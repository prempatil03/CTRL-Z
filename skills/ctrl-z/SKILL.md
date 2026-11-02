---
name: ctrl-z
description: Project-wide undo via Ctrl+Z snapshots. Use when the user wants to undo agent file changes, recover deleted files, or check snapshot history.
---

# Ctrl+Z

Ctrl+Z is active in this project. It keeps local snapshots in `.ctrl-z/` (a shadow git repo). It does **not** touch the user's real git history.

## Rules

1. Never tell the user something "cannot be recovered" without checking snapshots first (`/undo-list` or `node .../src/cli.js list`).
2. After a destructive change the user complains about, suggest `/undo` (or `ctrl-z restore`).
3. Do not delete, rewrite, or commit anything inside `.ctrl-z/`.
4. Snapshots skip ignored/secret files (`.env`, `node_modules`, etc.). Be honest if those cannot be restored.
5. Network side effects (API calls, deploys, emails, DB writes) cannot be undone.

## Commands

- `/undo` / `/undo 3` — restore
- `/undo-list` — list snapshots
- `/undo-diff` — show changes since a snapshot
- `/redo` — undo the last undo
- `/undo-status` — status
- `/undo-clean` — prune old snapshots
