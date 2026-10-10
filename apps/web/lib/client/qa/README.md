# Frontend Browser Smoke Check (QA)

Reproducible, zero-dependency browser smoke check for verifying responsive viewport layouts and keyboard/accessibility contracts on `@archprop/web`.

> [!NOTE]
> This is a focused smoke test designed to catch layout overflow, clipping, keyboard navigation breaks, and missing prerequisite states. It is **not** a complete WCAG audit, full assistive technology test, or screenshot-based visual regression suite.

## Scope & Implementation Details

Validates `/owner/property/new` and `/property/ARCHPROP-001` with fail-closed assertions:

1. **Responsive Viewports (Fail-Closed Layout Evaluation)**:
   - Evaluates widths `320px`, `375px`, `768px`, `1024px`, and `1440px`.
   - Requires valid, positive, finite `innerWidth` and document `scrollWidth` from the browser. Never substitutes `0` or ignores runtime exceptions.
   - Verifies no document-level horizontal overflow (`scrollWidth <= innerWidth + 1`).
   - Verifies that zero active interactive controls (buttons, inputs, links) are clipped outside the viewport bounds (`rect.right > winWidth + 1` or `rect.left < -1`).

2. **Real CDP-Driven Keyboard Navigation**:
   - Dispatches actual browser `Tab` key events (`Input.dispatchKeyEvent` with `key: "Tab"`) sequentially through Chrome DevTools Protocol.
   - Inspects `document.activeElement` after each Tab step to verify the exact enabled control receives focus in order.
   - Confirms that disabled action buttons are excluded from the enabled tab sequence and do not receive tab focus.

3. **Observable Focus Indicators**:
   - Inspects actual computed styles (`window.getComputedStyle`) on focused controls.
   - Verifies browser-observable focus indicators: computed outline (`outlineStyle !== "none"`, `outlineWidth > 0`), computed focus ring (`boxShadow` containing ring spread), or brand focus border color.
   - Rejects passive class-name checks alone as insufficient evidence.

4. **Screen-Reader & ARIA Relationships**:
   - Preset chips provide explicit toggle feedback via `aria-pressed="true"` / `aria-pressed="false"`.
   - Field errors set `aria-invalid="true"` and associate with `role="alert"` messages via `aria-describedby`.
   - Multi-field error associations (e.g. `offering-invariant-error` across target, supply, and price) verify target DOM element existence.

5. **Action Prerequisite Locks**:
   - Unwired blockchain action buttons ("Register property", "Invest in AVNUSA") remain strictly disabled (`disabled: true`).
   - Displays explicit missing prerequisite disclosures rather than simulating transaction state.

## Prerequisites

- Local web server running (e.g. `pnpm --filter @archprop/web exec next start -p <port>`).
- Chromium or Google Chrome binary available locally.

## Usage

### Direct Execution

```bash
# Explicit base URL and Chromium path:
node apps/web/lib/client/qa/browser-smoke.ts \
  --base-url http://localhost:33145 \
  --chromium-path /home/pupulion/.local/bin/chromium

# Or using environment variables:
ARCHPROP_BASE_URL=http://localhost:33145 \
CHROME_PATH=/home/pupulion/.local/bin/chromium \
node apps/web/lib/client/qa/browser-smoke.ts
```

### CLI Arguments

- `--base-url`, `-u`: Base URL of the running Next.js application (default: `http://localhost:3000`).
- `--chromium-path`, `--chrome-path`, `-c`: Path to the Chromium or Google Chrome executable (default: auto-detected in standard system paths).
- `--debug-port`, `-p`: Starting port for Chrome DevTools Protocol (default: `9222`, automatically probes for available port).
- `--timeout`, `-t`: Timeout in milliseconds for navigation and connection (default: `15000`).
- `--verbose`, `-v`: Enable verbose logging.

## Exit Codes

- `0` (`PASS`): All 10 viewport checks, actual CDP tab navigation steps, focus indicators, and accessibility assertions passed.
- `1` (`FAIL`): Verified defect or invalid result (layout overflow, clipped control, tab sequence mismatch, missing focus indicator, failed navigation, or HTTP 4xx/5xx).
- `2` (`BLOCKED`): Prerequisite unavailable (local web server unreachable or Chromium executable missing). An unexecuted check is never marked as `PASS`.

## Unit Tests

Pure helper logic (CLI parsing, fail-closed layout validation, tab-step evaluation, ARIA relationship validation) is unit-tested with Vitest:

```bash
pnpm --filter @archprop/web test
```
