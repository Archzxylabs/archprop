import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import {
  deriveOfferingForAsset,
  fetchAttestationRecords,
  fetchInvestorState,
  getClientChainConfig,
  inspectClientChainConfig,
} from "./chain-client";

describe("chain-client configuration", () => {
  it("returns null from getClientChainConfig when environment is missing or empty", () => {
    const config = getClientChainConfig();
    expect(config).toBeNull();
  });

  it("reports missing variables in inspectClientChainConfig", () => {
    const report = inspectClientChainConfig();
    expect(report.ok).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });
});

describe("deriveOfferingForAsset", () => {
  const escrowAddress = "0x4444444444444444444444444444444444444444" as const;
  const registryAddress = "0x1111111111111111111111111111111111111111" as const;
  const mockIdrAddress = "0x3333333333333333333333333333333333333333" as const;
  const propertyTokenAddress = "0x7777777777777777777777777777777777777777" as const;
  const canonicalAssetId = "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae" as const;

  it("returns null when no OfferingCreated logs exist for the asset ID", async () => {
    const mockClient = {
      getLogs: vi.fn(async () => []),
    } as unknown as PublicClient;

    const result = await deriveOfferingForAsset(
      mockClient,
      {
        offeringEscrow: escrowAddress,
        registry: registryAddress,
        mockIdr: mockIdrAddress,
      },
      canonicalAssetId,
    );

    expect(result).toBeNull();
    expect(mockClient.getLogs).toHaveBeenCalledTimes(1);
  });

  it("correctly derives offering and validates addresses when OfferingCreated event is confirmed", async () => {
    const mockClient = {
      getLogs: vi.fn(async () => [
        {
          args: {
            offeringId: 42n,
            assetId: canonicalAssetId,
            token: propertyTokenAddress,
            target: 3_000_000_000n,
            tokenPrice: 10_000n,
            deadline: 1800000000n,
          },
        },
      ]),
      readContract: vi.fn(async (params: { address: string; functionName: string }) => {
        if (params.functionName === "getOffering") {
          return {
            assetId: canonicalAssetId,
            propertyToken: propertyTokenAddress,
            paymentToken: mockIdrAddress,
            target: 3_000_000_000n,
            tokenPrice: 10_000n,
            deadline: 1800000000n,
            raised: 1_000_000_000n,
            issuerTreasury: "0x8888888888888888888888888888888888888888",
            status: 0, // OPEN
            fundsReleased: false,
          };
        }
        if (params.functionName === "assetToken") {
          return propertyTokenAddress;
        }
        throw new Error(`Unexpected contract call: ${params.functionName}`);
      }),
    } as unknown as PublicClient;

    const result = await deriveOfferingForAsset(
      mockClient,
      {
        offeringEscrow: escrowAddress,
        registry: registryAddress,
        mockIdr: mockIdrAddress,
      },
      canonicalAssetId,
    );

    expect(result).not.toBeNull();
    expect(result!.offeringId).toBe(42n);
    expect(result!.status).toBe("OPEN");
    expect(result!.statusCode).toBe(0);
    expect(result!.raised).toBe(1_000_000_000n);
    expect(result!.target).toBe(3_000_000_000n);
    expect(result!.tokenPrice).toBe(10_000n);
    expect(result!.remainingCap).toBe(2_000_000_000n);
  });

  it("fails closed when returned offering assetId does not match requested assetId", async () => {
    const wrongAssetId = "0x9999999999999999999999999999999999999999999999999999999999999999";
    const mockClient = {
      getLogs: vi.fn(async () => [
        {
          args: {
            offeringId: 1n,
            assetId: canonicalAssetId,
          },
        },
      ]),
      readContract: vi.fn(async () => ({
        assetId: wrongAssetId,
        propertyToken: propertyTokenAddress,
        paymentToken: mockIdrAddress,
        target: 3_000_000_000n,
        tokenPrice: 10_000n,
        deadline: 1800000000n,
        raised: 0n,
        issuerTreasury: "0x8888888888888888888888888888888888888888",
        status: 0,
        fundsReleased: false,
      })),
    } as unknown as PublicClient;

    await expect(
      deriveOfferingForAsset(
        mockClient,
        {
          offeringEscrow: escrowAddress,
          registry: registryAddress,
          mockIdr: mockIdrAddress,
        },
        canonicalAssetId,
      ),
    ).rejects.toThrow(/assetId mismatch/);
  });

  it("fails closed when paymentToken does not match configured MockIDR", async () => {
    const wrongPaymentToken = "0x0000000000000000000000000000000000000001";
    const mockClient = {
      getLogs: vi.fn(async () => [
        {
          args: {
            offeringId: 1n,
            assetId: canonicalAssetId,
          },
        },
      ]),
      readContract: vi.fn(async () => ({
        assetId: canonicalAssetId,
        propertyToken: propertyTokenAddress,
        paymentToken: wrongPaymentToken,
        target: 3_000_000_000n,
        tokenPrice: 10_000n,
        deadline: 1800000000n,
        raised: 0n,
        issuerTreasury: "0x8888888888888888888888888888888888888888",
        status: 0,
        fundsReleased: false,
      })),
    } as unknown as PublicClient;

    await expect(
      deriveOfferingForAsset(
        mockClient,
        {
          offeringEscrow: escrowAddress,
          registry: registryAddress,
          mockIdr: mockIdrAddress,
        },
        canonicalAssetId,
      ),
    ).rejects.toThrow(/paymentToken mismatch/);
  });

  it("fails closed when propertyToken does not match registry linked token", async () => {
    const unlinkedPropertyToken = "0x9999999999999999999999999999999999999999";
    const mockClient = {
      getLogs: vi.fn(async () => [
        {
          args: {
            offeringId: 1n,
            assetId: canonicalAssetId,
          },
        },
      ]),
      readContract: vi.fn(async (params: { functionName: string }) => {
        if (params.functionName === "getOffering") {
          return {
            assetId: canonicalAssetId,
            propertyToken: unlinkedPropertyToken,
            paymentToken: mockIdrAddress,
            target: 3_000_000_000n,
            tokenPrice: 10_000n,
            deadline: 1800000000n,
            raised: 0n,
            issuerTreasury: "0x8888888888888888888888888888888888888888",
            status: 0,
            fundsReleased: false,
          };
        }
        if (params.functionName === "assetToken") {
          return propertyTokenAddress;
        }
        throw new Error(`Unexpected function call: ${params.functionName}`);
      }),
    } as unknown as PublicClient;

    await expect(
      deriveOfferingForAsset(
        mockClient,
        {
          offeringEscrow: escrowAddress,
          registry: registryAddress,
          mockIdr: mockIdrAddress,
        },
        canonicalAssetId,
      ),
    ).rejects.toThrow(/propertyToken mismatch/);
  });
});

describe("fetchInvestorState", () => {
  it("reads actual investor approval, mIDR balance, allowance, and allocation", async () => {
    const investorAddress = "0x6666666666666666666666666666666666666666" as const;
    const mockClient = {
      readContract: vi.fn(async (params: { functionName: string }) => {
        switch (params.functionName) {
          case "isApproved":
            return true;
          case "balanceOf":
            return 50_000_000n;
          case "allowance":
            return 10_000_000n;
          case "allocationOf":
            return 500n;
          case "paymentOf":
            return 5_000_000n;
          default:
            throw new Error(`Unexpected function call: ${params.functionName}`);
        }
      }),
    } as unknown as PublicClient;

    const state = await fetchInvestorState(
      mockClient,
      {
        identityRegistry: "0x2222222222222222222222222222222222222222",
        mockIdr: "0x3333333333333333333333333333333333333333",
        offeringEscrow: "0x4444444444444444444444444444444444444444",
      },
      investorAddress,
      1n,
    );

    expect(state.isApproved).toBe(true);
    expect(state.mIdrBalance).toBe(50_000_000n);
    expect(state.allowance).toBe(10_000_000n);
    expect(state.allocation).toBe(500n);
    expect(state.payment).toBe(5_000_000n);
  });
});

describe("fetchAttestationRecords", () => {
  const canonicalAssetId = "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae" as const;

  it("extracts valid ownership and valuation records when valid and nonzero hash", async () => {
    const mockClient = {
      readContract: vi.fn(async (params: { args: unknown[] }) => {
        const kind = (params.args as [string, number])[1];
        if (kind === 0) {
          return {
            verifier: "0x1111111111111111111111111111111111111111",
            attestationType: 0,
            evidenceHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            value: 0n,
            timestamp: 1700000000n,
            valid: true,
          };
        }
        return {
          verifier: "0x2222222222222222222222222222222222222222",
          attestationType: 1,
          evidenceHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: 10_000_000_000n,
          timestamp: 1700000001n,
          valid: true,
        };
      }),
    } as unknown as PublicClient;

    const records = await fetchAttestationRecords(
      mockClient,
      "0x1111111111111111111111111111111111111111",
      canonicalAssetId,
    );

    expect(records.ownership).not.toBeNull();
    expect(records.ownership?.valid).toBe(true);
    expect(records.valuation).not.toBeNull();
    expect(records.valuation?.value).toBe(10_000_000_000n);
  });

  it("returns null for invalid or zero evidence hash attestations", async () => {
    const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const mockClient = {
      readContract: vi.fn(async () => ({
        verifier: "0x0000000000000000000000000000000000000000",
        attestationType: 0,
        evidenceHash: ZERO_BYTES32,
        value: 0n,
        timestamp: 0n,
        valid: false,
      })),
    } as unknown as PublicClient;

    const records = await fetchAttestationRecords(
      mockClient,
      "0x1111111111111111111111111111111111111111",
      canonicalAssetId,
    );

    expect(records.ownership).toBeNull();
    expect(records.valuation).toBeNull();
  });
});
