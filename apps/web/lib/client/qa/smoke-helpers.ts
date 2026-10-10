import type {
  CliOptions,
  PresetChipCheck,
  SmokeSummary,
  ViewportConfig,
} from "./types";

export const STANDARD_VIEWPORTS: readonly ViewportConfig[] = [
  { width: 320, height: 640, name: "320px mobile" },
  { width: 375, height: 667, name: "375px mobile" },
  { width: 768, height: 1024, name: "768px tablet" },
  { width: 1024, height: 768, name: "1024px desktop" },
  { width: 1440, height: 900, name: "1440px wide desktop" },
];

export const TARGET_ROUTES = [
  "/owner/property/new",
  "/property/ARCHPROP-001",
] as const;

export const EXPECTED_OWNER_FORM_ORDER = [
  "Reset to Villa Nusa preset",
  "externalId",
  "name",
  "location",
  "propertyType",
  "issuerName",
  "description",
  "indicativeValue",
  "offeringTarget",
  "economicRightsBps",
  "tokenSupply",
  "tokenPrice",
  "Register property",
] as const;

export const EXPECTED_INVESTMENT_PANEL_ORDER = [
  "investment-amount",
  "1M mIDR (100 tokens)",
  "5M mIDR (500 tokens)",
  "10M mIDR (1,000 tokens)",
  "Invest in AVNUSA",
] as const;

export const OWNER_REGISTRATION_PREREQUISITE =
  "connected owner wallet on Arbitrum Sepolia";

export const INVESTMENT_PREREQUISITE =
  "connected investor wallet on Arbitrum Sepolia";

export function parseCliArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): CliOptions {
  let baseUrl = env.ARCHPROP_BASE_URL || env.BASE_URL || "http://localhost:3000";
  let chromiumPath: string | undefined = env.CHROMIUM_PATH || env.CHROME_PATH || undefined;
  let debugPort = 9222;
  let timeoutMs = 15000;
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--base-url" || arg === "-u") {
      const next = argv[++i];
      if (next) baseUrl = next;
    } else if (arg.startsWith("--base-url=")) {
      baseUrl = arg.slice("--base-url=".length) || baseUrl;
    } else if (
      arg === "--chromium-path" ||
      arg === "--chrome-path" ||
      arg === "-c"
    ) {
      const next = argv[++i];
      if (next) chromiumPath = next;
    } else if (arg.startsWith("--chromium-path=")) {
      chromiumPath = arg.slice("--chromium-path=".length) || chromiumPath;
    } else if (arg.startsWith("--chrome-path=")) {
      chromiumPath = arg.slice("--chrome-path=".length) || chromiumPath;
    } else if (arg === "--debug-port" || arg === "-p") {
      const next = argv[++i];
      if (next) {
        const parsedPort = Number.parseInt(next, 10);
        if (!Number.isNaN(parsedPort) && parsedPort > 0) {
          debugPort = parsedPort;
        }
      }
    } else if (arg.startsWith("--debug-port=")) {
      const parsedPort = Number.parseInt(arg.slice("--debug-port=".length), 10);
      if (!Number.isNaN(parsedPort) && parsedPort > 0) {
        debugPort = parsedPort;
      }
    } else if (arg === "--timeout" || arg === "-t") {
      const next = argv[++i];
      if (next) {
        const parsedTimeout = Number.parseInt(next, 10);
        if (!Number.isNaN(parsedTimeout) && parsedTimeout > 0) {
          timeoutMs = parsedTimeout;
        }
      }
    } else if (arg.startsWith("--timeout=")) {
      const parsedTimeout = Number.parseInt(arg.slice("--timeout=".length), 10);
      if (!Number.isNaN(parsedTimeout) && parsedTimeout > 0) {
        timeoutMs = parsedTimeout;
      }
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    }
  }

  // Normalize base URL trailing slash
  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  return {
    baseUrl,
    chromiumPath,
    debugPort,
    timeoutMs,
    verbose,
  };
}

export function evaluateViewportLayout(params: {
  innerWidth: number;
  scrollWidth: number;
  clippedControls: string[];
}): { status: "PASS" | "FAIL"; hasHorizontalOverflow: boolean; details: string } {
  const { innerWidth, scrollWidth, clippedControls } = params;
  // Permit 1px subpixel rounding tolerance
  const hasHorizontalOverflow = scrollWidth > innerWidth + 1;
  const isClipped = clippedControls.length > 0;
  const status: "PASS" | "FAIL" = hasHorizontalOverflow || isClipped ? "FAIL" : "PASS";

  const failureReasons: string[] = [];
  if (hasHorizontalOverflow) {
    failureReasons.push(
      `horizontal overflow detected (scrollWidth=${scrollWidth}px > innerWidth=${innerWidth}px)`
    );
  }
  if (isClipped) {
    failureReasons.push(
      `clipped interactive controls: [${clippedControls.join(", ")}]`
    );
  }

  const details =
    failureReasons.length > 0
      ? failureReasons.join("; ")
      : `docWidth=${scrollWidth}px, winWidth=${innerWidth}px, clipped=0`;

  return {
    status,
    hasHorizontalOverflow,
    details,
  };
}

export function validateTabOrder(
  expectedSequence: readonly string[],
  actualElements: readonly { id: string }[]
): { valid: boolean; failures: string[] } {
  const actualIds = actualElements.map((el) => el.id);
  const failures: string[] = [];

  let lastIndex = -1;
  for (const expectedId of expectedSequence) {
    const foundIndex = actualIds.indexOf(expectedId);
    if (foundIndex === -1) {
      failures.push(`Missing expected interactive element: "${expectedId}"`);
    } else if (foundIndex < lastIndex) {
      failures.push(
        `Element "${expectedId}" at position ${foundIndex} appeared out of expected sequential order (previous was at index ${lastIndex})`
      );
    } else {
      lastIndex = foundIndex;
    }
  }

  return {
    valid: failures.length === 0,
    failures,
  };
}

export function validateActionPrerequisite(
  action: {
    disabled: boolean;
    label: string;
    prerequisitePresent: boolean;
    prerequisiteText?: string | undefined;
  },
  expectedPrerequisiteText: string
): { valid: boolean; failures: string[] } {
  const failures: string[] = [];

  if (!action.disabled) {
    failures.push(
      `Action "${action.label}" is enabled! Must remain disabled without wallet/chain prerequisites.`
    );
  }

  if (!action.prerequisitePresent) {
    failures.push(
      `Action "${action.label}" does not present prerequisite text.`
    );
  } else if (
    action.prerequisiteText &&
    !action.prerequisiteText.includes(expectedPrerequisiteText)
  ) {
    failures.push(
      `Action "${action.label}" has prerequisite text "${action.prerequisiteText}", expected containing "${expectedPrerequisiteText}".`
    );
  }

  return {
    valid: failures.length === 0,
    failures,
  };
}

export function validatePresetChips(
  presets: readonly PresetChipCheck[],
  expectedSelectedLabel?: string
): { valid: boolean; failures: string[] } {
  const failures: string[] = [];

  if (presets.length === 0) {
    failures.push("No preset chips found.");
    return { valid: false, failures };
  }

  let trueCount = 0;
  for (const chip of presets) {
    if (chip.ariaPressed !== "true" && chip.ariaPressed !== "false") {
      failures.push(
        `Preset "${chip.label}" has invalid aria-pressed="${chip.ariaPressed}". Must be "true" or "false".`
      );
    }
    if (chip.ariaPressed === "true") {
      trueCount++;
      if (expectedSelectedLabel && chip.label !== expectedSelectedLabel) {
        failures.push(
          `Preset "${chip.label}" is pressed, but expected "${expectedSelectedLabel}".`
        );
      }
    }
  }

  if (expectedSelectedLabel && trueCount === 0) {
    failures.push(
      `Expected preset "${expectedSelectedLabel}" to have aria-pressed="true", but none was selected.`
    );
  }

  return {
    valid: failures.length === 0,
    failures,
  };
}

export function validateAriaDescribedByTargets(
  ariaDescribedBy: string | null,
  availableDomIds: readonly string[]
): { valid: boolean; missingTargets: string[] } {
  if (!ariaDescribedBy) {
    return { valid: true, missingTargets: [] };
  }

  const targets = ariaDescribedBy.trim().split(/\s+/).filter(Boolean);
  const availableSet = new Set(availableDomIds);
  const missingTargets = targets.filter((targetId) => !availableSet.has(targetId));

  return {
    valid: missingTargets.length === 0,
    missingTargets,
  };
}

export function formatSmokeReport(summary: SmokeSummary): string {
  const lines: string[] = [];
  lines.push("================================================================================");
  lines.push("                   ARCHPROP BROWSER SMOKE TEST REPORT                           ");
  lines.push("================================================================================");
  lines.push(`Base URL:     ${summary.baseUrl}`);
  lines.push(`Chromium:     ${summary.chromiumPath || "auto-detected"}`);
  lines.push(`Status:       ${summary.overallStatus}`);
  if (summary.blockedReason) {
    lines.push(`Block Reason: ${summary.blockedReason}`);
  }
  lines.push("--------------------------------------------------------------------------------");

  if (summary.viewportResults.length > 0) {
    lines.push("VIEWPORT RESPONSIVENESS CHECKS:");
    for (const vr of summary.viewportResults) {
      const tag = vr.status === "PASS" ? "[PASS]" : "[FAIL]";
      lines.push(
        `  ${tag.padEnd(7)} ${vr.route.padEnd(28)} ${vr.viewport.name.padEnd(20)} (${vr.details || ""})`
      );
    }
    lines.push("--------------------------------------------------------------------------------");
  }

  if (summary.routeAccessibilityResults.length > 0) {
    lines.push("KEYBOARD & ACCESSIBILITY CHECKS:");
    for (const ar of summary.routeAccessibilityResults) {
      const tag = ar.status === "PASS" ? "[PASS]" : "[FAIL]";
      lines.push(`  ${tag.padEnd(7)} Route: ${ar.route}`);
      lines.push(`          Tab order:      ${ar.tabOrderValid ? "PASS" : "FAIL"}`);
      lines.push(`          Visible focus:  ${ar.visibleFocusValid ? "PASS" : "FAIL"}`);
      lines.push(`          ARIA relations: ${ar.ariaAssociationsValid ? "PASS" : "FAIL"}`);
      lines.push(`          Disabled locks: ${ar.disabledActionValid ? "PASS" : "FAIL"}`);
      if (ar.presetChipsValid !== undefined) {
        lines.push(`          Preset chips:   ${ar.presetChipsValid ? "PASS" : "FAIL"}`);
      }
      if (ar.failures.length > 0) {
        for (const failure of ar.failures) {
          lines.push(`          - FAILURE: ${failure}`);
        }
      }
    }
    lines.push("--------------------------------------------------------------------------------");
  }

  if (summary.failures.length > 0) {
    lines.push("OVERALL FAILURES:");
    for (const failure of summary.failures) {
      lines.push(`  - ${failure}`);
    }
    lines.push("--------------------------------------------------------------------------------");
  }

  lines.push(`OVERALL RESULT: ${summary.overallStatus}`);
  lines.push("================================================================================");

  return lines.join("\n");
}
