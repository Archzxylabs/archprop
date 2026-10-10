/**
 * Fail-closed configuration tests.
 *
 * The central contract of this package: absent, malformed, zero, or
 * wrong-chain configuration must throw rather than fall back to any default.
 */

import { describe, expect, it } from "vitest";
import {
  ChainConfigError,
  CONTRACT_ADDRESS_ENV,
  inspectChainConfig,
  loadChainConfig,
  parseContractAddress,
  parseRpcUrl,
  RPC_URL_ENV,
} from "../src/config";

const VALID_ADDRESSES: Record<string, string> = {
  registry: "0x1111111111111111111111111111111111111111",
  identityRegistry: "0x2222222222222222222222222222222222222222",
  mockIdr: "0x3333333333333333333333333333333333333333",
  offeringEscrow: "0x4444444444444444444444444444444444444444",
  revenueDistributor: "0x5555555555555555555555555555555555555555",
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function completeEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    [RPC_URL_ENV]: "https://sepolia-rollup.arbitrum.io/rpc",
  };
  for (const [key, envName] of Object.entries(CONTRACT_ADDRESS_ENV)) {
    env[envName] = VALID_ADDRESSES[key] as string;
  }
  return { ...env, ...overrides };
}

describe("parseRpcUrl", () => {
  it("accepts an absolute https URL", () => {
    // A bare origin normalises to a trailing slash, per URL semantics.
    expect(parseRpcUrl("https://rpc.example.com")).toBe(
      "https://rpc.example.com/",
    );
  });

  it("accepts an absolute http URL", () => {
    expect(parseRpcUrl("http://127.0.0.1:8545")).toBe("http://127.0.0.1:8545/");
  });

  it("preserves the path of a real endpoint", () => {
    expect(parseRpcUrl("https://sepolia-rollup.arbitrum.io/rpc")).toBe(
      "https://sepolia-rollup.arbitrum.io/rpc",
    );
  });

  it("rejects undefined", () => {
    expect(() => parseRpcUrl(undefined)).toThrow(ChainConfigError);
  });

  it("rejects an empty string", () => {
    expect(() => parseRpcUrl("")).toThrow(ChainConfigError);
  });

  it("rejects a relative path rather than defaulting to localhost", () => {
    expect(() => parseRpcUrl("/rpc")).toThrow(ChainConfigError);
  });

  it("rejects a bare hostname with no scheme", () => {
    expect(() => parseRpcUrl("localhost:8545")).toThrow(ChainConfigError);
  });

  it("rejects a non-http scheme", () => {
    expect(() => parseRpcUrl("ftp://example.com")).toThrow(ChainConfigError);
    expect(() => parseRpcUrl("ws://example.com")).toThrow(ChainConfigError);
  });
});

describe("parseContractAddress", () => {
  it("accepts a valid address and checksums it", () => {
    const parsed = parseContractAddress(
      "registry",
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(parsed).toBe("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa");
  });

  it("rejects undefined with no default fallback", () => {
    expect(() => parseContractAddress("registry", undefined)).toThrow(
      ChainConfigError,
    );
  });

  it("rejects an empty string", () => {
    expect(() => parseContractAddress("registry", "")).toThrow(ChainConfigError);
  });

  it("rejects a whitespace-only string", () => {
    expect(() => parseContractAddress("registry", "   ")).toThrow(ChainConfigError);
  });

  it("rejects the zero address", () => {
    expect(() => parseContractAddress("registry", ZERO_ADDRESS)).toThrow(
      ChainConfigError,
    );
  });

  it("rejects a malformed address", () => {
    expect(() => parseContractAddress("registry", "0x1234")).toThrow(
      ChainConfigError,
    );
    expect(() => parseContractAddress("registry", "not-an-address")).toThrow(
      ChainConfigError,
    );
  });

  it("rejects an address that is too long", () => {
    expect(() =>
      parseContractAddress("registry", `0x${"1".repeat(41)}`),
    ).toThrow(ChainConfigError);
  });
});

describe("canonical environment variables", () => {
  it("ignores undocumented ARCHPROP_RPC_URL and requires NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL", () => {
    const env = completeEnv();
    delete env[RPC_URL_ENV];
    env.ARCHPROP_RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
    expect(() => loadChainConfig(env)).toThrow(ChainConfigError);
  });

  it("ignores undocumented ARCHPROP_REGISTRY_ADDRESS and requires NEXT_PUBLIC_ARCHPROP_REGISTRY_ADDRESS", () => {
    const env = completeEnv();
    delete env[CONTRACT_ADDRESS_ENV.registry];
    env.ARCHPROP_REGISTRY_ADDRESS = VALID_ADDRESSES.registry;
    expect(() => loadChainConfig(env)).toThrow(ChainConfigError);
  });
});

describe("loadChainConfig", () => {
  it("loads a complete configuration", () => {
    const config = loadChainConfig(completeEnv());
    expect(config.chainId).toBe(421614);
    expect(config.rpcUrl).toBe("https://sepolia-rollup.arbitrum.io/rpc");
    expect(config.addresses.registry).toBe(VALID_ADDRESSES.registry);
    expect(Object.keys(config.addresses).sort()).toEqual(
      Object.keys(CONTRACT_ADDRESS_ENV).sort(),
    );
  });

  it("throws when the RPC URL is absent", () => {
    const env = completeEnv();
    delete env[RPC_URL_ENV];
    expect(() => loadChainConfig(env)).toThrow(ChainConfigError);
  });

  it("throws when every address is absent", () => {
    expect(() => loadChainConfig({ [RPC_URL_ENV]: "https://x.io" })).toThrow(
      ChainConfigError,
    );
  });

  it("throws when exactly one address is absent", () => {
    const env = completeEnv();
    delete env[CONTRACT_ADDRESS_ENV.revenueDistributor];
    expect(() => loadChainConfig(env)).toThrow(/revenueDistributor/);
  });

  it("throws when one address is the zero address", () => {
    expect(() =>
      loadChainConfig(completeEnv({ [CONTRACT_ADDRESS_ENV.mockIdr]: ZERO_ADDRESS })),
    ).toThrow(ChainConfigError);
  });

  it("reports every problem in a single error rather than failing on the first", () => {
    const env: NodeJS.ProcessEnv = {};
    let message = "";
    try {
      loadChainConfig(env);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(RPC_URL_ENV);
    for (const envName of Object.values(CONTRACT_ADDRESS_ENV)) {
      expect(message).toContain(envName);
    }
  });

  it("never returns a configuration containing a default or zero address", () => {
    const config = loadChainConfig(completeEnv());
    for (const address of Object.values(config.addresses)) {
      expect(address).not.toBe(ZERO_ADDRESS);
      expect(address).not.toBe("0x");
    }
  });
});

describe("inspectChainConfig", () => {
  it("reports ok for a complete environment", () => {
    const report = inspectChainConfig(completeEnv());
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.config).toBeDefined();
  });

  it("reports every missing field without throwing", () => {
    const report = inspectChainConfig({});
    expect(report.ok).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.config).toBeUndefined();
    expect(report.errors.join("\n")).toContain(RPC_URL_ENV);
    expect(report.errors.join("\n")).toContain(
      CONTRACT_ADDRESS_ENV.offeringEscrow,
    );
  });

  it("flags the zero address as a configuration error", () => {
    const report = inspectChainConfig(
      completeEnv({ [CONTRACT_ADDRESS_ENV.registry]: ZERO_ADDRESS }),
    );
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toContain("zero address");
  });

  it("warns when a private key is present in a read-only context", () => {
    const report = inspectChainConfig(
      completeEnv({ ARCHPROP_PRIVATE_KEY: "0xdeadbeef" }),
    );
    expect(report.ok).toBe(true);
    expect(report.warnings.join("\n")).toMatch(/private-key/i);
  });
});
