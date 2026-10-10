/**
 * Drives the frozen ARCHPROP lifecycle against a locally deployed contract set,
 * proving the whole golden path end to end on Anvil.
 *
 * The sequence follows the frozen protocol rules in docs/INTERFACES.md:
 * asset creation, dual attestation, agreement, issuance, token linking,
 * offering, funded investment, token claims, fund release, revenue
 * publication, and revenue claims. Each step asserts the on-chain result it
 * expects, so a contract regression fails here instead of surfacing later in
 * the UI.
 *
 * Usage: tsx scripts/seed-local.ts
 * Requires: scripts/deploy-local.ts to have written deployments/local.json
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createWalletClient, createPublicClient, http, keccak256, toBytes } from "viem";
import { parseAmount } from "../packages/chain/src/numbers";

const require = createRequire(import.meta.url);

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

/**
 * Resolves the Foundry artifacts directory.
 * Defaults to module-relative `packages/contracts/out` from the repository root,
 * or uses ARCHPROP_ARTIFACTS_DIR.
 */
export function getArtifactsDir(customDir?: string): string {
  const dir = customDir?.trim() || process.env.ARCHPROP_ARTIFACTS_DIR?.trim();
  if (dir && dir.length > 0) {
    return isAbsolute(dir) ? dir : resolve(REPO_ROOT, dir);
  }
  return resolve(REPO_ROOT, "packages/contracts/out");
}

/**
 * Resolves the local deployment file path.
 * Defaults to module-relative `deployments/local.json` from the repository root,
 * or uses ARCHPROP_DEPLOYMENT_PATH.
 */
export function getDeploymentPath(customPath?: string): string {
  const p = customPath?.trim() || process.env.ARCHPROP_DEPLOYMENT_PATH?.trim();
  if (p && p.length > 0) {
    return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
  }
  return resolve(REPO_ROOT, "deployments/local.json");
}

/** Local Anvil chain; see deploy-local.ts for why this is defined here. */
export const ANVIL_CHAIN = {
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
} as const;

/**
 * Local dev accounts fetched dynamically from unlocked Anvil node.
 * Role-to-account mapping is explicit with distinct addresses per role.
 */
export interface RoleAccounts {
  readonly admin: `0x${string}`;
  readonly owner: `0x${string}`;
  readonly legalVerifier: `0x${string}`;
  readonly valuationVerifier: `0x${string}`;
  readonly revenueVerifier: `0x${string}`;
  readonly structurer: `0x${string}`;
  readonly investor1: `0x${string}`;
  readonly investor2: `0x${string}`;
}

/** Asset status enum, matching the frozen Solidity declaration (docs/INTERFACES.md). */
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

/** Offering status enum. */
const OfferingStatus = { OPEN: 0, FUNDED: 1, FAILED: 2 } as const;

/** Attestation kind enum. */
const AttestationType = { OWNERSHIP: 0, VALUATION: 1, REVENUE: 2 } as const;

function artifact(name: string, artifactsDir: string): { abi: unknown[]; bytecode: `0x${string}` } {
  const path = join(artifactsDir, `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Foundry artifact for "${name}" not found at "${path}". ` +
        `Ensure packages/contracts has been compiled (via 'forge build') or specify ARCHPROP_ARTIFACTS_DIR. ` +
        `If SC-001 is not merged into this worktree, contract artifacts are unavailable.`,
    );
  }
  const a = require(path) as { abi: unknown[]; bytecode?: { object?: string } };
  const object = a.bytecode?.object;
  if (!object || typeof object !== "string" || !object.startsWith("0x")) {
    throw new Error(`${name} artifact bytecode is missing or not 0x-prefixed`);
  }
  return { abi: a.abi, bytecode: object as `0x${string}` };
}

/** Matches Solidity's `keccak256("STRUCTURER_ROLE")` role identifier. */
function roleHash(role: string): `0x${string}` {
  return keccak256(toBytes(role));
}

interface Deployment {
  chainId: number;
  contracts: {
    registry: string;
    identityRegistry: string;
    mockIdr: string;
    offeringEscrow: string;
    revenueDistributor: string;
  };
  propertyToken: string;
  asset: {
    assetId: string;
    metadataHash: string;
    agreementHash: string;
    tokenSupply: string;
    tokenPrice: string;
  };
}

async function main(): Promise<void> {
  const artifactsDir = getArtifactsDir();
  if (!existsSync(artifactsDir)) {
    throw new Error(
      `Foundry artifacts directory not found at "${artifactsDir}". ` +
        `Ensure packages/contracts has been built with 'forge build' or set ARCHPROP_ARTIFACTS_DIR. ` +
        `If SC-001 is not merged, contract artifacts are unavailable in this worktree.`,
    );
  }

  const rpcUrl = process.env.ARCHPROP_RPC_URL ?? process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ?? "http://127.0.0.1:8545";
  const publicClient = createPublicClient({ chain: ANVIL_CHAIN, transport: http(rpcUrl) });
  // Deadlines are compared against `block.timestamp`, so they are anchored to
  // the chain clock rather than the host clock — earlier runs may have used
  // `evm_increaseTime`, which leaves the two out of sync.
  async function chainNow(): Promise<bigint> {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    return block.timestamp;
  }

  const chainId = await publicClient.getChainId();
  if (Number(chainId) !== ANVIL_CHAIN.id) {
    throw new Error(`Refusing to seed: expected Anvil chain ${ANVIL_CHAIN.id}, got ${chainId}.`);
  }

  const walletClient = createWalletClient({ chain: ANVIL_CHAIN, transport: http(rpcUrl) });

  // Obtain unlocked accounts dynamically from local Anvil RPC
  const rawAccounts = await walletClient.getAddresses();
  if (!rawAccounts || rawAccounts.length < 8) {
    throw new Error(
      `Anvil RPC provided ${rawAccounts?.length ?? 0} unlocked accounts; at least 8 distinct accounts are required.`,
    );
  }

  const admin = rawAccounts[0]!;
  const owner = rawAccounts[1]!;
  const legalVerifier = rawAccounts[2]!;
  const valuationVerifier = rawAccounts[3]!;
  const revenueVerifier = rawAccounts[4]!;
  const structurer = rawAccounts[5]!;
  const investor1 = rawAccounts[6]!;
  const investor2 = rawAccounts[7]!;

  const selected = [admin, owner, legalVerifier, valuationVerifier, revenueVerifier, structurer, investor1, investor2];
  const distinct = new Set(selected.map((a) => a.toLowerCase()));
  if (distinct.size < 8) {
    throw new Error(
      `Anvil unlocked accounts are not all distinct (${distinct.size} distinct out of 8).`,
    );
  }

  // Verify all 8 accounts are funded with positive balance
  for (const address of selected) {
    const balance = await publicClient.getBalance({ address });
    if (balance === 0n) {
      throw new Error(`Account ${address} has zero balance on Anvil.`);
    }
  }

  const accounts: RoleAccounts = {
    admin,
    owner,
    legalVerifier,
    valuationVerifier,
    revenueVerifier,
    structurer,
    investor1,
    investor2,
  };

  const deploymentPath = getDeploymentPath();
  if (!existsSync(deploymentPath)) {
    throw new Error(
      `Deployment file not found at "${deploymentPath}". Run scripts/deploy-local.ts first.`,
    );
  }

  const deployment: Deployment = JSON.parse(
    readFileSync(deploymentPath, "utf8"),
  );
  const c = deployment.contracts;
  const propertyToken = deployment.propertyToken;
  const assetId = deployment.asset.assetId as `0x${string}`;

  const wallet = (account: `0x${string}`) =>
    createWalletClient({ account, chain: ANVIL_CHAIN, transport: http(rpcUrl) });

  /** Writes a transaction and asserts it succeeded, returning its receipt. */
  async function send(
    label: string,
    account: `0x${string}`,
    address: `0x${string}`,
    abi: unknown[],
    functionName: string,
    args: unknown[],
  ) {
    const { request } = await publicClient.simulateContract({
      account,
      address,
      abi: abi as any,
      functionName,
      args: args as any,
    });
    const hash = await wallet(account).writeContract(request as any);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${label}: transaction reverted (${hash})`);
    }
    console.log(`  ✓ ${label}`);
    return receipt;
  }

  function read<T>(address: `0x${string}`, abi: unknown[], functionName: string, args: unknown[] = []): Promise<T> {
    return publicClient.readContract({ address, abi, functionName, args }) as Promise<T>;
  }

  const registryAbi = artifact("ArchpropRegistry", artifactsDir).abi;
  const identityAbi = artifact("IdentityRegistry", artifactsDir).abi;
  const mockIdrAbi = artifact("MockIDR", artifactsDir).abi;
  const escrowAbi = artifact("OfferingEscrow", artifactsDir).abi;
  const tokenAbi = artifact("PropertyToken", artifactsDir).abi;
  const distributorAbi = artifact("RevenueDistributor", artifactsDir).abi;

  console.log(`Seeding golden path against ${rpcUrl}\n`);

  // ---- 1. roles -------------------------------------------------------
  console.log("1. Granting roles");
  // Assign distinct addresses to legal verifier, valuation verifier, revenue verifier, and structurer.
  // Grant each verifier only its respective role.
  const roleGrants: Array<[string, `0x${string}`, unknown[], string, `0x${string}`]> = [
    ["registry", c.registry as `0x${string}`, registryAbi, "LEGAL_VERIFIER_ROLE", legalVerifier],
    ["registry", c.registry as `0x${string}`, registryAbi, "VALUATION_VERIFIER_ROLE", valuationVerifier],
    ["registry", c.registry as `0x${string}`, registryAbi, "REVENUE_VERIFIER_ROLE", revenueVerifier],
    ["registry", c.registry as `0x${string}`, registryAbi, "STRUCTURER_ROLE", structurer],
    ["escrow", c.offeringEscrow as `0x${string}`, escrowAbi, "STRUCTURER_ROLE", structurer],
  ];
  for (const [contract, address, abi, role, holder] of roleGrants) {
    await send(`${contract}.grantRole(${role})`, admin, address, abi, "grantRole", [roleHash(role), holder]);
  }

  // ---- 2. investor approval + demo funds -----------------------------
  console.log("\n2. Approving investors and funding demo currency");
  for (const investor of [investor1, investor2]) {
    await send(`setInvestorApproval(${investor})`, admin, c.identityRegistry as `0x${string}`, identityAbi, "setInvestorApproval", [investor, true]);
  }
  // mIDR has zero decimals, so amounts are exact whole units.
  // Each investor needs 1,500,000,000 mIDR to fund their 150,000-token allocation (10,000 mIDR/token).
  // The faucet is capped at 10,000,000,000 per call; 2,000,000,000 is requested for each.
  const INVESTOR_FAUCET_AMOUNT = 2_000_000_000n;
  for (const account of [investor1, investor2]) {
    await send(`faucet(${account})`, account, c.mockIdr as `0x${string}`, mockIdrAbi, "faucet", [INVESTOR_FAUCET_AMOUNT]);
  }
  // The admin also needs mIDR, because `publishRevenue` is admin-gated but
  // pulls the deposited amount from the caller.
  const REVENUE_FAUCET_AMOUNT = 1_000_000_000n;
  await send(`faucet(${admin})`, admin, c.mockIdr as `0x${string}`, mockIdrAbi, "faucet", [REVENUE_FAUCET_AMOUNT]);

  // ---- 3. asset creation and verification ----------------------------
  console.log("\n3. Asset lifecycle");
  const metadataHash = deployment.asset.metadataHash as `0x${string}`;
  await send("createAsset", owner, c.registry as `0x${string}`, registryAbi, "createAsset", [assetId, metadataHash]);
  await send("beginVerification", owner, c.registry as `0x${string}`, registryAbi, "beginVerification", [assetId]);

  // Submit OWNERSHIP from legalVerifier wallet
  await send(
    "submitAttestation(OWNERSHIP)",
    legalVerifier,
    c.registry as `0x${string}`,
    registryAbi,
    "submitAttestation",
    [assetId, AttestationType.OWNERSHIP, "0x" + "44".repeat(32), 0n],
  );
  // Canonical Villa Nusa indicative property valuation is 10,000,000,000 IDR equivalent (docs/INTERFACES.md)
  // Submit VALUATION from valuationVerifier wallet
  await send(
    "submitAttestation(VALUATION)",
    valuationVerifier,
    c.registry as `0x${string}`,
    registryAbi,
    "submitAttestation",
    [assetId, AttestationType.VALUATION, "0x" + "55".repeat(32), 10_000_000_000n],
  );

  // Invariant assertions: legal and valuation attestations record different verifier addresses and neither is the owner
  const legalAttestation = await read<{ verifier: string; valid: boolean }>(
    c.registry as `0x${string}`,
    registryAbi,
    "getLatestAttestation",
    [assetId, AttestationType.OWNERSHIP],
  );
  const valuationAttestation = await read<{ verifier: string; valid: boolean }>(
    c.registry as `0x${string}`,
    registryAbi,
    "getLatestAttestation",
    [assetId, AttestationType.VALUATION],
  );

  if (legalAttestation.verifier.toLowerCase() !== legalVerifier.toLowerCase()) {
    throw new Error(`Legal attestation verifier mismatch: expected ${legalVerifier}, got ${legalAttestation.verifier}`);
  }
  if (valuationAttestation.verifier.toLowerCase() !== valuationVerifier.toLowerCase()) {
    throw new Error(`Valuation attestation verifier mismatch: expected ${valuationVerifier}, got ${valuationAttestation.verifier}`);
  }
  if (legalAttestation.verifier.toLowerCase() === valuationAttestation.verifier.toLowerCase()) {
    throw new Error(`Legal and valuation attestations must record different verifier addresses`);
  }
  if (legalAttestation.verifier.toLowerCase() === owner.toLowerCase()) {
    throw new Error(`Legal verifier must not be asset owner`);
  }
  if (valuationAttestation.verifier.toLowerCase() === owner.toLowerCase()) {
    throw new Error(`Valuation verifier must not be asset owner`);
  }

  await send("finalizeVerification", owner, c.registry as `0x${string}`, registryAbi, "finalizeVerification", [assetId]);
  const statusAfterVerify = await read<number>(c.registry as `0x${string}`, registryAbi, "assetStatus", [assetId]);
  if (statusAfterVerify !== AssetStatus.VERIFIED) {
    throw new Error(`expected VERIFIED, got ${statusAfterVerify}`);
  }

  const agreementHash = deployment.asset.agreementHash as `0x${string}`;
  await send("registerAgreement", structurer, c.registry as `0x${string}`, registryAbi, "registerAgreement", [assetId, agreementHash]);
  await send("markIssuanceReady", structurer, c.registry as `0x${string}`, registryAbi, "markIssuanceReady", [assetId]);
  const statusIssuance = await read<number>(c.registry as `0x${string}`, registryAbi, "assetStatus", [assetId]);
  if (statusIssuance !== AssetStatus.ISSUANCE_READY) {
    throw new Error(`expected ISSUANCE_READY, got ${statusIssuance}`);
  }

  await send("linkToken", structurer, c.registry as `0x${string}`, registryAbi, "linkToken", [assetId, propertyToken as `0x${string}`]);

  // The token supply is minted exactly once, to the escrow, in PropertyToken's constructor (ADR-003).
  const totalSupply = await read<bigint>(propertyToken as `0x${string}`, tokenAbi, "totalSupply");
  const escrowBalance = await read<bigint>(propertyToken as `0x${string}`, tokenAbi, "balanceOf", [c.offeringEscrow as `0x${string}`]);
  if (escrowBalance !== totalSupply) {
    throw new Error(`expected escrow to hold the full supply, got ${escrowBalance} of ${totalSupply}`);
  }

  // ---- 4. offering and investment -----------------------------------
  console.log("\n4. Offering and investment");
  const tokenSupply = parseAmount(deployment.asset.tokenSupply); // 300,000 AVNUSA
  const tokenPrice = parseAmount(deployment.asset.tokenPrice);   // 10,000 mIDR
  const target = tokenSupply * tokenPrice;                       // 3,000,000,000 mIDR
  const deadline = (await chainNow()) + BigInt(7 * 24 * 60 * 60);
  const perInvestorTokens = tokenSupply / 2n;                    // 150,000 AVNUSA
  const perInvestorPayment = perInvestorTokens * tokenPrice;     // 1,500,000,000 mIDR

  await send("createOffering", structurer, c.offeringEscrow as `0x${string}`, escrowAbi, "createOffering", [
    assetId,
    propertyToken as `0x${string}`,
    c.mockIdr as `0x${string}`,
    target,
    tokenPrice,
    deadline,
    owner,
  ]);

  // Approvals must precede investment: `invest` pulls payment tokens with
  // `transferFrom`, so an unapproved investor reverts on allowance.
  for (const investor of [investor1, investor2]) {
    await send(`approve escrow (${investor})`, investor, c.mockIdr as `0x${string}`, mockIdrAbi, "approve", [c.offeringEscrow as `0x${string}`, perInvestorPayment]);
    await send(`invest(${investor})`, investor, c.offeringEscrow as `0x${string}`, escrowAbi, "invest", [1n, perInvestorPayment]);
  }

  // ---- 5. finalize, claim tokens, release funds ----------------------
  console.log("\n5. Finalization and settlement");
  await send("finalizeSuccessfulOffering", admin, c.offeringEscrow as `0x${string}`, escrowAbi, "finalizeSuccessfulOffering", [1n]);

  for (const investor of [investor1, investor2]) {
    await send(`claimTokens(${investor})`, investor, c.offeringEscrow as `0x${string}`, escrowAbi, "claimTokens", [1n]);
    const balance = await read<bigint>(propertyToken as `0x${string}`, tokenAbi, "balanceOf", [investor]);
    if (balance !== perInvestorTokens) {
      throw new Error(`expected ${investor} to hold ${perInvestorTokens} tokens, got ${balance}`);
    }
  }

  await send("releaseFunds", admin, c.offeringEscrow as `0x${string}`, escrowAbi, "releaseFunds", [1n]);
  const statusActive = await read<number>(c.registry as `0x${string}`, registryAbi, "assetStatus", [assetId]);
  if (statusActive !== AssetStatus.ACTIVE) {
    throw new Error(`expected ACTIVE after release, got ${statusActive}`);
  }

  // ---- 6. revenue publication and claims ----------------------------
  console.log("\n6. Revenue distribution");
  // Revenue publication needs a matching REVENUE attestation and an exact
  // mIDR deposit in the same transaction.
  const revenueAmount = 100_000_000n; // 100M mIDR simulated revenue
  const evidenceHash = "0x" + "66".repeat(32) as `0x${string}`;
  // A short claim window keeps the epoch closable within this run; closing it
  // is the terminal step of the golden path.
  const claimDeadline = (await chainNow()) + BigInt(2 * 60 * 60);

  // Submit REVENUE attestation from revenueVerifier wallet
  await send(
    "submitAttestation(REVENUE)",
    revenueVerifier,
    c.registry as `0x${string}`,
    registryAbi,
    "submitAttestation",
    [assetId, AttestationType.REVENUE, evidenceHash, revenueAmount],
  );

  const revenueAttestation = await read<{ verifier: string; valid: boolean }>(
    c.registry as `0x${string}`,
    registryAbi,
    "getLatestAttestation",
    [assetId, AttestationType.REVENUE],
  );
  if (revenueAttestation.verifier.toLowerCase() !== revenueVerifier.toLowerCase()) {
    throw new Error(`Revenue attestation verifier mismatch: expected ${revenueVerifier}, got ${revenueAttestation.verifier}`);
  }
  if (revenueAttestation.verifier.toLowerCase() === owner.toLowerCase()) {
    throw new Error(`Revenue verifier must not be asset owner`);
  }

  // `publishRevenue` is default-admin gated and pulls the deposited amount from
  // the caller, so the admin both holds mIDR and signs this call.
  await send("approve distributor", admin, c.mockIdr as `0x${string}`, mockIdrAbi, "approve", [c.revenueDistributor as `0x${string}`, revenueAmount]);
  await send("publishRevenue", admin, c.revenueDistributor as `0x${string}`, distributorAbi, "publishRevenue", [
    assetId,
    propertyToken as `0x${string}`,
    c.mockIdr as `0x${string}`,
    revenueAmount,
    evidenceHash,
    claimDeadline,
  ]);

  for (const investor of [investor1, investor2]) {
    await send(`claimRevenue(${investor})`, investor, c.revenueDistributor as `0x${string}`, distributorAbi, "claimRevenue", [1n]);
  }

  // Closing the epoch is refused until the claim window has elapsed, so the
  // chain is advanced past it. Anvil-only; guarded by the chain check above.
  const secondsUntilDeadline = Number(claimDeadline - (await chainNow()));
  await publicClient.request({ method: "evm_increaseTime", params: [secondsUntilDeadline + 60] } as never);
  await publicClient.request({ method: "evm_mine", params: [] } as never);
  await send("closeRevenueEpoch", admin, c.revenueDistributor as `0x${string}`, distributorAbi, "closeRevenueEpoch", [1n]);

  console.log("\nGolden path complete.");
  console.log(`  assetId:          ${assetId}`);
  console.log(`  offering:         1`);
  console.log(`  epoch:            1`);
  console.log(`  revenue released: ${revenueAmount} mIDR`);
  console.log(`  investors:        ${[investor1, investor2].join(",")}`);
}

main().catch((error: unknown) => {
  console.error(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
