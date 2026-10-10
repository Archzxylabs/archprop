import { describe, expect, it } from "vitest";
import { deriveSlug, deriveSlugWithSuffix } from "./slug";

describe("deriveSlug", () => {
  it("lowercases and dashes a plain name", () => {
    expect(deriveSlug("Harbour View Tower")).toBe("harbour-view-tower");
  });

  it("collapses repeated separators into a single dash", () => {
    expect(deriveSlug("Rue  de  la   Paix / 14")).toBe("rue-de-la-paix-14");
  });

  it("trims leading and trailing dashes", () => {
    expect(deriveSlug("  ---Quay Twelve---  ")).toBe("quay-twelve");
  });

  it("strips combining marks so accented text stays ASCII", () => {
    expect(deriveSlug("Café Bellevue")).toBe("cafe-bellevue");
  });

  it("removes characters the database constraint would reject", () => {
    // The constraint is ^[a-z0-9]+(?:-[a-z0-9]+)*$, so no uppercase, underscore,
    // ampersand, or period may survive into the slug.
    const slug = deriveSlug("Tower & Co. (North) — Wing_2");
    expect(slug).toBe("tower-co-north-wing-2");
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("falls back to a non-empty slug when nothing usable remains", () => {
    // An empty slug would violate `not null` in spirit and the format check in
    // fact, so a name with no ASCII alphanumerics must still produce a value.
    expect(deriveSlug("•••")).toBe("property");
    expect(deriveSlug("---")).toBe("property");
  });

  it("never exceeds the maximum length and never ends in a dash", () => {
    const long = "a".repeat(300);
    const slug = deriveSlug(long);
    expect(slug).toHaveLength(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("deriveSlugWithSuffix", () => {
  it("returns the bare slug on the first attempt", () => {
    expect(deriveSlugWithSuffix("Harbour View", 1)).toBe("harbour-view");
    expect(deriveSlugWithSuffix("Harbour View", 0)).toBe("harbour-view");
  });

  it("appends a numeric disambiguator starting at 2", () => {
    expect(deriveSlugWithSuffix("Harbour View", 2)).toBe("harbour-view-2");
    expect(deriveSlugWithSuffix("Harbour View", 3)).toBe("harbour-view-3");
  });

  it("keeps the suffixed slug inside the length limit", () => {
    const slug = deriveSlugWithSuffix("a".repeat(300), 12);
    // 80 total, of which "-12" takes 3, leaves 77.
    expect(slug).toHaveLength(80);
    expect(slug).toBe(`${"a".repeat(77)}-12`);
  });

  it("keeps the fallback slug valid when suffixed", () => {
    expect(deriveSlugWithSuffix("•••", 2)).toBe("property-2");
  });

  it("always satisfies the database format constraint", () => {
    const names = [
      "Harbour View",
      "Café Bellevue",
      "Tower & Co. (North)",
      "a".repeat(300),
      "•••",
      "Mixed 123 Numbers",
    ];
    for (const name of names) {
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        const slug = deriveSlugWithSuffix(name, attempt);
        expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(slug).not.toBe("");
      }
    }
  });
});
