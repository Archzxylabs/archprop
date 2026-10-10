import {
  loadChainConfig,
  inspectChainConfig,
  type ChainConfig,
  type ChainConfigReport,
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

/**
 * Reads public chain environment variables safely in both browser and server runtimes.
 * Does not throw; returns null when incomplete or malformed.
 */
export function getClientChainConfig(): ChainConfig | null {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: (process.env.NODE_ENV as "development" | "production" | "test" | undefined) ?? "development",
    NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL: process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL,
    NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS: process.env.NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS,
    NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS: process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS,
    NEXT_PUBLIC_MOCK_IDR_ADDRESS: process.env.NEXT_PUBLIC_MOCK_IDR_ADDRESS,
    NEXT_PUBLIC_OFFERING_ESCROW_ADDRESS: process.env.NEXT_PUBLIC_OFFERING_ESCROW_ADDRESS,
    NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS: process.env.NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS,
  };

  try {
    return loadChainConfig(env);
  } catch {
    return null;
  }
}

/**
 * Returns a report of all missing or invalid configuration variables.
 */
export function inspectClientChainConfig(): ChainConfigReport {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: (process.env.NODE_ENV as "development" | "production" | "test" | undefined) ?? "development",
    NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL: process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL,
    NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS: process.env.NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS,
    NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS: process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS,
    NEXT_PUBLIC_MOCK_IDR_ADDRESS: process.env.NEXT_PUBLIC_MOCK_IDR_ADDRESS,
    NEXT_PUBLIC_OFFERING_ESCROW_ADDRESS: process.env.NEXT_PUBLIC_OFFERING_ESCROW_ADDRESS,
    NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS: process.env.NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS,
  };

  return inspectChainConfig(env);
}

/**
 * Builds a read-only viem public client for Arbitrum Sepolia.
 */
export function getArchpropPublicClient(config?: ChainConfig): PublicClient {
  const resolvedConfig = config ?? getClientChainConfig();
  if (!resolvedConfig) {
    const report = inspectClientChainConfig();
    throw new Error(`Chain configuration unavailable: ${report.errors.join("; ")}`);
  }

  return createPublicClient({
    chain: arbitrumSepolia,
    transport: http(resolvedConfig.rpcUrl),
  });
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
  status: "OPEN" | "FUNDED" | "FAILED";
  statusCode: number;
  fundsReleased: boolean;
  remainingCap: bigint;
}

/**
 * Derives Villa Nusa's offering ID from a confirmed OfferingCreated event emitted
 * by the configured escrow for the canonical asset ID; does not assume offering ID 1.
 * Validates the returned offering asset/token/payment addresses and reads raised, target,
 * price, deadline, and status from chain.
 */
export async function deriveOfferingForAsset(
  client: PublicClient,
  addresses: {
    offeringEscrow: Address;
    registry: Address;
    mockIdr: Address;
  },
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

  const offeringRaw = (await client.readContract({
    address: addresses.offeringEscrow,
    abi: offeringEscrowAbi,
    functionName: "getOffering",
    args: [offeringId],
  })) as {
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
  };

  // Validate the returned offering asset ID
  if (offeringRaw.assetId.toLowerCase() !== assetId.toLowerCase()) {
    throw new Error(
      `Escrow offering assetId mismatch: expected ${assetId}, got ${offeringRaw.assetId}`,
    );
  }

  // Validate the returned payment token matches configured MockIDR
  if (offeringRaw.paymentToken.toLowerCase() !== addresses.mockIdr.toLowerCase()) {
    throw new Error(
      `Escrow offering paymentToken mismatch: expected ${addresses.mockIdr}, got ${offeringRaw.paymentToken}`,
    );
  }

  // Validate property token matches the registry's linked token
  const linkedToken = (await client.readContract({
    address: addresses.registry,
    abi: archpropRegistryAbi,
    functionName: "assetToken",
    args: [assetId],
  })) as Address;

  if (offeringRaw.propertyToken.toLowerCase() !== linkedToken.toLowerCase()) {
    throw new Error(
      `Escrow offering propertyToken mismatch: expected registry token ${linkedToken}, got ${offeringRaw.propertyToken}`,
    );
  }

  const statusCode = Number(offeringRaw.status);
  const statusName: "OPEN" | "FUNDED" | "FAILED" =
    statusCode === 0 ? "OPEN" : statusCode === 1 ? "FUNDED" : "FAILED";

  const remainingCap =
    offeringRaw.target > offeringRaw.raised ? offeringRaw.target - offeringRaw.raised : 0n;

  return {
    offeringId,
    assetId,
    propertyToken: offeringRaw.propertyToken,
    paymentToken: offeringRaw.paymentToken,
    target: offeringRaw.target,
    tokenPrice: offeringRaw.tokenPrice,
    deadline: offeringRaw.deadline,
    raised: offeringRaw.raised,
    issuerTreasury: offeringRaw.issuerTreasury,
    status: statusName,
    statusCode,
    fundsReleased: offeringRaw.fundsReleased,
    remainingCap,
  };
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
  addresses: {
    identityRegistry: Address;
    mockIdr: Address;
    offeringEscrow: Address;
  },
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
