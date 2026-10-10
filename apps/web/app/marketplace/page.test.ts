import { describe, expect, it } from "vitest";
import * as marketplacePage from "./page";

/**
 * Marketplace rendering freshness.
 *
 * Funding, raised amounts, and offering status are chain-authoritative. If the
 * marketplace were prerendered at build time, its funding figures would freeze
 * into a static page and age into a false claim about the offering, so the page
 * must opt into per-request rendering.
 */
describe("marketplace runtime freshness", () => {
  it("is rendered on every request rather than frozen into the build", () => {
    expect(marketplacePage.dynamic).toBe("force-dynamic");
  });

  it("does not opt into any static revalidation window", () => {
    expect(
      (marketplacePage as { revalidate?: number | false }).revalidate,
    ).toBeUndefined();
  });
});
