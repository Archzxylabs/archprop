import { describe, expect, it } from "vitest";
import {
  evaluateViewportLayout,
  formatSmokeReport,
  parseCliArgs,
  STANDARD_VIEWPORTS,
  validateActionPrerequisite,
  validateAriaDescribedByTargets,
  validatePresetChips,
  validateTabOrder,
} from "./smoke-helpers";
import type { SmokeSummary } from "./types";

describe("smoke-helpers", () => {
  describe("parseCliArgs", () => {
    it("returns defaults when no arguments or env vars provided", () => {
      const options = parseCliArgs([], {});
      expect(options.baseUrl).toBe("http://localhost:3000");
      expect(options.chromiumPath).toBeUndefined();
      expect(options.debugPort).toBe(9222);
      expect(options.timeoutMs).toBe(15000);
      expect(options.verbose).toBe(false);
    });

    it("uses environment variables if CLI args are omitted", () => {
      const options = parseCliArgs([], {
        ARCHPROP_BASE_URL: "http://127.0.0.1:8080/",
        CHROMIUM_PATH: "/usr/bin/custom-chromium",
      });
      expect(options.baseUrl).toBe("http://127.0.0.1:8080");
      expect(options.chromiumPath).toBe("/usr/bin/custom-chromium");
    });

    it("parses CLI arguments and overrides env vars", () => {
      const options = parseCliArgs(
        [
          "--base-url",
          "http://localhost:4000/",
          "--chrome-path",
          "/bin/chrome",
          "--debug-port",
          "9333",
          "--timeout",
          "5000",
          "--verbose",
        ],
        {
          ARCHPROP_BASE_URL: "http://ignored:3000",
        }
      );
      expect(options.baseUrl).toBe("http://localhost:4000");
      expect(options.chromiumPath).toBe("/bin/chrome");
      expect(options.debugPort).toBe(9333);
      expect(options.timeoutMs).toBe(5000);
      expect(options.verbose).toBe(true);
    });

    it("handles key=value style arguments", () => {
      const options = parseCliArgs(
        [
          "--base-url=http://127.0.0.1:5000",
          "--chromium-path=/opt/google/chrome",
          "--debug-port=9444",
          "--timeout=8000",
        ],
        {}
      );
      expect(options.baseUrl).toBe("http://127.0.0.1:5000");
      expect(options.chromiumPath).toBe("/opt/google/chrome");
      expect(options.debugPort).toBe(9444);
      expect(options.timeoutMs).toBe(8000);
    });
  });

  describe("STANDARD_VIEWPORTS", () => {
    it("defines the five required canonical viewports", () => {
      expect(STANDARD_VIEWPORTS).toHaveLength(5);
      const widths = STANDARD_VIEWPORTS.map((v) => v.width);
      expect(widths).toEqual([320, 375, 768, 1024, 1440]);
    });
  });

  describe("evaluateViewportLayout", () => {
    it("passes when docWidth <= winWidth and no controls are clipped", () => {
      const result = evaluateViewportLayout({
        innerWidth: 320,
        scrollWidth: 320,
        clippedControls: [],
      });
      expect(result.status).toBe("PASS");
      expect(result.hasHorizontalOverflow).toBe(false);
      expect(result.details).toContain("clipped=0");
    });

    it("passes within 1px subpixel tolerance", () => {
      const result = evaluateViewportLayout({
        innerWidth: 375,
        scrollWidth: 376,
        clippedControls: [],
      });
      expect(result.status).toBe("PASS");
      expect(result.hasHorizontalOverflow).toBe(false);
    });

    it("fails when horizontal overflow exceeds tolerance", () => {
      const result = evaluateViewportLayout({
        innerWidth: 320,
        scrollWidth: 340,
        clippedControls: [],
      });
      expect(result.status).toBe("FAIL");
      expect(result.hasHorizontalOverflow).toBe(true);
      expect(result.details).toContain("horizontal overflow detected");
    });

    it("fails when controls are clipped even if no document scroll", () => {
      const result = evaluateViewportLayout({
        innerWidth: 320,
        scrollWidth: 320,
        clippedControls: ["externalId", "offeringTarget"],
      });
      expect(result.status).toBe("FAIL");
      expect(result.hasHorizontalOverflow).toBe(false);
      expect(result.details).toContain("clipped interactive controls: [externalId, offeringTarget]");
    });
  });

  describe("validateTabOrder", () => {
    const sequence = ["btn-reset", "input-1", "input-2", "btn-submit"];

    it("passes when elements appear in sequential order", () => {
      const actual = [
        { id: "btn-reset" },
        { id: "input-1" },
        { id: "input-2" },
        { id: "btn-submit" },
      ];
      const result = validateTabOrder(sequence, actual);
      expect(result.valid).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("passes when intermediate non-essential elements exist but sequence is respected", () => {
      const actual = [
        { id: "header-link" },
        { id: "btn-reset" },
        { id: "some-helper" },
        { id: "input-1" },
        { id: "input-2" },
        { id: "btn-submit" },
      ];
      const result = validateTabOrder(sequence, actual);
      expect(result.valid).toBe(true);
    });

    it("fails when an expected element is missing", () => {
      const actual = [
        { id: "btn-reset" },
        { id: "input-1" },
        { id: "btn-submit" },
      ];
      const result = validateTabOrder(sequence, actual);
      expect(result.valid).toBe(false);
      expect(result.failures[0]).toContain('Missing expected interactive element: "input-2"');
    });

    it("fails when elements appear out of order", () => {
      const actual = [
        { id: "btn-reset" },
        { id: "input-2" },
        { id: "input-1" },
        { id: "btn-submit" },
      ];
      const result = validateTabOrder(sequence, actual);
      expect(result.valid).toBe(false);
      expect(result.failures[0]).toContain("appeared out of expected sequential order");
    });
  });

  describe("validateActionPrerequisite", () => {
    it("passes when action is disabled and includes required prerequisite text", () => {
      const result = validateActionPrerequisite(
        {
          disabled: true,
          label: "Register property",
          prerequisitePresent: true,
          prerequisiteText: "Wallet and on-chain registration handler required",
        },
        "registration handler required"
      );
      expect(result.valid).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("fails if action is enabled", () => {
      const result = validateActionPrerequisite(
        {
          disabled: false,
          label: "Register property",
          prerequisitePresent: true,
          prerequisiteText: "Wallet and on-chain registration handler required",
        },
        "registration handler required"
      );
      expect(result.valid).toBe(false);
      expect(result.failures[0]).toContain("is enabled! Must remain disabled");
    });

    it("fails if prerequisite text does not match expected prerequisite", () => {
      const result = validateActionPrerequisite(
        {
          disabled: true,
          label: "Register property",
          prerequisitePresent: true,
          prerequisiteText: "Random text",
        },
        "registration handler required"
      );
      expect(result.valid).toBe(false);
      expect(result.failures[0]).toContain("expected containing");
    });

    it("matches canonical owner and investor prerequisite texts", () => {
      const ownerCheck = validateActionPrerequisite(
        {
          disabled: true,
          label: "Register property",
          prerequisitePresent: true,
          prerequisiteText:
            "Unavailable: this action needs a connected owner wallet on Arbitrum Sepolia.",
        },
        "connected owner wallet on Arbitrum Sepolia"
      );
      expect(ownerCheck.valid).toBe(true);

      const investorCheck = validateActionPrerequisite(
        {
          disabled: true,
          label: "Invest in AVNUSA",
          prerequisitePresent: true,
          prerequisiteText:
            "Unavailable: this action needs a connected investor wallet on Arbitrum Sepolia (live chain adapter pending FE-002).",
        },
        "connected investor wallet on Arbitrum Sepolia"
      );
      expect(investorCheck.valid).toBe(true);
    });
  });

  describe("validatePresetChips", () => {
    const chips = [
      { label: "1M mIDR (100 tokens)", ariaPressed: "true" },
      { label: "5M mIDR (500 tokens)", ariaPressed: "false" },
      { label: "10M mIDR (1,000 tokens)", ariaPressed: "false" },
    ];

    it("passes when aria-pressed attributes are valid and match selection", () => {
      const result = validatePresetChips(chips, "1M mIDR (100 tokens)");
      expect(result.valid).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("fails if aria-pressed is missing or not a boolean string", () => {
      const invalidChips = [
        { label: "1M mIDR (100 tokens)", ariaPressed: null },
        { label: "5M mIDR (500 tokens)", ariaPressed: "false" },
      ];
      const result = validatePresetChips(invalidChips);
      expect(result.valid).toBe(false);
      expect(result.failures[0]).toContain("has invalid aria-pressed");
    });

    it("fails if expected selected chip is not pressed", () => {
      const result = validatePresetChips(chips, "5M mIDR (500 tokens)");
      expect(result.valid).toBe(false);
      expect(result.failures[0]).toContain('Preset "1M mIDR (100 tokens)" is pressed, but expected "5M mIDR (500 tokens)"');
    });
  });

  describe("validateAriaDescribedByTargets", () => {
    it("passes when ariaDescribedBy is null", () => {
      const result = validateAriaDescribedByTargets(null, ["some-id"]);
      expect(result.valid).toBe(true);
      expect(result.missingTargets).toHaveLength(0);
    });

    it("passes when all space-separated targets exist in the DOM ID list", () => {
      const result = validateAriaDescribedByTargets(
        "offeringTarget-error offering-invariant-error",
        ["offeringTarget", "offeringTarget-error", "offering-invariant-error"]
      );
      expect(result.valid).toBe(true);
      expect(result.missingTargets).toHaveLength(0);
    });

    it("fails when any referenced target ID is missing from the DOM ID list", () => {
      const result = validateAriaDescribedByTargets(
        "offeringTarget-error offering-invariant-error missing-id",
        ["offeringTarget-error", "offering-invariant-error"]
      );
      expect(result.valid).toBe(false);
      expect(result.missingTargets).toEqual(["missing-id"]);
    });
  });

  describe("formatSmokeReport", () => {
    it("formats a complete summary report", () => {
      const summary: SmokeSummary = {
        overallStatus: "PASS",
        baseUrl: "http://localhost:3000",
        chromiumPath: "/usr/bin/chromium",
        viewportResults: [
          {
            route: "/owner/property/new",
            viewport: { width: 320, height: 640, name: "320px mobile" },
            status: "PASS",
            innerWidth: 320,
            scrollWidth: 320,
            hasHorizontalOverflow: false,
            clippedControls: [],
            details: "docWidth=320px, winWidth=320px, clipped=0",
          },
        ],
        routeAccessibilityResults: [
          {
            route: "/owner/property/new",
            status: "PASS",
            tabOrderValid: true,
            visibleFocusValid: true,
            ariaAssociationsValid: true,
            disabledActionValid: true,
            interactiveElements: [],
            ariaChecks: [],
            actionChecks: [],
            failures: [],
          },
        ],
        failures: [],
      };

      const report = formatSmokeReport(summary);
      expect(report).toContain("ARCHPROP BROWSER SMOKE TEST REPORT");
      expect(report).toContain("Base URL:     http://localhost:3000");
      expect(report).toContain("Status:       PASS");
      expect(report).toContain("/owner/property/new");
      expect(report).toContain("OVERALL RESULT: PASS");
    });

    it("formats a BLOCKED summary report with blocked reason", () => {
      const summary: SmokeSummary = {
        overallStatus: "BLOCKED",
        baseUrl: "http://localhost:3000",
        blockedReason: "Local server is unreachable",
        viewportResults: [],
        routeAccessibilityResults: [],
        failures: ["Local server is unreachable at http://localhost:3000"],
      };

      const report = formatSmokeReport(summary);
      expect(report).toContain("Status:       BLOCKED");
      expect(report).toContain("Block Reason: Local server is unreachable");
      expect(report).toContain("OVERALL RESULT: BLOCKED");
    });
  });
});
