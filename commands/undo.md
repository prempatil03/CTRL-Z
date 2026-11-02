---
description: Restore the project to a previous Ctrl+Z snapshot (default: last one)
---

Run this shell command and show the user the output. Do not modify any files yourself.

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" restore $ARGUMENTS --yes
```

If `$ARGUMENTS` is empty, restore the newest snapshot (step 1).
