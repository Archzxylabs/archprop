# Manual Claude Code Worker Launch

The isolated worktrees share baseline commit `1219eab` and are controlled by
the Git directory at `/tmp/archprop-git-control` because the workspace's native
`.git` placeholder is read-only. Open four terminals after Claude Code can
reach its API, then run one command in each. Accept the local-worktree trust
prompt if shown. Do not use `--dangerously-skip-permissions`.

```bash
cd /tmp/archprop-worktrees/contracts && claude --permission-mode auto --name archprop-contracts 'You are Agent 1. Read PRD.md, SYSTEM.md, AGENT.md, AGENTS.md, and docs/. Work only in packages/contracts/**. Implement and Foundry-test the six contracts exactly to docs/INTERFACES.md; no deployment, secrets, or edits outside scope. Commit and hand off SC-001 with commit, files, actual tests, blockers.'
```

```bash
cd /tmp/archprop-worktrees/frontend && claude --permission-mode auto --name archprop-frontend 'You are Agent 2. Read all authoritative docs. Work only in apps/web/app/**, apps/web/components/**, apps/web/styles/**. Implement the required responsive marketplace routes using frozen interfaces only, clear demo labels, and truthful transaction states; no deployment, secrets, or edits outside scope. Commit and hand off FE-001 with commit, files, actual tests, blockers.'
```

```bash
cd /tmp/archprop-worktrees/backend && claude --permission-mode auto --name archprop-backend 'You are Agent 3. Read all authoritative docs. Work only in apps/web/app/api/**, apps/web/lib/server/**, supabase/**. Implement the locked API/migration/storage scope including server-side SHA-256 PDF upload. DB cannot authorize chain state; no deployment, secrets, or edits outside scope. Commit and hand off BE-001 with commit, files, actual tests, blockers.'
```

```bash
cd /tmp/archprop-worktrees/integration-qa && claude --permission-mode auto --name archprop-integration-qa 'You are Agent 4. Read all authoritative docs. Work only in packages/chain/**, scripts/**, tests/e2e/**, docs/DEPLOYMENTS.md. Implement frozen-ABI adapters, fail-closed non-deploying scripts, diagnostics, and E2E scaffolding. Do not deploy or edit outside scope. Commit and hand off IQ-001 with commit, files, actual tests, explicit no-deployment confirmation, blockers.'
```

After a worker reports a commit, the orchestrator must inspect its diff,
interface compliance, scope, and actual test output before merging it into
`integration`.
