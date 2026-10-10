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
| FE-002C | Agy #2 | frontend-owned paths | FE-002B merged | reproducible browser smoke for narrow/wide viewports and actual keyboard paths, without new dependencies | Fix requested; not merged | `e03eb0b854e5963e47fe6ae9b3ebcda747b55a51` | Independently verified web Vitest 162/162, typecheck/lint, Webpack build 9/9; actual CDP Tab dispatch and layout fail-closed code inspected; agent-reported browser pass not repeatable (`listen EPERM`) | Post-last-Tab evaluation can be absent without failure; it checks only disabled-button text, not that focus left form/panel; second-pass CDP navigation is unchecked |
| BE-001 | Agy #3 | API/server/supabase paths | ORCH-001 | migration/RLS/storage policies; validated property/upload/revenue APIs | Merged; security correction accepted | `0637626624ebe115c195835d61704e3a7e2e83ee` (merge `83f2c8b`) | Independently verified backend Vitest 141/141, integrated web Vitest 268/268, all workspace typechecks, lint 0 errors; agent Turbopack build and integrated Webpack build pass | Live PostgreSQL/Supabase RLS remains untested; integrated Turbopack build blocked by sandbox symlink/root inference, while Webpack build passes |
| IQ-001 | Agy #4 | chain/scripts/e2e/deployment ledger | ORCH-001 | frozen typed ABI/client, fail-closed config, non-deploy scripts, E2E scaffold | Merged | `0fc1fa48321b3b03245b036cfbf0d9719f476a99` (squash `5b8f93a`) | Independently verified chain Vitest 119/119; chain/scripts/e2e typechecks pass; default E2E 31 pass/1 explicit skip; opt-in fails closed without artifacts or Anvil; root integration checks pass | Agent-reported local Anvil golden path 12/12 cannot be repeated in orchestrator sandbox (`listen EPERM`); no shared-chain deployment |
| SC-002 | Agy #1 | `packages/contracts/**` | SC-001 merged | isolated economic-invariant fuzz tests and artifact handoff | Merged | `3b031203cfc17f3731219c776fe06d879d33a9d5` (merge `0f23ef2`) | Independently verified `forge fmt --check`, `forge build --force`, `forge test -vvv`: 112/112 across 9 suites; integration `forge test --summary`: 112/112 | One unused import in new test is a non-blocking lint note; compiled production sources/ABI unchanged |
| SC-003 | Agy #1 | `packages/contracts/test/**` | SC-002 merged | adversarial failed-offering/refund conservation fuzz tests; no ABI changes | Merged | `3586e66b958679f349fedb9997c392b15353025d` (merge `958be24`) | Independently verified `forge fmt --check` and `forge test --summary`: 116/116 after merge | no blocker |
| SC-004 | Agy #1 | `packages/contracts/test/**` | SC-003 merged | adversarial sequential revenue epoch and transfer-lock tests; no ABI changes | Merged | `769a6880a472b2ca5ff5571bfe79365981a6a5a3` (merge `1fcd068`) | Independently verified `forge fmt --check`, `forge build --force`, and `forge test --summary`: 123/123 after merge | no new contract source changes; further test-only work is lower priority than frontend/backend integration |
| SC-005 | Agy #1 | `packages/contracts/src/OfferingEscrow.sol`, `packages/contracts/test/**` | SC-004 merged + ADR-013 | reject non-exact payment-token receipt before crediting investment; preserve frozen functions/events | Ready | — | focused fee-token regression + full Foundry suite | human dispatch pending; no frontend/backend dependency |
| FE-002 | Agy #2 | frontend-owned paths | FE-001 + IQ-001 merged | live wagmi/viem reads/writes, receipts, explorer links, no mock economics | Ready | — | component + typecheck/lint/build; local Anvil flow when available | human dispatch pending; FE-002C is optional and should not run concurrently in the same worktree |
| BE-002A | Agy #3 | backend-owned paths | BE-001 accepted + ADR-012 | signed, receipt-verified property-to-chain binding; one-time DRAFT to SUBMITTED cache update | Ready | — | focused route/security tests; web typecheck/lint/build | human dispatch pending; live RPC integration and RLS tests require configured services |
| BE-002B | Agy #3 | backend-owned paths | BE-002A accepted + verifier-access interface | signed private evidence access for independent verifiers | Blocked | — | focused API/security tests | authorization model and route schema not yet frozen |
| IQ-002 | Agy #4 | integration-owned paths | SC-001 + IQ-001 merged | reconcile generated ABI; local Anvil deploy/seed/E2E golden path, deterministic state diagnostics | Fix requested; not merged; duplicate report of unchanged commit | `710619c7192dbcf2aa4fd8934220491ea3f64e00` | Re-ran default E2E: 58 pass/1 fail/1 skip; `git diff --check` fails at EOF; explicit nonexistent artifact path still returns chain suite 128/128 (incorrect fallback) | Hard-coded worktree paths make E2E non-reproducible; explicit missing artifact path falls back to other artifacts; validator omits canonical valuation and exact investor payout checks |
| INT-001 | Orchestrator | integration only | approved initial/follow-up tasks | sequential merges; full checks; no ownership drift | Backlog | — | forge + pnpm checks + local E2E | implementation pending |
| DEP-001 | Agy #4, orchestrator reviewed | deployment files only | INT-001 + explicit human authorization | Arbitrum Sepolia deployment, address/tx ledger, smoke test | Blocked | — | on-chain receipts | explicit authorization not granted |

FE-001 is already merged. Remaining merges are gated by reviewed correction
commits and relevant tests after each merge. An agent report never directly
moves a task to `Merged`.
