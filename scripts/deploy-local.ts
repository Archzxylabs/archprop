/**
 * Deploys the ARCHPROP contract set to a local Anvil node and writes the
 * resulting addresses to `deployments/local.json`, which the E2E golden-path
 * runner consumes.
 *
 * This is a local-only, non-custodial script. It never reads, accepts, or
 * writes a private key: it queries unlocked accounts directly from the local
 * Anvil node via JSON-RPC (eth_accounts), and refuses to run against any chain
 * other than local Anvil chain ID 31337. No authorization gate exists here
 * because nothing leaves the developer's machine.
 *
 * Usage: tsx scripts/deploy-local.ts
 * Requires: anvil running on ARCHPROP_RPC_URL (default http://127.0.0.1:8545)
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createWalletClient, createPublicClient, http, formatEther } from "viem";

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

/**
 * Canonical Villa Nusa constants per PRD and docs/INTERFACES.md.
 */
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

/**
 * Local Anvil chain definition.
 *
 * The chain package's public client hard-fails on any chain other than
 * Arbitrum Sepolia, which is correct for production and must not be relaxed
 * for a local run. This script therefore defines the local chain itself and
 * never uses the production client factory, so a misconfigured RPC URL cannot
 * make it silently target a live network.
 */
export const ANVIL_CHAIN = {
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
} as const;
/** Named addresses the E2E runner and UI expect to find in the deployment file. */
export interface LocalDeployment {
  chainId: number;
  deployedAtBlock: number;
  deployer: string;
  contracts: {
    registry: string;
    identityRegistry: string;
    mockIdr: string;
    offeringEscrow: string;
    revenueDistributor: string;
  };
  asset: {
    assetId: string;
    metadataHash: string;
    agreementHash: string;
    tokenName: string;
    tokenSymbol: string;
    propertyValue: string;
    tokenSupply: string;
    tokenPrice: string;
    target: string;
  };
}

function loadArtifact(name: string, artifactsDir: string): { abi: unknown[]; bytecode: `0x${string}` } {
  const path = join(artifactsDir, `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Foundry artifact for "${name}" not found at "${path}". ` +
        `Ensure packages/contracts has been compiled (via 'forge build') or specify ARCHPROP_ARTIFACTS_DIR. ` +
        `If SC-001 is not merged into this worktree, contract artifacts are unavailable.`,
    );
  }
  const artifact = require(path) as { abi: unknown[]; bytecode?: { object?: string } };
  const object = artifact.bytecode?.object;
  if (!object || typeof object !== "string" || !object.startsWith("0x")) {
    throw new Error(`${name} artifact bytecode is missing or not 0x-prefixed`);
  }
  return { abi: artifact.abi, bytecode: object as `0x${string}` };
}

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
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

  const rpcUrl = envOrDefault(
    "ARCHPROP_RPC_URL",
    envOrDefault("NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL", "http://127.0.0.1:8545"),
  );

  const publicClient = createPublicClient({
    chain: ANVIL_CHAIN,
    transport: http(rpcUrl),
  });

  // Refuse any non-Anvil target: this script is local-only by construction.
  const chainId = await publicClient.getChainId();
  if (Number(chainId) !== ANVIL_CHAIN.id) {
    throw new Error(
      `Refusing to deploy: expected Anvil chain id ${ANVIL_CHAIN.id}, got ${chainId}. ` +
        `This script is local-only; do not point it at a shared or live network.`,
    );
  }

  const walletClient = createWalletClient({
    chain: ANVIL_CHAIN,
    transport: http(rpcUrl),
  });

  // Obtain unlocked accounts directly from local Anvil RPC
  const accounts = await walletClient.getAddresses();
  if (!accounts || accounts.length === 0) {
    throw new Error("No unlocked accounts returned by Anvil RPC.");
  }
  const deployer: `0x${string}` = accounts[0]!;
  if (!deployer) {
    throw new Error("Deployer account is undefined.");
  }
  const deployerBalance = await publicClient.getBalance({ address: deployer });
  if (deployerBalance === 0n) {
    throw new Error(`Deployer account ${deployer} has zero balance on Anvil.`);
  }

  const block = await publicClient.getBlockNumber();
  console.log(`Deploying to Anvil at ${rpcUrl} (chain ${chainId}, block ${block})`);

  // Deployment order follows the constructor dependency graph:
  // registry/identity/mockIdr are leaves, escrow and distributor depend on the
  // registry, and the property token depends on all three.
  const registry = loadArtifact("ArchpropRegistry", artifactsDir);
  const identityRegistry = loadArtifact("IdentityRegistry", artifactsDir);
  const mockIdr = loadArtifact("MockIDR", artifactsDir);
  const offeringEscrow = loadArtifact("OfferingEscrow", artifactsDir);
  const revenueDistributor = loadArtifact("RevenueDistributor", artifactsDir);

  async function deploy(
    name: string,
    artifact: { abi: unknown[]; bytecode: `0x${string}` },
    args: unknown[],
  ): Promise<`0x${string}`> {
    const hash = await walletClient.deployContract({
      account: deployer,
      chain: ANVIL_CHAIN,
      abi: artifact.abi as any,
      bytecode: artifact.bytecode,
      args: args as any,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${name} deployment reverted (tx ${hash})`);
    }
    const address = receipt.contractAddress;
    if (!address) {
      throw new Error(`${name} deployment produced no contract address`);
    }
    console.log(`  ${name}: ${address}`);
    return address;
  }

  /** Sends a post-deployment wiring call and asserts it succeeded. */
  async function writeContract(
    label: string,
    address: `0x${string}`,
    abi: unknown[],
    functionName: string,
    args: unknown[],
  ): Promise<void> {
    const { request } = await publicClient.simulateContract({
      account: deployer,
      address,
      abi: abi as any,
      functionName,
      args: args as any,
    });
    const hash = await walletClient.writeContract(request as any);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${label} reverted (tx ${hash})`);
    }
    console.log(`  ${label}`);
  }

  console.log("Deploying contracts...");
  const registryAddress = await deploy("ArchpropRegistry", registry, [deployer]);
  const identityRegistryAddress = await deploy("IdentityRegistry", identityRegistry, [deployer]);
  const mockIdrAddress = await deploy("MockIDR", mockIdr, [deployer]);
  const offeringEscrowAddress = await deploy("OfferingEscrow", offeringEscrow, [
    deployer,
    registryAddress,
    identityRegistryAddress,
  ]);
  const revenueDistributorAddress = await deploy("RevenueDistributor", revenueDistributor, [
    deployer,
    registryAddress,
  ]);

  // The property token needs the escrow and distributor before it can be
  // constructed, so it is deployed last rather than with the other leaves.
  const propertyToken = loadArtifact("PropertyToken", artifactsDir);
  const asset = CANONICAL_VILLA_NUSA;

  // Zero-decimal token, so the supply is an exact whole-unit count.
  const propertyTokenAddress = await deploy("PropertyToken", propertyToken, [
    asset.name,
    asset.symbol,
    asset.assetId,
    asset.tokenSupply,
    identityRegistryAddress,
    offeringEscrowAddress,
    revenueDistributorAddress,
  ]);

  // `linkToken` refuses to run until the registry knows its escrow, so the
  // registry is pointed at the escrow it was constructed with.
  await writeContract(
    "ArchpropRegistry.setEscrow",
    registryAddress,
    loadArtifact("ArchpropRegistry", artifactsDir).abi,
    "setEscrow",
    [offeringEscrowAddress],
  );

  const deployment: LocalDeployment & { propertyToken: string } = {
    chainId: Number(chainId),
    deployedAtBlock: Number(block),
    deployer,
    contracts: {
      registry: registryAddress,
      identityRegistry: identityRegistryAddress,
      mockIdr: mockIdrAddress,
      offeringEscrow: offeringEscrowAddress,
      revenueDistributor: revenueDistributorAddress,
    },
    propertyToken: propertyTokenAddress,
    asset: {
      assetId: asset.assetId,
      metadataHash: asset.metadataHash,
      agreementHash: asset.agreementHash,
      tokenName: asset.name,
      tokenSymbol: asset.symbol,
      propertyValue: asset.propertyValue.toString(),
      tokenSupply: asset.tokenSupply.toString(),
      tokenPrice: asset.tokenPrice.toString(),
      target: asset.target.toString(),
    },
  };

  const outPath = getDeploymentPath();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(deployment, null, 2)}\n`);

  console.log(`\nDeployment written to ${outPath}`);
  console.log(`Deployer balance: ${formatEther(await publicClient.getBalance({ address: deployer }))} ETH`);
}

main().catch((error: unknown) => {
  console.error(`\nDeployment failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
