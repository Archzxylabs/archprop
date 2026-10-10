import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Header responsive-breakpoint assertions.
 *
 * FE-001-C2 requires the compact disclosure to stay active through tablet
 * widths (roughly 640–1279px) rather than switching to the inline nav at `sm`,
 * where six links plus the wordmark and the wallet/network labels collide.
 *
 * There is no DOM environment available here, so these tests assert the
 * contract at the source level: the four breakpoint gates that must agree, and
 * the accessibility wiring that must survive any future refactor of them.
 */

const HEADER_PATH = join(process.cwd(), "components", "site-header.tsx");
const HEADER_SOURCE = readFileSync(HEADER_PATH, "utf8");

/** Tailwind's default breakpoint widths in pixels. */
const TAILWIND_BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

/** The six destinations the header must make reachable at every width. */
const REQUIRED_DESTINATIONS = [
  "/marketplace",
  "/owner",
  "/verifier",
  "/portfolio",
  "/admin",
] as const;

/**
 * Returns the opening tag that contains `anchorText`, so the className can be
 * read regardless of attribute order.
 *
 * The naive approach — taking the first `className=` after the anchor — breaks
 * in both directions here: the menu panel declares `id` *after* `className`,
 * while the wallet/network labels put their text *after* `className`. So this
 * locates the enclosing tag first, then reads the class list out of it.
 */
function classNameFor(anchorText: string): string {
  const anchor = HEADER_SOURCE.indexOf(anchorText);
  expect(anchor, `${anchorText} should exist in the header`).toBeGreaterThan(-1);

  // Walk back to the `<` that opens the tag containing the anchor.
  let tagStart = -1;
  for (let i = anchor; i >= 0; i -= 1) {
    if (HEADER_SOURCE[i] === "<") {
      tagStart = i;
      break;
    }
  }
  expect(tagStart, `${anchorText} should sit inside a JSX element`).toBeGreaterThan(-1);

  // Walk forward to the tag's closing `>`, skipping quoted strings so an
  // attribute like `onClick={() => setMenuOpen(false)}` cannot end the tag
  // early on its own arrow.
  let tagEnd = -1;
  let quote: string | null = null;
  for (let i = tagStart; i < HEADER_SOURCE.length; i += 1) {
    const char = HEADER_SOURCE[i];

    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") {
      tagEnd = i;
      break;
    }
  }
  expect(tagEnd, `the tag containing ${anchorText} should close`).toBeGreaterThan(-1);

  const tag = HEADER_SOURCE.slice(tagStart, tagEnd);
  const match = /className="([^"]*)"/.exec(tag);
  expect(match, `the tag containing ${anchorText} should declare a className`).not.toBeNull();

  return match![1]!;
}

/** Splits a class list into its unprefixed names and its prefixed variants. */
function splitClasses(classNames: string): { base: Set<string>; prefixed: Map<string, Set<string>> } {
  const base = new Set<string>();
  const prefixed = new Map<string, Set<string>>();

  for (const token of classNames.split(/\s+/).filter(Boolean)) {
    const separator = token.lastIndexOf(":");
    if (separator === -1) {
      base.add(token);
      continue;
    }

    const variant = token.slice(0, separator);
    const utility = token.slice(separator + 1);
    if (!prefixed.has(variant)) prefixed.set(variant, new Set());
    prefixed.get(variant)!.add(utility);
  }

  return { base, prefixed };
}

describe("site header breakpoint contract", () => {
  it("keeps the inline navigation hidden below the xl breakpoint", () => {
    const { base, prefixed } = splitClasses(classNameFor('aria-label="Primary"'));

    expect(base.has("hidden"), "the inline nav must be hidden by default").toBe(true);
    expect(prefixed.get("xl")?.has("block"), "and revealed only at `xl` and up").toBe(true);
  });

  it("keeps the compact menu trigger visible below the xl breakpoint", () => {
    const { base, prefixed } = splitClasses(classNameFor('aria-controls="primary-nav-mobile"'));

    // The trigger is visible by default and withdrawn at `xl` and up.
    expect(base.has("hidden"), "the trigger must not be hidden by default").toBe(false);
    expect(prefixed.get("xl")?.has("hidden"), "and withdrawn only at `xl` and up").toBe(true);

    // It must not carry a narrower gate: anything like `sm:hidden` would hand
    // the header back to the inline nav at tablet widths.
    for (const [variant, utilities] of prefixed) {
      const width =
        TAILWIND_BREAKPOINTS[variant as keyof typeof TAILWIND_BREAKPOINTS];
      const isNarrowerThanXl = width !== undefined && width < TAILWIND_BREAKPOINTS.xl;

      expect(
        isNarrowerThanXl,
        `the trigger must not gate on a breakpoint narrower than xl, found ${variant}:${[...utilities].join(",")}`,
      ).toBe(false);
    }
  });

  it("keeps the compact menu panel hidden at the xl breakpoint", () => {
    const { prefixed } = splitClasses(classNameFor('id="primary-nav-mobile"'));

    expect(prefixed.get("xl")?.has("hidden"), "the panel must hide at `xl` and up").toBe(true);
  });

  it("reveals the wallet and network labels only alongside the inline nav", () => {
    // Both labels are `hidden` by default and gated behind the same breakpoint
    // as the inline nav, so the header never has to fit a chip between the
    // wordmark and the menu trigger at tablet widths.
    for (const label of ["Arbitrum Sepolia", "Wallet not connected"]) {
      const { base, prefixed } = splitClasses(classNameFor(label));

      expect(base.has("hidden"), `${label} must be hidden by default`).toBe(true);
      expect(prefixed.get("xl")?.has("inline-flex"), `${label} must appear at xl and up`).toBe(
        true,
      );
    }
  });

  it("wires the menu trigger to its panel for assistive technology", () => {
    // `aria-expanded`/`aria-controls` are what let a screen-reader user tell
    // whether the disclosure is open, so they must survive any refactor.
    expect(HEADER_SOURCE).toContain('aria-expanded={menuOpen}');
    expect(HEADER_SOURCE).toContain('aria-controls="primary-nav-mobile"');
    expect(HEADER_SOURCE).toContain('id="primary-nav-mobile"');
  });

  it("closes the menu panel after a destination is chosen", () => {
    const panelStart = HEADER_SOURCE.indexOf('id="primary-nav-mobile"');
    const panelEnd = HEADER_SOURCE.indexOf("</nav>", panelStart);
    const panel = HEADER_SOURCE.slice(panelStart, panelEnd);

    expect(panel).toContain("onClick={() => setMenuOpen(false)}");
  });

  it("keeps every destination reachable from the compact menu", () => {
    // The disclosure renders the same `NAV_ITEMS` list the inline nav uses, so
    // the six destinations stay reachable at every width.
    const navItemsBlock = HEADER_SOURCE.slice(
      HEADER_SOURCE.indexOf("const NAV_ITEMS"),
      HEADER_SOURCE.indexOf("] as const;", HEADER_SOURCE.indexOf("const NAV_ITEMS")),
    );

    for (const destination of REQUIRED_DESTINATIONS) {
      expect(navItemsBlock, `${destination} must be in NAV_ITEMS`).toContain(destination);
    }
  });

  it("avoids fixed widths that would force horizontal overflow", () => {
    // A fixed width wider than the 320px floor, or a `w-screen`, would make the
    // document scroll sideways instead of shrinking.
    const headerStart = HEADER_SOURCE.indexOf("export function SiteHeader()");
    const headerEnd = HEADER_SOURCE.indexOf("export interface SectionHeadingProps");
    const header = HEADER_SOURCE.slice(headerStart, headerEnd);

    expect(header).not.toMatch(/\bw-\[\d/);
    expect(header).not.toMatch(/\bw-screen\b/);
    expect(header).not.toMatch(/\bmin-w-\[\d/);
    // The header content must be allowed to shrink below its intrinsic size.
    expect(header).toContain("min-w-0");
  });
});
