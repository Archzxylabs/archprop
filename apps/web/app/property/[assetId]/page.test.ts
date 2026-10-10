import { describe, expect, it } from "vitest";
import * as propertyPage from "./page";

/**
 * Property detail rendering freshness.
 *
 * Lifecycle, attestation, and offering state come from the chain, so the page
 * is rendered on every request instead of being frozen into a build-time
 * snapshot whose offering state would age into a false claim.
 */
describe("property detail runtime freshness", () => {
  it("is rendered on every request rather than frozen into the build", () => {
    expect(propertyPage.dynamic).toBe("force-dynamic");
  });

  it("does not opt into any static revalidation window", () => {
    expect((propertyPage as { revalidate?: number | false }).revalidate).toBeUndefined();
  });
});
