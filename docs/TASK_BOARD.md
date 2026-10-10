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
 │    └── BE-002 signed evidence/revenue polish ─┤
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
| FE-002B | Agy #2 | frontend-owned paths | FE-002A merged | browser-verified responsive/accessibility pass for owner form and investment preview without live writes | Ready | — | focused UI tests, viewport smoke, typecheck/lint/build | human dispatch pending; no ABI/API dependency |
| BE-001 | Agy #3 | API/server/supabase paths | ORCH-001 | migration/RLS/storage policies; validated property/upload/revenue APIs | Fix requested | `f17f1c035288474a4471b507ec7d1bd7326c0dba` | Independently verified Vitest 123/123, typecheck/build pass, lint 0 errors/2 unowned warnings; live RLS untested | Direct client cache writes are closed, but the same verified `RevenuePublished` transaction/epoch can be recorded again under another period; add DB replay constraint and actual-route regression test before merge |
| IQ-001 | Agy #4 | chain/scripts/e2e/deployment ledger | ORCH-001 | frozen typed ABI/client, fail-closed config, non-deploy scripts, E2E scaffold | Fix requested | `4d12113c64b387e1ce9fcef837582ba8e046c4ef` | Independently verified chain Vitest 119/119; chain/scripts/e2e typechecks pass; E2E 22 pass/1 skip without artifact override, 1 fail with artifacts but no Anvil | Artifact resolver uses package cwd rather than repo root, causing false skip; explicit artifact path hits Anvil `EPERM` in this sandbox; correct prerequisite gating and script path resolution before merge |
| SC-002 | Agy #1 | `packages/contracts/**` | SC-001 merged | isolated economic-invariant fuzz tests and artifact handoff | Ready | — | Foundry fuzz suite + ABI comparison | human dispatch pending |
| FE-002 | Agy #2 | frontend-owned paths | FE-001 + IQ-001 merged | live wagmi/viem reads/writes, receipts, explorer links, no mock economics | Blocked | — | component + typecheck/lint/build | IQ-001 typed chain adapter is not merged |
| BE-002 | Agy #3 | backend-owned paths | BE-001 review | signed private evidence access and integration fixes | Backlog | — | focused API/security tests | BE-001 correction not approved |
| IQ-002 | Agy #4 | integration-owned paths | SC-001 + IQ-001 merged | reconcile generated ABI; local Anvil deploy/seed/E2E golden path | Backlog | — | local deployment + E2E | IQ-001 correction not approved |
| INT-001 | Orchestrator | integration only | approved initial/follow-up tasks | sequential merges; full checks; no ownership drift | Backlog | — | forge + pnpm checks + local E2E | implementation pending |
| DEP-001 | Agy #4, orchestrator reviewed | deployment files only | INT-001 + explicit human authorization | Arbitrum Sepolia deployment, address/tx ledger, smoke test | Blocked | — | on-chain receipts | explicit authorization not granted |

FE-001 is already merged. Remaining merges are gated by reviewed correction
commits and relevant tests after each merge. An agent report never directly
moves a task to `Merged`.
