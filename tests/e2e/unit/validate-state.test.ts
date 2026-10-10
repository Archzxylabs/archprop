import { describe, expect, it } from "vitest";
import {
  CANONICAL_VILLA_NUSA,
  EXPECTED_CHAIN_ID,
  parseInvestors,
  validateDeploymentJson,
} from "../../../scripts/validate-state";

describe("scripts/validate-state Unit Tests", () => {
  const validAddr1 = "0x976EA74026E726554dB657fA54763abd0C3a0aa9" as const;
  const validAddr2 = "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955" as const;

  describe("ARCHPROP_INVESTORS Fail-Closed Parser", () => {
    it("fails closed when ARCHPROP_INVESTORS is undefined", () => {
      expect(() => parseInvestors(undefined)).toThrow(
        /ARCHPROP_INVESTORS is missing or empty/i,
      );
    });

    it("fails closed when ARCHPROP_INVESTORS is empty string", () => {
      expect(() => parseInvestors("")).toThrow(
        /ARCHPROP_INVESTORS is missing or empty/i,
      );
    });

    it("fails closed when ARCHPROP_INVESTORS has only whitespace", () => {
      expect(() => parseInvestors("   ")).toThrow(
        /ARCHPROP_INVESTORS is missing or empty/i,
      );
    });

    it("fails closed when only one address is provided", () => {
      expect(() => parseInvestors(validAddr1)).toThrow(
        /must contain exactly 2 addresses, received 1/i,
      );
    });

    it("fails closed when three addresses are provided", () => {
      const three = `${validAddr1},${validAddr2},0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f`;
      expect(() => parseInvestors(three)).toThrow(
        /must contain exactly 2 addresses, received 3/i,
      );
    });

    it("fails closed when an address is malformed (not EVM hex)", () => {
      expect(() => parseInvestors(`${validAddr1},not-an-address`)).toThrow(
        /Invalid investor address: "not-an-address"/i,
      );
      expect(() => parseInvestors(`${validAddr1},0x1234`)).toThrow(
        /Invalid investor address: "0x1234"/i,
      );
    });

    it("fails closed when an address is the zero address", () => {
      const zero = "0x0000000000000000000000000000000000000000";
      expect(() => parseInvestors(`${validAddr1},${zero}`)).toThrow(
        /cannot be the zero address/i,
      );
    });

    it("fails closed when duplicate addresses are provided (exact case)", () => {
      expect(() => parseInvestors(`${validAddr1},${validAddr1}`)).toThrow(
        /Duplicate investor address provided/i,
      );
    });

    it("fails closed when duplicate addresses are provided (different case)", () => {
      expect(() => parseInvestors(`${validAddr1},${validAddr1.toLowerCase()}`)).toThrow(
        /Duplicate investor address provided/i,
      );
    });

    it("parses valid two distinct investor addresses cleanly", () => {
      const res = parseInvestors(`  ${validAddr1}  ,  ${validAddr2}  `);
      expect(res).toEqual([validAddr1, validAddr2]);
    });
  });

  describe("Deployment JSON Fail-Closed Validator", () => {
    function makeValidFixture() {
      return {
        chainId: EXPECTED_CHAIN_ID,
        deployedAtBlock: 12,
        deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        contracts: {
          registry: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
          identityRegistry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
          mockIdr: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
          offeringEscrow: "0xCf7Ed3Ecc611578521759ec64260C66c738886b9",
          revenueDistributor: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
        },
        propertyToken: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
        asset: {
          assetId: CANONICAL_VILLA_NUSA.assetId,
          tokenSupply: CANONICAL_VILLA_NUSA.tokenSupply.toString(),
          tokenPrice: CANONICAL_VILLA_NUSA.tokenPrice.toString(),
          target: CANONICAL_VILLA_NUSA.target.toString(),
          propertyValue: CANONICAL_VILLA_NUSA.propertyValue.toString(),
        },
      };
    }

    it("accepts a fully canonical local deployment fixture", () => {
      const fixture = makeValidFixture();
      const res = validateDeploymentJson(fixture);
      expect(res.chainId).toBe(31337);
      expect(res.asset.tokenSupply).toBe(300_000n);
      expect(res.asset.tokenPrice).toBe(10_000n);
      expect(res.asset.target).toBe(3_000_000_000n);
      expect(res.contracts.registry).toBe(fixture.contracts.registry);
      expect(res.offeringId).toBeUndefined();
      expect(res.epochId).toBeUndefined();
    });

    it("accepts valid explicit offeringId and epochId", () => {
      const fixture = {
        ...makeValidFixture(),
        offeringId: 1,
        epochId: 2,
      };
      const res = validateDeploymentJson(fixture);
      expect(res.offeringId).toBe(1n);
      expect(res.epochId).toBe(2n);
    });

    it("rejects non-object input", () => {
      expect(() => validateDeploymentJson(null)).toThrow(/not a valid JSON object/i);
      expect(() => validateDeploymentJson("string")).toThrow(/not a valid JSON object/i);
    });

    it("rejects wrong chainId (e.g. Arbitrum Sepolia 421614)", () => {
      const fixture = { ...makeValidFixture(), chainId: 421614 };
      expect(() => validateDeploymentJson(fixture)).toThrow(
        /Deployment targets chain 421614, expected local Anvil chain 31337/i,
      );
    });

    it("rejects missing contracts mapping", () => {
      const fixture = makeValidFixture();
      delete (fixture as any).contracts;
      expect(() => validateDeploymentJson(fixture)).toThrow(
        /missing 'contracts' mapping/i,
      );
    });

    it("rejects zero address in contract mappings", () => {
      const fixture = makeValidFixture();
      fixture.contracts.registry = "0x0000000000000000000000000000000000000000";
      expect(() => validateDeploymentJson(fixture)).toThrow(
        /Invalid or missing contract address for 'registry'/i,
      );
    });

    it("rejects malformed address in contract mappings", () => {
      const fixture = makeValidFixture();
      fixture.contracts.offeringEscrow = "not-an-address";
      expect(() => validateDeploymentJson(fixture)).toThrow(
        /Invalid or missing contract address for 'offeringEscrow'/i,
      );
    });

    it("rejects zero address in propertyToken", () => {
      const fixture = makeValidFixture();
      fixture.propertyToken = "0x0000000000000000000000000000000000000000";
      expect(() => validateDeploymentJson(fixture)).toThrow(
        /Invalid or missing propertyToken address/i,
      );
    });

    it("rejects missing asset definition", () => {
      const fixture = makeValidFixture();
      delete (fixture as any).asset;
      expect(() => validateDeploymentJson(fixture)).toThrow(
        /missing 'asset' definition/i,
      );
    });

    it("rejects mismatched assetId", () => {
      const fixture = makeValidFixture();
      fixture.asset.assetId = ("0x" + "11".repeat(32)) as `0x${string}`;
      expect(() => validateDeploymentJson(fixture)).toThrow(
        /does not match canonical Villa Nusa assetId/i,
      );
    });

    it("rejects mismatched tokenSupply", () => {
      const fixture = makeValidFixture();
      fixture.asset.tokenSupply = "500000";
      expect(() => validateDeploymentJson(fixture)).toThrow(
        /tokenSupply 500000 does not match canonical 300000/i,
      );
    });

    it("rejects mismatched tokenPrice", () => {
      const fixture = makeValidFixture();
      fixture.asset.tokenPrice = "20000";
      expect(() => validateDeploymentJson(fixture)).toThrow(
        /tokenPrice 20000 does not match canonical 10000/i,
      );
    });

    it("rejects mismatched target", () => {
      const fixture = makeValidFixture();
      fixture.asset.target = "5000000000";
      expect(() => validateDeploymentJson(fixture)).toThrow(
        /target 5000000000 does not match canonical 3000000000/i,
      );
    });

    it("rejects non-positive offeringId", () => {
      const fixture = { ...makeValidFixture(), offeringId: 0 };
      expect(() => validateDeploymentJson(fixture)).toThrow(
        /Invalid offeringId "0"/i,
      );
    });

    it("rejects non-positive epochId", () => {
      const fixture = { ...makeValidFixture(), epochId: -1 };
      expect(() => validateDeploymentJson(fixture)).toThrow(
        /Invalid epochId "-1"/i,
      );
    });
  });

  describe("validateState Function Fail-Closed and Integration Checks", () => {
    it("fails closed when deployment file does not exist", async () => {
      const { validateState } = await import("../../../scripts/validate-state");
      await expect(
        validateState({
          deploymentPath: "/nonexistent/deployment/file.json",
          investors: `${validAddr1},${validAddr2}`,
        }),
      ).rejects.toThrow(/Deployment file not found at/i);
    });

    it("fails closed when ARCHPROP_INVESTORS is missing in validateState options", async () => {
      const { validateState } = await import("../../../scripts/validate-state");
      await expect(
        validateState({
          deploymentPath: "/tmp/archprop-worktrees/integration-qa/deployments/local.json",
          investors: "",
        }),
      ).rejects.toThrow(/ARCHPROP_INVESTORS is missing or empty/i);
    });

    it("fails closed when RPC returns mismatched chainId", async () => {
      const { validateState } = await import("../../../scripts/validate-state");
      // Use mock RPC URL returning chain ID error or invalid port
      await expect(
        validateState({
          deploymentPath: "/tmp/archprop-worktrees/integration-qa/deployments/local.json",
          investors: `${validAddr1},${validAddr2}`,
          rpcUrl: "http://127.0.0.1:54321", // unreachable
        }),
      ).rejects.toThrow();
    });
  });
});

