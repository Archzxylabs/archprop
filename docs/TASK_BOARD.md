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
| SC-001 | Claude #1 | `packages/contracts/**` | ORCH-001 | six contracts; locked ABI/events/invariants; Foundry suite green | Blocked | — (uncommitted working tree) | `forge test -vvv`: 79 passed from existing cache; `forge fmt --check`: failed | no reviewable commit; ABI/lifecycle drift; dependencies are untracked and not reproducibly installed |
| FE-001 | Claude #2 | frontend-owned paths | ORCH-001 | all required routes and state-truthful responsive shell; no fake chain success | Ready | — | required: web typecheck/lint/build | awaiting human dispatch |
| BE-001 | Claude #3 | API/server/supabase paths | ORCH-001 | migration/RLS/storage policies; validated property/upload/revenue APIs | Blocked | — (uncommitted working tree) | web/shared typechecks and build pass; Vitest 23/23; ESLint 0 errors/4 warnings | no reviewable commit; create route omits required slug; private-document read path is incorrect; PDF content and route/DB coverage incomplete; unauthorized root lockfile |
| IQ-001 | Claude #4 | chain/scripts/e2e/deployment ledger | ORCH-001 | frozen typed ABI/client, fail-closed config, non-deploy scripts, E2E scaffold | Blocked | — (uncommitted working tree) | chain/shared typechecks pass; Vitest 122/122 | no reviewable commit; runtime variable names drift from `.env.example`; `TokenLinked` indexing mismatch; scripts/E2E/deployment ledger absent; unauthorized root lockfile |
| SC-002 | Claude #1 | `packages/contracts/**` | SC-001 review | isolated fixes, gas/security review, deployment artifact handoff | Backlog | — | Foundry invariant/fuzz suite | SC-001 not reviewed |
| FE-002 | Claude #2 | frontend-owned paths | FE-001 + IQ-001 merged | live wagmi/viem reads/writes, receipts, explorer links, no mock economics | Backlog | — | component + typecheck/lint/build | dependencies not merged |
| BE-002 | Claude #3 | backend-owned paths | BE-001 review | signed private evidence access and integration fixes | Backlog | — | focused API/security tests | BE-001 not reviewed |
| IQ-002 | Claude #4 | integration-owned paths | SC-001 + IQ-001 merged | reconcile generated ABI; local Anvil deploy/seed/E2E golden path | Backlog | — | local deployment + E2E | contracts not merged |
| INT-001 | Orchestrator | integration only | approved initial/follow-up tasks | sequential merges; full checks; no ownership drift | Backlog | — | forge + pnpm checks + local E2E | implementation pending |
| DEP-001 | Claude #4, orchestrator reviewed | deployment files only | INT-001 + explicit human authorization | Arbitrum Sepolia deployment, address/tx ledger, smoke test | Blocked | — | on-chain receipts | explicit authorization not granted |

Initial merge order is SC-001, IQ-001, BE-001, FE-001, with a relevant test run
after every merge. An agent report moves a task to `Review`, never directly to
`Merged`.
