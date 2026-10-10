import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Route-manifest assertions.
 *
 * FE-001 requires a fixed route set. Rather than trusting that the files
 * happened to be created, these tests read the App Router tree and assert each
 * required route resolves to a real `page.tsx`.
 */

const APP_DIR = join(process.cwd(), "app");

/** Resolves a route's directory, treating the root specially. */
function routeDir(route: string): string {
  return join(APP_DIR, route === "/" ? "" : route.slice(1));
}

function collectPageDirs(dir: string, relative = ""): string[] {
  const found: string[] = [];
  let entries: string[];

  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }

  for (const entry of entries) {
    const absolute = join(dir, entry);
    const relativePath = relative ? `${relative}/${entry}` : entry;

    let isDirectory = false;
    try {
      isDirectory = statSync(absolute).isDirectory();
    } catch {
      continue;
    }

    if (!isDirectory || entry === "api" || entry === "node_modules") {
      continue;
    }

    if (readdirSync(absolute).includes("page.tsx")) {
      found.push(`/${relativePath}`);
    }

    found.push(...collectPageDirs(absolute, relativePath));
  }

  // The root route is `app/page.tsx`, which has no directory segment of its
  // own, so it is collected separately from the nested routes above.
  if (relative === "" && readdirSync(dir).includes("page.tsx")) {
    found.push("/");
  }

  return found;
}

const pageRoutes = collectPageDirs(APP_DIR);

describe("required route set", () => {
  it("discovers pages in the App Router tree", () => {
    expect(pageRoutes.length).toBeGreaterThan(0);
  });

  it("includes every required static route", () => {
    for (const route of [
      "/",
      "/marketplace",
      "/owner",
      "/verifier",
      "/portfolio",
      "/admin",
    ]) {
      expect(pageRoutes, `missing route: ${route}`).toContain(route);
    }
  });

  it("includes every required dynamic route", () => {
    for (const route of [
      "/property/[assetId]",
      "/owner/property/[id]",
      "/verifier/[assetId]",
    ]) {
      expect(pageRoutes, `missing route: ${route}`).toContain(route);
    }
  });

  it("includes the owner property registration route", () => {
    expect(pageRoutes).toContain("/owner/property/new");
  });

  it("does not define any API route from the frontend shell", () => {
    expect(pageRoutes.some((route) => route.startsWith("/api"))).toBe(false);
  });
});

describe("page module contract", () => {
  it("renders a default export from each page", () => {
    for (const route of pageRoutes) {
      const source = readFileSync(join(routeDir(route), "page.tsx"), "utf8");
      expect(source, `${route} has no default export`).toMatch(
        /export default /,
      );
    }
  });

  it("gives every page exactly one h1", () => {
    for (const route of pageRoutes) {
      const source = readFileSync(join(routeDir(route), "page.tsx"), "utf8");
      const h1Count = (source.match(/<h1\b/g) ?? []).length;
      expect(h1Count, `${route} should have exactly one <h1>`).toBe(1);
    }
  });
});

describe("admin route content", () => {
  const adminSource = readFileSync(join(routeDir("/admin"), "page.tsx"), "utf8");

  it("names the expected Arbitrum Sepolia network", () => {
    expect(adminSource).toContain("EXPECTED_CHAIN_ID");
    expect(adminSource).toContain("Arbitrum Sepolia");
  });

  it("states the wallet connection requirement", () => {
    expect(adminSource).toContain("ConnectWalletPrompt");
    expect(adminSource).toContain("Wallet connection");
  });

  it("covers investor identity approval", () => {
    expect(adminSource).toContain("Investor identity approval");
  });

  it("covers verifier and role awareness", () => {
    expect(adminSource).toContain("Verifier and role awareness");
  });

  it("covers a simulated revenue attestation workflow", () => {
    expect(adminSource).toContain("Revenue attestation");
  });

  it("labels the revenue workflow as simulated rather than real", () => {
    expect(adminSource).toContain("simulated");
  });

  it("disables every operator action with an explicit reason", () => {
    // Each action is a disabled button paired with a missing-prerequisite hint.
    const disabledCount = (adminSource.match(/disabled\b/g) ?? []).length;
    expect(disabledCount).toBeGreaterThan(0);
    expect(adminSource).toContain("DisabledActionHint");
  });

  it("never shows a successful operation or fake approval", () => {
    expect(adminSource).not.toMatch(/Approved\b|Transaction submitted|Success|Confirmed/);
  });

  it("never claims the operator can verify or self-verify an asset", () => {
    expect(adminSource).toContain("It does not verify assets");
    expect(adminSource).toContain("an owner can never self-verify");
  });
});
