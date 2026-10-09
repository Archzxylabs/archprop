# ARCHPROP Ownership Manifest

`docs/INTERFACES.md`, `docs/DECISIONS.md`, root `PRD.md`, `SYSTEM.md`, and
`AGENT.md` are orchestrator-owned and frozen after the baseline commit.

| Owner | Branch | Worktree | Exclusive files/directories | Explicitly forbidden |
| --- | --- | --- | --- | --- |
| Orchestrator | `integration` | `/home/pupulion/archprop` | `docs/`, `AGENTS.md`, `CLAUDE.md`, root config, integration | feature implementation on an agent branch; deploy without authorization |
| Agent 1 — contracts | `agent/contracts` | `/tmp/archprop-worktrees/contracts` | `packages/contracts/**` | frontend, chain adapter, DB/API, root config, frozen docs |
| Agent 2 — frontend | `agent/frontend` | `/tmp/archprop-worktrees/frontend` | `apps/web/app/**` except `apps/web/app/api/**`; `apps/web/components/**`, `apps/web/styles/**`, `apps/web/lib/client/**` | API handlers/server code, contract ABI/method invention, migrations, root/shared config |
| Agent 3 — backend/data | `agent/backend` | `/tmp/archprop-worktrees/backend` | `apps/web/app/api/**`, `apps/web/lib/server/**`, `supabase/**` | client UI, contract/chain code, root config |
| Agent 4 — integration/QA | `agent/integration-qa` | `/tmp/archprop-worktrees/integration-qa` | `packages/chain/**`, `scripts/**`, `tests/e2e/**`, `docs/DEPLOYMENTS.md` | contract source, UI, API/migrations, live deployment |

Shared files are read-only to agents: `package.json`, `pnpm-workspace.yaml`,
lockfiles, `apps/web/package.json`, `apps/web/tsconfig.json`,
`apps/web/next.config.ts`, `apps/web/eslint.config.mjs`, `packages/shared/**`,
`docs/INTERFACES.md`, `docs/OWNERSHIP.md`,
`docs/TASK_BOARD.md`, `docs/DECISIONS.md`, `AGENTS.md`, and `CLAUDE.md`.
Request changes through a handoff note; the orchestrator makes/coordinates them.

## Handoff required for every agent

```
Task ID:
Branch / commit:
Changed files:
Interface compliance:
Tests actually executed and result:
Known limitations / blockers:
```

Workers make reviewable conventional commits only on their branch. They must
not push/merge integration or `main`, use destructive Git commands, alter
dependencies, expose credentials, or deploy to any shared chain. The
orchestrator verifies scope, diff, frozen ABI, and tests before a sequential
merge.

If a path appears covered by two broad globs, the more specific owner wins.
Therefore `apps/web/app/api/**` always belongs to Agent 3 and is forbidden to
Agent 2.
