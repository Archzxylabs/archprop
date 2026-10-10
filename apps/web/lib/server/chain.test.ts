import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import {
  REVENUE_PUBLISHED_EVENT,
  decodeRevenuePublishedLogs,
  fetchVerifiedReceipt,
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
