# Ctrl+Z demo script

Use this for a terminal recording (vhs / asciinema).

```bash
# Setup
mkdir demo-project && cd demo-project
echo 'hello' > app.js
echo 'ok' > readme.txt
npx ctrl-z init
npx ctrl-z snap -m "starting point"

# Agent goes rogue
rm readme.txt
echo 'broken' > app.js
echo 'oops' > junk.js

# Undo
npx ctrl-z list
npx ctrl-z restore 1 --yes

# Files are back
cat app.js
ls
```
