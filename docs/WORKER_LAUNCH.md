# Manual Claude Code Worker Launch

The isolated worktrees share the current `integration` baseline and are controlled by
the Git directory at `/tmp/archprop-git-control` because the workspace's native
`.git` placeholder is read-only. Open four terminals after Claude Code can
reach its API, then run one command in each. Accept the local-worktree trust
prompt if shown. Do not use `--dangerously-skip-permissions`. Paste the complete
task-specific prompt issued by the orchestrator for the matching agent/task.

```bash
cd /tmp/archprop-worktrees/contracts && claude --permission-mode auto --name archprop-contracts
```

```bash
cd /tmp/archprop-worktrees/frontend && claude --permission-mode auto --name archprop-frontend
```

```bash
cd /tmp/archprop-worktrees/backend && claude --permission-mode auto --name archprop-backend
```

```bash
cd /tmp/archprop-worktrees/integration-qa && claude --permission-mode auto --name archprop-integration-qa
```

After a worker reports a commit, the orchestrator must inspect its diff,
interface compliance, scope, and actual test output before merging it into
`integration`.
