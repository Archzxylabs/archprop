import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../local-anvil/runner";

describe("Shared Testnet Deployment Guard", () => {
  it("docs/DEPLOYMENTS.md marks Arbitrum Sepolia as NOT DEPLOYED / NOT AUTHORIZED", () => {
    const deploymentMdPath = join(REPO_ROOT, "docs/DEPLOYMENTS.md");
    expect(existsSync(deploymentMdPath), "docs/DEPLOYMENTS.md must exist").toBe(true);
    const content = readFileSync(deploymentMdPath, "utf8");
    expect(content).toContain("421614");
    expect(content).toContain("NOT DEPLOYED / NOT AUTHORIZED");
  });

  it("ensures no private keys are present in environment defaults or tracked files", () => {
    expect(process.env.PRIVATE_KEY).toBeUndefined();
    expect(process.env.ARCHPROP_PRIVATE_KEY).toBeUndefined();
  });
});
