/**
 * E2E Local Anvil Runner and Golden-Path Orchestrator.
 *
 * Requirements:
 * - Target Anvil only (chain ID 31337); refuse any other chain.
 * - Consume repository-relative Foundry artifacts (or explicitly supplied via ARCHPROP_ARTIFACTS_DIR).
 * - Deploy, seed, and validate the canonical Villa Nusa golden path once contracts are present.
 * - Return non-zero on any failed receipt or invariant.
 * - If SC-001 is unavailable in this worktree, report/skip with an explicit missing-contract prerequisite.
 *   Never report the golden path as passed if contracts were missing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  toBytes,
  type PublicClient,
} from "viem";

const require = createRequire(import.meta.url);

function findRepoRoot(fromDir: string): string {
  let cur = fromDir;
  while (cur !== dirname(cur)) {
    if (existsSync(join(cur, "packages/chain")) && existsSync(join(cur, "docs"))) {
      return cur;
    }
    cur = dirname(cur);
  }
  return resolve(fromDir, "../../..");
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = findRepoRoot(MODULE_DIR);

export const ANVIL_CHAIN_ID = 31337;

export const ANVIL_CHAIN = {
  id: ANVIL_CHAIN_ID,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
} as const;

/** Canonical Villa Nusa constants per PRD and docs/INTERFACES.md. */
export const CANONICAL_VILLA_NUSA = {
  assetId: "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae" as `0x${string}`,
  name: "Archprop Villa Nusa",
  symbol: "AVNUSA",
  propertyValue: 10_000_000_000n,
  tokenSupply: 300_000n,
  tokenPrice: 10_000n,
  target: 3_000_000_000n,
  metadataHash: ("0x" + "22".repeat(32)) as `0x${string}`,
  agreementHash: ("0x" + "33".repeat(32)) as `0x${string}`,
} as const;

/** AssetStatus enum in frozen numeric order (docs/INTERFACES.md). */
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
export const AttestationType = { OWNERSHIP: 0, VALUATION: 1, REVENUE: 2 } as const;

/**
 * Local role accounts interface. Every role is assigned a distinct address.
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

/**
 * Fetches unlocked accounts directly from local Anvil node via RPC.
 * Refuses any non-Anvil target, requires at least 8 distinct accounts,
 * and asserts that every account has a positive balance.
 */
export async function getUnlockedAnvilAccounts(
  publicClient: PublicClient,
  customWalletClient?: ReturnType<typeof createWalletClient>,
): Promise<RoleAccounts> {
  const chainId = await publicClient.getChainId();
  if (Number(chainId) !== ANVIL_CHAIN_ID) {
    throw new Error(
      `Unexpected chain ID ${chainId}. Local account auto-detection targets Anvil only (${ANVIL_CHAIN_ID}).`,
    );
  }

  const wc =
    customWalletClient ??
    createWalletClient({
      chain: ANVIL_CHAIN,
      transport: http("http://127.0.0.1:8545"),
    });

  const rawAccounts = await wc.getAddresses();
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

  for (const address of selected) {
    const balance = await publicClient.getBalance({ address });
    if (balance === 0n) {
      throw new Error(`Account ${address} has zero balance on Anvil.`);
    }
  }

  return {
    admin,
    owner,
    legalVerifier,
    valuationVerifier,
    revenueVerifier,
    structurer,
    investor1,
    investor2,
  };
}

export const REQUIRED_CONTRACTS = [
  "ArchpropRegistry",
  "IdentityRegistry",
  "MockIDR",
  "OfferingEscrow",
  "RevenueDistributor",
  "PropertyToken",
] as const;

export interface ArtifactCheck {
  available: boolean;
  artifactsDir: string;
  missingArtifacts: string[];
  diagnostic: string;
}

/**
 * Resolves the Foundry artifacts directory.
 * Priority:
 * 1. Explicit argument or ARCHPROP_ARTIFACTS_DIR environment variable
 * 2. Module-relative packages/contracts/out from repository root
 */
export function resolveArtifactsDir(customDir?: string): string {
  const dir = customDir?.trim() || process.env.ARCHPROP_ARTIFACTS_DIR?.trim();
  if (dir && dir.length > 0) {
    return isAbsolute(dir) ? dir : resolve(REPO_ROOT, dir);
  }
  return resolve(REPO_ROOT, "packages/contracts/out");
}

/**
 * Resolves the local deployment file path.
 * Priority:
 * 1. Explicit argument or ARCHPROP_DEPLOYMENT_PATH environment variable
 * 2. Module-relative deployments/local.json from repository root
 */
export function getDeploymentPath(customPath?: string): string {
  const p = customPath?.trim() || process.env.ARCHPROP_DEPLOYMENT_PATH?.trim();
  if (p && p.length > 0) {
    return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
  }
  return resolve(REPO_ROOT, "deployments/local.json");
}

/**
 * Verifies that all required Foundry contract artifacts exist.
 */
export function checkArtifactsPrerequisite(customDir?: string): ArtifactCheck {
  const artifactsDir = resolveArtifactsDir(customDir);
  const missingArtifacts: string[] = [];

  if (!existsSync(artifactsDir)) {
    return {
      available: false,
      artifactsDir,
      missingArtifacts: [...REQUIRED_CONTRACTS],
      diagnostic:
        `Foundry artifacts directory not found at "${artifactsDir}". ` +
        `SC-001 contracts are not available or have not been compiled in this worktree. ` +
        `Golden path execution is blocked until SC-001 is merged and built.`,
    };
  }

  for (const name of REQUIRED_CONTRACTS) {
    const artifactPath = join(artifactsDir, `${name}.sol`, `${name}.json`);
    if (!existsSync(artifactPath)) {
      missingArtifacts.push(name);
    }
  }

  if (missingArtifacts.length > 0) {
    return {
      available: false,
      artifactsDir,
      missingArtifacts,
      diagnostic:
        `Missing required Foundry artifact(s): ${missingArtifacts.join(", ")} in "${artifactsDir}". ` +
        `SC-001 contracts are incomplete or unbuilt. Golden path execution is blocked.`,
    };
  }

  return {
    available: true,
    artifactsDir,
    missingArtifacts: [],
    diagnostic: `All required Foundry contract artifacts found in "${artifactsDir}".`,
  };
}

/**
 * Refuses any non-Anvil chain ID.
 */
export async function assertAnvilChain(client: PublicClient): Promise<number> {
  const chainId = await client.getChainId();
  if (Number(chainId) !== ANVIL_CHAIN_ID) {
    throw new Error(
      `Unexpected chain ID ${chainId}. The local E2E runner targets Anvil only ` +
        `(${ANVIL_CHAIN_ID}) and refuses all other networks to prevent unintended operations.`,
    );
  }
  return Number(chainId);
}

export interface AnvilCheck {
  ok: boolean;
  rpcUrl: string;
  chainId?: number;
  diagnostic: string;
}

/**
 * Checks whether local Anvil RPC is reachable and ready on chain ID 31337.
 */
export async function checkAnvilPrerequisite(rpcUrl?: string): Promise<AnvilCheck> {
  const url = rpcUrl ?? process.env.ARCHPROP_RPC_URL ?? "http://127.0.0.1:8545";
  try {
    const publicClient = createPublicClient({
      transport: http(url, { timeout: 4000 }),
    });
    const chainId = await publicClient.getChainId();
    if (Number(chainId) !== ANVIL_CHAIN_ID) {
      return {
        ok: false,
        rpcUrl: url,
        chainId: Number(chainId),
        diagnostic:
          `Connected RPC at "${url}" returned chain ID ${chainId}, expected Anvil chain ID ${ANVIL_CHAIN_ID}. ` +
          `Local golden path execution targets Anvil only and refuses other networks.`,
      };
    }

    const walletClient = createWalletClient({
      chain: ANVIL_CHAIN,
      transport: http(url, { timeout: 4000 }),
    });
    const accounts = await walletClient.getAddresses();
    if (!accounts || accounts.length < 8) {
      return {
        ok: false,
        rpcUrl: url,
        chainId: Number(chainId),
        diagnostic:
          `Anvil node at "${url}" returned ${accounts?.length ?? 0} unlocked accounts, ` +
          `but at least 8 distinct accounts are required for role separation.`,
      };
    }

    for (const addr of accounts.slice(0, 8)) {
      const balance = await publicClient.getBalance({ address: addr });
      if (balance === 0n) {
        return {
          ok: false,
          rpcUrl: url,
          chainId: Number(chainId),
          diagnostic: `Unlocked account ${addr} has zero balance on Anvil at "${url}".`,
        };
      }
    }

    return {
      ok: true,
      rpcUrl: url,
      chainId: Number(chainId),
      diagnostic: `Anvil node is running at "${url}" on chain ${ANVIL_CHAIN_ID} with funded unlocked accounts.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      rpcUrl: url,
      diagnostic:
        `Anvil RPC is not reachable at "${url}": ${msg}. ` +
        `Please ensure an Anvil node is running on ${url} (chain ID ${ANVIL_CHAIN_ID}).`,
    };
  }
}

function loadArtifact(name: string, artifactsDir: string): { abi: unknown[]; bytecode: `0x${string}` } {
  const path = join(artifactsDir, `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`Artifact "${name}" not found at "${path}".`);
  }
  const artifact = require(path) as { abi: unknown[]; bytecode?: { object?: string } };
  const object = artifact.bytecode?.object;
  if (!object || typeof object !== "string" || !object.startsWith("0x")) {
    throw new Error(`Artifact "${name}" bytecode is missing or not 0x-prefixed.`);
  }
  return { abi: artifact.abi, bytecode: object as `0x${string}` };
}

function roleHash(role: string): `0x${string}` {
  return keccak256(toBytes(role));
}

export interface GoldenPathResult {
  ok: boolean;
  blockNumber: bigint;
  contracts: {
    registry: `0x${string}`;
    identityRegistry: `0x${string}`;
    mockIdr: `0x${string}`;
    offeringEscrow: `0x${string}`;
    revenueDistributor: `0x${string}`;
    propertyToken: `0x${string}`;
  };
  checksPassed: number;
  totalChecks: number;
}

/**
 * Executes the full end-to-end golden path on local Anvil:
 * 1. Verifies chain is Anvil.
 * 2. Deploys contracts.
 * 3. Seeds full lifecycle (attestation gate, agreement, token linking, offering, 2 investors fill 3B target, claims, release, revenue, close).
 * 4. Validates state invariants.
 *
 * Throws on any failed receipt or invariant violation.
 */
export async function executeGoldenPath(options?: {
  rpcUrl?: string;
  artifactsDir?: string;
}): Promise<GoldenPathResult> {
  const rpcUrl = options?.rpcUrl ?? process.env.ARCHPROP_RPC_URL ?? "http://127.0.0.1:8545";

  const prereq = checkArtifactsPrerequisite(options?.artifactsDir);
  if (!prereq.available) {
    throw new Error(`[PREREQUISITE-FAILED] ${prereq.diagnostic}`);
  }

  const anvilCheck = await checkAnvilPrerequisite(rpcUrl);
  if (!anvilCheck.ok) {
    throw new Error(`[PREREQUISITE-FAILED] ${anvilCheck.diagnostic}`);
  }

  const artifactsDir = prereq.artifactsDir;

  const publicClient = createPublicClient({
    chain: ANVIL_CHAIN,
    transport: http(rpcUrl),
  });

  await assertAnvilChain(publicClient);

  const walletClient = createWalletClient({
    chain: ANVIL_CHAIN,
    transport: http(rpcUrl),
  });

  const accounts = await getUnlockedAnvilAccounts(publicClient, walletClient);
  const blockNumber = await publicClient.getBlockNumber();
  const deployer = accounts.admin;

  const wallet = (account: `0x${string}`) =>
    createWalletClient({ account, chain: ANVIL_CHAIN, transport: http(rpcUrl) });

  async function deploy(
    name: string,
    artifactData: { abi: unknown[]; bytecode: `0x${string}` },
    args: unknown[],
  ): Promise<`0x${string}`> {
    const hash = await wallet(accounts.admin).deployContract({
      account: accounts.admin,
      chain: ANVIL_CHAIN,
      abi: artifactData.abi as any,
      bytecode: artifactData.bytecode,
      args: args as any,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Deployment of ${name} reverted (tx ${hash})`);
    }
    const address = receipt.contractAddress;
    if (!address) {
      throw new Error(`Deployment of ${name} produced no contract address.`);
    }
    return address;
  }

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
      throw new Error(`${label} reverted (tx ${hash})`);
    }
    return receipt;
  }

  function read<T>(
    address: `0x${string}`,
    abi: unknown[],
    functionName: string,
    args: unknown[] = [],
  ): Promise<T> {
    return publicClient.readContract({ address, abi, functionName, args }) as Promise<T>;
  }

  async function chainNow(): Promise<bigint> {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    return block.timestamp;
  }

  // --- Step 1: Deploy Contracts ---
  const registryAbi = loadArtifact("ArchpropRegistry", artifactsDir);
  const identityAbi = loadArtifact("IdentityRegistry", artifactsDir);
  const mockIdrAbi = loadArtifact("MockIDR", artifactsDir);
  const escrowAbi = loadArtifact("OfferingEscrow", artifactsDir);
  const distributorAbi = loadArtifact("RevenueDistributor", artifactsDir);
  const tokenAbi = loadArtifact("PropertyToken", artifactsDir);

  const registryAddress = await deploy("ArchpropRegistry", registryAbi, [deployer]);
  const identityRegistryAddress = await deploy("IdentityRegistry", identityAbi, [deployer]);
  const mockIdrAddress = await deploy("MockIDR", mockIdrAbi, [deployer]);
  const offeringEscrowAddress = await deploy("OfferingEscrow", escrowAbi, [
    deployer,
    registryAddress,
    identityRegistryAddress,
  ]);
  const revenueDistributorAddress = await deploy("RevenueDistributor", distributorAbi, [
    deployer,
    registryAddress,
  ]);

  const asset = CANONICAL_VILLA_NUSA;

  // PropertyToken constructor mints full fixed supply to OfferingEscrow (ADR-003)
  const propertyTokenAddress = await deploy("PropertyToken", tokenAbi, [
    asset.name,
    asset.symbol,
    asset.assetId,
    asset.tokenSupply,
    identityRegistryAddress,
    offeringEscrowAddress,
    revenueDistributorAddress,
  ]);

  await send(
    "ArchpropRegistry.setEscrow",
    accounts.admin,
    registryAddress,
    registryAbi.abi,
    "setEscrow",
    [offeringEscrowAddress],
  );

  // --- Step 2: Grant Roles ---
  const roleGrants: Array<[string, `0x${string}`, unknown[], string, `0x${string}`]> = [
    ["registry", registryAddress, registryAbi.abi, "LEGAL_VERIFIER_ROLE", accounts.legalVerifier],
    ["registry", registryAddress, registryAbi.abi, "VALUATION_VERIFIER_ROLE", accounts.valuationVerifier],
    ["registry", registryAddress, registryAbi.abi, "REVENUE_VERIFIER_ROLE", accounts.revenueVerifier],
    ["registry", registryAddress, registryAbi.abi, "STRUCTURER_ROLE", accounts.structurer],
    ["escrow", offeringEscrowAddress, escrowAbi.abi, "STRUCTURER_ROLE", accounts.structurer],
  ];
  for (const [contract, address, abi, role, holder] of roleGrants) {
    await send(`${contract}.grantRole(${role})`, accounts.admin, address, abi, "grantRole", [
      roleHash(role),
      holder,
    ]);
  }

  // --- Step 3: Approve Investors & Demo Faucet ---
  for (const investor of [accounts.investor1, accounts.investor2]) {
    await send(
      `setInvestorApproval(${investor})`,
      accounts.admin,
      identityRegistryAddress,
      identityAbi.abi,
      "setInvestorApproval",
      [investor, true],
    );
  }

  // Each investor needs 1,500,000,000 mIDR (150,000 tokens * 10,000)
  const INVESTOR_FAUCET = 2_000_000_000n;
  for (const investor of [accounts.investor1, accounts.investor2]) {
    await send(
      `faucet(${investor})`,
      investor,
      mockIdrAddress,
      mockIdrAbi.abi,
      "faucet",
      [INVESTOR_FAUCET],
    );
  }

  const ADMIN_FAUCET = 1_000_000_000n;
  await send(
    `faucet(${accounts.admin})`,
    accounts.admin,
    mockIdrAddress,
    mockIdrAbi.abi,
    "faucet",
    [ADMIN_FAUCET],
  );

  // --- Step 4: Asset Lifecycle & Attestations ---
  await send("createAsset", accounts.owner, registryAddress, registryAbi.abi, "createAsset", [
    asset.assetId,
    asset.metadataHash,
  ]);
  await send(
    "beginVerification",
    accounts.owner,
    registryAddress,
    registryAbi.abi,
    "beginVerification",
    [asset.assetId],
  );

  await send(
    "submitAttestation(OWNERSHIP)",
    accounts.legalVerifier,
    registryAddress,
    registryAbi.abi,
    "submitAttestation",
    [asset.assetId, AttestationType.OWNERSHIP, "0x" + "44".repeat(32), 0n],
  );
  await send(
    "submitAttestation(VALUATION)",
    accounts.valuationVerifier,
    registryAddress,
    registryAbi.abi,
    "submitAttestation",
    [asset.assetId, AttestationType.VALUATION, "0x" + "55".repeat(32), asset.propertyValue],
  );

  // Invariant assertions: legal and valuation attestations record different verifier addresses and neither is the owner
  const legalAttestation = await read<{ verifier: string; valid: boolean }>(
    registryAddress,
    registryAbi.abi,
    "getLatestAttestation",
    [asset.assetId, AttestationType.OWNERSHIP],
  );
  const valuationAttestation = await read<{ verifier: string; valid: boolean }>(
    registryAddress,
    registryAbi.abi,
    "getLatestAttestation",
    [asset.assetId, AttestationType.VALUATION],
  );

  if (legalAttestation.verifier.toLowerCase() !== accounts.legalVerifier.toLowerCase()) {
    throw new Error(`Legal attestation verifier mismatch: expected ${accounts.legalVerifier}, got ${legalAttestation.verifier}`);
  }
  if (valuationAttestation.verifier.toLowerCase() !== accounts.valuationVerifier.toLowerCase()) {
    throw new Error(`Valuation attestation verifier mismatch: expected ${accounts.valuationVerifier}, got ${valuationAttestation.verifier}`);
  }
  if (legalAttestation.verifier.toLowerCase() === valuationAttestation.verifier.toLowerCase()) {
    throw new Error(`Legal and valuation attestations must record different verifier addresses`);
  }
  if (legalAttestation.verifier.toLowerCase() === accounts.owner.toLowerCase()) {
    throw new Error(`Legal verifier must not be asset owner`);
  }
  if (valuationAttestation.verifier.toLowerCase() === accounts.owner.toLowerCase()) {
    throw new Error(`Valuation verifier must not be asset owner`);
  }

  await send(
    "finalizeVerification",
    accounts.owner,
    registryAddress,
    registryAbi.abi,
    "finalizeVerification",
    [asset.assetId],
  );
  const statusAfterVerify = await read<number>(registryAddress, registryAbi.abi, "assetStatus", [
    asset.assetId,
  ]);
  if (statusAfterVerify !== AssetStatus.VERIFIED) {
    throw new Error(`Expected VERIFIED (${AssetStatus.VERIFIED}), got ${statusAfterVerify}`);
  }

  await send(
    "registerAgreement",
    accounts.structurer,
    registryAddress,
    registryAbi.abi,
    "registerAgreement",
    [asset.assetId, asset.agreementHash],
  );
  await send(
    "markIssuanceReady",
    accounts.structurer,
    registryAddress,
    registryAbi.abi,
    "markIssuanceReady",
    [asset.assetId],
  );
  const statusIssuance = await read<number>(registryAddress, registryAbi.abi, "assetStatus", [
    asset.assetId,
  ]);
  if (statusIssuance !== AssetStatus.ISSUANCE_READY) {
    throw new Error(`Expected ISSUANCE_READY (${AssetStatus.ISSUANCE_READY}), got ${statusIssuance}`);
  }

  await send("linkToken", accounts.structurer, registryAddress, registryAbi.abi, "linkToken", [
    asset.assetId,
    propertyTokenAddress,
  ]);

  const totalSupply = await read<bigint>(propertyTokenAddress, tokenAbi.abi, "totalSupply");
  const escrowBalance = await read<bigint>(propertyTokenAddress, tokenAbi.abi, "balanceOf", [
    offeringEscrowAddress,
  ]);
  if (escrowBalance !== totalSupply || totalSupply !== asset.tokenSupply) {
    throw new Error(
      `Escrow supply invariant failed: escrow has ${escrowBalance}, total is ${totalSupply}, expected ${asset.tokenSupply}`,
    );
  }

  // --- Step 5: Offering & Full Funding ---
  const deadline = (await chainNow()) + BigInt(7 * 24 * 60 * 60);
  const perInvestorTokens = asset.tokenSupply / 2n; // 150,000
  const perInvestorPayment = perInvestorTokens * asset.tokenPrice; // 1,500,000,000

  await send("createOffering", accounts.structurer, offeringEscrowAddress, escrowAbi.abi, "createOffering", [
    asset.assetId,
    propertyTokenAddress,
    mockIdrAddress,
    asset.target,
    asset.tokenPrice,
    deadline,
    accounts.owner,
  ]);

  for (const investor of [accounts.investor1, accounts.investor2]) {
    await send(
      `approve escrow (${investor})`,
      investor,
      mockIdrAddress,
      mockIdrAbi.abi,
      "approve",
      [offeringEscrowAddress, perInvestorPayment],
    );
    await send(
      `invest (${investor})`,
      investor,
      offeringEscrowAddress,
      escrowAbi.abi,
      "invest",
      [1n, perInvestorPayment],
    );
  }

  // --- Step 6: Finalize, Claim Tokens, Release Funds ---
  await send(
    "finalizeSuccessfulOffering",
    accounts.admin,
    offeringEscrowAddress,
    escrowAbi.abi,
    "finalizeSuccessfulOffering",
    [1n],
  );

  for (const investor of [accounts.investor1, accounts.investor2]) {
    await send(
      `claimTokens (${investor})`,
      investor,
      offeringEscrowAddress,
      escrowAbi.abi,
      "claimTokens",
      [1n],
    );
    const balance = await read<bigint>(propertyTokenAddress, tokenAbi.abi, "balanceOf", [
      investor,
    ]);
    if (balance !== perInvestorTokens) {
      throw new Error(
        `Token claim invariant failed: investor ${investor} holds ${balance}, expected ${perInvestorTokens}`,
      );
    }
  }

  await send(
    "releaseFunds",
    accounts.admin,
    offeringEscrowAddress,
    escrowAbi.abi,
    "releaseFunds",
    [1n],
  );
  const statusActive = await read<number>(registryAddress, registryAbi.abi, "assetStatus", [
    asset.assetId,
  ]);
  if (statusActive !== AssetStatus.ACTIVE) {
    throw new Error(`Expected ACTIVE (${AssetStatus.ACTIVE}) after fund release, got ${statusActive}`);
  }

  // --- Step 7: Revenue Distribution & Settlement ---
  const revenueAmount = 100_000_000n;
  const evidenceHash = ("0x" + "66".repeat(32)) as `0x${string}`;
  const claimDeadline = (await chainNow()) + BigInt(2 * 60 * 60);

  // Submit REVENUE attestation from revenueVerifier wallet
  await send(
    "submitAttestation(REVENUE)",
    accounts.revenueVerifier,
    registryAddress,
    registryAbi.abi,
    "submitAttestation",
    [asset.assetId, AttestationType.REVENUE, evidenceHash, revenueAmount],
  );

  const revenueAttestation = await read<{ verifier: string; valid: boolean }>(
    registryAddress,
    registryAbi.abi,
    "getLatestAttestation",
    [asset.assetId, AttestationType.REVENUE],
  );
  if (revenueAttestation.verifier.toLowerCase() !== accounts.revenueVerifier.toLowerCase()) {
    throw new Error(`Revenue attestation verifier mismatch: expected ${accounts.revenueVerifier}, got ${revenueAttestation.verifier}`);
  }
  if (revenueAttestation.verifier.toLowerCase() === accounts.owner.toLowerCase()) {
    throw new Error(`Revenue verifier must not be asset owner`);
  }

  await send(
    "approve distributor",
    accounts.admin,
    mockIdrAddress,
    mockIdrAbi.abi,
    "approve",
    [revenueDistributorAddress, revenueAmount],
  );
  await send(
    "publishRevenue",
    accounts.admin,
    revenueDistributorAddress,
    distributorAbi.abi,
    "publishRevenue",
    [
      asset.assetId,
      propertyTokenAddress,
      mockIdrAddress,
      revenueAmount,
      evidenceHash,
      claimDeadline,
    ],
  );

  for (const investor of [accounts.investor1, accounts.investor2]) {
    await send(
      `claimRevenue (${investor})`,
      investor,
      revenueDistributorAddress,
      distributorAbi.abi,
      "claimRevenue",
      [1n],
    );
  }

  const secondsUntilDeadline = Number(claimDeadline - (await chainNow()));
  await publicClient.request({ method: "evm_increaseTime", params: [secondsUntilDeadline + 60] } as never);
  await publicClient.request({ method: "evm_mine", params: [] } as never);

  await send(
    "closeRevenueEpoch",
    accounts.admin,
    revenueDistributorAddress,
    distributorAbi.abi,
    "closeRevenueEpoch",
    [1n],
  );

  // --- Step 8: Validate State Invariants ---
  let checksPassed = 0;
  const totalChecks = 12;

  // 1. Asset status is ACTIVE
  const finalStatus = await read<number>(registryAddress, registryAbi.abi, "assetStatus", [asset.assetId]);
  if (finalStatus === AssetStatus.ACTIVE) checksPassed++;

  // 2. Token linked matches
  const linkedToken = await read<string>(registryAddress, registryAbi.abi, "assetToken", [asset.assetId]);
  if (linkedToken.toLowerCase() === propertyTokenAddress.toLowerCase()) checksPassed++;

  // 3. Offering is FUNDED and fundsReleased == true
  const offeringReadAbi = parseAbi([
    "function getOffering(uint256 offeringId) view returns ((bytes32 assetId, address propertyToken, address paymentToken, uint256 target, uint256 tokenPrice, uint64 deadline, uint256 raised, address issuerTreasury, uint8 status, bool fundsReleased))",
  ]);
  const off = await publicClient.readContract({
    address: offeringEscrowAddress,
    abi: offeringReadAbi,
    functionName: "getOffering",
    args: [1n],
  });
  if (Number(off.status) === OfferingStatus.FUNDED && off.fundsReleased === true) checksPassed++;

  // 4. Offering target raised exactly
  if (off.raised === asset.target && off.target === asset.target) checksPassed++;

  // 5. Total supply matches
  const finalSupply = await read<bigint>(propertyTokenAddress, tokenAbi.abi, "totalSupply");
  if (finalSupply === asset.tokenSupply) checksPassed++;

  // 6. Investor 1 balance matches 150,000
  const bal1 = await read<bigint>(propertyTokenAddress, tokenAbi.abi, "balanceOf", [accounts.investor1]);
  if (bal1 === perInvestorTokens) checksPassed++;

  // 7. Investor 2 balance matches 150,000
  const bal2 = await read<bigint>(propertyTokenAddress, tokenAbi.abi, "balanceOf", [accounts.investor2]);
  if (bal2 === perInvestorTokens) checksPassed++;

  // 8. Revenue epoch closed
  const epochReadAbi = parseAbi([
    "function getRevenueEpoch(uint256 epochId) view returns ((bytes32 assetId, address propertyToken, address paymentToken, uint256 amount, uint256 totalSupply, uint64 claimDeadline, address funder, uint256 claimedAmount, bool closed))",
  ]);
  const epoch = await publicClient.readContract({
    address: revenueDistributorAddress,
    abi: epochReadAbi,
    functionName: "getRevenueEpoch",
    args: [1n],
  });
  if (epoch.closed === true && epoch.claimedAmount === revenueAmount) checksPassed++;

  // 9. No claimable revenue remaining for investors
  const claimable1 = await read<bigint>(
    revenueDistributorAddress,
    distributorAbi.abi,
    "claimableRevenue",
    [1n, accounts.investor1],
  );
  if (claimable1 === 0n) checksPassed++;

  // 10. Legal attestation verifier matches and is not owner
  const finalLegalAtt = await read<{ verifier: string; valid: boolean }>(
    registryAddress,
    registryAbi.abi,
    "getLatestAttestation",
    [asset.assetId, AttestationType.OWNERSHIP],
  );
  if (
    finalLegalAtt.verifier.toLowerCase() === accounts.legalVerifier.toLowerCase() &&
    finalLegalAtt.verifier.toLowerCase() !== accounts.owner.toLowerCase()
  ) {
    checksPassed++;
  }

  // 11. Valuation attestation verifier matches, is not owner, and is distinct from legal verifier
  const finalValuationAtt = await read<{ verifier: string; valid: boolean }>(
    registryAddress,
    registryAbi.abi,
    "getLatestAttestation",
    [asset.assetId, AttestationType.VALUATION],
  );
  if (
    finalValuationAtt.verifier.toLowerCase() === accounts.valuationVerifier.toLowerCase() &&
    finalValuationAtt.verifier.toLowerCase() !== accounts.owner.toLowerCase() &&
    finalValuationAtt.verifier.toLowerCase() !== finalLegalAtt.verifier.toLowerCase()
  ) {
    checksPassed++;
  }

  // 12. Revenue attestation verifier matches and is not owner
  const finalRevenueAtt = await read<{ verifier: string; valid: boolean }>(
    registryAddress,
    registryAbi.abi,
    "getLatestAttestation",
    [asset.assetId, AttestationType.REVENUE],
  );
  if (
    finalRevenueAtt.verifier.toLowerCase() === accounts.revenueVerifier.toLowerCase() &&
    finalRevenueAtt.verifier.toLowerCase() !== accounts.owner.toLowerCase()
  ) {
    checksPassed++;
  }

  if (checksPassed !== totalChecks) {
    throw new Error(`State invariant checks failed: ${checksPassed}/${totalChecks} passed.`);
  }

  return {
    ok: true,
    blockNumber,
    contracts: {
      registry: registryAddress,
      identityRegistry: identityRegistryAddress,
      mockIdr: mockIdrAddress,
      offeringEscrow: offeringEscrowAddress,
      revenueDistributor: revenueDistributorAddress,
      propertyToken: propertyTokenAddress,
    },
    checksPassed,
    totalChecks,
  };
}

// Standalone execution entrypoint
if (process.argv[1]?.endsWith("runner.ts")) {
  console.log("=== Archprop E2E Local Anvil Runner ===");
  const prereq = checkArtifactsPrerequisite();
  if (!prereq.available) {
    console.error(`\n[E2E-PREREQUISITE-BLOCKED] ${prereq.diagnostic}`);
    console.error("SC-001 is not merged; contracts are absent in this worktree.");
    console.error("Refusing to report golden path as passed without contract execution.");
    process.exit(1);
  }

  executeGoldenPath()
    .then((result) => {
      console.log(`\n✓ Golden path succeeded on Anvil (${result.checksPassed}/${result.totalChecks} checks passed).`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(`\n✗ Golden path execution failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
