# ARCHPROP Task Board

The orchestrator alone updates status after inspecting the actual branch,
commit, scope, interfaces, and test evidence. `Ready` does not mean dispatched;
the human dispatcher confirms when work starts.

## Dependency graph

```text
ORCH-001 frozen baseline
 ├── SC-001 contract protocol + Foundry tests
 │    └── IQ-002 ABI reconciliation + local golden-path integration
 ├── FE-001 route/component shell
 │    └── FE-002 live wallet/chain integration ─┐
 ├── BE-001 schema/evidence APIs                 ├── INT-001 full integration
 │    └── BE-002A signed chain binding ──────────┤
 │         └── BE-002B verifier evidence access ┤
 │              └── BE-002C evidence discovery ┤
 └── IQ-001 typed adapters/scripts/E2E scaffold ┘
                                                  └── DEP-001 Arbitrum Sepolia
                                                      (human authorization)
```

SC-001, FE-001, BE-001, and IQ-001 are safe to run concurrently because the ABI,
HTTP schemas, runtime variable names, and file ownership are frozen.

| ID | Owner | Owned files | Dependencies | Acceptance / merge gate | Status | Latest commit | Tests | Blockers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ORCH-001 | Orchestrator | docs, shared types, root config | none | frozen contracts/API/types; four clean worktrees | Complete | `integration` | spec/diff/worktree audit | native `.git` is read-only; `/tmp/archprop-git-control` is the control repo |
| SC-001 | Agy #1 | `packages/contracts/**` | ORCH-001 | six contracts; locked ABI/events/invariants; Foundry suite green | Merged | `0acd194` (merge `92c3bd6`) | `forge fmt --check`: pass; fresh `forge build --force --silent`: pass; `forge test --summary`: 105/105 after merge | no code blocker; integration required ignored Foundry `lib/` dependencies copied locally from contract worktree |
| FE-001 | Agy #2 | frontend-owned paths | ORCH-001 | all required routes and state-truthful responsive shell; no fake chain success | Merged | `228e665` | Vitest 55/55; typecheck pass; owned lint clean; full lint 0 errors/2 config warnings; production build pass (9/9 static pages) | no code blocker; independent runtime server blocked by sandbox `listen EPERM`, and no screenshot baseline exists for a visual-regression verdict |
| FE-002A | Agy #2 | frontend-owned paths | FE-001 | interaction-ready property form and investment preview; exact API numeric validation; no fake chain writes | Merged | `92b22d9` (merge `08ded78`) | Vitest 121/121, typecheck and lint pass; webpack build 9/9 after merge | live wallet writes remain gated on IQ-001; Turbopack unavailable under sandbox port `EPERM` |
| FE-002B | Agy #2 | frontend-owned paths | FE-002A merged | browser-verified responsive/accessibility pass for owner form and investment preview without live writes | Merged | `17b3d8f509ebba24f9ffb2a370768637101ddb50` (merge `4b88a2d`) | Independently verified Vitest 127/127, typecheck/lint and webpack build 9/9 after merge; agent-reported CDP viewport 10/10 not independently repeatable here | local server cannot bind in orchestrator sandbox (`EPERM`); live chain writes still gated on IQ-001 |
| FE-002C | Agy #2 | frontend-owned paths | FE-002B merged | reproducible browser smoke for narrow/wide viewports and actual keyboard paths, without new dependencies | Merged | `3fad4e2ceaeb662f4d99c69edd80e4272a122ebe` (merge `f278db3`) | Independently verified frontend Vitest 168/168, typecheck/lint, Webpack build 9/9; integrated Vitest 341/341, typecheck/lint, Webpack build 11/11; agent-reported Chromium viewport/keyboard pass not independently repeatable (`listen EPERM`) | Browser smoke is scoped to viewport/keyboard checks, not a full visual-regression or WCAG audit; no live chain writes |
| BE-001 | Agy #3 | API/server/supabase paths | ORCH-001 | migration/RLS/storage policies; validated property/upload/revenue APIs | Merged; security correction accepted | `0637626624ebe115c195835d61704e3a7e2e83ee` (merge `83f2c8b`) | Independently verified backend Vitest 141/141, integrated web Vitest 268/268, all workspace typechecks, lint 0 errors; agent Turbopack build and integrated Webpack build pass | Live PostgreSQL/Supabase RLS remains untested; integrated Turbopack build blocked by sandbox symlink/root inference, while Webpack build passes |
| IQ-001 | Agy #4 | chain/scripts/e2e/deployment ledger | ORCH-001 | frozen typed ABI/client, fail-closed config, non-deploy scripts, E2E scaffold | Merged | `0fc1fa48321b3b03245b036cfbf0d9719f476a99` (squash `5b8f93a`) | Independently verified chain Vitest 119/119; chain/scripts/e2e typechecks pass; default E2E 31 pass/1 explicit skip; opt-in fails closed without artifacts or Anvil; root integration checks pass | Agent-reported local Anvil golden path 12/12 cannot be repeated in orchestrator sandbox (`listen EPERM`); no shared-chain deployment |
| SC-002 | Agy #1 | `packages/contracts/**` | SC-001 merged | isolated economic-invariant fuzz tests and artifact handoff | Merged | `3b031203cfc17f3731219c776fe06d879d33a9d5` (merge `0f23ef2`) | Independently verified `forge fmt --check`, `forge build --force`, `forge test -vvv`: 112/112 across 9 suites; integration `forge test --summary`: 112/112 | One unused import in new test is a non-blocking lint note; compiled production sources/ABI unchanged |
| SC-003 | Agy #1 | `packages/contracts/test/**` | SC-002 merged | adversarial failed-offering/refund conservation fuzz tests; no ABI changes | Merged | `3586e66b958679f349fedb9997c392b15353025d` (merge `958be24`) | Independently verified `forge fmt --check` and `forge test --summary`: 116/116 after merge | no blocker |
| SC-004 | Agy #1 | `packages/contracts/test/**` | SC-003 merged | adversarial sequential revenue epoch and transfer-lock tests; no ABI changes | Merged | `769a6880a472b2ca5ff5571bfe79365981a6a5a3` (merge `1fcd068`) | Independently verified `forge fmt --check`, `forge build --force`, and `forge test --summary`: 123/123 after merge | no new contract source changes; further test-only work is lower priority than frontend/backend integration |
| SC-005 | Agy #1 | `packages/contracts/src/OfferingEscrow.sol`, `packages/contracts/test/**` | SC-004 merged + ADR-013 | reject non-exact payment-token receipt before crediting investment; preserve frozen functions/events | Merged | `705cc5c5854550aa49a41d17370f7aa9c212eaeb` (merge `95c6189`) | Independently verified `forge fmt --check`, `forge build --force`, `forge test --summary`: 130/130 in agent worktree and integration; compiler/test lint warnings remain | no blocker; no testnet deployment |
| SC-006 | Agy #1 | `packages/contracts/src/{OfferingEscrow,RevenueDistributor}.sol`, `packages/contracts/test/**` | SC-005 merged + ADR-015 | exact recipient payment on refund, treasury release, revenue claim and dust return; no false success with mutable fee token | Merged | `8ba5a82` (merge `fea07cf`) | Independently verified `forge fmt --check`, `forge build --force --silent`, `forge test --summary`: 135/135 in agent worktree; integration `forge test --summary`: 135/135 | test-only compiler/lint warnings remain; no testnet deployment |
| FE-002 | Agy #2 | frontend-owned paths | FE-001 + IQ-001 merged | live wagmi/viem reads/writes, receipts, explorer links, no mock economics | Ready | — | component + typecheck/lint/build; local Anvil flow when available | human dispatch pending; FE-002C is optional and should not run concurrently in the same worktree |
| FE-002D | Agy #2 | frontend-owned paths | FE-002C merged + IQ-001 merged | wallet/network state, live Villa Nusa chain reads, and receipt-confirmed investor approve/invest path | Ready | — | mocked RPC/wallet tests, typecheck/lint/build, local Anvil flow when available; no balance fallback | human dispatch pending; owner/verifier/revenue write flows follow this core layer |
| BE-002A | Agy #3 | backend-owned paths | BE-001 accepted + ADR-012 | signed, receipt-verified property-to-chain binding; one-time DRAFT to SUBMITTED cache update | Merged | `e3a99a96900fc7a9771392693d961cef9fa54fbb` (merge `b6e582a`) | Independently verified web Vitest 300/300 in agent worktree and integration, web/shared typecheck, lint 0 errors/2 unowned warnings, Webpack build 11/11 pages after merge | live RPC/Supabase/RLS integration remains untested; database is cache only |
| BE-002B | Agy #3 | backend-owned paths | BE-002A merged + ADR-014 | signed private evidence access for independent verifiers | Merged | `ec664aa` (merge `7bc476e`) | Independently verified backend Vitest 332/332, typecheck, lint 0 errors/2 unowned config warnings, Webpack build 11/11; integrated web Vitest 373/373, typecheck/lint, Webpack build 11/11 | Live Supabase/RPC and storage policy behavior remain unverified without configured services; no testnet deployment |
| BE-002C | Agy #3 | `apps/web/app/api/**`, `apps/web/lib/server/**` | BE-002B merged + ADR-016 | signed, live-role-gated discovery of role-appropriate private evidence metadata without paths or URLs | Ready | — | focused route/security tests, web typecheck/lint/build | human dispatch pending; live Supabase/RPC unavailable locally |
| IQ-002 | Agy #4 | integration-owned paths | SC-001 + IQ-001 merged | reconcile generated ABI; local Anvil deploy/seed/E2E golden path, deterministic state diagnostics | Merged | `2e4b8f2` (merge `c2b56f1`) | Independently verified chain ABI 129/129 with compiled integrated artifacts, default E2E 64 pass/1 explicit skip, chain/scripts/E2E typecheck; explicit nonexistent artifact path fails closed; integrated web 341/341 | Agent-reported opt-in Anvil 65/65 and validator 30/30 not independently repeatable in orchestrator sandbox; no testnet deployment |
| IQ-003 | Agy #4 | `tests/e2e/**`, `scripts/**` | SC-006 and IQ-002 merged | check exact MockIDR recipient balance deltas and conservation at each local golden-path transfer; rerun opt-in Anvil against current integration | Ready | — | unit/typecheck, ABI reconciliation, opt-in local Anvil and validator report | human dispatch pending; local Anvil required, no shared-chain deployment |
| INT-001 | Orchestrator | integration only | approved initial/follow-up tasks | sequential merges; full checks; no ownership drift | Backlog | — | forge + pnpm checks + local E2E | implementation pending |
| DEP-001 | Agy #4, orchestrator reviewed | deployment files only | INT-001 + explicit human authorization | Arbitrum Sepolia deployment, address/tx ledger, smoke test | Blocked | — | on-chain receipts | explicit authorization not granted |

FE-001 is already merged. Remaining merges are gated by reviewed correction
commits and relevant tests after each merge. An agent report never directly
moves a task to `Merged`.
