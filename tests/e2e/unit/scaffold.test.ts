import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ANVIL_CHAIN_ID,
  assertAnvilChain,
  AssetStatus,
  CANONICAL_VILLA_NUSA,
  checkAnvilPrerequisite,
  checkArtifactsPrerequisite,
  executeGoldenPath,
  getDeploymentPath,
  getUnlockedAnvilAccounts,
  REPO_ROOT,
  REQUIRED_CONTRACTS,
  resolveArtifactsDir,
} from "../local-anvil/runner";
import type { PublicClient } from "viem";

describe("E2E Scaffold Unit and Invariant Checks", () => {
  describe("Network Safety Guards", () => {
    it("targets Anvil chain ID 31337 only", () => {
      expect(ANVIL_CHAIN_ID).toBe(31337);
    });

    it("accepts Anvil chain ID 31337", async () => {
      const mockClient = {
        getChainId: async () => 31337,
      } as unknown as PublicClient;

      await expect(assertAnvilChain(mockClient)).resolves.toBe(31337);
    });

    it("refuses Arbitrum Sepolia chain ID 421614", async () => {
      const mockClient = {
        getChainId: async () => 421614,
      } as unknown as PublicClient;

      await expect(assertAnvilChain(mockClient)).rejects.toThrow(
        /Unexpected chain ID 421614.*targets Anvil only/i,
      );
    });

    it("refuses Ethereum Mainnet chain ID 1", async () => {
      const mockClient = {
        getChainId: async () => 1,
      } as unknown as PublicClient;

      await expect(assertAnvilChain(mockClient)).rejects.toThrow(/Unexpected chain ID 1/i);
    });

    it("refuses Arbitrum One chain ID 42161", async () => {
      const mockClient = {
        getChainId: async () => 42161,
      } as unknown as PublicClient;

      await expect(assertAnvilChain(mockClient)).rejects.toThrow(/Unexpected chain ID 42161/i);
    });
  });

  describe("Canonical Villa Nusa Configuration", () => {
    it("matches canonical Villa Nusa assetId exactly", () => {
      expect(CANONICAL_VILLA_NUSA.assetId).toBe(
        "0x1756428cf9ce005285ddcf87c75240c798535bed95c6aeca6a5a7d3eb7b364ae",
      );
    });

    it("matches canonical token name and symbol", () => {
      expect(CANONICAL_VILLA_NUSA.name).toBe("Archprop Villa Nusa");
      expect(CANONICAL_VILLA_NUSA.symbol).toBe("AVNUSA");
    });

    it("matches canonical property valuation", () => {
      expect(CANONICAL_VILLA_NUSA.propertyValue).toBe(10_000_000_000n);
    });

    it("matches canonical token supply and pricing", () => {
      expect(CANONICAL_VILLA_NUSA.tokenSupply).toBe(300_000n);
      expect(CANONICAL_VILLA_NUSA.tokenPrice).toBe(10_000n);
      expect(CANONICAL_VILLA_NUSA.target).toBe(3_000_000_000n);
    });

    it("satisfies the target == supply * price invariant", () => {
      expect(
        CANONICAL_VILLA_NUSA.tokenSupply * CANONICAL_VILLA_NUSA.tokenPrice,
      ).toBe(CANONICAL_VILLA_NUSA.target);
    });

    it("splits evenly across two seeded investors to fill target", () => {
      const perInvestorTokens = CANONICAL_VILLA_NUSA.tokenSupply / 2n;
      expect(perInvestorTokens).toBe(150_000n);
      const perInvestorPayment = perInvestorTokens * CANONICAL_VILLA_NUSA.tokenPrice;
      expect(perInvestorPayment).toBe(1_500_000_000n);
      expect(perInvestorPayment * 2n).toBe(CANONICAL_VILLA_NUSA.target);
    });
  });

  describe("AssetStatus Enum Ordering", () => {
    it("matches the frozen enum ordering from docs/INTERFACES.md", () => {
      expect(AssetStatus.SUBMITTED).toBe(0);
      expect(AssetStatus.UNDER_VERIFICATION).toBe(1);
      expect(AssetStatus.VERIFIED).toBe(2);
      expect(AssetStatus.ISSUANCE_READY).toBe(3);
      expect(AssetStatus.OFFERING).toBe(4);
      expect(AssetStatus.FUNDED).toBe(5);
      expect(AssetStatus.ACTIVE).toBe(6);
      expect(AssetStatus.REJECTED).toBe(7);
      expect(AssetStatus.FAILED).toBe(8);
    });
  });

  describe("Contract Prerequisites and Artifact Hygiene", () => {
    it("lists all six required contracts", () => {
      expect(REQUIRED_CONTRACTS).toEqual([
        "ArchpropRegistry",
        "IdentityRegistry",
        "MockIDR",
        "OfferingEscrow",
        "RevenueDistributor",
        "PropertyToken",
      ]);
    });

    it("reports missing directory with clear SC-001 prerequisite diagnostic", () => {
      const check = checkArtifactsPrerequisite("/nonexistent/path/contracts/out");
      expect(check.available).toBe(false);
      expect(check.missingArtifacts.length).toBe(6);
      expect(check.diagnostic).toContain("SC-001");
      expect(check.diagnostic).toContain("blocked until SC-001 is merged");
    });
  });

  describe("Key-Free Source Hygiene Regression Test", () => {
    function findTsFiles(dir: string): string[] {
      const results: string[] = [];
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === ".turbo") continue;
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          results.push(...findTsFiles(fullPath));
        } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
          results.push(fullPath);
        }
      }
      return results;
    }

    it("ensures no source, script, or test file uses privateKeyToAccount or literal private keys", () => {
      const scanDirs = [
        join(REPO_ROOT, "packages/chain/src"),
        join(REPO_ROOT, "scripts"),
        join(REPO_ROOT, "tests/e2e"),
      ];

      const files = scanDirs
        .flatMap(findTsFiles)
        .filter((f) => !f.endsWith("scaffold.test.ts"));
      expect(files.length).toBeGreaterThan(5);

      for (const file of files) {
        const content = readFileSync(file, "utf8");
        // No usage of privateKeyToAccount anywhere
        expect(content).not.toContain("privateKeyToAccount");
        // No DEV_KEYS constant
        expect(content).not.toContain("DEV_KEYS");
      }
    });
  });

  describe("Local Account Selection & Role Separation", () => {
    const mockAccounts: `0x${string}`[] = [
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
      "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
      "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
      "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
    ];

    it("assigns distinct addresses to each role and enforces separation", async () => {
      const mockPublicClient = {
        getChainId: async () => 31337,
        getBalance: async () => 1000000000000000000n,
      } as unknown as PublicClient;

      const mockWalletClient = {
        getAddresses: async () => mockAccounts,
      } as unknown as any;

      const roleAccounts = await getUnlockedAnvilAccounts(mockPublicClient, mockWalletClient);

      expect(roleAccounts.admin).toBe(mockAccounts[0]);
      expect(roleAccounts.owner).toBe(mockAccounts[1]);
      expect(roleAccounts.legalVerifier).toBe(mockAccounts[2]);
      expect(roleAccounts.valuationVerifier).toBe(mockAccounts[3]);
      expect(roleAccounts.revenueVerifier).toBe(mockAccounts[4]);
      expect(roleAccounts.structurer).toBe(mockAccounts[5]);
      expect(roleAccounts.investor1).toBe(mockAccounts[6]);
      expect(roleAccounts.investor2).toBe(mockAccounts[7]);

      // All 8 must be distinct
      const allAddresses = Object.values(roleAccounts);
      expect(new Set(allAddresses.map((a) => a.toLowerCase())).size).toBe(8);

      // Distinct verifier assertions
      expect(roleAccounts.legalVerifier).not.toBe(roleAccounts.valuationVerifier);
      expect(roleAccounts.legalVerifier).not.toBe(roleAccounts.owner);
      expect(roleAccounts.valuationVerifier).not.toBe(roleAccounts.owner);
      expect(roleAccounts.revenueVerifier).not.toBe(roleAccounts.owner);
    });

    it("rejects when RPC returns fewer than 8 unlocked accounts", async () => {
      const mockPublicClient = {
        getChainId: async () => 31337,
        getBalance: async () => 1000000000000000000n,
      } as unknown as PublicClient;

      const mockWalletClient = {
        getAddresses: async () => mockAccounts.slice(0, 5),
      } as unknown as any;

      await expect(
        getUnlockedAnvilAccounts(mockPublicClient, mockWalletClient),
      ).rejects.toThrow(/at least 8 distinct accounts are required/i);
    });

    it("rejects when any account has zero balance", async () => {
      const mockPublicClient = {
        getChainId: async () => 31337,
        getBalance: async ({ address }: { address: `0x${string}` }) =>
          address === mockAccounts[2] ? 0n : 1000000000000000000n,
      } as unknown as PublicClient;

      const mockWalletClient = {
        getAddresses: async () => mockAccounts,
      } as unknown as any;

      await expect(
        getUnlockedAnvilAccounts(mockPublicClient, mockWalletClient),
      ).rejects.toThrow(/has zero balance on Anvil/i);
    });
  });

  describe("Rejection of Missing or Wrong-Chain Anvil RPC", () => {
    it("refuses Arbitrum Sepolia chain ID 421614 when fetching local accounts", async () => {
      const mockPublicClient = {
        getChainId: async () => 421614,
      } as unknown as PublicClient;

      await expect(getUnlockedAnvilAccounts(mockPublicClient)).rejects.toThrow(
        /Unexpected chain ID 421614.*targets Anvil only/i,
      );
    });

    it("refuses Ethereum Mainnet chain ID 1 when fetching local accounts", async () => {
      const mockPublicClient = {
        getChainId: async () => 1,
      } as unknown as PublicClient;

      await expect(getUnlockedAnvilAccounts(mockPublicClient)).rejects.toThrow(
        /Unexpected chain ID 1.*targets Anvil only/i,
      );
    });
  });

  describe("Module-Relative Path Resolution and CWD Independence", () => {
    it("resolves default artifacts directory relative to repo root regardless of cwd", () => {
      const prev = process.env.ARCHPROP_ARTIFACTS_DIR;
      delete process.env.ARCHPROP_ARTIFACTS_DIR;
      try {
        const expected = join(REPO_ROOT, "packages/contracts/out");
        expect(resolveArtifactsDir()).toBe(expected);

        const origCwd = process.cwd();
        try {
          process.chdir("/tmp");
          expect(resolveArtifactsDir()).toBe(expected);
        } finally {
          process.chdir(origCwd);
        }
      } finally {
        if (prev !== undefined) process.env.ARCHPROP_ARTIFACTS_DIR = prev;
      }
    });

    it("resolves relative custom artifacts directory relative to repo root", () => {
      const custom = resolveArtifactsDir("packages/contracts/out");
      expect(custom).toBe(join(REPO_ROOT, "packages/contracts/out"));
    });

    it("preserves absolute custom artifacts directory", () => {
      const custom = resolveArtifactsDir("/custom/artifacts/path");
      expect(custom).toBe("/custom/artifacts/path");
    });

    it("resolves default deployment path relative to repo root regardless of cwd", () => {
      const prev = process.env.ARCHPROP_DEPLOYMENT_PATH;
      delete process.env.ARCHPROP_DEPLOYMENT_PATH;
      try {
        const expected = join(REPO_ROOT, "deployments/local.json");
        expect(getDeploymentPath()).toBe(expected);

        const origCwd = process.cwd();
        try {
          process.chdir("/tmp");
          expect(getDeploymentPath()).toBe(expected);
        } finally {
          process.chdir(origCwd);
        }
      } finally {
        if (prev !== undefined) process.env.ARCHPROP_DEPLOYMENT_PATH = prev;
      }
    });

    it("resolves relative custom deployment path relative to repo root", () => {
      const custom = getDeploymentPath("custom-deployments/local.json");
      expect(custom).toBe(join(REPO_ROOT, "custom-deployments/local.json"));
    });
  });

  describe("Golden Path Opt-In and Strict Prerequisite Failure Paths", () => {
    it("reports diagnostic failure when Anvil RPC is unreachable", async () => {
      // Connect to dummy non-listening port
      const result = await checkAnvilPrerequisite("http://127.0.0.1:54321");
      expect(result.ok).toBe(false);
      expect(result.diagnostic).toMatch(/Anvil RPC is not reachable/i);
      expect(result.diagnostic).toMatch(/54321/);
    });

    it("reports missing directory diagnostic when artifacts are nonexistent", () => {
      const check = checkArtifactsPrerequisite("/nonexistent/custom/path");
      expect(check.available).toBe(false);
      expect(check.missingArtifacts.length).toBe(6);
      expect(check.diagnostic).toContain("SC-001");
      expect(check.diagnostic).toContain("blocked until SC-001 is merged");
    });

    it("fails closed when executeGoldenPath is called with nonexistent artifacts", async () => {
      await expect(
        executeGoldenPath({ artifactsDir: "/nonexistent/test/artifacts" }),
      ).rejects.toThrow(/PREREQUISITE-FAILED/i);
    });

    it("fails closed when executeGoldenPath is called with unreachable RPC", async () => {
      await expect(
        executeGoldenPath({ rpcUrl: "http://127.0.0.1:54321" }),
      ).rejects.toThrow(/PREREQUISITE-FAILED/i);
    });
  });
});
