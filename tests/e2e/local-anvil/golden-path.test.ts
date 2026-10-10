import { describe, expect, it } from "vitest";
import {
  checkAnvilPrerequisite,
  checkArtifactsPrerequisite,
  executeGoldenPath,
} from "./runner";

const isOptIn =
  process.env.ARCHPROP_RUN_LOCAL_E2E === "1" ||
  process.env.ARCHPROP_RUN_LOCAL_E2E === "true";

describe("Local Anvil Golden Path E2E", () => {
  if (!isOptIn) {
    it.skip(
      "[OPT-IN REQUIRED] Local Anvil golden path test skipped by default. " +
        "Set ARCHPROP_RUN_LOCAL_E2E=1 to execute full golden path against local Anvil (chain 31337).",
      () => {
        // Skipped by default. Never reports a golden path pass without explicit opt-in.
      },
    );
    return;
  }

  it(
    "executes full golden path: deploy -> verify -> offer -> fund -> claim -> revenue -> close",
    async () => {
      // 1. Artifacts prerequisite check: MUST FAIL if missing
      const artifactCheck = checkArtifactsPrerequisite();
      if (!artifactCheck.available) {
        expect.fail(
          `Prerequisite failed: ${artifactCheck.diagnostic}. Missing artifacts: ${artifactCheck.missingArtifacts.join(", ")}`,
        );
      }

      // 2. Anvil prerequisite check: MUST FAIL if unreachable, wrong chain, or insufficient accounts
      const anvilCheck = await checkAnvilPrerequisite();
      if (!anvilCheck.ok) {
        expect.fail(`Prerequisite failed: ${anvilCheck.diagnostic}`);
      }

      // 3. Execute real deployment and all 12 on-chain invariants
      const result = await executeGoldenPath();
      expect(result.ok, "Golden path execution must succeed").toBe(true);
      expect(result.checksPassed, "All invariant checks must pass").toBe(result.totalChecks);
      expect(result.checksPassed, "Expected exactly 12 on-chain invariants").toBe(12);

      // 4. Assert all economic balance deltas were observed and exact
      expect(result.observedBalanceDeltas.length, "Expected at least 14 observed balance deltas").toBeGreaterThanOrEqual(14);
      for (const d of result.observedBalanceDeltas) {
        expect(d.delta, `Delta mismatch for ${d.label}`).toBe(d.expectedDelta);
      }
    },
    300000,
  );
});
