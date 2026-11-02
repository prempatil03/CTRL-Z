# Ctrl+Z

Before large or destructive edits, snapshot the project:

```bash
npx ctrl-z snap -m "<what you are about to do>"
```

To undo: `npx ctrl-z list` then `npx ctrl-z restore 1 --yes`.

Do not delete `.ctrl-z/`. Ignored secrets and network side effects cannot be undone.
Without agent hooks, snapshots are only taken when you run `snap` yourself.
