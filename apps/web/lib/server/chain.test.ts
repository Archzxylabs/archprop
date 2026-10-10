import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import {
  ASSET_CREATED_EVENT,
  REVENUE_PUBLISHED_EVENT,
  decodeAssetCreatedLogs,
  decodeRevenuePublishedLogs,
  fetchRegistryAsset,
  fetchVerifiedReceipt,
  verifyRpcChainId,
  checkRegistryRole,
} from "./chain";

const DISTRIBUTOR: `0x${string}` = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const ASSET_ID: `0x${string}` = "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae";
const OTHER_ASSET: `0x${string}` =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const EVIDENCE_HASH: `0x${string}` = `0x${"44".repeat(32)}`;
const OTHER_CONTRACT: `0x${string}` = `0x${"55".repeat(20)}`;

/**
 * Builds a log whose topics/data encode a real RevenuePublished event, so these
 * tests exercise the actual decoder rather than a mock of it.
 */
function buildLog(args: {
  epochId: bigint;
  assetId: `0x${string}`;
  amount: bigint;
  evidenceHash: `0x${string}`;
  claimDeadline: bigint;
  emitter?: `0x${string}`;
}): Log {
  const topics = encodeEventTopics({
    abi: [REVENUE_PUBLISHED_EVENT],
    eventName: "RevenuePublished",
    args: { epochId: args.epochId, assetId: args.assetId },
  });
  const data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "bytes32" },
      { type: "uint64" },
    ],
    [args.amount, args.evidenceHash, args.claimDeadline],
  );
  return {
    address: args.emitter ?? DISTRIBUTOR,
    topics,
    data,
    blockNumber: 12_345n,
    blockHash: "0x" + "11".repeat(32),
    transactionHash: "0x" + "22".repeat(32),
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  } as unknown as Log;
}

describe("fetchVerifiedReceipt", () => {
  it("accepts a successful receipt", async () => {
    const result = await fetchVerifiedReceipt(
      async () => ({
        status: "success",
        blockNumber: 99n,
        logs: [],
      }),
      "0x" + "33".repeat(32),
    );
    expect(result).toEqual({ ok: true, blockNumber: 99, logs: [] });
  });

  it("rejects a reverted receipt", async () => {
    const result = await fetchVerifiedReceipt(
      async () => ({ status: "reverted", blockNumber: 99n, logs: [] }),
      "0x" + "33".repeat(32),
    );
    expect(result).toEqual({ ok: false, reason: "reverted" });
  });

  it("reports a missing receipt as not_found rather than an error", async () => {
    const result = await fetchVerifiedReceipt(async () => {
      throw new Error("Transaction receipt not found.");
    }, "0x" + "33".repeat(32));
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("reports a transport failure as rpc_error", async () => {
    const result = await fetchVerifiedReceipt(async () => {
      throw new Error("HTTP request timed out");
    }, "0x" + "33".repeat(32));
    expect(result).toEqual({ ok: false, reason: "rpc_error" });
  });
});

describe("decodeRevenuePublishedLogs", () => {
  it("decodes a matching log from the configured distributor", () => {
    const logs = [
      buildLog({ epochId: 7n, assetId: ASSET_ID, amount: 5_000n, evidenceHash: EVIDENCE_HASH, claimDeadline: 1n }),
    ];
    const decoded = decodeRevenuePublishedLogs(logs, DISTRIBUTOR, ASSET_ID);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.epochId).toBe(7n);
    expect(decoded[0]?.amount).toBe(5_000n);
    expect(decoded[0]?.blockNumber).toBe(12_345);
  });

  it("ignores a log emitted by a different contract", () => {
    const logs = [
      buildLog({
        epochId: 7n,
        assetId: ASSET_ID,
        amount: 5_000n,
        evidenceHash: EVIDENCE_HASH,
        claimDeadline: 1n,
        emitter: OTHER_CONTRACT,
      }),
    ];
    expect(decodeRevenuePublishedLogs(logs, DISTRIBUTOR, ASSET_ID)).toHaveLength(0);
  });

  it("ignores a log for a different asset, which must not satisfy verification", () => {
    const logs = [
      buildLog({
        epochId: 7n,
        assetId: OTHER_ASSET,
        amount: 5_000n,
        evidenceHash: EVIDENCE_HASH,
        claimDeadline: 1n,
      }),
    ];
    expect(decodeRevenuePublishedLogs(logs, DISTRIBUTOR, ASSET_ID)).toHaveLength(0);
  });

  it("skips undecodable logs instead of throwing", () => {
    const garbage = {
      address: DISTRIBUTOR,
      topics: ["0x" + "66".repeat(32)],
      data: "0xdeadbeef",
      blockNumber: 1n,
      logIndex: 0,
    } as unknown as Log;
    const logs = [
      garbage,
      buildLog({ epochId: 9n, assetId: ASSET_ID, amount: 1n, evidenceHash: EVIDENCE_HASH, claimDeadline: 1n }),
    ];
    const decoded = decodeRevenuePublishedLogs(logs, DISTRIBUTOR, ASSET_ID);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.epochId).toBe(9n);
  });

  it("matches the asset id case-insensitively", () => {
    const logs = [
      buildLog({ epochId: 7n, assetId: ASSET_ID, amount: 5_000n, evidenceHash: EVIDENCE_HASH, claimDeadline: 1n }),
    ];
    expect(
      decodeRevenuePublishedLogs(logs, DISTRIBUTOR, ASSET_ID.toUpperCase() as unknown as `0x${string}`),
    ).toHaveLength(1);
  });
});

describe("verifyRpcChainId", () => {
  it("accepts the canonical Arbitrum Sepolia chain ID (421614)", async () => {
    const result = await verifyRpcChainId(async () => 421614);
    expect(result).toEqual({ ok: true, chainId: 421614 });
  });

  it("rejects a mismatched chain ID (e.g. Ethereum mainnet or local node)", async () => {
    const mainnet = await verifyRpcChainId(async () => 1);
    expect(mainnet).toEqual({ ok: false, reason: "mismatch", chainId: 1 });

    const localAnvil = await verifyRpcChainId(async () => 31337);
    expect(localAnvil).toEqual({ ok: false, reason: "mismatch", chainId: 31337 });
  });

  it("handles RPC errors/unavailable transport safely", async () => {
    const errorResult = await verifyRpcChainId(async () => {
      throw new Error("RPC endpoint unavailable / network timeout");
    });
    expect(errorResult).toEqual({ ok: false, reason: "rpc_error" });
  });
});

describe("decodeAssetCreatedLogs", () => {
  const REGISTRY: `0x${string}` = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const OWNER: `0x${string}` = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const METADATA_HASH: `0x${string}` = `0x${"77".repeat(32)}`;

  function buildAssetCreatedLog(args: {
    assetId: `0x${string}`;
    owner: `0x${string}`;
    metadataHash: `0x${string}`;
    emitter?: `0x${string}`;
  }): Log {
    const topics = encodeEventTopics({
      abi: [ASSET_CREATED_EVENT],
      eventName: "AssetCreated",
      args: { assetId: args.assetId, owner: args.owner },
    });
    const data = encodeAbiParameters(
      [{ type: "bytes32" }],
      [args.metadataHash],
    );
    return {
      address: args.emitter ?? REGISTRY,
      topics,
      data,
      blockNumber: 12_345n,
      blockHash: "0x" + "11".repeat(32),
      transactionHash: "0x" + "22".repeat(32),
      transactionIndex: 0,
      logIndex: 0,
      removed: false,
    } as unknown as Log;
  }

  it("decodes a matching AssetCreated log from the configured registry", () => {
    const logs = [
      buildAssetCreatedLog({ assetId: ASSET_ID, owner: OWNER, metadataHash: METADATA_HASH }),
    ];
    const decoded = decodeAssetCreatedLogs(logs, REGISTRY, ASSET_ID);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.assetId).toBe(ASSET_ID);
    expect(decoded[0]?.owner.toLowerCase()).toBe(OWNER.toLowerCase());
    expect(decoded[0]?.metadataHash).toBe(METADATA_HASH);
    expect(decoded[0]?.blockNumber).toBe(12_345);
  });

  it("ignores an AssetCreated log emitted by a different contract", () => {
    const logs = [
      buildAssetCreatedLog({
        assetId: ASSET_ID,
        owner: OWNER,
        metadataHash: METADATA_HASH,
        emitter: OTHER_CONTRACT,
      }),
    ];
    expect(decodeAssetCreatedLogs(logs, REGISTRY, ASSET_ID)).toHaveLength(0);
  });

  it("ignores an AssetCreated log for a different asset ID", () => {
    const logs = [
      buildAssetCreatedLog({ assetId: OTHER_ASSET, owner: OWNER, metadataHash: METADATA_HASH }),
    ];
    expect(decodeAssetCreatedLogs(logs, REGISTRY, ASSET_ID)).toHaveLength(0);
  });
});

describe("fetchRegistryAsset", () => {
  const REGISTRY: `0x${string}` = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const OWNER: `0x${string}` = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const METADATA_HASH: `0x${string}` = `0x${"77".repeat(32)}`;
  const AGREEMENT_HASH: `0x${string}` = `0x${"88".repeat(32)}`;
  const TOKEN: `0x${string}` = `0x${"99".repeat(20)}`;

  it("parses struct object returned by registry", async () => {
    const result = await fetchRegistryAsset(
      async () => ({
        owner: OWNER,
        metadataHash: METADATA_HASH,
        agreementHash: AGREEMENT_HASH,
        status: 0,
        token: TOKEN,
      }),
      REGISTRY,
      ASSET_ID,
    );
    expect(result).toEqual({
      ok: true,
      asset: {
        owner: OWNER,
        metadataHash: METADATA_HASH,
        agreementHash: AGREEMENT_HASH,
        status: 0,
        token: TOKEN,
      },
    });
  });

  it("parses tuple array returned by registry", async () => {
    const result = await fetchRegistryAsset(
      async () => [OWNER, METADATA_HASH, AGREEMENT_HASH, 0, TOKEN] as const,
      REGISTRY,
      ASSET_ID,
    );
    expect(result).toEqual({
      ok: true,
      asset: {
        owner: OWNER,
        metadataHash: METADATA_HASH,
        agreementHash: AGREEMENT_HASH,
        status: 0,
        token: TOKEN,
      },
    });
  });

  it("handles RPC error safely", async () => {
    const result = await fetchRegistryAsset(
      async () => {
        throw new Error("RPC timeout");
      },
      REGISTRY,
      ASSET_ID,
    );
    expect(result).toEqual({ ok: false, reason: "rpc_error" });
  });
});

describe("checkRegistryRole", () => {
  const REGISTRY: `0x${string}` = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const ACCOUNT: `0x${string}` = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const ROLE: `0x${string}` = "0x92201a2c4d2d948a3b076df4ae54439a8944585a9b2f54c599c035e4b5ad6c99";

  it("returns hasRole true when account holds the role", async () => {
    const result = await checkRegistryRole(
      async () => true,
      REGISTRY,
      ROLE,
      ACCOUNT,
    );
    expect(result).toEqual({ ok: true, hasRole: true });
  });

  it("returns hasRole false when account does not hold the role", async () => {
    const result = await checkRegistryRole(
      async () => false,
      REGISTRY,
      ROLE,
      ACCOUNT,
    );
    expect(result).toEqual({ ok: true, hasRole: false });
  });

  it("returns rpc_error when readContract throws", async () => {
    const result = await checkRegistryRole(
      async () => {
        throw new Error("RPC connection refused");
      },
      REGISTRY,
      ROLE,
      ACCOUNT,
    );
    expect(result).toEqual({ ok: false, reason: "rpc_error" });
  });
});
