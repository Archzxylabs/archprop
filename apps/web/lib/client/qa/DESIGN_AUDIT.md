# Archcore → Archprop design audit

Task: UI-001 / Archcore design adaptation. Scope: frontend presentation only.
Reference: `/home/haikaru/Archverse/Lab/archcore-marketplace`.

The complete 3,379-line reference stylesheet is retained in
`apps/web/styles/archcore.css`, preceded only by a provenance comment. Archprop
content and route-specific extensions are isolated in `archprop.css`; semantic
Tailwind tokens map existing workspaces to the same design. The reference repo
is read-only and no dependency change is needed.

## Visual system

| Reference system | Source specification | Archprop application |
| --- | --- | --- |
| Palette | Black `#000000`, white `#ffffff`, Robin Neon `#ccff00`; original alpha values, gradients, lines and glows | Original CSS preserved; teal brand tokens replaced. Existing red error/rejection semantics retained for actionable failure feedback. |
| Display type | Space Grotesk 400/500/600/700; tight negative tracking; fluid oversized headings | All headings, branding, numbers and wordmark |
| Body type | DM Sans 400/500/600/700 | All routes, cards, navigation and forms |
| Utility type | IBM Plex Mono 400/500/600; 10–11px uppercase labels and tracked captions | Eyebrows, HUD, progress counters, hashes, disclosure and metadata |
| Fonts | Original reference Google Fonts families and weights | Locally hosted font files with OFL licenses; no runtime third-party font dependency |
| Navigation | Fixed floating capsule, white translucent surface, blur, shadow, four-tile mark, lime CTA, hamburger morph | Six existing routes and real wallet controls; compact navigation through 1279px |
| Hero | Sticky 440vh story; four chapters; grid, glow, illustrated object, orbit rings, HUD and chapter controls | Property → verification → economic rights → proof |
| Marquee | Solid and outlined type, star/dot separators, opposing tracks | Property, evidence, participation, Villa Nusa and Bali |
| Portal | Sticky 420vh black chapter, circular opening, neon particle field and three text panels | Evidence → participation → visible proof |
| Catalog | Rounded image cards, category labels, specifications, lime price strip, pill filters and arrows | Three frozen demo listings; illustrative architecture, published terms and truthful funding states |
| How it works | Lime surface, sticky introduction, numbered scrolling timeline, white and black illustrative flow cards | Independent evidence → agreement → escrow and receipt-backed actions |
| Provider section | Black inset panel, reusable object, lime rings/nodes, parallax art and statistics | Owner entry point, four wizard stages and two mandatory attestations |
| FAQ | Sticky introduction, three numbered groups, timeline rail, accordion plus-to-cross interaction | Economic rights, demo funding and synthetic evidence |
| Closing CTA | Centered large heading, lime capsule CTA | Explore Properties |
| Footer | Black surface, oversized gradient wordmark, navigation, legal/demo copy and back-to-top | ARCHPROP branding, existing routes, Arbitrum Sepolia and mIDR disclosure |
| Drawer | Blurred backdrop, right-edge white panel, circular close, range control and price breakdown | Illustrative AVNUSA calculation; never a reservation or transaction |
| Workspace extension | Reference type, capsules, borders, radii, form treatments and surfaces | Owner, verifier, portfolio, admin, owner details and six ordered property sections |
| Responsive behavior | Source 1180, 900 and 380px breakpoints, plus source short-height rules | Preserved; extra workspace breakpoints at 1280/1100/640px and a compact owner wizard |

## Motion inventory

| Motion | Original timing or choreography | Implementation |
| --- | --- | --- |
| Boot | 1180ms ease-out cubic percentage; 700ms fade | Presentation-only boot, pointer-transparent; skipped for reduced motion |
| Reading progress | Fixed 3px line, left-origin scale | All routes |
| Header | Down-scroll hide after 170px; `translateY(-125%)`; 600ms cubic-bezier | Preserved; open menu, keyboard focus and reduced motion keep it visible |
| Buttons / links | 350ms cubic-bezier lift by 3px, shadows; arrow translation | Original CSS |
| Hero text | Blur 9px, vertical entrance 42px; opacity 650ms, transform 800ms, blur 700ms | Four scroll-driven chapters with inert inactive controls |
| Hero scene | Scroll rotation 2.95 radians; pointer easing 8/s, progress smoothing 7/s; idle bob; layered disassembly and tether lines | Procedural projected villa replaces the GPU; no Three.js dependency or unrelated compute content |
| Assembly / particles | Assembly .12–.31 / .61–.78; orbit-to-burst .15–.34 / .55–.72 | Same progress windows, architectural roof layers and ambient particles |
| Orbit rings / scroll cue | 16s and 23s opposing orbits; original cue keyframe | Original CSS |
| Marquee | 32s forward / 38s reverse | Original CSS |
| Portal | Expansion begins before sticky entry; expansion endpoint .12; exit .82–.98; smoothstep circular opening; exit scale +.5 | Reference portal controller ported with disposal, capped DPR and visibility gating |
| Portal text | Original opacity, scale and blur entrances; three progress windows | Evidence, participation and proof panels |
| Portal particles | 420/980 streaks and 100/240 dust motes; scroll impulse and original neon/white alpha values | Reference canvas renderer |
| Horizontal catalog | Scroll distance = travel × 2.35 + 260px; scroll-linked progress; desktop arrows; mobile swipe | Three cards use a wider desktop footprint to preserve horizontal travel; filters reset the chapter |
| Catalog card reveal | Threshold .3; opacity .52, 24px lift, scale .965, blur 1.5px; 550ms entrance; 8px hover lift | Original CSS and intersection observer |
| Section reveal | Threshold .1, bottom root margin -8%; lift 38px / blur 7px; 700–800ms | Catalog, provider, closing CTA and workspace sections |
| How timeline | Focus line 52% viewport; active number and progress rail; 64px card lift with .45→1 opacity | Same source calculations |
| FAQ timeline | Focus line 40% viewport; matching 64px lift and counters | Same source calculations, recalculated after accordion toggles |
| Accordion | 300ms circular plus rotation by 45° | Original CSS and native details/summary |
| Owner art | Scroll-linked ±47.5px vertical parallax | Same source calculation |
| Terminal caret | 1s stepped blink | Educational process explainer, explicitly not live transaction output |
| Footer | 78px scroll-linked wordmark rise | Same source calculation |
| Drawer | 450ms cubic-bezier entrance from right | Native modal dialog, focus containment, Escape and focus restoration |
| Menu icon | 300ms line morph | Two-line hamburger / cross |

## Intentional content adaptations

- GPU hardware is replaced with an original villa model and three original SVG
  architectural concepts. The motion categories and source palette remain;
  model geometry, rendering engine and particle density are adapted to property
  imagery. All illustrations are labeled synthetic/illustrative.
- The catalog has the three required properties, rather than the reference's GPU
  inventory. Desktop card width expands to retain horizontal scrolling.
- The estimate uses frozen Villa Nusa terms. It clearly states that the result
  is only a calculation and never submits, reserves, approves or invests.
- Existing workspace routes inherit the reference system even though Archcore
  only defines a landing page and drawer. Property section order remains
  overview, verification, economic rights, offering, on-chain proof, revenue.
- Reduced motion shows every story/portal chapter as readable static content,
  disables ambient animation and removes long empty sticky scroll. A no-script
  stylesheet also presents every chapter, with a static illustration fallback.
- Missing chain configuration is presented in the catalog as unavailable live
  funding, without exposing environment variable names in the product card.
  The underlying chain state and all investment guards remain unchanged.

## Interface compliance

No edits to contracts, ABIs, shared types/constants, API handlers, server code,
Supabase, dependency manifests, frozen docs or root configuration. Existing
wallet connection, chain validation, live investor read/write hooks, receipt
confirmation and missing-prerequisite guards remain intact. No testnet write,
deployment or fabricated economic state is introduced.

## Validation

Validation results are recorded below after the final frontend gates and
browser review. Browser artifacts are local review output, not published assets.

The existing dependency-free browser check remains available:

```sh
node apps/web/lib/client/qa/browser-smoke.ts \
  --base-url http://localhost:3100 \
  --chromium-path /path/to/chromium
```

`design-smoke.mjs` additionally checks all ten routes at 320, 375, 768, 1024
and 1440 pixels; actual hero/portal chapter changes; horizontal catalog travel;
filters; range interaction; native-dialog focus and Escape; the mobile menu;
reduced-motion rendering; and JavaScript-free navigation/content. It uses an
optional external Playwright installation, so product dependencies stay frozen.

```sh
npm install --prefix /tmp/archprop-design-qa playwright --no-audit --no-fund
ARCHPROP_PLAYWRIGHT_MODULE=/tmp/archprop-design-qa/node_modules/playwright/index.mjs \
ARCHPROP_BASE_URL=http://localhost:3100 \
CHROME_PATH=/path/to/chromium \
node apps/web/lib/client/qa/design-smoke.mjs
```

By default, screenshots and JSON evidence go to the operating system temp
folder `archprop-design-review`. Override with `ARCHPROP_DESIGN_OUTPUT`.

### Executed results — 10 October 2026

| Gate | Result |
| --- | --- |
| `pnpm --filter @archprop/web test` | PASS — 473 tests across 22 files |
| `pnpm --filter @archprop/web typecheck` | PASS |
| `pnpm --filter @archprop/web lint` | PASS — zero errors; two pre-existing warnings in the frozen ESLint/PostCSS config files |
| `pnpm --filter @archprop/web build` | PASS — default Turbopack production build |
| `pnpm --filter @archprop/web exec next build --webpack` | PASS — additional Webpack production build |
| Existing `browser-smoke.ts`, production server | PASS — ten viewport checks, zero clipped controls, real Tab order, visible focus, ARIA associations and disabled prerequisite guards |
| `design-smoke.mjs`, production server | PASS — all ten routes at five widths (50 checks), zero horizontal overflow, zero browser page errors |
| Design interactions | PASS — four hero chapters, three portal chapters, horizontal catalog movement, filters, estimator range, dialog focus containment/Escape and restored scroll, mobile menu/Escape, reduced-motion FAQ and every static story chapter |
| JavaScript disabled | PASS — six navigation links, all four readable hero chapters, static villa fallback, no horizontal overflow at 375px |
| CSS source parity | PASS — exact copy of all 3,379 reference CSS lines, after the provenance comment |
| Scope / whitespace review | PASS — all changes frontend-owned; no API/server/shared/dependency changes; `git diff --check` clean |

Screenshots were reviewed for desktop and mobile hero, chapter transitions,
portal, catalog, marketplace, estimate and workspace presentation. Local QA
artifacts are disposable and are excluded from the commit.

### Remaining product limits

This handoff completes the design adaptation, not the unfinished live golden
path. Shared Arbitrum Sepolia and Supabase services are not configured for this
review. Existing owner, verifier, portfolio and operator integration gaps remain
as documented in `docs/FRONTEND_HANDOFF.md`; unavailable actions stay locked.
Live wallet/RPC transactions and on-chain receipts were not exercised. No shared
chain deployment, repository push or publication was performed.
