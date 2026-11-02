# Ctrl+Z

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![GitHub](https://img.shields.io/badge/github-prempatil03%2FCTRL--Z-181717?logo=github)](https://github.com/prempatil03/CTRL-Z)

**Ctrl+Z for your whole project.**

AI coding agents can edit or delete dozens of files in seconds. Ctrl+Z takes a local snapshot first, so one command puts the project back.

```text
$ ctrl-z restore
Restored project to: "before Edit src/auth.js" (2 min ago)
  - 3 files restored
  - 1 file the agent created was removed
```

Works with **any terminal** and any AI agent. Your real git history is never touched. Nothing is uploaded.

---

## Quick start

**Needs:** Node.js 18+ and `git` on your PATH. No npm dependencies.

```bash
# from this repo
node src/cli.js init
node src/cli.js snap -m "starting point"

# break something on purpose, then:
node src/cli.js list
node src/cli.js restore 1 --yes
```

After you publish to npm:

```bash
npx ctrl-z init
npx ctrl-z snap -m "starting point"
```

---

## Commands

| Command | Description |
|---|---|
| `ctrl-z snap [-m label]` | Snapshot the project now |
| `ctrl-z list` | Show recent snapshots |
| `ctrl-z restore [n]` | Restore snapshot `n` (default: latest) |
| `ctrl-z diff [n]` | Diff working tree vs snapshot |
| `ctrl-z redo` | Undo the last restore |
| `ctrl-z status` | Active?, snap count, disk use |
| `ctrl-z prune` | Delete old snapshots |
| `ctrl-z off` / `on` | Disable / enable snapshots |
| `ctrl-z reset --yes` | Delete `.ctrl-z/` entirely |

**Useful flags:** `--dry-run` (with `restore`), `--yes` / `-y`, `--cwd <dir>`

Where your agent supports slash commands: `/undo`, `/undo-list`, `/undo-diff`, `/redo`, `/undo-status`, `/undo-clean`.

---

## How it works

1. Snapshots are stored in a hidden **shadow git repo** at `.ctrl-z/repo.git` — separate from your real `.git`.
2. Unchanged trees are skipped (except a safety snap before every undo).
3. Restore checks out that snapshot and removes files created after it.
4. Junk is skipped: `node_modules`, build output, huge files, `.env`-style secrets.

```text
  You / AI agent
        │
        ▼
   ctrl-z CLI  ──►  .ctrl-z/ (local only)
        │
   snap · list · restore · redo
```

---

## What it can and cannot undo

| Can undo | Cannot undo |
|---|---|
| File edits, deletes, creates in the project | Files outside the project |
| | Network side effects (APIs, deploys, email, DB) |
| | Ignored / secret files (e.g. `.env`) |
| | Changes while Ctrl+Z was `off` |

---

## Use with AI agents

| Setup | Snapshots |
|---|---|
| **Any terminal** | Manual — `ctrl-z snap` / `restore` |
| **Agent with hooks** | Automatic — install the plugin in `.plugin/` |
| **Cursor / Windsurf / Cline / Aider** | Rule-guided — copy `AGENTS.md` or the rule files; the agent should snap before risky edits |

Rule-guided mode is weaker than hooks. Say so if users ask.

---

## FAQ

**Does it touch my git history?**  
No. Only `.ctrl-z/repo.git`.

**Does it upload anything?**  
No. Everything stays on your machine. Do not push `.ctrl-z/`.

**Does it restore `.env`?**  
No — secrets and ignored files are skipped on purpose.

**How do I configure it?**  
Optional `.ctrl-z/config.json`: `maxFileBytes`, `keepCount`, `keepDays`, `maxStorageBytes`.

Defaults: skip files over 5 MB; keep the last 50 snapshots or 7 days (union); warn/prune if storage exceeds 500 MB.

---

## Development

```bash
node src/cli.js version
npm test
npm run bench:quick
```

MIT license — see [LICENSE](LICENSE).
