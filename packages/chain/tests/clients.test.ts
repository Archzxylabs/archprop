/**
 * Client tests: the chain-ID guard and read-time failure handling.
 *
 * A stub client factory is injected so the guard and reader logic are tested
 * deterministically, with no network. The stub records calls, which lets us
 * assert that a chain mismatch prevents any contract read from being attempted.
 */

import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import {
  assertSupportedChainId,
  ChainMismatchError,
  createArchpropChainReader,
  createArchpropPublicClient,
} from "../src/clients";
import type { ArchpropChainReader, PublicClientFactory } from "../src/clients";
import { ChainConfigError, loadChainConfig, RPC_URL_ENV } from "../src/config";

const ADDRESSES = {
  registry: "0x1111111111111111111111111111111111111111",
  identityRegistry: "0x2222222222222222222222222222222222222222",
  mockIdr: "0x3333333333333333333333333333333333333333",
  offeringEscrow: "0x4444444444444444444444444444444444444444",
  revenueDistributor: "0x5555555555555555555555555555555555555555",
} as const;

const ASSET_ID = `0x${"ab".repeat(32)}` as `0x${string}`;
const EVIDENCE_HASH = `0x${"cd".repeat(32)}` as `0x${string}`;
const ZERO_HASH = `0x${"00".repeat(32)}` as `0x${string}`;
const INVESTOR = "0x6666666666666666666666666666666666666666";
const TOKEN = "0x7777777777777777777777777777777777777777";

function chainConfig() {
  return {
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    addresses: { ...ADDRESSES },
    chainId: 421614 as const,
  };
}

interface StubClient {
  client: PublicClient;
  calls: Array<{ functionName: string; address: string; args: unknown[] }>;
}

/** Builds a PublicClient stub that records calls and returns queued results. */
function stubClient(
  chainId: number,
  handlers: Record<string, (...args: unknown[]) => unknown> = {},
): StubClient {
  const calls: StubClient["calls"] = [];
  const client = {
    getChainId: vi.fn(async () => chainId),
    readContract: vi.fn(async (request: Record<string, unknown>) => {
      const args = (request.args as unknown[]) ?? [];
      calls.push({
        functionName: String(request.functionName),
        address: String(request.address),
        args,
      });
      const handler = handlers[String(request.functionName)];
      if (handler === undefined) {
        throw new Error(`unstubbed function ${String(request.functionName)}`);
      }
      return handler(...args);
    }),
  };
  return { client: client as unknown as PublicClient, calls };
}

function factoryFor(stub: StubClient): PublicClientFactory {
  return () => stub.client;
}

const HANDLERS: Record<string, (...args: unknown[]) => unknown> = {
  // 5 is FUNDED in the frozen enum order (SUBMITTED=0 ... ACTIVE=6).
  assetStatus: () => 5n,
  assetToken: () => TOKEN,
  assetOwner: () => INVESTOR,
  getAsset: () => ({
    owner: INVESTOR,
    metadataHash: ASSET_ID,
    agreementHash: EVIDENCE_HASH,
    status: 5n,
    token: TOKEN,
  }),
  getLatestAttestation: () => ({
    verifier: INVESTOR,
    attestationType: 2n,
    evidenceHash: EVIDENCE_HASH,
    value: 1_000n,
    timestamp: 1_700_000_000n,
    valid: true,
  }),
  isRevenueAttestationValid: () => true,
  isApproved: () => true,
  assetId: () => ASSET_ID,
  identityRegistry: () => ADDRESSES.identityRegistry,
  offeringEscrow: () => ADDRESSES.offeringEscrow,
  revenueDistributor: () => ADDRESSES.revenueDistributor,
  decimals: () => 0n,
  totalSupply: () => 300_000n,
  balanceOf: () => 1_000n,
  allocationOf: () => 50n,
  paymentOf: () => 50n,
  tokensClaimed: () => true,
  refundClaimed: () => false,
  revenueClaimed: () => false,
  getOffering: () => ({
    assetId: ASSET_ID,
    propertyToken: TOKEN,
    paymentToken: ADDRESSES.mockIdr,
    target: 3_000_000_000n,
    tokenPrice: 10_000n,
    deadline: 1_800_000_000n,
    raised: 3_000_000_000n,
    issuerTreasury: INVESTOR,
    status: 1n,
    fundsReleased: true,
  }),
  getRevenueEpoch: () => ({
    assetId: ASSET_ID,
    propertyToken: TOKEN,
    paymentToken: ADDRESSES.mockIdr,
    amount: 500_000n,
    totalSupply: 300_000n,
    claimDeadline: 1_900_000_000n,
    funder: INVESTOR,
    claimedAmount: 100_000n,
    closed: false,
  }),
  claimableRevenue: () => 250n,
};

describe("chain-ID guard", () => {
  it("resolves when the client reports Arbitrum Sepolia", async () => {
    const stub = stubClient(421614);
    await expect(assertSupportedChainId(stub.client)).resolves.toBe(421614);
  });

  it("fails closed on Ethereum mainnet", async () => {
    const stub = stubClient(1);
    await expect(assertSupportedChainId(stub.client)).rejects.toThrow(
      ChainMismatchError,
    );
  });

  it("fails closed on Arbitrum One", async () => {
    const stub = stubClient(42161);
    await expect(assertSupportedChainId(stub.client)).rejects.toThrow(
      ChainMismatchError,
    );
  });

  it("fails closed on local Anvil", async () => {
    const stub = stubClient(31337);
    await expect(assertSupportedChainId(stub.client)).rejects.toThrow(
      ChainMismatchError,
    );
  });

  it("names the actual chain id in the error", async () => {
    const stub = stubClient(1);
    await expect(assertSupportedChainId(stub.client)).rejects.toThrow(
      /chain 1/,
    );
  });

  it("propagates an RPC failure rather than assuming a chain", async () => {
    const client = {
      getChainId: vi.fn(async () => {
        throw new Error("rpc unreachable");
      }),
    } as unknown as PublicClient;
    await expect(assertSupportedChainId(client)).rejects.toThrow(
      /rpc unreachable/,
    );
  });

  it("verifies the chain before returning a public client", async () => {
    const stub = stubClient(1);
    await expect(
      createArchpropPublicClient("https://x.io", factoryFor(stub)),
    ).rejects.toThrow(ChainMismatchError);
    expect(stub.calls).toEqual([]);
  });

  it("returns the client when the chain is correct", async () => {
    const stub = stubClient(421614);
    const client = await createArchpropPublicClient(
      "https://x.io",
      factoryFor(stub),
    );
    expect(client).toBe(stub.client);
  });
});

describe("createArchpropChainReader", () => {
  it("decodes asset status into a lifecycle string", async () => {
    const stub = stubClient(421614, HANDLERS);
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    expect(await reader.getAssetStatus(ASSET_ID)).toBe("FUNDED");
    expect(stub.calls[0]).toMatchObject({
      functionName: "assetStatus",
      address: ADDRESSES.registry,
    });
  });

  it("decodes the asset token and owner", async () => {
    const stub = stubClient(421614, HANDLERS);
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    expect(await reader.getAssetToken(ASSET_ID)).toBe(TOKEN);
    expect(await reader.getAssetOwner(ASSET_ID)).toBe(INVESTOR);
  });

  it("decodes the composite asset read", async () => {
    const stub = stubClient(421614, HANDLERS);
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    const asset = await reader.getAsset(ASSET_ID);
    expect(asset.status).toBe("FUNDED");
    expect(asset.token).toBe(TOKEN);
    expect(asset.metadataHash).toBe(ASSET_ID);
  });

  it("throws on an unknown asset status rather than defaulting", async () => {
    const stub = stubClient(421614, { ...HANDLERS, assetStatus: () => 77n });
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    await expect(reader.getAssetStatus(ASSET_ID)).rejects.toThrow(/AssetStatus/);
  });

  it("encodes the attestation type on the way in and decodes on the way out", async () => {
    const stub = stubClient(421614, HANDLERS);
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    const attestation = await reader.getLatestAttestation(ASSET_ID, "REVENUE");
    expect(attestation.attestationType).toBe("REVENUE");
    expect(stub.calls[0]?.args).toEqual([ASSET_ID, 2]);
  });

  it("reads escrow state and decodes offering status", async () => {
    const stub = stubClient(421614, HANDLERS);
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    const offering = await reader.getOffering(1n);
    expect(offering.status).toBe("FUNDED");
    expect(offering.target).toBe(3_000_000_000n);
    expect(await reader.allocationOf(1n, INVESTOR)).toBe(50n);
    expect(await reader.paymentOf(1n, INVESTOR)).toBe(50n);
    expect(await reader.tokensClaimed(1n, INVESTOR)).toBe(true);
    expect(await reader.refundClaimed(1n, INVESTOR)).toBe(false);
  });

  it("reads revenue epoch state", async () => {
    const stub = stubClient(421614, HANDLERS);
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    const epoch = await reader.getRevenueEpoch(1n);
    expect(epoch.amount).toBe(500_000n);
    expect(epoch.closed).toBe(false);
    expect(await reader.claimableRevenue(1n, INVESTOR)).toBe(250n);
    expect(await reader.revenueClaimed(1n, INVESTOR)).toBe(false);
  });

  it("reads token info and binds balanceOf to the token address", async () => {
    const stub = stubClient(421614, HANDLERS);
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    const info = await reader.getTokenInfo(TOKEN);
    expect(info.decimals).toBe(0);
    expect(info.assetId).toBe(ASSET_ID);
    expect(info.totalSupply).toBe(300_000n);
    expect(await info.balanceOf(INVESTOR)).toBe(1_000n);
    expect(stub.calls.at(-1)?.address).toBe(TOKEN);
  });

  it("reads identity approval", async () => {
    const stub = stubClient(421614, HANDLERS);
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    expect(await reader.isInvestorApproved(INVESTOR)).toBe(true);
    expect(stub.calls[0]?.address).toBe(ADDRESSES.identityRegistry);
  });

  it("reads the demo currency balance", async () => {
    const stub = stubClient(421614, HANDLERS);
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    expect(await reader.mockIdrBalanceOf(INVESTOR)).toBe(1_000n);
    expect(stub.calls[0]?.address).toBe(ADDRESSES.mockIdr);
  });

  it("wraps an RPC failure with the operation name for diagnosability", async () => {
    const stub = stubClient(421614, {
      ...HANDLERS,
      assetStatus: () => {
        throw new Error("execution reverted");
      },
    });
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    await expect(reader.getAssetStatus(ASSET_ID)).rejects.toThrow(
      /getAssetStatus/,
    );
    await expect(reader.getAssetStatus(ASSET_ID)).rejects.toThrow(
      /execution reverted/,
    );
  });

  it("rejects a zero evidence hash before calling the contract", async () => {
    const stub = stubClient(421614, HANDLERS);
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    await expect(
      reader.isRevenueAttestationValid(ASSET_ID, ZERO_HASH, 1n),
    ).rejects.toThrow(/non-zero/);
    expect(stub.calls).toEqual([]);
  });

  it("passes a valid evidence hash through", async () => {
    const stub = stubClient(421614, HANDLERS);
    const reader = await createArchpropChainReader(
      chainConfig(),
      factoryFor(stub),
    );
    expect(
      await reader.isRevenueAttestationValid(ASSET_ID, EVIDENCE_HASH, 1_000n),
    ).toBe(true);
  });

  it("refuses to build a reader on a mismatched chain", async () => {
    const stub = stubClient(1, HANDLERS);
    await expect(
      createArchpropChainReader(chainConfig(), factoryFor(stub)),
    ).rejects.toThrow(ChainMismatchError);
    expect(stub.calls).toEqual([]);
  });
});

describe("config wiring", () => {
  it("exposes the required env var name matching .env.example", () => {
    expect(RPC_URL_ENV).toBe("NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL");
  });

  it("produces a config the reader can consume from .env.example names", () => {
    const env: NodeJS.ProcessEnv = {
      NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc",
      NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS: ADDRESSES.registry,
      NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS: ADDRESSES.identityRegistry,
      NEXT_PUBLIC_MOCK_IDR_ADDRESS: ADDRESSES.mockIdr,
      NEXT_PUBLIC_OFFERING_ESCROW_ADDRESS: ADDRESSES.offeringEscrow,
      NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS: ADDRESSES.revenueDistributor,
    };
    const loaded = loadChainConfig(env);
    expect(loaded.addresses.registry).toBe(ADDRESSES.registry);
    expect(loaded.chainId).toBe(421614);
    expect(() => loadChainConfig({})).toThrow(ChainConfigError);
  });

  it("rejects undocumented ARCHPROP_* aliases and requires canonical NEXT_PUBLIC_* variables", () => {
    const env: NodeJS.ProcessEnv = {
      ARCHPROP_RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc",
      ARCHPROP_REGISTRY_ADDRESS: ADDRESSES.registry,
      ARCHPROP_IDENTITY_REGISTRY_ADDRESS: ADDRESSES.identityRegistry,
      ARCHPROP_MOCK_IDR_ADDRESS: ADDRESSES.mockIdr,
      ARCHPROP_OFFERING_ESCROW_ADDRESS: ADDRESSES.offeringEscrow,
      ARCHPROP_REVENUE_DISTRIBUTOR_ADDRESS: ADDRESSES.revenueDistributor,
    };
    expect(() => loadChainConfig(env)).toThrow(ChainConfigError);
  });
});
