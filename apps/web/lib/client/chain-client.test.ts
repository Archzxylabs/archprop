import { describe, expect, it, vi, afterEach } from "vitest";
import type { PublicClient } from "viem";
import {
  deriveOfferingForAsset,
  describeOfferingEconomicsMismatch,
  fetchAttestationRecords,
  fetchInvestorState,
  fetchOfferingById,
  getArchpropPublicClient,
  getClientChainConfig,
  inspectClientChainConfig,
  readClientEnv,
  resetClientChainCaches,
} from "./chain-client";

const CONFIG_ENV_KEYS = [
  "NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL",
  "NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS",
  "NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS",
  "NEXT_PUBLIC_MOCK_IDR_ADDRESS",
  "NEXT_PUBLIC_OFFERING_ESCROW_ADDRESS",
  "NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS",
] as const;

const VALID_ENV: Record<(typeof CONFIG_ENV_KEYS)[number], string> = {
  NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc",
  NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS: "0x1111111111111111111111111111111111111111",
  NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS: "0x2222222222222222222222222222222222222222",
  NEXT_PUBLIC_MOCK_IDR_ADDRESS: "0x3333333333333333333333333333333333333333",
  NEXT_PUBLIC_OFFERING_ESCROW_ADDRESS: "0x4444444444444444444444444444444444444444",
  NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS: "0x5555555555555555555555555555555555555555",
};

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(CONFIG_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of CONFIG_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("chain-client configuration", () => {
  const savedEnv = snapshotEnv();

  afterEach(() => {
    restoreEnv(savedEnv);
    resetClientChainCaches();
  });

  it("returns null from getClientChainConfig when environment is missing or empty", () => {
    const config = getClientChainConfig();
    expect(config).toBeNull();
  });

  it("reports missing variables in inspectClientChainConfig", () => {
    const report = inspectClientChainConfig();
    expect(report.ok).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it("reads canonical NEXT_PUBLIC_* variables via direct static property accesses", () => {
    for (const [key, value] of Object.entries(VALID_ENV)) {
      process.env[key] = value;
    }
    resetClientChainCaches();

    const env = readClientEnv();
    expect(env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL).toBe(VALID_ENV.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL);
    expect(env.NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS).toBe(VALID_ENV.NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS);
    expect(env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS).toBe(VALID_ENV.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS);
    expect(env.NEXT_PUBLIC_MOCK_IDR_ADDRESS).toBe(VALID_ENV.NEXT_PUBLIC_MOCK_IDR_ADDRESS);
    expect(env.NEXT_PUBLIC_OFFERING_ESCROW_ADDRESS).toBe(VALID_ENV.NEXT_PUBLIC_OFFERING_ESCROW_ADDRESS);
    expect(env.NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS).toBe(VALID_ENV.NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS);

    const config = getClientChainConfig();
    expect(config).not.toBeNull();
    expect(config?.rpcUrl).toBe(VALID_ENV.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL);
    expect(config?.addresses.registry).toBe(VALID_ENV.NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS);
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

describe("chain-client configuration stability (refresh stability regression)", () => {
  const savedEnv = snapshotEnv();

  afterEach(() => {
    restoreEnv(savedEnv);
    resetClientChainCaches();
  });

  it("returns the identical config object across calls while the environment is unchanged", () => {
    for (const [key, value] of Object.entries(VALID_ENV)) {
      process.env[key] = value;
    }
    resetClientChainCaches();

    const first = getClientChainConfig();
    const second = getClientChainConfig();
    const third = getClientChainConfig();

    expect(first).not.toBeNull();
    // Identical reference: a callback with the config in its dependency list
    // keeps one stable value instead of re-running on every render.
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(inspectClientChainConfig()).toBe(inspectClientChainConfig());
  });

  it("returns a new config object after an environment variable changes", () => {
    for (const [key, value] of Object.entries(VALID_ENV)) {
      process.env[key] = value;
    }
    resetClientChainCaches();

    const before = getClientChainConfig();
    expect(before).not.toBeNull();

    process.env.NEXT_PUBLIC_OFFERING_ESCROW_ADDRESS =
      "0x9999999999999999999999999999999999999999";

    const after = getClientChainConfig();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(after?.addresses.offeringEscrow).toBe(
      "0x9999999999999999999999999999999999999999",
    );
  });

  it("reuses one public client per configuration instead of allocating per render", () => {
    for (const [key, value] of Object.entries(VALID_ENV)) {
      process.env[key] = value;
    }
    resetClientChainCaches();

    const config = getClientChainConfig();
    expect(config).not.toBeNull();
    expect(getArchpropPublicClient(config!)).toBe(getArchpropPublicClient(config!));
  });
});

describe("fetchOfferingById status decoding (fail closed)", () => {
  const escrowAddress = "0x4444444444444444444444444444444444444444" as const;
  const registryAddress = "0x1111111111111111111111111111111111111111" as const;
  const mockIdrAddress = "0x3333333333333333333333333333333333333333" as const;
  const propertyTokenAddress = "0x7777777777777777777777777777777777777777" as const;
  const canonicalAssetId =
    "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae" as const;

  const addresses = {
    offeringEscrow: escrowAddress,
    registry: registryAddress,
    mockIdr: mockIdrAddress,
  };

  function clientReturning(overrides: Record<string, unknown>): PublicClient {
    return {
      getLogs: vi.fn(async () => [
        {
          args: {
            offeringId: 1n,
            assetId: canonicalAssetId,
            token: propertyTokenAddress,
            target: 3_000_000_000n,
            tokenPrice: 10_000n,
            deadline: 1_800_000_000n,
          },
        },
      ]),
      readContract: vi.fn(async (params: { functionName: string }) => {
        if (params.functionName === "getOffering") {
          return {
            assetId: canonicalAssetId,
            propertyToken: propertyTokenAddress,
            paymentToken: mockIdrAddress,
            target: 3_000_000_000n,
            tokenPrice: 10_000n,
            deadline: 1_800_000_000n,
            raised: 0n,
            issuerTreasury: "0x8888888888888888888888888888888888888888",
            status: 0,
            fundsReleased: false,
            ...overrides,
          };
        }
        if (params.functionName === "assetToken") {
          return propertyTokenAddress;
        }
        throw new Error(`Unexpected contract call: ${params.functionName}`);
      }),
    } as unknown as PublicClient;
  }

  it("throws on an unknown offering status instead of reporting it as FAILED", async () => {
    const client = clientReturning({ status: 7 });

    await expect(fetchOfferingById(client, addresses, 1n)).rejects.toThrow(
      /Unknown OfferingStatus value 7/,
    );
    await expect(
      deriveOfferingForAsset(client, addresses, canonicalAssetId),
    ).rejects.toThrow(/Unknown OfferingStatus value 7/);
  });

  it("throws on a status above the frozen enum range instead of guessing", async () => {
    const client = clientReturning({ status: 99 });

    await expect(fetchOfferingById(client, addresses, 1n)).rejects.toThrow(
      /Refusing to guess a state/,
    );
  });

  it("still decodes every in-range status to its frozen name", async () => {
    const expected = ["OPEN", "FUNDED", "FAILED"] as const;
    for (const [index, name] of expected.entries()) {
      const client = clientReturning({ status: index });
      const offering = await fetchOfferingById(client, addresses, 1n);
      expect(offering.status).toBe(name);
      expect(offering.statusCode).toBe(index);
    }
  });

  it("rejects an offering whose token price is not positive", async () => {
    const client = clientReturning({ tokenPrice: 0n });

    await expect(fetchOfferingById(client, addresses, 1n)).rejects.toThrow(
      /non-positive token price/,
    );
  });

  it("rejects an offering whose raised amount exceeds its target", async () => {
    const client = clientReturning({ raised: 4_000_000_000n });

    await expect(fetchOfferingById(client, addresses, 1n)).rejects.toThrow(
      /above its target/,
    );
  });
});

describe("describeOfferingEconomicsMismatch", () => {
  const live = {
    tokenPrice: 10_000n,
    target: 3_000_000_000n,
    raised: 0n,
  };

  it("returns null when the live economics match the displayed constants", () => {
    expect(
      describeOfferingEconomicsMismatch(live, {
        tokenPrice: 10_000n,
        offeringTarget: 3_000_000_000n,
      }),
    ).toBeNull();
  });

  it("reports a token price the chain does not agree with", () => {
    const message = describeOfferingEconomicsMismatch(live, { tokenPrice: 20_000n });
    expect(message).toContain("Live offering token price is 10000 mIDR");
    expect(message).toContain("this page displays 20000 mIDR");
  });

  it("reports a target the chain does not agree with", () => {
    const message = describeOfferingEconomicsMismatch(live, {
      offeringTarget: 1_000_000_000n,
    });
    expect(message).toContain("Live offering target is 3000000000 mIDR");
  });

  it("reports a price mismatch before a target mismatch when both differ", () => {
    const message = describeOfferingEconomicsMismatch(live, {
      tokenPrice: 1n,
      offeringTarget: 1n,
    });
    expect(message).toContain("token price");
  });

  it("returns null when there is nothing to compare against", () => {
    expect(describeOfferingEconomicsMismatch(null, { tokenPrice: 1n })).toBeNull();
    expect(describeOfferingEconomicsMismatch(live, null)).toBeNull();
    expect(describeOfferingEconomicsMismatch(live, {})).toBeNull();
  });
});
