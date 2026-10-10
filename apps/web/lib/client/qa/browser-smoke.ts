#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createServer } from "node:net";
// @ts-expect-error Node TS execution requires .ts extension in imports
import { evaluateTabStep, evaluateViewportLayout, EXPECTED_INVESTMENT_PANEL_ENABLED_TAB_SEQUENCE, EXPECTED_OWNER_FORM_ENABLED_TAB_SEQUENCE, formatSmokeReport, INVESTMENT_PREREQUISITE, OWNER_REGISTRATION_PREREQUISITE, parseCliArgs, STANDARD_VIEWPORTS, TARGET_ROUTES, validateActionPrerequisite, validateAriaDescribedByTargets, validatePresetChips } from "./smoke-helpers.ts";
import type { ActiveElementFocusInfo, CliOptions, RouteAccessibilityResult, SmokeSummary, TabStepResult, ViewportResult } from "./types.ts";

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

const CHROMIUM_CANDIDATE_PATHS = [
  "/home/pupulion/.local/bin/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/chrome",
  "/usr/bin/google-chrome-stable",
];

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

async function sendTabKey(cdpClient: CdpClient): Promise<void> {
  await cdpClient.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
    macCharCode: 9,
    unmodifiedText: "\t",
    text: "\t",
    code: "Tab",
    key: "Tab",
  });
  await cdpClient.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
    macCharCode: 9,
    unmodifiedText: "\t",
    text: "\t",
    code: "Tab",
    key: "Tab",
  });
  await sleep(60);
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

      // Fail-closed HTTP status verification
      try {
        const routeRes = await fetch(fullUrl, { method: "GET" });
        if (!routeRes.ok) {
          summary.overallStatus = "FAIL";
          const failMsg = `Target route ${route} returned HTTP ${routeRes.status} ${routeRes.statusText}`;
          summary.failures.push(failMsg);
          return summary;
        }
      } catch (err: unknown) {
        summary.overallStatus = "FAIL";
        const failMsg = `Failed to fetch target route ${route}: ${err instanceof Error ? err.message : String(err)}`;
        summary.failures.push(failMsg);
        return summary;
      }

      const navRes = await cdpClient.send<{ errorText?: string }>("Page.navigate", { url: fullUrl });
      if (navRes.errorText) {
        summary.overallStatus = "FAIL";
        const failMsg = `CDP navigation to ${route} failed: ${navRes.errorText}`;
        summary.failures.push(failMsg);
        return summary;
      }
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
          result?: {
            value?: {
              docWidth: number;
              winWidth: number;
              clippedControls: string[];
            };
          };
          exceptionDetails?: {
            text?: string;
            exception?: { description?: string };
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

        // Fail-closed handling for missing or exceptional evaluation results
        if (evalRes.exceptionDetails) {
          const detailMsg =
            evalRes.exceptionDetails.text ||
            evalRes.exceptionDetails.exception?.description ||
            "Evaluation exception";
          const failMsg = `[Viewport FAIL] ${route} at ${vp.name}: CDP Runtime exception (${detailMsg})`;
          summary.failures.push(failMsg);
          summary.viewportResults.push({
            route,
            viewport: vp,
            status: "FAIL",
            innerWidth: vp.width,
            scrollWidth: 0,
            hasHorizontalOverflow: false,
            clippedControls: [],
            details: `CDP evaluation threw exception: ${detailMsg}`,
          });
          continue;
        }

        const rawLayout = evalRes.result?.value;
        const evalStatus = evaluateViewportLayout({
          innerWidth: rawLayout?.winWidth,
          scrollWidth: rawLayout?.docWidth,
          clippedControls: rawLayout?.clippedControls,
        });

        const vResult: ViewportResult = {
          route,
          viewport: vp,
          status: evalStatus.status,
          innerWidth: typeof rawLayout?.winWidth === "number" ? rawLayout.winWidth : vp.width,
          scrollWidth: typeof rawLayout?.docWidth === "number" ? rawLayout.docWidth : 0,
          hasHorizontalOverflow: evalStatus.hasHorizontalOverflow,
          clippedControls: Array.isArray(rawLayout?.clippedControls) ? rawLayout.clippedControls : [],
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

    // 7. Route Accessibility & CDP-Driven Tab Navigation
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

      const routeFailures: string[] = [];
      const tabSteps: TabStepResult[] = [];

      // Step A: Focus the element preceding the property form in tab order
      interface FocusPrepEval {
        result?: {
          value?: {
            focusedPreceding: boolean;
            precedingId: string;
            precedingTag: string;
          };
        };
      }

      const focusPrep = await cdpClient.send<FocusPrepEval>("Runtime.evaluate", {
        expression: `(() => {
          const form = document.querySelector('form[aria-label="Property details"]');
          if (!form) return null;
          const firstControl = form.querySelector('button, input, textarea');
          if (!firstControl) return null;

          const allFocusables = Array.from(document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled])'));
          const idx = allFocusables.indexOf(firstControl);
          if (idx > 0) {
            allFocusables[idx - 1].focus();
            return {
              focusedPreceding: true,
              precedingId: allFocusables[idx - 1].id || allFocusables[idx - 1].textContent?.trim().slice(0, 20) || '',
              precedingTag: allFocusables[idx - 1].tagName,
            };
          } else {
            document.body.focus();
            return {
              focusedPreceding: true,
              precedingId: 'body',
              precedingTag: 'BODY',
            };
          }
        })()`,
        returnByValue: true,
      });

      if (!focusPrep.result?.value?.focusedPreceding) {
        routeFailures.push("Unable to initialize keyboard tab navigation before property details form.");
      }

      // Step B: Drive actual Tab key presses and verify each enabled control in sequence
      for (let i = 0; i < EXPECTED_OWNER_FORM_ENABLED_TAB_SEQUENCE.length; i++) {
        const expectedControl = EXPECTED_OWNER_FORM_ENABLED_TAB_SEQUENCE[i]!;
        await sendTabKey(cdpClient);

        interface ActiveElementEval {
          result?: {
            value?: ActiveElementFocusInfo;
          };
          exceptionDetails?: { text?: string };
        }

        const activeEval = await cdpClient.send<ActiveElementEval>("Runtime.evaluate", {
          expression: `(() => {
            const el = document.activeElement;
            if (!el) return null;
            const cs = window.getComputedStyle(el);
            return {
              tag: el.tagName,
              id: el.id,
              text: el.textContent?.trim().slice(0, 35) || '',
              disabled: el.disabled || false,
              outlineStyle: cs.outlineStyle,
              outlineWidth: cs.outlineWidth,
              boxShadow: cs.boxShadow,
              borderColor: cs.borderColor,
            };
          })()`,
          returnByValue: true,
        });

        const activeElement = activeEval.result?.value || {
          tag: "UNKNOWN",
          id: "",
          text: "",
          disabled: false,
        };

        const stepResult = evaluateTabStep(expectedControl, activeElement, i + 1);
        tabSteps.push(stepResult);

        if (stepResult.failureReason) {
          routeFailures.push(stepResult.failureReason);
        }
      }

      // Step C: Send one more Tab and verify focus does NOT land on the disabled Register button
      await sendTabKey(cdpClient);
      interface PostTabEval {
        result?: {
          value?: {
            activeId: string;
            activeTag: string;
            activeText: string;
          };
        };
      }

      const postTab = await cdpClient.send<PostTabEval>("Runtime.evaluate", {
        expression: `(() => {
          const el = document.activeElement;
          return {
            activeId: el?.id || '',
            activeTag: el?.tagName || '',
            activeText: el?.textContent?.trim().slice(0, 30) || '',
          };
        })()`,
        returnByValue: true,
      });

      if (postTab.result?.value?.activeText.includes("Register property")) {
        routeFailures.push("Disabled action button 'Register property' improperly received tab focus!");
      }

      // Step D: Separately verify disabled action state & prerequisite
      interface SubmitButtonEval {
        result?: {
          value?: {
            disabled: boolean;
            label: string;
            prerequisitePresent: boolean;
            prerequisiteText?: string;
          };
        };
      }

      const submitCheck = await cdpClient.send<SubmitButtonEval>("Runtime.evaluate", {
        expression: `(() => {
          const form = document.querySelector('form[aria-label="Property details"]');
          if (!form) return null;
          const submitBtn = Array.from(form.querySelectorAll('button')).find(b => b.textContent?.includes('Register property'));
          const container = submitBtn ? submitBtn.closest('span') || submitBtn.parentElement : null;
          return {
            disabled: submitBtn ? submitBtn.disabled : false,
            label: submitBtn ? submitBtn.textContent?.trim() : '',
            prerequisitePresent: container ? container.textContent?.includes('owner wallet on Arbitrum Sepolia') || false : false,
            prerequisiteText: container ? container.textContent?.trim() : '',
          };
        })()`,
        returnByValue: true,
      });

      const submitData = submitCheck.result?.value || {
        disabled: false,
        label: "Register property",
        prerequisitePresent: false,
      };

      const actionPrereq = validateActionPrerequisite(submitData, OWNER_REGISTRATION_PREREQUISITE);
      if (!actionPrereq.valid) {
        routeFailures.push(...actionPrereq.failures);
      }

      // Step E: Verify ARIA error relationships upon invalid mutation
      interface MutationEval {
        result?: {
          value?: {
            targetAriaInvalid: boolean;
            supplyAriaInvalid: boolean;
            priceAriaInvalid: boolean;
            targetDescribedBy: string | null;
            errorAlertId: string | null;
            domIds: string[];
          };
        };
      }

      const mutationEval = await cdpClient.send<MutationEval>("Runtime.evaluate", {
        expression: `(() => {
          const form = document.querySelector('form[aria-label="Property details"]');
          if (!form) return null;

          const priceInput = form.querySelector('#tokenPrice');
          if (!priceInput) return null;

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

          const res = {
            targetAriaInvalid: targetInput?.getAttribute('aria-invalid') === 'true',
            supplyAriaInvalid: supplyInput?.getAttribute('aria-invalid') === 'true',
            priceAriaInvalid: priceInput?.getAttribute('aria-invalid') === 'true',
            targetDescribedBy: targetInput?.getAttribute('aria-describedby'),
            errorAlertId: alertEl ? alertEl.id : null,
            domIds: Array.from(document.querySelectorAll('[id]')).map(el => el.id),
          };

          // Reset back via preset button
          const resetBtn = Array.from(form.querySelectorAll('button')).find(b => b.textContent?.includes('Reset'));
          if (resetBtn) resetBtn.click();

          return res;
        })()`,
        returnByValue: true,
      });

      const mutation = mutationEval.result?.value;
      const ariaValid =
        mutation?.targetAriaInvalid === true &&
        mutation?.supplyAriaInvalid === true &&
        mutation?.priceAriaInvalid === true &&
        mutation?.targetDescribedBy?.includes("offering-invariant-error") === true &&
        mutation?.errorAlertId === "offering-invariant-error";

      if (!ariaValid) {
        routeFailures.push(
          "Invariant failure does not correctly set aria-invalid and aria-describedby referencing #offering-invariant-error."
        );
      }

      const ariaTargetCheck = validateAriaDescribedByTargets(
        mutation?.targetDescribedBy || null,
        mutation?.domIds || []
      );
      if (!ariaTargetCheck.valid) {
        routeFailures.push(
          `ARIA targets missing: [${ariaTargetCheck.missingTargets.join(", ")}]`
        );
      }

      const tabSequenceValid = tabSteps.every((s) => s.matchesExpected);
      const visibleFocusValid = tabSteps.every((s) => s.hasObservableFocus);

      const accessResult: RouteAccessibilityResult = {
        route,
        status: routeFailures.length === 0 ? "PASS" : "FAIL",
        tabSequenceValid,
        visibleFocusValid,
        ariaAssociationsValid: ariaValid && ariaTargetCheck.valid,
        disabledActionValid: actionPrereq.valid,
        tabSteps,
        ariaChecks: [
          {
            fieldId: "offeringTarget",
            hasAriaInvalid: mutation?.targetAriaInvalid || false,
            ariaDescribedBy: mutation?.targetDescribedBy || null,
            targetElementsExist: mutation?.errorAlertId !== null,
          },
        ],
        actionChecks: [submitData],
        failures: routeFailures,
      };

      summary.routeAccessibilityResults.push(accessResult);
      if (accessResult.status === "FAIL") {
        summary.failures.push(`[Accessibility FAIL] ${route}: ${routeFailures.join("; ")}`);
      }
    }

    // Check 7B: /property/ARCHPROP-001
    {
      const route = "/property/ARCHPROP-001";
      await cdpClient.send("Page.navigate", { url: `${options.baseUrl}${route}` });
      await sleep(600);

      const routeFailures: string[] = [];
      const tabSteps: TabStepResult[] = [];

      // Step A: Focus the element preceding investment-amount in tab order
      interface FocusPrepPanelEval {
        result?: {
          value?: {
            focusedPreceding: boolean;
            precedingId: string;
          };
        };
      }

      const focusPrep = await cdpClient.send<FocusPrepPanelEval>("Runtime.evaluate", {
        expression: `(() => {
          const amountInput = document.querySelector("#investment-amount");
          if (!amountInput) return null;
          const allFocusables = Array.from(document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])'));
          const idx = allFocusables.indexOf(amountInput);
          if (idx > 0) {
            allFocusables[idx - 1].focus();
            return {
              focusedPreceding: true,
              precedingId: allFocusables[idx - 1].id || allFocusables[idx - 1].textContent?.trim().slice(0, 20) || '',
            };
          }
          return null;
        })()`,
        returnByValue: true,
      });

      if (!focusPrep.result?.value?.focusedPreceding) {
        routeFailures.push("Unable to initialize keyboard tab navigation before investment panel.");
      }

      // Step B: Drive Tab key presses for each enabled control in sequence
      for (let i = 0; i < EXPECTED_INVESTMENT_PANEL_ENABLED_TAB_SEQUENCE.length; i++) {
        const expectedControl = EXPECTED_INVESTMENT_PANEL_ENABLED_TAB_SEQUENCE[i]!;
        await sendTabKey(cdpClient);

        interface ActiveElementEval {
          result?: {
            value?: ActiveElementFocusInfo;
          };
        }

        const activeEval = await cdpClient.send<ActiveElementEval>("Runtime.evaluate", {
          expression: `(() => {
            const el = document.activeElement;
            if (!el) return null;
            const cs = window.getComputedStyle(el);
            return {
              tag: el.tagName,
              id: el.id,
              text: el.textContent?.trim().slice(0, 35) || '',
              disabled: el.disabled || false,
              outlineStyle: cs.outlineStyle,
              outlineWidth: cs.outlineWidth,
              boxShadow: cs.boxShadow,
              borderColor: cs.borderColor,
            };
          })()`,
          returnByValue: true,
        });

        const activeElement = activeEval.result?.value || {
          tag: "UNKNOWN",
          id: "",
          text: "",
          disabled: false,
        };

        const stepResult = evaluateTabStep(expectedControl, activeElement, i + 1);
        tabSteps.push(stepResult);

        if (stepResult.failureReason) {
          routeFailures.push(stepResult.failureReason);
        }
      }

      // Step C: Send one more Tab and verify focus leaves panel (does NOT enter disabled Invest button)
      await sendTabKey(cdpClient);
      interface PostTabPanelEval {
        result?: {
          value?: {
            activeText: string;
          };
        };
      }

      const postTab = await cdpClient.send<PostTabPanelEval>("Runtime.evaluate", {
        expression: `(() => {
          const el = document.activeElement;
          return { activeText: el?.textContent?.trim().slice(0, 30) || '' };
        })()`,
        returnByValue: true,
      });

      if (postTab.result?.value?.activeText.includes("Invest in")) {
        routeFailures.push("Disabled action button 'Invest in AVNUSA' improperly received tab focus!");
      }

      // Step D: Separately verify disabled action state & prerequisite
      interface InvestButtonEval {
        result?: {
          value?: {
            disabled: boolean;
            label: string;
            prerequisitePresent: boolean;
            prerequisiteText?: string;
          };
        };
      }

      const investCheck = await cdpClient.send<InvestButtonEval>("Runtime.evaluate", {
        expression: `(() => {
          const panel = document.querySelector('[aria-label="Investment preview"]');
          if (!panel) return null;
          const investBtn = Array.from(panel.querySelectorAll('button')).find(b => b.textContent?.includes('Invest in'));
          const container = investBtn ? investBtn.closest('span') || investBtn.parentElement : null;
          return {
            disabled: investBtn ? investBtn.disabled : false,
            label: investBtn ? investBtn.textContent?.trim() : '',
            prerequisitePresent: container ? container.textContent?.includes('investor wallet on Arbitrum Sepolia') || false : false,
            prerequisiteText: container ? container.textContent?.trim() : '',
          };
        })()`,
        returnByValue: true,
      });

      const investData = investCheck.result?.value || {
        disabled: false,
        label: "Invest in AVNUSA",
        prerequisitePresent: false,
      };

      const actionPrereq = validateActionPrerequisite(investData, INVESTMENT_PREREQUISITE);
      if (!actionPrereq.valid) {
        routeFailures.push(...actionPrereq.failures);
      }

      // Step E: Preset chips aria-pressed check
      interface PresetEval {
        result?: {
          value?: {
            chips: { label: string; ariaPressed: string | null }[];
          };
        };
      }

      const presetEval = await cdpClient.send<PresetEval>("Runtime.evaluate", {
        expression: `(() => {
          const panel = document.querySelector('[aria-label="Investment preview"]');
          if (!panel) return null;
          const btns = Array.from(panel.querySelectorAll('button[aria-pressed]'));
          return {
            chips: btns.map(b => ({
              label: b.textContent?.trim() || '',
              ariaPressed: b.getAttribute('aria-pressed'),
            })),
          };
        })()`,
        returnByValue: true,
      });

      const chips = presetEval.result?.value?.chips || [];
      const presetCheck = validatePresetChips(chips, "1M mIDR (100 tokens)");
      if (!presetCheck.valid) {
        routeFailures.push(...presetCheck.failures);
      }

      // Step F: Invalid amount error association check
      interface InvalidAmountEval {
        result?: {
          value?: {
            amountAriaInvalid: boolean;
            amountDescribedBy: string | null;
            errorAlertId: string | null;
            domIds: string[];
          };
        };
      }

      const invalidAmountEval = await cdpClient.send<InvalidAmountEval>("Runtime.evaluate", {
        expression: `(() => {
          const panel = document.querySelector('[aria-label="Investment preview"]');
          if (!panel) return null;

          const amountInput = panel.querySelector('#investment-amount');
          if (!amountInput) return null;

          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(amountInput, "123456");
          } else {
            amountInput.value = "123456";
          }
          amountInput.dispatchEvent(new Event('input', { bubbles: true }));
          amountInput.dispatchEvent(new Event('change', { bubbles: true }));

          const errorEl = panel.querySelector('#investment-error');
          const res = {
            amountAriaInvalid: amountInput.getAttribute('aria-invalid') === 'true',
            amountDescribedBy: amountInput.getAttribute('aria-describedby'),
            errorAlertId: errorEl ? errorEl.id : null,
            domIds: Array.from(document.querySelectorAll('[id]')).map(el => el.id),
          };

          // Reset back via first chip
          const firstChip = panel.querySelector('button[aria-pressed]');
          if (firstChip) firstChip.click();

          return res;
        })()`,
        returnByValue: true,
      });

      const invalidAmount = invalidAmountEval.result?.value;
      const ariaTargetCheck = validateAriaDescribedByTargets(
        invalidAmount?.amountDescribedBy || null,
        invalidAmount?.domIds || []
      );
      if (!ariaTargetCheck.valid) {
        routeFailures.push(
          `Investment error aria-describedby references missing targets: [${ariaTargetCheck.missingTargets.join(", ")}]`
        );
      }
      if (invalidAmount?.amountAriaInvalid !== true) {
        routeFailures.push("Amount input does not set aria-invalid='true' when value is not divisible by unit price.");
      }

      const tabSequenceValid = tabSteps.every((s) => s.matchesExpected);
      const visibleFocusValid = tabSteps.every((s) => s.hasObservableFocus);

      const accessResult: RouteAccessibilityResult = {
        route,
        status: routeFailures.length === 0 ? "PASS" : "FAIL",
        tabSequenceValid,
        visibleFocusValid,
        ariaAssociationsValid: ariaTargetCheck.valid && invalidAmount?.amountAriaInvalid === true,
        disabledActionValid: actionPrereq.valid,
        presetChipsValid: presetCheck.valid,
        tabSteps,
        ariaChecks: [
          {
            fieldId: "investment-amount",
            hasAriaInvalid: invalidAmount?.amountAriaInvalid || false,
            ariaDescribedBy: invalidAmount?.amountDescribedBy || null,
            targetElementsExist: ariaTargetCheck.valid,
          },
        ],
        actionChecks: [investData],
        presetChecks: chips,
        failures: routeFailures,
      };

      summary.routeAccessibilityResults.push(accessResult);
      if (accessResult.status === "FAIL") {
        summary.failures.push(`[Accessibility FAIL] ${route}: ${routeFailures.join("; ")}`);
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
          // Process exited
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
