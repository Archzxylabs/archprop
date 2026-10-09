# ARCHPROP Agent Instructions

Read, in order: root `PRD.md`, `SYSTEM.md`, `AGENT.md`, then
`docs/INTERFACES.md`, `docs/OWNERSHIP.md`, `docs/TASK_BOARD.md`, and
`docs/DECISIONS.md`. The latter four control implementation coordination.

Work only in your assigned worktree and ownership boundary. The frozen ABI,
lifecycle, events, shared types, HTTP schemas, and numeric constants in
`docs/INTERFACES.md` are binding. Do not modify shared/root/dependency files,
frozen documents, or another agent's directories. Raise an interface/dependency
request instead.

Never put private keys or credentials in code, docs, commits, logs, or chat;
never deploy to shared Arbitrum Sepolia without explicit orchestrator approval.
Do not claim a test passed without running it. Commit only reviewable work on
your feature branch and end with the handoff format in `docs/OWNERSHIP.md`.
