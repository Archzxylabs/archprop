/**
 * Asserts that the golden path left the chain in the expected state.
 *
 * This is deliberately independent of the seed script: it only reads, so it
 * catches a seed that silently skipped a step or wrote the wrong value.
 *
 * Usage:
 *   tsx scripts/validate-state.ts [deployments/local.json]
 * Requires:
 *   ARCHPROP_INVESTORS="0x...,0x..." with exactly two distinct funded investor addresses.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";

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

export const RPC_URL = process.env.ARCHPROP_RPC_URL ?? "http://127.0.0.1:8545";
export const EXPECTED_CHAIN_ID = 31337;

/** Canonical Villa Nusa economics from docs/INTERFACES.md and PRD. */
export const CANONICAL_VILLA_NUSA = {
  assetId: "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae" as `0x${string}`,
  propertyValue: 10_000_000_000n,
  tokenSupply: 300_000n,
  tokenPrice: 10_000n,
  target: 3_000_000_000n,
  revenueAmount: 100_000_000n,
} as const;

/** Enums mirrored from ArchpropInterfaces.sol; see docs/INTERFACES.md. */
export const AssetStatus = {
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

export const OfferingStatus = { OPEN: 0, FUNDED: 1, FAILED: 2 } as const;

export const readAbi = parseAbi([
  "function assetStatus(bytes32 assetId) view returns (uint8)",
  "function assetToken(bytes32 assetId) view returns (address)",
  "function escrow() view returns (address)",
  "function allocationOf(uint256 offeringId, address investor) view returns (uint256)",
  "function paymentOf(uint256 offeringId, address investor) view returns (uint256)",
  "function tokensClaimed(uint256 offeringId, address investor) view returns (bool)",
  "function claimableRevenue(uint256 epochId, address investor) view returns (uint256)",
  "function revenueClaimed(uint256 epochId, address investor) view returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function getOffering(uint256 offeringId) view returns ((bytes32 assetId, address propertyToken, address paymentToken, uint256 target, uint256 tokenPrice, uint64 deadline, uint256 raised, address issuerTreasury, uint8 status, bool fundsReleased))",
  "function getRevenueEpoch(uint256 epochId) view returns ((bytes32 assetId, address propertyToken, address paymentToken, uint256 amount, uint256 totalSupply, uint64 claimDeadline, address funder, uint256 claimedAmount, bool closed))",
]);

/**
 * Validates and extracts exactly two distinct non-zero EVM investor addresses.
 * Fails closed on absent, empty, malformed, duplicate, or non-two-address input.
 */
export function parseInvestors(rawEnv?: string): [`0x${string}`, `0x${string}`] {
  if (!rawEnv || rawEnv.trim().length === 0) {
    throw new Error(
      "ARCHPROP_INVESTORS is missing or empty. Exactly two distinct funded investor addresses are required.",
    );
  }
  const parts = rawEnv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (parts.length !== 2) {
    throw new Error(
      `ARCHPROP_INVESTORS must contain exactly 2 addresses, received ${parts.length}.`,
    );
  }

  const isAddress = (a: string): a is `0x${string}` =>
    /^0x[a-fA-F0-9]{40}$/.test(a);

  for (const addr of parts) {
    if (!isAddress(addr)) {
      throw new Error(
        `Invalid investor address: "${addr}". Expected a 40-hex-character EVM address.`,
      );
    }
    if (addr.toLowerCase() === "0x0000000000000000000000000000000000000000") {
      throw new Error(
        `Investor address cannot be the zero address: "${addr}".`,
      );
    }
  }

  if (parts[0]!.toLowerCase() === parts[1]!.toLowerCase()) {
    throw new Error(
      `Duplicate investor address provided: "${parts[0]}". Two distinct investors are required.`,
    );
  }

  return [parts[0] as `0x${string}`, parts[1] as `0x${string}`];
}

export interface ValidatedContracts {
  registry: `0x${string}`;
  identityRegistry: `0x${string}`;
  mockIdr: `0x${string}`;
  offeringEscrow: `0x${string}`;
  revenueDistributor: `0x${string}`;
}

export interface ValidatedDeployment {
  chainId: number;
  contracts: ValidatedContracts;
  propertyToken: `0x${string}`;
  asset: {
    assetId: `0x${string}`;
    tokenSupply: bigint;
    tokenPrice: bigint;
    target: bigint;
  };
  offeringId?: bigint | undefined;
  epochId?: bigint | undefined;
}

const isNonZeroAddress = (addr: unknown): addr is `0x${string}` =>
  typeof addr === "string" &&
  /^0x[a-fA-F0-9]{40}$/i.test(addr) &&
  addr.toLowerCase() !== "0x0000000000000000000000000000000000000000";

/**
 * Validates the deployment JSON structure and values before any chain reads.
 * Fails closed on missing fields, wrong chain ID, zero addresses, or mismatched canonical values.
 */
export function validateDeploymentJson(raw: unknown): ValidatedDeployment {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid deployment file: content is not a valid JSON object.");
  }
  const d = raw as Record<string, any>;

  if (d.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Deployment targets chain ${d.chainId}, expected local Anvil chain ${EXPECTED_CHAIN_ID}.`,
    );
  }

  if (!d.contracts || typeof d.contracts !== "object") {
    throw new Error("Deployment file is missing 'contracts' mapping.");
  }

  const requiredContractKeys = [
    "registry",
    "identityRegistry",
    "mockIdr",
    "offeringEscrow",
    "revenueDistributor",
  ] as const;

  for (const key of requiredContractKeys) {
    if (!isNonZeroAddress(d.contracts[key])) {
      throw new Error(
        `Invalid or missing contract address for '${key}': "${d.contracts[key]}". Non-zero EVM address required.`,
      );
    }
  }

  if (!isNonZeroAddress(d.propertyToken)) {
    throw new Error(
      `Invalid or missing propertyToken address: "${d.propertyToken}". Non-zero EVM address required.`,
    );
  }

  if (!d.asset || typeof d.asset !== "object") {
    throw new Error("Deployment file is missing 'asset' definition.");
  }

  const assetId = d.asset.assetId;
  if (
    typeof assetId !== "string" ||
    assetId.toLowerCase() !== CANONICAL_VILLA_NUSA.assetId.toLowerCase()
  ) {
    throw new Error(
      `Deployment assetId "${assetId}" does not match canonical Villa Nusa assetId "${CANONICAL_VILLA_NUSA.assetId}".`,
    );
  }

  let supply: bigint;
  let price: bigint;
  let target: bigint;

  try {
    supply = BigInt(d.asset.tokenSupply);
    price = BigInt(d.asset.tokenPrice);
    target = BigInt(d.asset.target);
  } catch {
    throw new Error("Failed to parse numeric asset parameters (tokenSupply, tokenPrice, target) as BigInt.");
  }

  if (supply !== CANONICAL_VILLA_NUSA.tokenSupply) {
    throw new Error(
      `Deployment tokenSupply ${supply} does not match canonical ${CANONICAL_VILLA_NUSA.tokenSupply}.`,
    );
  }
  if (price !== CANONICAL_VILLA_NUSA.tokenPrice) {
    throw new Error(
      `Deployment tokenPrice ${price} does not match canonical ${CANONICAL_VILLA_NUSA.tokenPrice}.`,
    );
  }
  if (target !== CANONICAL_VILLA_NUSA.target) {
    throw new Error(
      `Deployment target ${target} does not match canonical ${CANONICAL_VILLA_NUSA.target}.`,
    );
  }

  let offeringId: bigint | undefined;
  if (d.offeringId !== undefined && d.offeringId !== null) {
    try {
      offeringId = BigInt(d.offeringId);
      if (offeringId <= 0n) throw new Error();
    } catch {
      throw new Error(`Invalid offeringId "${d.offeringId}" in deployment file; must be a positive integer.`);
    }
  }

  let epochId: bigint | undefined;
  if (d.epochId !== undefined && d.epochId !== null) {
    try {
      epochId = BigInt(d.epochId);
      if (epochId <= 0n) throw new Error();
    } catch {
      throw new Error(`Invalid epochId "${d.epochId}" in deployment file; must be a positive integer.`);
    }
  }

  return {
    chainId: d.chainId,
    contracts: {
      registry: d.contracts.registry,
      identityRegistry: d.contracts.identityRegistry,
      mockIdr: d.contracts.mockIdr,
      offeringEscrow: d.contracts.offeringEscrow,
      revenueDistributor: d.contracts.revenueDistributor,
    },
    propertyToken: d.propertyToken,
    asset: {
      assetId: assetId as `0x${string}`,
      tokenSupply: supply,
      tokenPrice: price,
      target,
    },
    offeringId,
    epochId,
  };
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export async function validateState(options?: {
  deploymentPath?: string | undefined;
  rpcUrl?: string | undefined;
  investors?: string | undefined;
}): Promise<{ ok: boolean; checks: CheckResult[] }> {
  const deploymentPath = getDeploymentPath(options?.deploymentPath);
  if (!existsSync(deploymentPath)) {
    throw new Error(
      `Deployment file not found at "${deploymentPath}". Run scripts/deploy-local.ts first.`,
    );
  }

  const rawDeployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
  const d = validateDeploymentJson(rawDeployment);
  const investors = parseInvestors(options?.investors ?? process.env.ARCHPROP_INVESTORS);

  const rpcUrl = options?.rpcUrl ?? RPC_URL;
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  if (Number(chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `RPC ${rpcUrl} reports chain ID ${chainId}, expected local Anvil chain ${EXPECTED_CHAIN_ID}.`,
    );
  }

  const checks: CheckResult[] = [];
  function check(name: string, ok: boolean, detail: string): void {
    checks.push({ name, ok, detail });
  }

  const registryAddress = d.contracts.registry;
  const escrowAddress = d.contracts.offeringEscrow;
  const distributorAddress = d.contracts.revenueDistributor;
  const propertyTokenAddress = d.propertyToken;
  const assetId = d.asset.assetId;
  const tokenSupply = d.asset.tokenSupply;
  const tokenPrice = d.asset.tokenPrice;

  // 1. Asset status
  const status = await publicClient.readContract({
    address: registryAddress,
    abi: readAbi,
    functionName: "assetStatus",
    args: [assetId],
  });
  check("asset is ACTIVE", Number(status) === AssetStatus.ACTIVE, `status=${Number(status)}`);

  // 2. Asset token linked
  const linkedToken = await publicClient.readContract({
    address: registryAddress,
    abi: readAbi,
    functionName: "assetToken",
    args: [assetId],
  });
  check(
    "asset token linked",
    linkedToken.toLowerCase() === propertyTokenAddress.toLowerCase(),
    `token=${linkedToken}`,
  );

  // 3. Registry escrow configured
  const configuredEscrow = await publicClient.readContract({
    address: registryAddress,
    abi: readAbi,
    functionName: "escrow",
  });
  check(
    "registry escrow configured",
    configuredEscrow.toLowerCase() === escrowAddress.toLowerCase(),
    `escrow=${configuredEscrow}`,
  );

  // 4. Derive/confirm offeringId
  let offeringId = d.offeringId;
  if (!offeringId) {
    try {
      const offeringLogs = await publicClient.getLogs({
        address: escrowAddress,
        event: parseAbiItem(
          "event OfferingCreated(uint256 indexed offeringId, bytes32 indexed assetId, address indexed token, uint256 target, uint256 tokenPrice, uint64 deadline)",
        ),
        args: { assetId },
        fromBlock: 0n,
      });
      if (offeringLogs.length > 0 && offeringLogs[offeringLogs.length - 1]?.args?.offeringId !== undefined) {
        offeringId = offeringLogs[offeringLogs.length - 1]!.args.offeringId!;
      } else {
        offeringId = 1n;
      }
    } catch {
      offeringId = 1n;
    }
  }

  // 5. Read Offering
  const o = await publicClient.readContract({
    address: escrowAddress,
    abi: readAbi,
    functionName: "getOffering",
    args: [offeringId],
  });
  check("offering FUNDED", Number(o.status) === OfferingStatus.FUNDED, `status=${Number(o.status)}`);
  check("offering funds released", o.fundsReleased === true, `fundsReleased=${o.fundsReleased}`);
  const target = tokenSupply * tokenPrice;
  check(
    "offering target fully raised",
    o.raised === o.target && o.target === target && o.raised === CANONICAL_VILLA_NUSA.target,
    `raised=${o.raised} target=${o.target} expected=${target}`,
  );
  check(
    "offering property token matches",
    o.propertyToken.toLowerCase() === propertyTokenAddress.toLowerCase(),
    `token=${o.propertyToken}`,
  );

  // 6. Token supply intact
  const supply = await publicClient.readContract({
    address: propertyTokenAddress,
    abi: readAbi,
    functionName: "totalSupply",
  });
  check("token supply intact", supply === tokenSupply && supply === CANONICAL_VILLA_NUSA.tokenSupply, `supply=${supply}`);

  // 7. Token balance of escrow is 0 (all claimed)
  const escrowTokenBal = await publicClient.readContract({
    address: propertyTokenAddress,
    abi: readAbi,
    functionName: "balanceOf",
    args: [escrowAddress],
  });
  check("escrow token balance zero", escrowTokenBal === 0n, `escrowBalance=${escrowTokenBal}`);

  // 8. Derive/confirm epochId
  let epochId = d.epochId;
  if (!epochId) {
    try {
      const revenueLogs = await publicClient.getLogs({
        address: distributorAddress,
        event: parseAbiItem(
          "event RevenuePublished(uint256 indexed epochId, bytes32 indexed assetId, uint256 amount, bytes32 evidenceHash, uint64 claimDeadline)",
        ),
        args: { assetId },
        fromBlock: 0n,
      });
      if (revenueLogs.length > 0 && revenueLogs[revenueLogs.length - 1]?.args?.epochId !== undefined) {
        epochId = revenueLogs[revenueLogs.length - 1]!.args.epochId!;
      } else {
        epochId = 1n;
      }
    } catch {
      epochId = 1n;
    }
  }

  // 9. Investor allocations, balances, payments, tokens claimed, and revenue claimed
  const expectedPerInvestor = tokenSupply / 2n; // 150,000
  const expectedPaymentPerInvestor = target / 2n; // 1,500,000,000

  for (const investor of investors) {
    const allocation = await publicClient.readContract({
      address: escrowAddress,
      abi: readAbi,
      functionName: "allocationOf",
      args: [offeringId, investor],
    });
    const balance = await publicClient.readContract({
      address: propertyTokenAddress,
      abi: readAbi,
      functionName: "balanceOf",
      args: [investor],
    });
    const payment = await publicClient.readContract({
      address: escrowAddress,
      abi: readAbi,
      functionName: "paymentOf",
      args: [offeringId, investor],
    });
    const claimedTokens = await publicClient.readContract({
      address: escrowAddress,
      abi: readAbi,
      functionName: "tokensClaimed",
      args: [offeringId, investor],
    });

    check(
      `allocation ${investor.slice(0, 10)}`,
      allocation === expectedPerInvestor && allocation === 150_000n,
      `allocation=${allocation} expected=${expectedPerInvestor}`,
    );
    check(
      `balance ${investor.slice(0, 10)}`,
      balance === expectedPerInvestor && balance === allocation,
      `balance=${balance} allocation=${allocation}`,
    );
    check(
      `payment ${investor.slice(0, 10)}`,
      payment === expectedPaymentPerInvestor && payment === 1_500_000_000n,
      `payment=${payment} expected=${expectedPaymentPerInvestor}`,
    );
    check(
      `tokens claimed ${investor.slice(0, 10)}`,
      claimedTokens === true,
      `claimed=${claimedTokens}`,
    );

    const claimable = await publicClient.readContract({
      address: distributorAddress,
      abi: readAbi,
      functionName: "claimableRevenue",
      args: [epochId, investor],
    });
    const revClaimed = await publicClient.readContract({
      address: distributorAddress,
      abi: readAbi,
      functionName: "revenueClaimed",
      args: [epochId, investor],
    });
    check(
      `revenue settled ${investor.slice(0, 10)}`,
      claimable === 0n,
      `claimable=${claimable}`,
    );
    check(
      `revenue claimed ${investor.slice(0, 10)}`,
      revClaimed === true,
      `claimed=${revClaimed}`,
    );
  }

  // 10. Revenue Epoch
  const e = await publicClient.readContract({
    address: distributorAddress,
    abi: readAbi,
    functionName: "getRevenueEpoch",
    args: [epochId],
  });
  check("epoch closed", e.closed === true, `closed=${e.closed}`);
  check(
    "epoch fully claimed",
    e.claimedAmount === e.amount && e.amount === CANONICAL_VILLA_NUSA.revenueAmount,
    `claimed=${e.claimedAmount} amount=${e.amount}`,
  );
  check(
    "epoch property token matches",
    e.propertyToken.toLowerCase() === propertyTokenAddress.toLowerCase(),
    `token=${e.propertyToken}`,
  );

  const allPassed = checks.every((c) => c.ok);
  return { ok: allPassed, checks };
}

async function main(): Promise<void> {
  const result = await validateState({
    deploymentPath: process.argv[2],
  });

  const failed = result.checks.filter((c) => !c.ok);
  for (const c of result.checks) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.ok ? "" : ` — ${c.detail}`}`);
  }

  console.log(`\n${result.checks.length - failed.length}/${result.checks.length} checks passed.`);
  if (failed.length > 0 || !result.ok) {
    console.error(`${failed.length} check(s) failed.`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("validate-state.ts")) {
  main().catch((error: unknown) => {
    console.error(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
