/**
 * Asserts that the golden path left the chain in the expected state.
 *
 * This is deliberately independent of the seed script: it only reads, so it
 * catches a seed that silently skipped a step or wrote the wrong value.
 *
 * Usage:
 *   tsx scripts/validate-state.ts [deployments/local.json]
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi } from "viem";

function findRepoRoot(fromDir: string): string {
  let cur = fromDir;
  while (cur !== dirname(cur)) {
    if (existsSync(join(cur, "packages/chain")) && existsSync(join(cur, "docs"))) {
      return cur;
    }
    cur = dirname(cur);
  }
  return resolve(fromDir, "..");
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = findRepoRoot(MODULE_DIR);

export function getDeploymentPath(cliArg?: string): string {
  if (cliArg && cliArg.trim().length > 0) {
    const trimmed = cliArg.trim();
    return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
  }
  const custom = process.env.ARCHPROP_DEPLOYMENT_PATH?.trim();
  if (custom && custom.length > 0) {
    return isAbsolute(custom) ? custom : resolve(REPO_ROOT, custom);
  }
  return resolve(REPO_ROOT, "deployments/local.json");
}

const RPC_URL = process.env.ARCHPROP_RPC_URL ?? "http://127.0.0.1:8545";
const EXPECTED_CHAIN_ID = 31337;

/** Enums mirrored from ArchpropInterfaces.sol; see docs/INTERFACES.md. */
const AssetStatus = {
  SUBMITTED: 0,
  UNDER_VERIFICATION: 1,
  VERIFIED: 2,
  ISSUANCE_READY: 3,
  OFFERING: 4,
  FUNDED: 5,
  ACTIVE: 6,
  REJECTED: 7,
  FAILED: 8,
} as const;
const OfferingStatus = { OPEN: 0, FUNDED: 1, FAILED: 2 } as const;

const readAbi = parseAbi([
  "function assetStatus(bytes32 assetId) view returns (uint8)",
  "function assetToken(bytes32 assetId) view returns (address)",
  "function escrow() view returns (address)",
  "function allocationOf(uint256 offeringId, address investor) view returns (uint256)",
  "function paymentOf(uint256 offeringId, address investor) view returns (uint256)",
  "function claimableRevenue(uint256 epochId, address investor) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  // `_offerings` and `_epochs` are private storage, so the only read path is the
  // struct-returning view. Field order mirrors ArchpropInterfaces.sol.
  "function getOffering(uint256 offeringId) view returns ((bytes32 assetId, address propertyToken, address paymentToken, uint256 target, uint256 tokenPrice, uint64 deadline, uint256 raised, address issuerTreasury, uint8 status, bool fundsReleased))",
  "function getRevenueEpoch(uint256 epochId) view returns ((bytes32 assetId, address propertyToken, address paymentToken, uint256 amount, uint256 totalSupply, uint64 claimDeadline, address funder, uint256 claimedAmount, bool closed))",
]);

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

async function main(): Promise<void> {
  const deploymentPath = getDeploymentPath(process.argv[2]);
  if (!existsSync(deploymentPath)) {
    throw new Error(
      `Deployment file not found at "${deploymentPath}". Run scripts/deploy-local.ts first.`,
    );
  }
  const d = JSON.parse(readFileSync(deploymentPath, "utf8")) as {
    chainId: number;
    contracts: {
      registry: `0x${string}`;
      identityRegistry: `0x${string}`;
      mockIdr: `0x${string}`;
      offeringEscrow: `0x${string}`;
      revenueDistributor: `0x${string}`;
    };
    propertyToken: `0x${string}`;
    asset: { assetId: `0x${string}`; tokenSupply: string; tokenPrice: string };
  };

  if (d.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`deployment targets chain ${d.chainId}, expected ${EXPECTED_CHAIN_ID}`);
  }
  if (!d.propertyToken || !d.asset?.assetId) {
    throw new Error("deployment is missing propertyToken or asset.assetId");
  }

  const registryAddress = d.contracts.registry;
  const escrowAddress = d.contracts.offeringEscrow;
  const distributorAddress = d.contracts.revenueDistributor;
  const propertyTokenAddress = d.propertyToken;
  const assetId = d.asset.assetId;
  const tokenSupply = BigInt(d.asset.tokenSupply);
  const tokenPrice = BigInt(d.asset.tokenPrice);

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const chainId = await publicClient.getChainId();
  if (Number(chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error(`RPC ${RPC_URL} reports chain ${chainId}, expected ${EXPECTED_CHAIN_ID}`);
  }

  const registry = { address: registryAddress, abi: readAbi };
  const escrow = { address: escrowAddress, abi: readAbi };
  const distributor = { address: distributorAddress, abi: readAbi };
  const token = { address: propertyTokenAddress, abi: readAbi };

  const status = await publicClient.readContract({ ...registry, functionName: "assetStatus", args: [assetId] });
  check("asset is ACTIVE", Number(status) === AssetStatus.ACTIVE, `status=${Number(status)}`);

  const linkedToken = await publicClient.readContract({ ...registry, functionName: "assetToken", args: [assetId] });
  check("asset token linked", linkedToken.toLowerCase() === propertyTokenAddress.toLowerCase(), `token=${linkedToken}`);

  const configuredEscrow = await publicClient.readContract({ ...registry, functionName: "escrow" });
  check("registry escrow configured", configuredEscrow.toLowerCase() === escrowAddress.toLowerCase(), `escrow=${configuredEscrow}`);

  // Struct returns arrive as a named object, so fields are read by name here.
  const o = await publicClient.readContract({ ...escrow, functionName: "getOffering", args: [1n] });
  check("offering FUNDED", Number(o.status) === OfferingStatus.FUNDED, `status=${Number(o.status)}`);
  check("funds released", o.fundsReleased === true, `fundsReleased=${o.fundsReleased}`);

  const target = tokenSupply * tokenPrice;
  check("target fully raised", o.raised === o.target && o.target === target, `raised=${o.raised} target=${o.target} expected=${target}`);
  check("offering token matches", o.propertyToken.toLowerCase() === propertyTokenAddress.toLowerCase(), `token=${o.propertyToken}`);

  const supply = await publicClient.readContract({ ...token, functionName: "totalSupply" });
  check("token supply intact", supply === tokenSupply, `supply=${supply}`);

  // The seed splits the target across two investors, so each should hold and be
  // owed exactly half the supply in tokens.
  const expectedPerInvestor = tokenSupply / 2n;
  const investors = (process.env.ARCHPROP_INVESTORS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const investor of investors) {
    const address = investor as `0x${string}`;
    const allocation = await publicClient.readContract({ ...escrow, functionName: "allocationOf", args: [1n, address] });
    const balance = await publicClient.readContract({ ...token, functionName: "balanceOf", args: [address] });
    check(`allocation ${address.slice(0, 10)}`, allocation === expectedPerInvestor, `allocation=${allocation} expected=${expectedPerInvestor}`);
    check(`balance ${address.slice(0, 10)}`, balance === allocation, `balance=${balance} allocation=${allocation}`);
    // A closed epoch must leave nothing claimable for a holder who claimed.
    const claimable = await publicClient.readContract({ ...distributor, functionName: "claimableRevenue", args: [1n, address] });
    check(`revenue settled ${address.slice(0, 10)}`, claimable === 0n, `claimable=${claimable}`);
  }

  // Same struct-return shape for the epoch.
  const e = await publicClient.readContract({ ...distributor, functionName: "getRevenueEpoch", args: [1n] });
  check("epoch closed", e.closed === true, `closed=${e.closed}`);
  check("epoch fully claimed", e.claimedAmount === e.amount, `claimed=${e.claimedAmount} amount=${e.amount}`);

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.ok ? "" : ` — ${c.detail}`}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length > 0) {
    console.error(`${failed.length} check(s) failed.`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
