#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createServer } from "node:net";

export interface ViewportConfig {
  width: number;
  height: number;
  name: string;
}

export interface CliOptions {
  baseUrl: string;
  chromiumPath?: string | undefined;
  debugPort: number;
  timeoutMs: number;
  verbose: boolean;
}

export type CheckStatus = "PASS" | "FAIL" | "BLOCKED";

export interface ViewportResult {
  route: string;
  viewport: ViewportConfig;
  status: "PASS" | "FAIL";
  innerWidth: number;
  scrollWidth: number;
  hasHorizontalOverflow: boolean;
  clippedControls: string[];
  details?: string | undefined;
}

export interface KeyboardInteractiveElement {
  tag: string;
  id: string;
  name?: string | undefined;
  type?: string | undefined;
  disabled: boolean;
  hasVisibleFocus?: boolean | undefined;
}

export interface AriaAssociationCheck {
  fieldId: string;
  hasAriaInvalid: boolean;
  ariaDescribedBy: string | null;
  targetElementsExist: boolean;
  missingTargets?: string[] | undefined;
}

export interface ActionButtonCheck {
  label: string;
  disabled: boolean;
  prerequisitePresent: boolean;
  prerequisiteText?: string | undefined;
}

export interface PresetChipCheck {
  label: string;
  ariaPressed: string | null;
}

export interface RouteAccessibilityResult {
  route: string;
  status: "PASS" | "FAIL";
  tabOrderValid: boolean;
  visibleFocusValid: boolean;
  ariaAssociationsValid: boolean;
  disabledActionValid: boolean;
  presetChipsValid?: boolean | undefined;
  interactiveElements: KeyboardInteractiveElement[];
  ariaChecks: AriaAssociationCheck[];
  actionChecks: ActionButtonCheck[];
  presetChecks?: PresetChipCheck[] | undefined;
  failures: string[];
}

export interface SmokeSummary {
  overallStatus: CheckStatus;
  baseUrl: string;
  chromiumPath?: string | undefined;
  blockedReason?: string | undefined;
  viewportResults: ViewportResult[];
  routeAccessibilityResults: RouteAccessibilityResult[];
  failures: string[];
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string; code?: number };
}

interface CdpClient {
  send: <T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>
  ) => Promise<T>;
  close: () => void;
}

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

const CHROMIUM_CANDIDATE_PATHS = [
  "/home/pupulion/.local/bin/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/chrome",
  "/usr/bin/google-chrome-stable",
];

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

function resolveChromiumPath(explicitPath?: string): string | null {
  if (explicitPath) {
    if (existsSync(explicitPath) && statSync(explicitPath).isFile()) {
      return explicitPath;
    }
    return null;
  }

  for (const candidate of CHROMIUM_CANDIDATE_PATHS) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  return startPort;
}

async function checkServerReachable(
  baseUrl: string,
  timeoutMs = 4000
): Promise<{ reachable: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(baseUrl, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { reachable: response.status < 500 };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { reachable: false, error: message };
  }
}

async function createCdpClient(
  webSocketDebuggerUrl: string
): Promise<CdpClient> {
  const ws = new WebSocket(webSocketDebuggerUrl);
  let msgId = 1;
  const pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  ws.onmessage = (event) => {
    try {
      const parsed: CdpMessage = JSON.parse(String(event.data));
      if (parsed.id && pendingRequests.has(parsed.id)) {
        const handler = pendingRequests.get(parsed.id);
        pendingRequests.delete(parsed.id);
        if (parsed.error) {
          handler?.reject(new Error(parsed.error.message));
        } else {
          handler?.resolve(parsed.result ?? {});
        }
      }
    } catch {
      // Ignore unparseable frames
    }
  };

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (err) => reject(err);
  });

  const send = <T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const id = msgId++;
      pendingRequests.set(id, {
        resolve: (val) => resolve(val as T),
        reject,
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const close = () => {
    try {
      ws.close();
    } catch {
      // Ignore close error
    }
  };

  return { send, close };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runBrowserSmokeCheck(
  options: CliOptions
): Promise<SmokeSummary> {
  const summary: SmokeSummary = {
    overallStatus: "BLOCKED",
    baseUrl: options.baseUrl,
    chromiumPath: options.chromiumPath,
    viewportResults: [],
    routeAccessibilityResults: [],
    failures: [],
  };

  // 1. Verify local web server is reachable
  const serverCheck = await checkServerReachable(options.baseUrl);
  if (!serverCheck.reachable) {
    summary.overallStatus = "BLOCKED";
    summary.blockedReason = `Local server is unreachable at ${options.baseUrl} (${serverCheck.error || "connection failed"}). Start the server first.`;
    summary.failures.push(summary.blockedReason);
    return summary;
  }

  // 2. Resolve Chromium executable
  const resolvedChromium = resolveChromiumPath(options.chromiumPath);
  if (!resolvedChromium) {
    summary.overallStatus = "BLOCKED";
    summary.blockedReason = options.chromiumPath
      ? `Chromium executable not found at specified path: "${options.chromiumPath}"`
      : `Chromium executable not found in system paths. Supply path via --chromium-path or CHROME_PATH environment variable.`;
    summary.failures.push(summary.blockedReason);
    return summary;
  }
  summary.chromiumPath = resolvedChromium;

  // 3. Find available port for CDP
  const debugPort = await findAvailablePort(options.debugPort);

  // 4. Launch headless Chromium
  let chromeProcess: ChildProcess | null = null;
  let cdpClient: CdpClient | null = null;

  try {
    chromeProcess = spawn(resolvedChromium, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${debugPort}`,
    ]);

    // Wait for CDP readiness
    let cdpReady = false;
    const startTime = Date.now();
    while (Date.now() - startTime < 6000) {
      try {
        const verRes = await fetch(
          `http://127.0.0.1:${debugPort}/json/version`
        );
        if (verRes.ok) {
          cdpReady = true;
          break;
        }
      } catch {
        // Retry
      }
      await sleep(150);
    }

    if (!cdpReady) {
      summary.overallStatus = "BLOCKED";
      summary.blockedReason = `Chromium started but CDP port ${debugPort} did not respond within timeout.`;
      summary.failures.push(summary.blockedReason);
      return summary;
    }

    // 5. Connect CDP tab
    const newTabRes = await fetch(`http://127.0.0.1:${debugPort}/json/new`, {
      method: "PUT",
    });
    const tabData = (await newTabRes.json()) as {
      webSocketDebuggerUrl: string;
    };
    cdpClient = await createCdpClient(tabData.webSocketDebuggerUrl);

    await cdpClient.send("Page.enable");
    await cdpClient.send("DOM.enable");
    await cdpClient.send("Runtime.enable");

    // 6. Viewport responsiveness checks across all routes
    for (const route of TARGET_ROUTES) {
      const fullUrl = `${options.baseUrl}${route}`;
      await cdpClient.send("Page.navigate", { url: fullUrl });
      await sleep(800);

      for (const vp of STANDARD_VIEWPORTS) {
        await cdpClient.send("Emulation.setDeviceMetricsOverride", {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: vp.width < 768,
        });
        await sleep(150);

        interface LayoutEval {
          result: {
            value: {
              docWidth: number;
              winWidth: number;
              clippedControls: string[];
            };
          };
        }

        const evalRes = await cdpClient.send<LayoutEval>("Runtime.evaluate", {
          expression: `(() => {
            const docWidth = Math.max(
              document.documentElement.scrollWidth,
              document.body ? document.body.scrollWidth : 0
            );
            const winWidth = window.innerWidth;
            const controls = Array.from(document.querySelectorAll('input, button, textarea, select, [role="button"]'));
            const clipped = controls.filter(c => {
              const rect = c.getBoundingClientRect();
              if (rect.width === 0 && rect.height === 0) return false;
              return rect.right > winWidth + 1 || rect.left < -1;
            }).map(c => c.id || c.name || c.getAttribute('aria-label') || c.textContent?.trim().slice(0, 30) || 'unnamed');

            return {
              docWidth,
              winWidth,
              clippedControls: clipped,
            };
          })()`,
          returnByValue: true,
        });

        const layoutData = evalRes.result?.value || {
          docWidth: 0,
          winWidth: vp.width,
          clippedControls: [],
        };

        const evalStatus = evaluateViewportLayout({
          innerWidth: layoutData.winWidth,
          scrollWidth: layoutData.docWidth,
          clippedControls: layoutData.clippedControls,
        });

        const vResult: ViewportResult = {
          route,
          viewport: vp,
          status: evalStatus.status,
          innerWidth: layoutData.winWidth,
          scrollWidth: layoutData.docWidth,
          hasHorizontalOverflow: evalStatus.hasHorizontalOverflow,
          clippedControls: layoutData.clippedControls,
          details: evalStatus.details,
        };

        summary.viewportResults.push(vResult);
        if (vResult.status === "FAIL") {
          summary.failures.push(
            `[Viewport FAIL] ${route} at ${vp.name}: ${evalStatus.details}`
          );
        }
      }
    }

    // 7. Route Accessibility & Keyboard Checks
    await cdpClient.send("Emulation.setDeviceMetricsOverride", {
      width: 1024,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // Check 7A: /owner/property/new
    {
      const route = "/owner/property/new";
      await cdpClient.send("Page.navigate", { url: `${options.baseUrl}${route}` });
      await sleep(600);

      interface OwnerFormEval {
        result: {
          value: {
            interactiveElements: {
              tag: string;
              id: string;
              type?: string;
              disabled: boolean;
              hasFocusClasses: boolean;
            }[];
            submitButton: {
              disabled: boolean;
              label: string;
              prerequisitePresent: boolean;
              prerequisiteText?: string;
            };
            invalidMutationResult: {
              targetAriaInvalid: boolean;
              supplyAriaInvalid: boolean;
              priceAriaInvalid: boolean;
              targetDescribedBy: string | null;
              errorAlertId: string | null;
            };
            domIds: string[];
          };
        };
      }

      const formEval = await cdpClient.send<OwnerFormEval>("Runtime.evaluate", {
        expression: `(() => {
          const form = document.querySelector('form[aria-label="Property details"]');
          if (!form) return null;

          const controls = Array.from(form.querySelectorAll('button, input, textarea'));
          const interactiveElements = controls.map(el => ({
            tag: el.tagName.toLowerCase(),
            id: el.id || el.name || el.textContent?.trim().slice(0, 30) || 'unnamed',
            type: el.type,
            disabled: el.disabled,
            hasFocusClasses: el.className.includes('focus') || el.className.includes('ring') || el.className.includes('outline'),
          }));

          const submitBtn = Array.from(form.querySelectorAll('button')).find(b => b.textContent?.includes('Register property'));
          const submitContainer = submitBtn ? submitBtn.closest('span') || submitBtn.parentElement : null;
          const submitButton = {
            disabled: submitBtn ? submitBtn.disabled : false,
            label: submitBtn ? submitBtn.textContent?.trim() : '',
            prerequisitePresent: submitContainer ? submitContainer.textContent?.includes('owner wallet on Arbitrum Sepolia') || false : false,
            prerequisiteText: submitContainer ? submitContainer.textContent?.trim() : '',
          };

          // Mutate tokenPrice to trigger invariant error using React native setter
          const priceInput = form.querySelector('#tokenPrice');
          let invalidMutationResult = {
            targetAriaInvalid: false,
            supplyAriaInvalid: false,
            priceAriaInvalid: false,
            targetDescribedBy: null,
            errorAlertId: null,
          };

          if (priceInput) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(priceInput, "9999");
            } else {
              priceInput.value = "9999";
            }
            priceInput.dispatchEvent(new Event('input', { bubbles: true }));
            priceInput.dispatchEvent(new Event('change', { bubbles: true }));

            const targetInput = form.querySelector('#offeringTarget');
            const supplyInput = form.querySelector('#tokenSupply');
            const alertEl = form.querySelector('#offering-invariant-error');

            invalidMutationResult = {
              targetAriaInvalid: targetInput?.getAttribute('aria-invalid') === 'true',
              supplyAriaInvalid: supplyInput?.getAttribute('aria-invalid') === 'true',
              priceAriaInvalid: priceInput?.getAttribute('aria-invalid') === 'true',
              targetDescribedBy: targetInput?.getAttribute('aria-describedby'),
              errorAlertId: alertEl ? alertEl.id : null,
            };

            // Reset back
            const resetBtn = Array.from(form.querySelectorAll('button')).find(b => b.textContent?.includes('Reset'));
            if (resetBtn) {
              resetBtn.click();
            }
          }

          const domIds = Array.from(document.querySelectorAll('[id]')).map(el => el.id);

          return {
            interactiveElements,
            submitButton,
            invalidMutationResult,
            domIds,
          };
        })()`,
        returnByValue: true,
      });

      const formData = formEval.result?.value;
      const routeFailures: string[] = [];

      if (!formData) {
        routeFailures.push("Property details form not found on page.");
      }

      const elements = formData?.interactiveElements || [];
      const tabOrderCheck = validateTabOrder(EXPECTED_OWNER_FORM_ORDER, elements);
      if (!tabOrderCheck.valid) {
        routeFailures.push(...tabOrderCheck.failures);
      }

      // Check focus classes on non-disabled interactive elements
      const focusClassesCheck = elements
        .filter((el) => !el.disabled)
        .every((el) => el.hasFocusClasses);
      if (!focusClassesCheck) {
        routeFailures.push("One or more active form controls lack visible focus classes.");
      }

      const actionCheck = validateActionPrerequisite(
        formData?.submitButton || {
          disabled: false,
          label: "Register property",
          prerequisitePresent: false,
        },
        OWNER_REGISTRATION_PREREQUISITE
      );
      if (!actionCheck.valid) {
        routeFailures.push(...actionCheck.failures);
      }

      const mutation = formData?.invalidMutationResult;
      const ariaValid =
        mutation?.targetAriaInvalid === true &&
        mutation?.supplyAriaInvalid === true &&
        mutation?.priceAriaInvalid === true &&
        mutation?.targetDescribedBy?.includes("offering-invariant-error") === true &&
        mutation?.errorAlertId === "offering-invariant-error";

      if (!ariaValid) {
        routeFailures.push(
          "Invariant failure does not correctly set aria-invalid and aria-describedby pointing to #offering-invariant-error."
        );
      }

      const accessResult: RouteAccessibilityResult = {
        route,
        status: routeFailures.length === 0 ? "PASS" : "FAIL",
        tabOrderValid: tabOrderCheck.valid,
        visibleFocusValid: focusClassesCheck,
        ariaAssociationsValid: ariaValid,
        disabledActionValid: actionCheck.valid,
        interactiveElements: elements,
        ariaChecks: [
          {
            fieldId: "offeringTarget",
            hasAriaInvalid: mutation?.targetAriaInvalid || false,
            ariaDescribedBy: mutation?.targetDescribedBy || null,
            targetElementsExist: mutation?.errorAlertId !== null,
          },
        ],
        actionChecks: [
          {
            label: formData?.submitButton.label || "Register property",
            disabled: formData?.submitButton.disabled || false,
            prerequisitePresent: formData?.submitButton.prerequisitePresent || false,
            prerequisiteText: formData?.submitButton.prerequisiteText,
          },
        ],
        failures: routeFailures,
      };

      summary.routeAccessibilityResults.push(accessResult);
      if (accessResult.status === "FAIL") {
        summary.failures.push(
          `[Accessibility FAIL] ${route}: ${routeFailures.join("; ")}`
        );
      }
    }

    // Check 7B: /property/ARCHPROP-001
    {
      const route = "/property/ARCHPROP-001";
      await cdpClient.send("Page.navigate", { url: `${options.baseUrl}${route}` });
      await sleep(600);

      interface InvestPanelEval {
        result: {
          value: {
            interactiveElements: {
              tag: string;
              id: string;
              type?: string;
              disabled: boolean;
              hasFocusClasses: boolean;
            }[];
            presetChips: {
              label: string;
              ariaPressed: string | null;
            }[];
            investButton: {
              disabled: boolean;
              label: string;
              prerequisitePresent: boolean;
              prerequisiteText?: string;
            };
            invalidInputResult: {
              amountAriaInvalid: boolean;
              amountDescribedBy: string | null;
              errorAlertId: string | null;
            };
            domIds: string[];
          };
        };
      }

      const panelEval = await cdpClient.send<InvestPanelEval>("Runtime.evaluate", {
        expression: `(() => {
          const panel = document.querySelector('[aria-label="Investment preview"]');
          if (!panel) return null;

          const controls = Array.from(panel.querySelectorAll('button, input'));
          const interactiveElements = controls.map(el => ({
            tag: el.tagName.toLowerCase(),
            id: el.id || el.textContent?.trim().slice(0, 30) || 'unnamed',
            type: el.type,
            disabled: el.disabled,
            hasFocusClasses: el.className.includes('focus') || el.className.includes('outline'),
          }));

          const presetButtons = Array.from(panel.querySelectorAll('div.flex.flex-wrap button, button[aria-pressed]'));
          const presetChips = presetButtons.map(b => ({
            label: b.textContent?.trim() || '',
            ariaPressed: b.getAttribute('aria-pressed'),
          }));

          const investBtn = Array.from(panel.querySelectorAll('button')).find(b => b.textContent?.includes('Invest in'));
          const investContainer = investBtn ? investBtn.closest('span') || investBtn.parentElement : null;
          const investButton = {
            disabled: investBtn ? investBtn.disabled : false,
            label: investBtn ? investBtn.textContent?.trim() : '',
            prerequisitePresent: investContainer ? investContainer.textContent?.includes('investor wallet on Arbitrum Sepolia') || false : false,
            prerequisiteText: investContainer ? investContainer.textContent?.trim() : '',
          };

          // Mutate amount to invalid divisible value using React native setter
          const amountInput = panel.querySelector('#investment-amount');
          let invalidInputResult = {
            amountAriaInvalid: false,
            amountDescribedBy: null,
            errorAlertId: null,
          };

          if (amountInput) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(amountInput, "123456");
            } else {
              amountInput.value = "123456";
            }
            amountInput.dispatchEvent(new Event('input', { bubbles: true }));
            amountInput.dispatchEvent(new Event('change', { bubbles: true }));

            const errorEl = panel.querySelector('#investment-error');
            invalidInputResult = {
              amountAriaInvalid: amountInput.getAttribute('aria-invalid') === 'true',
              amountDescribedBy: amountInput.getAttribute('aria-describedby'),
              errorAlertId: errorEl ? errorEl.id : null,
            };

            // Reset back to 1M preset
            if (presetButtons[0]) {
              presetButtons[0].click();
            }
          }

          const domIds = Array.from(document.querySelectorAll('[id]')).map(el => el.id);

          return {
            interactiveElements,
            presetChips,
            investButton,
            invalidInputResult,
            domIds,
          };
        })()`,
        returnByValue: true,
      });

      const panelData = panelEval.result?.value;
      const routeFailures: string[] = [];

      if (!panelData) {
        routeFailures.push("Investment preview panel not found on page.");
      }

      const elements = panelData?.interactiveElements || [];
      const tabOrderCheck = validateTabOrder(EXPECTED_INVESTMENT_PANEL_ORDER, elements);
      if (!tabOrderCheck.valid) {
        routeFailures.push(...tabOrderCheck.failures);
      }

      // Check focus classes on active controls
      const focusClassesCheck = elements
        .filter((el) => !el.disabled)
        .every((el) => el.hasFocusClasses);
      if (!focusClassesCheck) {
        routeFailures.push("One or more active investment panel controls lack visible focus classes.");
      }

      const presetCheck = validatePresetChips(
        panelData?.presetChips || [],
        "1M mIDR (100 tokens)"
      );
      if (!presetCheck.valid) {
        routeFailures.push(...presetCheck.failures);
      }

      const actionCheck = validateActionPrerequisite(
        panelData?.investButton || {
          disabled: false,
          label: "Invest in AVNUSA",
          prerequisitePresent: false,
        },
        INVESTMENT_PREREQUISITE
      );
      if (!actionCheck.valid) {
        routeFailures.push(...actionCheck.failures);
      }

      const invalidInput = panelData?.invalidInputResult;
      const ariaDescribedByCheck = validateAriaDescribedByTargets(
        invalidInput?.amountDescribedBy || null,
        panelData?.domIds || []
      );
      if (!ariaDescribedByCheck.valid) {
        routeFailures.push(
          `Investment error aria-describedby references missing DOM targets: [${ariaDescribedByCheck.missingTargets.join(", ")}]`
        );
      }

      const accessResult: RouteAccessibilityResult = {
        route,
        status: routeFailures.length === 0 ? "PASS" : "FAIL",
        tabOrderValid: tabOrderCheck.valid,
        visibleFocusValid: focusClassesCheck,
        ariaAssociationsValid: ariaDescribedByCheck.valid && invalidInput?.amountAriaInvalid === true,
        disabledActionValid: actionCheck.valid,
        presetChipsValid: presetCheck.valid,
        interactiveElements: elements,
        ariaChecks: [
          {
            fieldId: "investment-amount",
            hasAriaInvalid: invalidInput?.amountAriaInvalid || false,
            ariaDescribedBy: invalidInput?.amountDescribedBy || null,
            targetElementsExist: ariaDescribedByCheck.valid,
          },
        ],
        actionChecks: [
          {
            label: panelData?.investButton.label || "Invest in AVNUSA",
            disabled: panelData?.investButton.disabled || false,
            prerequisitePresent: panelData?.investButton.prerequisitePresent || false,
            prerequisiteText: panelData?.investButton.prerequisiteText,
          },
        ],
        presetChecks: panelData?.presetChips,
        failures: routeFailures,
      };

      summary.routeAccessibilityResults.push(accessResult);
      if (accessResult.status === "FAIL") {
        summary.failures.push(
          `[Accessibility FAIL] ${route}: ${routeFailures.join("; ")}`
        );
      }
    }

    summary.overallStatus = summary.failures.length === 0 ? "PASS" : "FAIL";
    return summary;
  } finally {
    if (cdpClient) {
      cdpClient.close();
    }
    if (chromeProcess) {
      chromeProcess.kill("SIGTERM");
      setTimeout(() => {
        try {
          chromeProcess?.kill("SIGKILL");
        } catch {
          // Already exited
        }
      }, 500).unref();
    }
  }
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("browser-smoke.ts") ||
    process.argv[1].endsWith("browser-smoke.js"))
) {
  const options = parseCliArgs(process.argv.slice(2));

  runBrowserSmokeCheck(options)
    .then((summary) => {
      console.log(formatSmokeReport(summary));
      if (summary.overallStatus === "PASS") {
        process.exit(0);
      } else if (summary.overallStatus === "BLOCKED") {
        process.exit(2);
      } else {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("Unexpected error executing browser smoke check:", err);
      process.exit(1);
    });
}
