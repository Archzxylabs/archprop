import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  archpropRegistryAbi,
  identityRegistryAbi,
  mockIdrAbi,
  offeringEscrowAbi,
  propertyTokenAbi,
  revenueDistributorAbi,
} from "../src/abi";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(fromDir: string): string {
  let cur = fromDir;
  while (cur !== dirname(cur)) {
    if (existsSync(join(cur, "packages/chain")) && existsSync(join(cur, "docs"))) {
      return cur;
    }
    cur = dirname(cur);
  }
  return resolve(fromDir, "../..");
}

const REPO_ROOT = findRepoRoot(MODULE_DIR);

export function resolveArtifactsDir(): { path: string; isExplicit: boolean; exists: boolean } {
  const envVal = process.env.ARCHPROP_ARTIFACTS_DIR?.trim();
  if (envVal && envVal.length > 0) {
    const explicitPath = isAbsolute(envVal) ? envVal : resolve(REPO_ROOT, envVal);
    return {
      path: explicitPath,
      isExplicit: true,
      exists: existsSync(explicitPath),
    };
  }
  const defaultPath = resolve(REPO_ROOT, "packages/contracts/out");
  return {
    path: defaultPath,
    isExplicit: false,
    exists: existsSync(defaultPath),
  };
}

type AbiItem = {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: Array<{
    name: string;
    type: string;
    indexed?: boolean;
    components?: Array<{ name: string; type: string }>;
  }>;
  outputs?: Array<{
    name: string;
    type: string;
    components?: Array<{ name: string; type: string }>;
  }>;
};

function reconcileAbi(
  contractName: string,
  chainAbi: readonly unknown[],
  artifactAbi: readonly unknown[],
): void {
  const chainItems = chainAbi as AbiItem[];
  const artifactItems = artifactAbi as AbiItem[];

  for (const item of chainItems) {
    if (item.type === "function") {
      const matchingFns = artifactItems.filter(
        (a) => a.type === "function" && a.name === item.name,
      );
      expect(
        matchingFns.length,
        `Expected function "${item.name}" to exist in ${contractName} compiled artifact`,
      ).toBeGreaterThan(0);

      // Find function with matching arity
      const matchedFn = matchingFns.find(
        (f) => (f.inputs?.length ?? 0) === (item.inputs?.length ?? 0),
      );
      expect(
        matchedFn,
        `Expected function "${item.name}" in ${contractName} to have ${item.inputs?.length ?? 0} inputs`,
      ).toBeDefined();

      if (!matchedFn) continue;

      // Check state mutability (pure is compatible with view as both are read-only)
      const mutabilityCompatible =
        matchedFn.stateMutability === item.stateMutability ||
        ((item.stateMutability === "view" || item.stateMutability === "pure") &&
          (matchedFn.stateMutability === "view" || matchedFn.stateMutability === "pure"));
      expect(
        mutabilityCompatible,
        `State mutability mismatch for "${item.name}" in ${contractName}: expected ${item.stateMutability}, got ${matchedFn.stateMutability}`,
      ).toBe(true);

      // Check inputs
      const expectedInputs = item.inputs ?? [];
      const actualInputs = matchedFn.inputs ?? [];
      expect(
        actualInputs.length,
        `Input count mismatch for "${item.name}" in ${contractName}`,
      ).toBe(expectedInputs.length);

      for (let i = 0; i < expectedInputs.length; i++) {
        const exp = expectedInputs[i]!;
        const act = actualInputs[i]!;
        expect(
          act.type,
          `Input ${i} (${exp.name}) type mismatch in function "${item.name}" of ${contractName}`,
        ).toBe(exp.type);

        if (exp.type === "tuple" && exp.components) {
          expect(act.components).toBeDefined();
          const actCompTypes = act.components!.map((c) => c.type);
          const expCompTypes = exp.components.map((c) => c.type);
          expect(
            actCompTypes,
            `Tuple components type mismatch in function "${item.name}" of ${contractName}`,
          ).toEqual(expCompTypes);
        }
      }

      // Check outputs
      const expectedOutputs = item.outputs ?? [];
      const actualOutputs = matchedFn.outputs ?? [];
      expect(
        actualOutputs.length,
        `Output count mismatch for "${item.name}" in ${contractName}`,
      ).toBe(expectedOutputs.length);

      for (let i = 0; i < expectedOutputs.length; i++) {
        const exp = expectedOutputs[i]!;
        const act = actualOutputs[i]!;
        expect(
          act.type,
          `Output ${i} type mismatch in function "${item.name}" of ${contractName}`,
        ).toBe(exp.type);

        if (exp.type === "tuple" && exp.components) {
          expect(act.components).toBeDefined();
          const actCompTypes = act.components!.map((c) => c.type);
          const expCompTypes = exp.components.map((c) => c.type);
          expect(
            actCompTypes,
            `Tuple output components type mismatch in function "${item.name}" of ${contractName}`,
          ).toEqual(expCompTypes);
        }
      }
    } else if (item.type === "event") {
      const matchingEvents = artifactItems.filter(
        (a) => a.type === "event" && a.name === item.name,
      );
      expect(
        matchingEvents.length,
        `Expected event "${item.name}" to exist in ${contractName} compiled artifact`,
      ).toBeGreaterThan(0);

      const matchedEvent = matchingEvents.find(
        (e) => (e.inputs?.length ?? 0) === (item.inputs?.length ?? 0),
      );
      expect(
        matchedEvent,
        `Expected event "${item.name}" in ${contractName} to have ${item.inputs?.length ?? 0} parameters`,
      ).toBeDefined();

      if (!matchedEvent) continue;

      const expectedInputs = item.inputs ?? [];
      const actualInputs = matchedEvent.inputs ?? [];
      expect(
        actualInputs.length,
        `Parameter count mismatch for event "${item.name}" in ${contractName}`,
      ).toBe(expectedInputs.length);

      for (let i = 0; i < expectedInputs.length; i++) {
        const exp = expectedInputs[i]!;
        const act = actualInputs[i]!;
        expect(
          act.type,
          `Parameter ${i} (${exp.name}) type mismatch in event "${item.name}" of ${contractName}`,
        ).toBe(exp.type);

        expect(
          Boolean(act.indexed),
          `Indexed flag mismatch for parameter ${i} (${exp.name}) in event "${item.name}" of ${contractName}: expected indexed=${exp.indexed}, got indexed=${act.indexed}`,
        ).toBe(Boolean(exp.indexed));
      }
    }
  }
}

describe("ABI Reconciliation with Compiled Foundry Artifacts", () => {
  const artifactsInfo = resolveArtifactsDir();
  const isExplicitlyRequested =
    process.env.ARCHPROP_CHECK_ARTIFACTS === "1" ||
    process.env.ARCHPROP_RUN_LOCAL_E2E === "1" ||
    artifactsInfo.isExplicit;

  if (!artifactsInfo.exists) {
    if (isExplicitlyRequested) {
      it("fails when compiled artifacts are explicitly requested or configured but absent", () => {
        expect.fail(
          artifactsInfo.isExplicit
            ? `Explicit ARCHPROP_ARTIFACTS_DIR "${artifactsInfo.path}" does not exist. Reconciliation failed.`
            : `Compiled Foundry contract artifacts were explicitly requested via ARCHPROP_CHECK_ARTIFACTS=1, but default directory "${artifactsInfo.path}" does not exist.`,
        );
      });
    } else {
      it.skip(
        `[OFFLINE SKIP] Compiled Foundry artifacts not available at "${artifactsInfo.path}". Set ARCHPROP_CHECK_ARTIFACTS=1 or ARCHPROP_ARTIFACTS_DIR to run reconciliation.`,
        () => {},
      );
    }
    return;
  }

  function loadArtifactAbi(contractName: string): unknown[] {
    const artifactPath = join(artifactsInfo.path, `${contractName}.sol`, `${contractName}.json`);
    expect(existsSync(artifactPath), `Artifact file ${artifactPath} must exist`).toBe(true);
    const data = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(Array.isArray(data.abi), `Artifact ${contractName} must contain an ABI array`).toBe(true);
    return data.abi;
  }

  it("reconciles ArchpropRegistry typed ABI against compiled Foundry artifact", () => {
    const artifactAbi = loadArtifactAbi("ArchpropRegistry");
    reconcileAbi("ArchpropRegistry", archpropRegistryAbi, artifactAbi);
  });

  it("reconciles IdentityRegistry typed ABI against compiled Foundry artifact", () => {
    const artifactAbi = loadArtifactAbi("IdentityRegistry");
    reconcileAbi("IdentityRegistry", identityRegistryAbi, artifactAbi);
  });

  it("reconciles MockIDR typed ABI against compiled Foundry artifact", () => {
    const artifactAbi = loadArtifactAbi("MockIDR");
    reconcileAbi("MockIDR", mockIdrAbi, artifactAbi);
  });

  it("reconciles OfferingEscrow typed ABI against compiled Foundry artifact", () => {
    const artifactAbi = loadArtifactAbi("OfferingEscrow");
    reconcileAbi("OfferingEscrow", offeringEscrowAbi, artifactAbi);
  });

  it("reconciles RevenueDistributor typed ABI against compiled Foundry artifact", () => {
    const artifactAbi = loadArtifactAbi("RevenueDistributor");
    reconcileAbi("RevenueDistributor", revenueDistributorAbi, artifactAbi);
  });

  it("reconciles PropertyToken typed ABI against compiled Foundry artifact", () => {
    const artifactAbi = loadArtifactAbi("PropertyToken");
    reconcileAbi("PropertyToken", propertyTokenAbi, artifactAbi);
  });

  describe("ABI Comparison Failure Diagnostics", () => {
    it("fails when a required function is missing from the artifact", () => {
      const mockChainAbi = [
        { type: "function", name: "nonExistentFunction", inputs: [], outputs: [] },
      ];
      const mockArtifactAbi = [
        { type: "function", name: "someOtherFunction", inputs: [], outputs: [] },
      ];
      expect(() =>
        reconcileAbi("TestContract", mockChainAbi, mockArtifactAbi),
      ).toThrow(/Expected function "nonExistentFunction" to exist in TestContract/i);
    });

    it("fails when input parameter type mismatches", () => {
      const mockChainAbi = [
        {
          type: "function",
          name: "transfer",
          inputs: [{ name: "amount", type: "uint256" }],
          outputs: [],
        },
      ];
      const mockArtifactAbi = [
        {
          type: "function",
          name: "transfer",
          inputs: [{ name: "amount", type: "uint128" }],
          outputs: [],
        },
      ];
      expect(() =>
        reconcileAbi("TestContract", mockChainAbi, mockArtifactAbi),
      ).toThrow(/type mismatch in function "transfer"/i);
    });

    it("fails when event indexed flag mismatches", () => {
      const mockChainAbi = [
        {
          type: "event",
          name: "AssetCreated",
          inputs: [{ name: "assetId", type: "bytes32", indexed: true }],
        },
      ];
      const mockArtifactAbi = [
        {
          type: "event",
          name: "AssetCreated",
          inputs: [{ name: "assetId", type: "bytes32", indexed: false }],
        },
      ];
      expect(() =>
        reconcileAbi("TestContract", mockChainAbi, mockArtifactAbi),
      ).toThrow(/Indexed flag mismatch for parameter 0/i);
    });

    it("fails closed when explicit ARCHPROP_ARTIFACTS_DIR does not exist", () => {
      const prevEnv = process.env.ARCHPROP_ARTIFACTS_DIR;
      process.env.ARCHPROP_ARTIFACTS_DIR = "/nonexistent/test/artifacts";
      try {
        const info = resolveArtifactsDir();
        expect(info.isExplicit).toBe(true);
        expect(info.exists).toBe(false);
        expect(info.path).toBe("/nonexistent/test/artifacts");
      } finally {
        if (prevEnv !== undefined) {
          process.env.ARCHPROP_ARTIFACTS_DIR = prevEnv;
        } else {
          delete process.env.ARCHPROP_ARTIFACTS_DIR;
        }
      }
    });
  });
});
