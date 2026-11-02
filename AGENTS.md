# Ctrl+Z — agent instructions

This project (and any project using Ctrl+Z) can undo file changes via a local CLI.

## Before risky work

Before any large or destructive change (deleting files, rewriting many files, refactoring across folders, running shell commands that modify the tree), run:

```bash
npx ctrl-z snap -m "<what you are about to do>"
```

Or, if Ctrl+Z is installed locally in the repo:

```bash
node path/to/ctrl-z/src/cli.js snap -m "<what you are about to do>"
```

## After the user asks to undo

```bash
npx ctrl-z list
npx ctrl-z restore 1 --yes
```

## Important honesty

- **Automatic snapshots** only exist when the host agent supports hooks (e.g. Claude Code with the Ctrl+Z plugin).
- In Cursor, Windsurf, Cline, Aider, and similar tools **without hooks**, you must call `snap` yourself before risky edits. Say so if the user asks.
- Do not delete `.ctrl-z/`.
- Cannot undo: network side effects, databases, or files outside the project / ignored secrets (`.env`).
