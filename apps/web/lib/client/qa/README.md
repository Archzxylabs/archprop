# Frontend Browser Smoke Check (QA)

Reproducible, zero-dependency browser smoke check for verifying responsive viewport layouts and keyboard/accessibility contracts on `@archprop/web`.

## Scope

Validates `/owner/property/new` and `/property/ARCHPROP-001`:
1. **Responsive Viewports**: Tests widths `320px`, `375px`, `768px`, `1024px`, and `1440px`.
   - Ensures no document-level horizontal overflow (`scrollWidth <= innerWidth + 1`).
   - Ensures no interactive controls (buttons, inputs, links) are clipped outside the viewport bounds.
2. **Keyboard Reachability & Order**:
   - Sequential tab navigation order on the owner property form and investment panel.
   - Visible focus styling present on all interactive inputs and buttons.
3. **Screen-Reader & ARIA Relationships**:
   - Preset chips provide explicit selection state via `aria-pressed="true"` / `aria-pressed="false"`.
   - Field errors set `aria-invalid="true"` and associate with `role="alert"` messages via `aria-describedby`.
   - Multi-field error associations (e.g. `offering-invariant-error` across target, supply, and price).
4. **Action Prerequisite Locks**:
   - Unwired blockchain action buttons ("Register property", "Invest in AVNUSA") remain strictly disabled (`disabled: true`).
   - Action buttons display clear missing prerequisite messages rather than simulating transaction state.

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

- `0` (`PASS`): All viewport checks and accessibility assertions passed.
- `1` (`FAIL`): Real layout or accessibility defect detected (overflow, clipped control, incorrect tab order, missing ARIA attribute, or prematurely enabled action).
- `2` (`BLOCKED`): Prerequisite unavailable (local web server unreachable or Chromium executable missing). An unexecuted check is never marked as `PASS`.

## Unit Tests

Pure helper logic (CLI parsing, layout calculations, tab order verification, ARIA relationship validation) is unit-tested with Vitest:

```bash
pnpm --filter @archprop/web test
```
