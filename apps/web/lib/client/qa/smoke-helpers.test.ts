import { describe, expect, it } from "vitest";
import {
  evaluateFocusEvidence,
  evaluateFocusExit,
  evaluateTabStep,
  evaluateViewportLayout,
  EXPECTED_INVESTMENT_PANEL_ENABLED_TAB_SEQUENCE,
  EXPECTED_OWNER_FORM_ENABLED_TAB_SEQUENCE,
  formatSmokeReport,
  INVESTMENT_PREREQUISITE,
  OWNER_REGISTRATION_PREREQUISITE,
  parseCliArgs,
  STANDARD_VIEWPORTS,
  validateActionPrerequisite,
  validateAriaDescribedByTargets,
  validatePresetChips,
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

  describe("evaluateViewportLayout (fail-closed behavior)", () => {
    it("fails when innerWidth is undefined, null, NaN, or non-finite", () => {
      expect(
        evaluateViewportLayout({
          innerWidth: undefined,
          scrollWidth: 320,
          clippedControls: [],
        }).status
      ).toBe("FAIL");

      expect(
        evaluateViewportLayout({
          innerWidth: Number.NaN,
          scrollWidth: 320,
          clippedControls: [],
        }).status
      ).toBe("FAIL");

      expect(
        evaluateViewportLayout({
          innerWidth: 0,
          scrollWidth: 320,
          clippedControls: [],
        }).status
      ).toBe("FAIL");
    });

    it("fails when scrollWidth is undefined, null, NaN, or non-finite", () => {
      expect(
        evaluateViewportLayout({
          innerWidth: 320,
          scrollWidth: undefined,
          clippedControls: [],
        }).status
      ).toBe("FAIL");

      expect(
        evaluateViewportLayout({
          innerWidth: 320,
          scrollWidth: null,
          clippedControls: [],
        }).status
      ).toBe("FAIL");

      expect(
        evaluateViewportLayout({
          innerWidth: 320,
          scrollWidth: 0,
          clippedControls: [],
        }).status
      ).toBe("FAIL");
    });

    it("fails when clippedControls is not an array", () => {
      expect(
        evaluateViewportLayout({
          innerWidth: 320,
          scrollWidth: 320,
          clippedControls: null,
        }).status
      ).toBe("FAIL");
    });

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

  describe("evaluateFocusEvidence (strict keyboard focus evidence)", () => {
    it("fails when matchesFocusVisible is false or undefined", () => {
      const result1 = evaluateFocusEvidence({
        matchesFocusVisible: false,
        outlineStyle: "solid",
        outlineWidth: "2px",
      });
      expect(result1.valid).toBe(false);
      expect(result1.reason).toContain("does not match :focus-visible");

      const result2 = evaluateFocusEvidence({
        matchesFocusVisible: undefined,
        outlineStyle: "solid",
        outlineWidth: "2px",
      });
      expect(result2.valid).toBe(false);
    });

    it("fails when matchesFocusVisible is true but no outline or ring exists", () => {
      const result = evaluateFocusEvidence({
        matchesFocusVisible: true,
        outlineStyle: "none",
        outlineWidth: "0px",
        boxShadow: "none",
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("lacks a meaningful computed focus indicator");
    });

    it("fails when only drop shadow without spread is present", () => {
      const result = evaluateFocusEvidence({
        matchesFocusVisible: true,
        outlineStyle: "none",
        outlineWidth: "0px",
        boxShadow: "rgba(0, 0, 0, 0.1) 0px 4px 6px 0px",
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("lacks a meaningful computed focus indicator");
    });

    it("passes when matchesFocusVisible is true and outline is visible", () => {
      const result = evaluateFocusEvidence({
        matchesFocusVisible: true,
        outlineStyle: "solid",
        outlineWidth: "2px",
      });
      expect(result.valid).toBe(true);
    });

    it("passes when matchesFocusVisible is true and focus ring spread is present", () => {
      const result = evaluateFocusEvidence({
        matchesFocusVisible: true,
        outlineStyle: "none",
        outlineWidth: "0px",
        boxShadow: "rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.510931 ...) 0px 0px 0px 2px",
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("evaluateFocusExit (fail-closed exit boundary checks)", () => {
    it("fails when evaluation exception is reported", () => {
      const result = evaluateFocusExit({
        evalException: "CDP connection lost",
        activeElement: null,
        isInsideContainer: false,
        disabledButtonText: "Register property",
      });
      expect(result.success).toBe(false);
      expect(result.failureReason).toContain("threw an exception: CDP connection lost");
    });

    it("fails when activeElement is null or missing tag", () => {
      const result = evaluateFocusExit({
        activeElement: null,
        isInsideContainer: false,
        disabledButtonText: "Register property",
      });
      expect(result.success).toBe(false);
      expect(result.failureReason).toContain("could not be resolved or was null");
    });

    it("fails when activeElement is the disabled action button", () => {
      const result = evaluateFocusExit({
        activeElement: { tag: "BUTTON", id: "", text: "Register property" },
        isInsideContainer: true,
        disabledButtonText: "Register property",
      });
      expect(result.success).toBe(false);
      expect(result.skippedDisabledButton).toBe(false);
      expect(result.failureReason).toContain("improperly received tab focus");
    });

    it("fails when focus remained inside the form/panel", () => {
      const result = evaluateFocusExit({
        activeElement: { tag: "INPUT", id: "tokenPrice", text: "" },
        isInsideContainer: true,
        disabledButtonText: "Register property",
      });
      expect(result.success).toBe(false);
      expect(result.isInsideContainer).toBe(true);
      expect(result.failureReason).toContain("Focus remained inside the container");
    });

    it("passes when focus successfully moved outside and skipped disabled button", () => {
      const result = evaluateFocusExit({
        activeElement: { tag: "A", id: "back-link", text: "← Back to your assets" },
        isInsideContainer: false,
        disabledButtonText: "Register property",
      });
      expect(result.success).toBe(true);
      expect(result.isInsideContainer).toBe(false);
      expect(result.skippedDisabledButton).toBe(true);
      expect(result.failureReason).toBeUndefined();
    });
  });

  describe("evaluateTabStep", () => {
    it("passes when active element matches expected and has :focus-visible with focus ring", () => {
      const step = evaluateTabStep(
        "externalId",
        {
          tag: "INPUT",
          id: "externalId",
          disabled: false,
          matchesFocusVisible: true,
          outlineStyle: "none",
          outlineWidth: "2px",
          boxShadow: "oklab(...) 0px 0px 0px 2px",
        },
        1
      );
      expect(step.matchesExpected).toBe(true);
      expect(step.hasObservableFocus).toBe(true);
      expect(step.failureReason).toBeUndefined();
    });

    it("matches button by text label with visible outline", () => {
      const step = evaluateTabStep(
        "Reset to Villa Nusa preset",
        {
          tag: "BUTTON",
          id: "",
          text: "Reset to Villa Nusa preset",
          disabled: false,
          matchesFocusVisible: true,
          outlineStyle: "solid",
          outlineWidth: "2px",
        },
        1
      );
      expect(step.matchesExpected).toBe(true);
      expect(step.hasObservableFocus).toBe(true);
    });

    it("fails when focused element does not match expected", () => {
      const step = evaluateTabStep(
        "externalId",
        {
          tag: "INPUT",
          id: "wrongField",
          disabled: false,
          matchesFocusVisible: true,
          outlineStyle: "solid",
          outlineWidth: "2px",
        },
        2
      );
      expect(step.matchesExpected).toBe(false);
      expect(step.failureReason).toContain('Expected focus on "externalId"');
    });

    it("fails when focused element is marked disabled", () => {
      const step = evaluateTabStep(
        "Register property",
        {
          tag: "BUTTON",
          id: "Register property",
          disabled: true,
          matchesFocusVisible: true,
          outlineStyle: "solid",
          outlineWidth: "2px",
        },
        13
      );
      expect(step.matchesExpected).toBe(false);
      expect(step.failureReason).toContain("while marked disabled");
    });

    it("fails when focused element lacks :focus-visible matching", () => {
      const step = evaluateTabStep(
        "name",
        {
          tag: "INPUT",
          id: "name",
          disabled: false,
          matchesFocusVisible: false,
          outlineStyle: "solid",
          outlineWidth: "2px",
        },
        2
      );
      expect(step.matchesExpected).toBe(true);
      expect(step.hasObservableFocus).toBe(false);
      expect(step.failureReason).toContain("does not match :focus-visible");
    });
  });

  describe("Expected Tab Sequences", () => {
    it("excludes disabled submit button from owner form enabled tab sequence", () => {
      expect(EXPECTED_OWNER_FORM_ENABLED_TAB_SEQUENCE).toHaveLength(12);
      expect(EXPECTED_OWNER_FORM_ENABLED_TAB_SEQUENCE).not.toContain("Register property");
      expect(EXPECTED_OWNER_FORM_ENABLED_TAB_SEQUENCE[0]).toBe("Reset to Villa Nusa preset");
      expect(EXPECTED_OWNER_FORM_ENABLED_TAB_SEQUENCE[11]).toBe("tokenPrice");
    });

    it("excludes disabled investment button from investment panel enabled tab sequence", () => {
      expect(EXPECTED_INVESTMENT_PANEL_ENABLED_TAB_SEQUENCE).toHaveLength(4);
      expect(EXPECTED_INVESTMENT_PANEL_ENABLED_TAB_SEQUENCE).not.toContain("Invest in AVNUSA");
      expect(EXPECTED_INVESTMENT_PANEL_ENABLED_TAB_SEQUENCE[0]).toBe("investment-amount");
      expect(EXPECTED_INVESTMENT_PANEL_ENABLED_TAB_SEQUENCE[3]).toBe("10M mIDR (1,000 tokens)");
    });
  });

  describe("validateActionPrerequisite", () => {
    it("passes when action is disabled and includes required prerequisite text", () => {
      const result = validateActionPrerequisite(
        {
          disabled: true,
          label: "Register property",
          prerequisitePresent: true,
          prerequisiteText:
            "Unavailable: this action needs a connected owner wallet on Arbitrum Sepolia.",
        },
        OWNER_REGISTRATION_PREREQUISITE
      );
      expect(result.valid).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("matches canonical investment prerequisite text", () => {
      const result = validateActionPrerequisite(
        {
          disabled: true,
          label: "Invest in AVNUSA",
          prerequisitePresent: true,
          prerequisiteText:
            "Unavailable: this action needs a connected investor wallet on Arbitrum Sepolia (live chain adapter pending FE-002).",
        },
        INVESTMENT_PREREQUISITE
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
          prerequisiteText: OWNER_REGISTRATION_PREREQUISITE,
        },
        OWNER_REGISTRATION_PREREQUISITE
      );
      expect(result.valid).toBe(false);
      expect(result.failures[0]).toContain("is enabled! Must remain disabled");
    });

    it("fails if prerequisite text is missing or wrong", () => {
      const result = validateActionPrerequisite(
        {
          disabled: true,
          label: "Register property",
          prerequisitePresent: true,
          prerequisiteText: "Random text",
        },
        OWNER_REGISTRATION_PREREQUISITE
      );
      expect(result.valid).toBe(false);
      expect(result.failures[0]).toContain("expected containing");
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
    it("formats a complete summary report with observed tab steps and focus exit", () => {
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
            navigationValid: true,
            tabSequenceValid: true,
            visibleFocusValid: true,
            focusExitValid: true,
            ariaAssociationsValid: true,
            disabledActionValid: true,
            tabSteps: [
              {
                step: 1,
                expectedControl: "Reset to Villa Nusa preset",
                actualId: "",
                actualText: "Reset to Villa Nusa preset",
                actualTag: "BUTTON",
                matchesExpected: true,
                hasObservableFocus: true,
              },
            ],
            focusExitResult: {
              success: true,
              activeTag: "A",
              activeText: "← Back to your assets",
              isInsideContainer: false,
              skippedDisabledButton: true,
            },
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
      expect(report).toContain("Observed Tab Steps:");
      expect(report).toContain("Focus exit result: ✓");
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
