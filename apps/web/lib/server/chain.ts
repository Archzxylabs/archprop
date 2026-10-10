/**
 * Read-only chain access for API routes.
 *
 * This module never signs, never holds a private key, and never submits a
 * transaction. Its only job is to answer "did this already happen on-chain, and
 * what did it say?" so the API can record a truthful cache entry rather than
 * invent one. The backend deliberately routes no owner/verifier/investor
 * wallet signing through a server key.
 */

import { decodeEventLog, parseAbiItem, type Log } from "viem";
import type { ChainConfig } from "./config";

/** Exact event signature from the frozen chain adapter contract. */
export const REVENUE_PUBLISHED_EVENT = parseAbiItem(
  "event RevenuePublished(uint256 indexed epochId, bytes32 indexed assetId, uint256 amount, bytes32 evidenceHash, uint64 claimDeadline)",
);

export interface RevenuePublishedLog {
  epochId: bigint;
  assetId: string;
  amount: bigint;
  evidenceHash: string;
  claimDeadline: bigint;
  blockNumber: number;
  logIndex: number;
}

export type ReceiptCheck =
  | { ok: true; blockNumber: number; logs: readonly Log[] }
  | { ok: false; reason: "not_found" | "reverted" | "rpc_error" };

/**
 * Minimal receipt shape this module depends on. Declared structurally so tests
 * and the route both work without a live RPC client.
 */
export interface ReceiptLike {
  status: "success" | "reverted";
  blockNumber: bigint;
  logs: readonly Log[];
}

/**
 * Fetches a receipt and confirms the transaction succeeded.
 *
 * A reverted or missing receipt is a hard failure: recording it would let the
 * database claim a distribution exists when the chain says it does not.
 */
export async function fetchVerifiedReceipt(
  getReceipt: (txHash: string) => Promise<ReceiptLike>,
  txHash: string,
): Promise<ReceiptCheck> {
  try {
    const receipt = await getReceipt(txHash);
    if (receipt.status !== "success") {
      return { ok: false, reason: "reverted" };
    }
    return {
      ok: true,
      blockNumber: Number(receipt.blockNumber),
      logs: receipt.logs,
    };
  } catch (error) {
    // A missing receipt and a transport failure are distinct outcomes, but
    // both must be reported as unverified — never as success.
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|notfound|does not exist/i.test(message)) {
      return { ok: false, reason: "not_found" };
    }
    return { ok: false, reason: "rpc_error" };
  }
}

/**
 * Decodes the `RevenuePublished` logs in a receipt that belong to the
 * distributor and match `assetId`.
 *
 * Anchoring to this transaction's own logs (rather than scanning the chain)
 * means the receipt itself is the evidence. Filtering by `assetId` matters: a
 * transaction can publish more than one epoch, so a receipt containing a
 * matching event for a different asset must not be accepted for this one.
 */
export function decodeRevenuePublishedLogs(
  logs: readonly Log[],
  distributorAddress: string,
  assetId: string,
): RevenuePublishedLog[] {
  const results: RevenuePublishedLog[] = [];
  const wantedAsset = assetId.toLowerCase();
  const wantedDistributor = distributorAddress.toLowerCase();

  for (const log of logs) {
    if (log.address.toLowerCase() !== wantedDistributor) {
      continue;
    }
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: [REVENUE_PUBLISHED_EVENT],
        data: log.data,
        topics: log.topics,
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== "RevenuePublished") {
      continue;
    }
    const args = decoded.args as {
      epochId: bigint;
      assetId: string;
      amount: bigint;
      evidenceHash: string;
      claimDeadline: bigint;
    };
    if (args.assetId.toLowerCase() !== wantedAsset) {
      continue;
    }
    results.push({
      epochId: args.epochId,
      assetId: args.assetId,
      amount: args.amount,
      evidenceHash: args.evidenceHash,
      claimDeadline: args.claimDeadline,
      blockNumber: Number(log.blockNumber ?? 0n),
      logIndex: Number(log.logIndex ?? 0n),
    });
  }
  return results;
}

/** Wraps a viem PublicClient's getTransactionReceipt as the injectable function. */
export function receiptGetterFromClient(client: {
  getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<ReceiptLike>;
}): (txHash: string) => Promise<ReceiptLike> {
  return (txHash: string) => client.getTransactionReceipt({ hash: txHash as `0x${string}` });
}

export type ChainIdCheck =
  | { ok: true; chainId: number }
  | { ok: false; reason: "rpc_error" | "mismatch"; chainId?: number };

/**
 * Confirms that the RPC client is connected to the expected chain ID (421614).
 *
 * Failing to check the chain ID would let an RPC pointing to the wrong network
 * validate receipts or events for a foreign chain.
 */
export async function verifyRpcChainId(
  getChainId: () => Promise<number>,
  expectedChainId: number = 421614,
): Promise<ChainIdCheck> {
  try {
    const chainId = await getChainId();
    if (chainId !== expectedChainId) {
      return { ok: false, reason: "mismatch", chainId };
    }
    return { ok: true, chainId };
  } catch {
    return { ok: false, reason: "rpc_error" };
  }
}

/** Exact event signature for AssetCreated from ArchpropRegistry. */
export const ASSET_CREATED_EVENT = parseAbiItem(
  "event AssetCreated(bytes32 indexed assetId, address indexed owner, bytes32 metadataHash)",
);

export interface AssetCreatedLog {
  assetId: string;
  owner: `0x${string}`;
  metadataHash: string;
  blockNumber: number;
  logIndex: number;
}

/**
 * Decodes AssetCreated logs in a receipt that belong to ArchpropRegistry and match assetId.
 */
export function decodeAssetCreatedLogs(
  logs: readonly Log[],
  registryAddress: string,
  assetId: string,
): AssetCreatedLog[] {
  const results: AssetCreatedLog[] = [];
  const wantedAsset = assetId.toLowerCase();
  const wantedRegistry = registryAddress.toLowerCase();

  for (const log of logs) {
    if (log.address.toLowerCase() !== wantedRegistry) {
      continue;
    }
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: [ASSET_CREATED_EVENT],
        data: log.data,
        topics: log.topics,
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== "AssetCreated") {
      continue;
    }
    const args = decoded.args as {
      assetId: string;
      owner: `0x${string}`;
      metadataHash: string;
    };
    if (args.assetId.toLowerCase() !== wantedAsset) {
      continue;
    }
    results.push({
      assetId: args.assetId,
      owner: args.owner,
      metadataHash: args.metadataHash,
      blockNumber: Number(log.blockNumber ?? 0n),
      logIndex: Number(log.logIndex ?? 0n),
    });
  }
  return results;
}

/** ABI for reading asset state from ArchpropRegistry. */
export const GET_ASSET_ABI = [
  {
    type: "function",
    name: "getAsset",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [
      {
        name: "asset",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "metadataHash", type: "bytes32" },
          { name: "agreementHash", type: "bytes32" },
          { name: "status", type: "uint8" },
          { name: "token", type: "address" },
        ],
      },
    ],
  },
] as const;

export interface RegistryAssetView {
  owner: `0x${string}`;
  metadataHash: `0x${string}`;
  agreementHash: `0x${string}`;
  status: number;
  token: `0x${string}`;
}

export type RegistryAssetCheck =
  | { ok: true; asset: RegistryAssetView }
  | { ok: false; reason: "rpc_error" };

/**
 * Reads current asset state from ArchpropRegistry via getAsset(assetId).
 */
export async function fetchRegistryAsset(
  readContract: (args: {
    address: `0x${string}`;
    abi: typeof GET_ASSET_ABI;
    functionName: "getAsset";
    args: readonly [`0x${string}`];
  }) => Promise<unknown>,
  registryAddress: string,
  assetId: string,
): Promise<RegistryAssetCheck> {
  try {
    const raw = (await readContract({
      address: registryAddress as `0x${string}`,
      abi: GET_ASSET_ABI,
      functionName: "getAsset",
      args: [assetId as `0x${string}`],
    })) as
      | {
          owner: `0x${string}`;
          metadataHash: `0x${string}`;
          agreementHash: `0x${string}`;
          status: number;
          token: `0x${string}`;
        }
      | readonly [`0x${string}`, `0x${string}`, `0x${string}`, number, `0x${string}`];

    if (Array.isArray(raw)) {
      return {
        ok: true,
        asset: {
          owner: raw[0],
          metadataHash: raw[1],
          agreementHash: raw[2],
          status: Number(raw[3]),
          token: raw[4],
        },
      };
    }
    const record = raw as {
      owner: `0x${string}`;
      metadataHash: `0x${string}`;
      agreementHash: `0x${string}`;
      status: number;
      token: `0x${string}`;
    };
    return {
      ok: true,
      asset: {
        owner: record.owner,
        metadataHash: record.metadataHash,
        agreementHash: record.agreementHash,
        status: Number(record.status),
        token: record.token,
      },
    };
  } catch {
    return { ok: false, reason: "rpc_error" };
  }
}

export type { ChainConfig };
