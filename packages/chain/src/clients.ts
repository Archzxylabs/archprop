/**
 * Read-only viem clients and typed contract readers for ARCHPROP.
 *
 * This module is intentionally read-only: it exposes no write helpers and
 * never accepts a private key or account. Broadcasting a transaction requires
 * an explicit operator action outside this package.
 *
 * Every read is guarded by a chain-ID check. A client connected to any chain
 * other than Arbitrum Sepolia fails closed, because an address that is valid on
 * one chain is meaningless or dangerous on another.
 */

import {
  createPublicClient,
  http,
  type PublicClient,
} from "viem";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  arbitrumSepolia,
} from "./chain";
import type { ChainConfig, ContractAddress, ContractAddresses } from "./config";
import { ChainConfigError } from "./config";
import {
  archpropRegistryAbi,
  identityRegistryAbi,
  mockIdrAbi,
  offeringEscrowAbi,
  propertyTokenAbi,
  revenueDistributorAbi,
} from "./abi";
import {
  decodeAssetStatus,
  decodeAttestationType,
  decodeOfferingStatus,
  encodeAttestationType,
  encodeAssetStatus,
  UnknownEnumValueError,
} from "./enums";
import { assertNonZeroHash } from "./numbers";
import type {
  Address as SharedAddress,
  AssetId,
  AttestationType,
  DocumentType,
  LifecycleStatus,
  PropertyMetadata,
} from "@archprop/shared";

export type { ChainConfig, ContractAddress, ContractAddresses };

/** Thrown when a client is bound to a chain ARCHPROP does not support. */
export class ChainMismatchError extends ChainConfigError {
  override readonly name = "ChainMismatchError";

  constructor(readonly actual: number) {
    super(
      `Client is connected to chain ${actual}, but ARCHPROP requires ` +
        `Arbitrum Sepolia (${ARBITRUM_SEPOLIA_CHAIN_ID}). Refusing to read ` +
        `contracts from an unexpected chain.`,
    );
  }
}

/** Factory signature for building a raw client; injectable for tests. */
export type PublicClientFactory = (rpcUrl: string) => PublicClient;

const defaultPublicClientFactory: PublicClientFactory = (rpcUrl) =>
  createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });

/**
 * Verifies that a client is bound to a chain ARCHPROP supports. Exported so the
 * guard can be tested without a network round-trip.
 */
export async function assertSupportedChainId(
  client: PublicClient,
): Promise<number> {
  const actualChainId = await client.getChainId();
  if (actualChainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new ChainMismatchError(actualChainId);
  }
  return actualChainId;
}

/**
 * Creates a read-only public client for the configured RPC and verifies the
 * chain it actually reports. Fails closed on any mismatch.
 */
export async function createArchpropPublicClient(
  rpcUrl: string,
  clientFactory: PublicClientFactory = defaultPublicClientFactory,
): Promise<PublicClient> {
  const client = clientFactory(rpcUrl);
  await assertSupportedChainId(client);
  return client;
}

/** A configured, chain-verified read client bound to frozen contract addresses. */
export interface ArchpropChainReader {
  readonly publicClient: PublicClient;
  readonly addresses: ContractAddresses;
  readonly chainId: typeof ARBITRUM_SEPOLIA_CHAIN_ID;

  // registry
  getAssetStatus(assetId: AssetId): Promise<LifecycleStatus>;
  getAssetToken(assetId: AssetId): Promise<SharedAddress>;
  getAssetOwner(assetId: AssetId): Promise<SharedAddress>;
  getAsset(assetId: AssetId): Promise<{
    owner: SharedAddress;
    metadataHash: string;
    agreementHash: string;
    status: LifecycleStatus;
    token: SharedAddress;
  }>;
  getLatestAttestation(assetId: AssetId, kind: AttestationType): Promise<{
    verifier: SharedAddress;
    attestationType: AttestationType;
    evidenceHash: string;
    value: bigint;
    timestamp: bigint;
    valid: boolean;
  }>;
  isRevenueAttestationValid(
    assetId: AssetId,
    evidenceHash: string,
    amount: bigint,
  ): Promise<boolean>;

  // identity
  isInvestorApproved(investor: SharedAddress): Promise<boolean>;

  // property token
  getTokenInfo(token: SharedAddress): Promise<{
    assetId: AssetId;
    identityRegistry: SharedAddress;
    offeringEscrow: SharedAddress;
    revenueDistributor: SharedAddress;
    decimals: number;
    totalSupply: bigint;
    balanceOf: (account: SharedAddress) => Promise<bigint>;
  }>;

  // escrow
  getOffering(offeringId: bigint): Promise<{
    assetId: AssetId;
    propertyToken: SharedAddress;
    paymentToken: SharedAddress;
    target: bigint;
    tokenPrice: bigint;
    deadline: bigint;
    raised: bigint;
    issuerTreasury: SharedAddress;
    status: "OPEN" | "FUNDED" | "FAILED";
    fundsReleased: boolean;
  }>;
  allocationOf(offeringId: bigint, investor: SharedAddress): Promise<bigint>;
  paymentOf(offeringId: bigint, investor: SharedAddress): Promise<bigint>;
  tokensClaimed(offeringId: bigint, investor: SharedAddress): Promise<boolean>;
  refundClaimed(offeringId: bigint, investor: SharedAddress): Promise<boolean>;

  // revenue
  getRevenueEpoch(epochId: bigint): Promise<{
    assetId: AssetId;
    propertyToken: SharedAddress;
    paymentToken: SharedAddress;
    amount: bigint;
    totalSupply: bigint;
    claimDeadline: bigint;
    funder: SharedAddress;
    claimedAmount: bigint;
    closed: boolean;
  }>;
  claimableRevenue(epochId: bigint, investor: SharedAddress): Promise<bigint>;
  revenueClaimed(epochId: bigint, investor: SharedAddress): Promise<boolean>;

  // demo currency
  mockIdrBalanceOf(account: SharedAddress): Promise<bigint>;
}

/**
 * Builds a chain-verified reader from explicit configuration.
 *
 * `clientFactory` exists for tests; production callers use the default, which
 * builds a real HTTP client from the configured RPC URL.
 */
export async function createArchpropChainReader(
  config: ChainConfig,
  clientFactory: PublicClientFactory = defaultPublicClientFactory,
): Promise<ArchpropChainReader> {
  const publicClient = await createArchpropPublicClient(
    config.rpcUrl,
    clientFactory,
  );
  const { addresses } = config;

  async function read<T>(
    operation: string,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw new ChainConfigError(
        `Read failed during "${operation}": ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    publicClient,
    addresses,
    chainId: ARBITRUM_SEPOLIA_CHAIN_ID,

    getAssetStatus(assetId) {
      return read("getAssetStatus", async () => {
        const raw = await publicClient.readContract({
          address: addresses.registry,
          abi: archpropRegistryAbi,
          functionName: "assetStatus",
          args: [assetId],
        });
        return decodeAssetStatus(raw);
      });
    },

    getAssetToken(assetId) {
      return read("getAssetToken", () =>
        publicClient.readContract({
          address: addresses.registry,
          abi: archpropRegistryAbi,
          functionName: "assetToken",
          args: [assetId],
        }),
      );
    },

    getAssetOwner(assetId) {
      return read("getAssetOwner", () =>
        publicClient.readContract({
          address: addresses.registry,
          abi: archpropRegistryAbi,
          functionName: "assetOwner",
          args: [assetId],
        }),
      );
    },

    getAsset(assetId) {
      return read("getAsset", async () => {
        const asset = await publicClient.readContract({
          address: addresses.registry,
          abi: archpropRegistryAbi,
          functionName: "getAsset",
          args: [assetId],
        });
        return {
          owner: asset.owner,
          metadataHash: asset.metadataHash,
          agreementHash: asset.agreementHash,
          status: decodeAssetStatus(asset.status),
          token: asset.token,
        };
      });
    },

    getLatestAttestation(assetId, kind) {
      return read("getLatestAttestation", async () => {
        const attestation = await publicClient.readContract({
          address: addresses.registry,
          abi: archpropRegistryAbi,
          functionName: "getLatestAttestation",
          args: [assetId, encodeAttestationType(kind)],
        });
        return {
          verifier: attestation.verifier,
          attestationType: decodeAttestationType(attestation.attestationType),
          evidenceHash: attestation.evidenceHash,
          value: attestation.value,
          timestamp: attestation.timestamp,
          valid: attestation.valid,
        };
      });
    },

    isRevenueAttestationValid(assetId, evidenceHash, amount) {
      return read("isRevenueAttestationValid", () => {
        const hash = assertNonZeroHash(evidenceHash, "evidenceHash");
        return publicClient.readContract({
          address: addresses.registry,
          abi: archpropRegistryAbi,
          functionName: "isRevenueAttestationValid",
          args: [assetId, hash, amount],
        });
      });
    },

    isInvestorApproved(investor) {
      return read("isInvestorApproved", () =>
        publicClient.readContract({
          address: addresses.identityRegistry,
          abi: identityRegistryAbi,
          functionName: "isApproved",
          args: [investor],
        }),
      );
    },

    async getTokenInfo(token) {
      return read("getTokenInfo", async () => {
        const [assetId, identityRegistry, offeringEscrow, revenueDistributor, decimals, totalSupply] =
          await Promise.all([
            publicClient.readContract({
              address: token,
              abi: propertyTokenAbi,
              functionName: "assetId",
            }),
            publicClient.readContract({
              address: token,
              abi: propertyTokenAbi,
              functionName: "identityRegistry",
            }),
            publicClient.readContract({
              address: token,
              abi: propertyTokenAbi,
              functionName: "offeringEscrow",
            }),
            publicClient.readContract({
              address: token,
              abi: propertyTokenAbi,
              functionName: "revenueDistributor",
            }),
            publicClient.readContract({
              address: token,
              abi: propertyTokenAbi,
              functionName: "decimals",
            }),
            publicClient.readContract({
              address: token,
              abi: propertyTokenAbi,
              functionName: "totalSupply",
            }),
          ]);
        return {
          assetId,
          identityRegistry,
          offeringEscrow,
          revenueDistributor,
          decimals: Number(decimals),
          totalSupply,
          balanceOf: (account) =>
            read("token.balanceOf", () =>
              publicClient.readContract({
                address: token,
                abi: propertyTokenAbi,
                functionName: "balanceOf",
                args: [account],
              }),
            ),
        };
      });
    },

    getOffering(offeringId) {
      return read("getOffering", async () => {
        const offering = await publicClient.readContract({
          address: addresses.offeringEscrow,
          abi: offeringEscrowAbi,
          functionName: "getOffering",
          args: [offeringId],
        });
        return {
          assetId: offering.assetId,
          propertyToken: offering.propertyToken,
          paymentToken: offering.paymentToken,
          target: offering.target,
          tokenPrice: offering.tokenPrice,
          deadline: offering.deadline,
          raised: offering.raised,
          issuerTreasury: offering.issuerTreasury,
          status: decodeOfferingStatus(offering.status),
          fundsReleased: offering.fundsReleased,
        };
      });
    },

    allocationOf(offeringId, investor) {
      return read("allocationOf", () =>
        publicClient.readContract({
          address: addresses.offeringEscrow,
          abi: offeringEscrowAbi,
          functionName: "allocationOf",
          args: [offeringId, investor],
        }),
      );
    },

    paymentOf(offeringId, investor) {
      return read("paymentOf", () =>
        publicClient.readContract({
          address: addresses.offeringEscrow,
          abi: offeringEscrowAbi,
          functionName: "paymentOf",
          args: [offeringId, investor],
        }),
      );
    },

    tokensClaimed(offeringId, investor) {
      return read("tokensClaimed", () =>
        publicClient.readContract({
          address: addresses.offeringEscrow,
          abi: offeringEscrowAbi,
          functionName: "tokensClaimed",
          args: [offeringId, investor],
        }),
      );
    },

    refundClaimed(offeringId, investor) {
      return read("refundClaimed", () =>
        publicClient.readContract({
          address: addresses.offeringEscrow,
          abi: offeringEscrowAbi,
          functionName: "refundClaimed",
          args: [offeringId, investor],
        }),
      );
    },

    getRevenueEpoch(epochId) {
      return read("getRevenueEpoch", async () => {
        const epoch = await publicClient.readContract({
          address: addresses.revenueDistributor,
          abi: revenueDistributorAbi,
          functionName: "getRevenueEpoch",
          args: [epochId],
        });
        return {
          assetId: epoch.assetId,
          propertyToken: epoch.propertyToken,
          paymentToken: epoch.paymentToken,
          amount: epoch.amount,
          totalSupply: epoch.totalSupply,
          claimDeadline: epoch.claimDeadline,
          funder: epoch.funder,
          claimedAmount: epoch.claimedAmount,
          closed: epoch.closed,
        };
      });
    },

    claimableRevenue(epochId, investor) {
      return read("claimableRevenue", () =>
        publicClient.readContract({
          address: addresses.revenueDistributor,
          abi: revenueDistributorAbi,
          functionName: "claimableRevenue",
          args: [epochId, investor],
        }),
      );
    },

    revenueClaimed(epochId, investor) {
      return read("revenueClaimed", () =>
        publicClient.readContract({
          address: addresses.revenueDistributor,
          abi: revenueDistributorAbi,
          functionName: "revenueClaimed",
          args: [epochId, investor],
        }),
      );
    },

    mockIdrBalanceOf(account) {
      return read("mockIdrBalanceOf", () =>
        publicClient.readContract({
          address: addresses.mockIdr,
          abi: mockIdrAbi,
          functionName: "balanceOf",
          args: [account],
        }),
      );
    },
  };
}

/** Builds a reader directly from an environment map, failing closed. */
export async function createArchpropChainReaderFromEnv(
  env: NodeJS.ProcessEnv,
): Promise<ArchpropChainReader> {
  const { loadChainConfig } = await import("./config");
  return createArchpropChainReader(loadChainConfig(env));
}

export {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  arbitrumSepolia,
  decodeAssetStatus,
  decodeAttestationType,
  decodeOfferingStatus,
  encodeAssetStatus,
  UnknownEnumValueError,
};
export type { AttestationType, LifecycleStatus, PropertyMetadata, DocumentType };
