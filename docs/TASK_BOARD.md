# ARCHPROP Task Board

Baseline: `integration` branch (commit recorded below once created). Status is
updated only by the orchestrator after evidence is checked.

| ID | Owner | Owned files | Dependencies | Acceptance criteria | Status | Latest commit | Tests | Blockers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ORCH-001 | Orchestrator | docs + controls | none | frozen baseline and four worktrees | Running | pending | spec audit | native `.git` read-only; external control repo used |
| SC-001 | Agent 1 | `packages/contracts/**` | INTERFACES locked | six contracts compile; invariants/events/Foundry tests pass | Ready | — | `forge test` | needs baseline worktree |
| FE-001 | Agent 2 | UI paths/components/styles | interfaces + chain adapter ABI | required routes, demo labels, wallet transaction UX, responsive Villa Nusa flow | Ready | — | typecheck/lint/build | needs baseline worktree |
| BE-001 | Agent 3 | API/server/supabase | HTTP schema | migrations, validated CRUD/upload SHA-256/private storage, no chain authority bypass | Ready | — | focused tests/typecheck | needs baseline worktree |
| IQ-001 | Agent 4 | chain/scripts/e2e/deployments | interfaces + contract artifact after SC-001 | typed adapters, no-deploy seed diagnostics, E2E scaffold | Ready | — | typecheck/e2e scaffold | contract ABI implementation follows lock |

Merge order: SC-001 → IQ-001 (adapter alignment) → BE-001 → FE-001 → full
integration. Agents report `Review`; only then may a card move to `Merged`.
