import {
  loadChainConfig,
  inspectChainConfig,
  decodeOfferingStatus,
  CONTRACT_KEYS,
  CONTRACT_ADDRESS_ENV,
  RPC_URL_ENV,
  type ChainConfig,
  type ChainConfigReport,
  type OfferingStatus,
  archpropRegistryAbi,
  identityRegistryAbi,
  offeringEscrowAbi,
  arbitrumSepolia,
} from "@archprop/chain";
import {
  createPublicClient,
  http,
  type PublicClient,
  type Address,
  type Hex,
  erc20Abi,
} from "viem";
import type { AssetId } from "@archprop/shared";

export type { ChainConfig, ChainConfigReport, OfferingStatus };

/**
 * The contract addresses this client needs. `ChainConfig["addresses"]` is a
 * structural superset, so callers can pass the loaded configuration directly.
 */
export interface ChainAddressSet {
  registry: Address;
  identityRegistry: Address;
  mockIdr: Address;
  offeringEscrow: Address;
}

/** Addresses needed to locate and price an offering. */
export type OfferingReadAddresses = Pick<
  ChainAddressSet,
  "offeringEscrow" | "registry" | "mockIdr"
>;

/** Addresses needed to read one investor's position. */
export type InvestorReadAddresses = Pick<
  ChainAddressSet,
  "identityRegistry" | "mockIdr" | "offeringEscrow"
>;

/**
 * Reads public chain environment variables safely in both browser and server runtimes.
 * Does not throw; returns null when incomplete or malformed.
 */
function readClientEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: (process.env.NODE_ENV as "development" | "production" | "test" | undefined) ?? "development",
    [RPC_URL_ENV]: process.env[RPC_URL_ENV],
    [CONTRACT_ADDRESS_ENV.registry]: process.env[CONTRACT_ADDRESS_ENV.registry],
    [CONTRACT_ADDRESS_ENV.identityRegistry]: process.env[CONTRACT_ADDRESS_ENV.identityRegistry],
    [CONTRACT_ADDRESS_ENV.mockIdr]: process.env[CONTRACT_ADDRESS_ENV.mockIdr],
    [CONTRACT_ADDRESS_ENV.offeringEscrow]: process.env[CONTRACT_ADDRESS_ENV.offeringEscrow],
    [CONTRACT_ADDRESS_ENV.revenueDistributor]: process.env[CONTRACT_ADDRESS_ENV.revenueDistributor],
  };
}

/**
 * Identity of the current public configuration.
 *
 * `getClientChainConfig` returns the *same object* for as long as this
 * fingerprint is unchanged. A hook that puts the config in a `useCallback`
 * dependency list therefore keeps one stable reference across renders instead
 * of re-running its effect on every render.
 */
function clientConfigFingerprint(env: NodeJS.ProcessEnv): string {
  return [
    env[RPC_URL_ENV] ?? "",
    ...CONTRACT_KEYS.map((key) => env[CONTRACT_ADDRESS_ENV[key]] ?? ""),
  ].join("\n");
}

let configCache: { fingerprint: string; config: ChainConfig | null } | null = null;
let reportCache: { fingerprint: string; report: ChainConfigReport } | null = null;
let publicClientCache: { key: string; client: PublicClient } | null = null;

/**
 * Drops every memoized configuration and client.
 *
 * Production code never needs this; tests use it to prove that memoization
 * follows the environment rather than leaking a stale value.
 */
export function resetClientChainCaches(): void {
  configCache = null;
  reportCache = null;
  publicClientCache = null;
}

/**
 * Returns a referentially stable, validated chain configuration.
 *
 * Repeated calls with an unchanged environment return the identical object, so
 * the value is safe to use as a React effect/callback dependency.
 */
export function getClientChainConfig(): ChainConfig | null {
  const env = readClientEnv();
  const fingerprint = clientConfigFingerprint(env);
  if (configCache && configCache.fingerprint === fingerprint) {
    return configCache.config;
  }

  let config: ChainConfig | null;
  try {
    config = loadChainConfig(env);
  } catch {
    config = null;
  }
  configCache = { fingerprint, config };
  return config;
}

/**
 * Returns a report of all missing or invalid configuration variables.
 * Memoized on the same fingerprint as `getClientChainConfig`.
 */
export function inspectClientChainConfig(): ChainConfigReport {
  const env = readClientEnv();
  const fingerprint = clientConfigFingerprint(env);
  if (reportCache && reportCache.fingerprint === fingerprint) {
    return reportCache.report;
  }

  const report = inspectChainConfig(env);
  reportCache = {
    fingerprint,
    report: { ok: report.ok, errors: report.errors, warnings: report.warnings },
  };
  return reportCache.report;
}

/**
 * Builds (or reuses) the read-only viem public client for Arbitrum Sepolia.
 *
 * One client instance is shared per RPC URL so repeated renders and refreshes
 * do not allocate a new transport each time.
 */
export function getArchpropPublicClient(config?: ChainConfig): PublicClient {
  const resolvedConfig = config ?? getClientChainConfig();
  if (!resolvedConfig) {
    const report = inspectClientChainConfig();
    throw new Error(`Chain configuration unavailable: ${report.errors.join("; ")}`);
  }

  const key = `${resolvedConfig.chainId}:${resolvedConfig.rpcUrl}`;
  if (publicClientCache && publicClientCache.key === key) {
    return publicClientCache.client;
  }

  const client = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(resolvedConfig.rpcUrl),
  });
  publicClientCache = { key, client };
  return client;
}

export interface DerivedOffering {
  offeringId: bigint;
  assetId: AssetId;
  propertyToken: Address;
  paymentToken: Address;
  target: bigint;
  tokenPrice: bigint;
  deadline: bigint;
  raised: bigint;
  issuerTreasury: Address;
  status: OfferingStatus;
  statusCode: number;
  fundsReleased: boolean;
  remainingCap: bigint;
}

/** Raw `OfferingView` as returned by the frozen `getOffering` ABI. */
interface OfferingViewRaw {
  assetId: Hex;
  propertyToken: Address;
  paymentToken: Address;
  target: bigint;
  tokenPrice: bigint;
  deadline: bigint;
  raised: bigint;
  issuerTreasury: Address;
  status: number;
  fundsReleased: boolean;
}

/**
 * Reads one offering by ID from `OfferingEscrow.getOffering` and validates it.
 *
 * The status is decoded with the frozen `@archprop/chain` decoder, so an
 * unknown numeric status throws instead of being silently reported as `FAILED`.
 * Asset, payment, and property-token addresses are all cross-checked, and the
 * accounting is rejected when it is internally inconsistent.
 */
export async function fetchOfferingById(
  client: PublicClient,
  addresses: OfferingReadAddresses,
  offeringId: bigint,
  expectedAssetId?: AssetId | undefined,
): Promise<DerivedOffering> {
  const offeringRaw = (await client.readContract({
    address: addresses.offeringEscrow,
    abi: offeringEscrowAbi,
    functionName: "getOffering",
    args: [offeringId],
  })) as OfferingViewRaw;

  if (expectedAssetId && offeringRaw.assetId.toLowerCase() !== expectedAssetId.toLowerCase()) {
    throw new Error(
      `Escrow offering assetId mismatch: expected ${expectedAssetId}, got ${offeringRaw.assetId}`,
    );
  }

  if (offeringRaw.paymentToken.toLowerCase() !== addresses.mockIdr.toLowerCase()) {
    throw new Error(
      `Escrow offering paymentToken mismatch: expected ${addresses.mockIdr}, got ${offeringRaw.paymentToken}`,
    );
  }

  const linkedToken = (await client.readContract({
    address: addresses.registry,
    abi: archpropRegistryAbi,
    functionName: "assetToken",
    args: [offeringRaw.assetId],
  })) as Address;

  if (offeringRaw.propertyToken.toLowerCase() !== linkedToken.toLowerCase()) {
    throw new Error(
      `Escrow offering propertyToken mismatch: expected registry token ${linkedToken}, got ${offeringRaw.propertyToken}`,
    );
  }

  if (offeringRaw.tokenPrice <= 0n) {
    throw new Error(
      `Escrow offering ${offeringId} reports a non-positive token price (${offeringRaw.tokenPrice}); refusing to quote an allocation.`,
    );
  }

  if (offeringRaw.raised > offeringRaw.target) {
    throw new Error(
      `Escrow offering ${offeringId} reports raised ${offeringRaw.raised} above its target ${offeringRaw.target}; accounting is inconsistent.`,
    );
  }

  // Throws UnknownEnumValueError for any value outside the frozen enum.
  const status = decodeOfferingStatus(offeringRaw.status);

  return {
    offeringId,
    assetId: offeringRaw.assetId,
    propertyToken: offeringRaw.propertyToken,
    paymentToken: offeringRaw.paymentToken,
    target: offeringRaw.target,
    tokenPrice: offeringRaw.tokenPrice,
    deadline: offeringRaw.deadline,
    raised: offeringRaw.raised,
    issuerTreasury: offeringRaw.issuerTreasury,
    status,
    statusCode: Number(offeringRaw.status),
    fundsReleased: offeringRaw.fundsReleased,
    remainingCap:
      offeringRaw.target > offeringRaw.raised ? offeringRaw.target - offeringRaw.raised : 0n,
  };
}

/**
 * Derives Villa Nusa's offering ID from a confirmed OfferingCreated event emitted
 * by the configured escrow for the canonical asset ID; does not assume offering ID 1.
 * Validates the returned offering asset/token/payment addresses and reads raised, target,
 * price, deadline, and status from chain.
 */
export async function deriveOfferingForAsset(
  client: PublicClient,
  addresses: OfferingReadAddresses,
  assetId: AssetId,
): Promise<DerivedOffering | null> {
  const logs = await client.getLogs({
    address: addresses.offeringEscrow,
    event: {
      type: "event",
      name: "OfferingCreated",
      inputs: [
        { name: "offeringId", type: "uint256", indexed: true },
        { name: "assetId", type: "bytes32", indexed: true },
        { name: "token", type: "address", indexed: true },
        { name: "target", type: "uint256", indexed: false },
        { name: "tokenPrice", type: "uint256", indexed: false },
        { name: "deadline", type: "uint64", indexed: false },
      ],
    },
    args: {
      assetId,
    },
    fromBlock: 0n,
  });

  if (!logs || logs.length === 0) {
    return null;
  }

  const latestLog = logs[logs.length - 1];
  if (!latestLog || !latestLog.args) {
    return null;
  }
  const offeringId = latestLog.args.offeringId;
  if (offeringId === undefined) {
    return null;
  }

  return fetchOfferingById(client, addresses, offeringId, assetId);
}

export interface DisplayedOfferingConstants {
  tokenPrice?: bigint | undefined;
  offeringTarget?: bigint | undefined;
}

/**
 * Explains how a live offering disagrees with the constants the UI displays,
 * or returns `null` when they agree.
 *
 * Investment must never be priced from a display constant the chain does not
 * agree with, so a caller either uses the live values or disables the action.
 */
export function describeOfferingEconomicsMismatch(
  offering: Pick<DerivedOffering, "tokenPrice" | "target" | "raised"> | null | undefined,
  displayed: DisplayedOfferingConstants | null | undefined,
): string | null {
  if (!offering || !displayed) {
    return null;
  }
  if (displayed.tokenPrice !== undefined && displayed.tokenPrice !== offering.tokenPrice) {
    return `Live offering token price is ${offering.tokenPrice.toString()} mIDR but this page displays ${displayed.tokenPrice.toString()} mIDR.`;
  }
  if (
    displayed.offeringTarget !== undefined &&
    displayed.offeringTarget !== offering.target
  ) {
    return `Live offering target is ${offering.target.toString()} mIDR but this page displays ${displayed.offeringTarget.toString()} mIDR.`;
  }
  return null;
}

export interface InvestorChainState {
  address: Address;
  isApproved: boolean;
  mIdrBalance: bigint;
  allowance: bigint;
  allocation: bigint;
  payment: bigint;
}

/**
 * Reads actual investor approval, mIDR balance, allowance, allocation, and payment.
 */
export async function fetchInvestorState(
  client: PublicClient,
  addresses: InvestorReadAddresses,
  investorAddress: Address,
  offeringId: bigint,
): Promise<InvestorChainState> {
  const [isApproved, mIdrBalance, allowance, allocation, payment] = await Promise.all([
    client.readContract({
      address: addresses.identityRegistry,
      abi: identityRegistryAbi,
      functionName: "isApproved",
      args: [investorAddress],
    }) as Promise<boolean>,
    client.readContract({
      address: addresses.mockIdr,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [investorAddress],
    }) as Promise<bigint>,
    client.readContract({
      address: addresses.mockIdr,
      abi: erc20Abi,
      functionName: "allowance",
      args: [investorAddress, addresses.offeringEscrow],
    }) as Promise<bigint>,
    client.readContract({
      address: addresses.offeringEscrow,
      abi: offeringEscrowAbi,
      functionName: "allocationOf",
      args: [offeringId, investorAddress],
    }) as Promise<bigint>,
    client.readContract({
      address: addresses.offeringEscrow,
      abi: offeringEscrowAbi,
      functionName: "paymentOf",
      args: [offeringId, investorAddress],
    }) as Promise<bigint>,
  ]);

  return {
    address: investorAddress,
    isApproved: Boolean(isApproved),
    mIdrBalance: BigInt(mIdrBalance),
    allowance: BigInt(allowance),
    allocation: BigInt(allocation),
    payment: BigInt(payment),
  };
}

export interface AttestationRecords {
  ownership: {
    verifier: Address;
    evidenceHash: Hex;
    valid: boolean;
    timestamp: bigint;
  } | null;
  valuation: {
    verifier: Address;
    evidenceHash: Hex;
    value: bigint;
    valid: boolean;
    timestamp: bigint;
  } | null;
}

/**
 * Reads ownership and valuation attestation records from ArchpropRegistry.
 */
export async function fetchAttestationRecords(
  client: PublicClient,
  registryAddress: Address,
  assetId: AssetId,
): Promise<AttestationRecords> {
  const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

  const [rawOwnership, rawValuation] = await Promise.all([
    client.readContract({
      address: registryAddress,
      abi: archpropRegistryAbi,
      functionName: "getLatestAttestation",
      args: [assetId, 0], // OWNERSHIP
    }) as Promise<{
      verifier: Address;
      attestationType: number;
      evidenceHash: Hex;
      value: bigint;
      timestamp: bigint;
      valid: boolean;
    }>,
    client.readContract({
      address: registryAddress,
      abi: archpropRegistryAbi,
      functionName: "getLatestAttestation",
      args: [assetId, 1], // VALUATION
    }) as Promise<{
      verifier: Address;
      attestationType: number;
      evidenceHash: Hex;
      value: bigint;
      timestamp: bigint;
      valid: boolean;
    }>,
  ]);

  const ownership =
    rawOwnership.valid && rawOwnership.evidenceHash !== ZERO_BYTES32
      ? {
          verifier: rawOwnership.verifier,
          evidenceHash: rawOwnership.evidenceHash,
          valid: rawOwnership.valid,
          timestamp: rawOwnership.timestamp,
        }
      : null;

  const valuation =
    rawValuation.valid && rawValuation.evidenceHash !== ZERO_BYTES32
      ? {
          verifier: rawValuation.verifier,
          evidenceHash: rawValuation.evidenceHash,
          value: rawValuation.value,
          valid: rawValuation.valid,
          timestamp: rawValuation.timestamp,
        }
      : null;

  return { ownership, valuation };
}
