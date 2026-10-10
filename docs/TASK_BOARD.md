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
| SC-001 | Agy #1 | `packages/contracts/**` | ORCH-001 | six contracts; locked ABI/events/invariants; Foundry suite green | Fix requested | `4825b09` | `forge fmt --check`: pass; `forge build`: pass with lint notes/warnings; `forge test -vvv`: 105/105 | README bootstrap uses unsupported `forge install --no-commit`; `git diff --check` reports an extra blank line at EOF; correction commit required before merge |
| FE-001 | Agy #2 | frontend-owned paths | ORCH-001 | all required routes and state-truthful responsive shell; no fake chain success | Merged | `228e665` | Vitest 55/55; typecheck pass; owned lint clean; full lint 0 errors/2 config warnings; production build pass (9/9 static pages) | no code blocker; independent runtime server blocked by sandbox `listen EPERM`, and no screenshot baseline exists for a visual-regression verdict |
| FE-002A | Agy #2 | frontend-owned paths | FE-001 | interaction-ready property form and investment preview; exact API numeric validation; no fake chain writes | Fix requested | `d60731e` | Vitest 107/107, typecheck and lint pass; webpack build 9/9; Turbopack build blocked by sandbox port `EPERM` | form accepts non-canonical numeric strings and silently truncates BPS input; `git diff --check` fails; correction commit required before merge |
| BE-001 | Agy #3 | API/server/supabase paths | ORCH-001 | migration/RLS/storage policies; validated property/upload/revenue APIs | Fix requested | `e1404a7` | Vitest 95/95; web/shared typechecks and web build pass; lint 0 errors/2 unowned warnings | anonymous client sends empty Bearer header; public detail queries private table as anon and returns 500; users may self-update role; live RLS untested; correction commit required before merge |
| IQ-001 | Agy #4 | chain/scripts/e2e/deployment ledger | ORCH-001 | frozen typed ABI/client, fail-closed config, non-deploy scripts, E2E scaffold | Blocked | — (uncommitted working tree) | chain/shared typechecks pass; Vitest 122/122 | no reviewable commit; runtime variable names drift from `.env.example`; `TokenLinked` indexing mismatch; scripts/E2E/deployment ledger absent; unauthorized root lockfile |
| SC-002 | Agy #1 | `packages/contracts/**` | SC-001 review | isolated fixes, gas/security review, deployment artifact handoff | Backlog | — | Foundry invariant/fuzz suite | SC-001 correction not approved |
| FE-002 | Agy #2 | frontend-owned paths | FE-001 + IQ-001 merged | live wagmi/viem reads/writes, receipts, explorer links, no mock economics | Blocked | — | component + typecheck/lint/build | IQ-001 typed chain adapter is not merged |
| BE-002 | Agy #3 | backend-owned paths | BE-001 review | signed private evidence access and integration fixes | Backlog | — | focused API/security tests | BE-001 correction not approved |
| IQ-002 | Agy #4 | integration-owned paths | SC-001 + IQ-001 merged | reconcile generated ABI; local Anvil deploy/seed/E2E golden path | Backlog | — | local deployment + E2E | contracts not merged |
| INT-001 | Orchestrator | integration only | approved initial/follow-up tasks | sequential merges; full checks; no ownership drift | Backlog | — | forge + pnpm checks + local E2E | implementation pending |
| DEP-001 | Agy #4, orchestrator reviewed | deployment files only | INT-001 + explicit human authorization | Arbitrum Sepolia deployment, address/tx ledger, smoke test | Blocked | — | on-chain receipts | explicit authorization not granted |

FE-001 is already merged. Remaining merges are gated by reviewed correction
commits and relevant tests after each merge. An agent report never directly
moves a task to `Merged`.
