---
description: Install or repair the Ollama quota statusline (wraps the existing statusline)
---

Set up the `ollama-quota` statusline line.

Run:

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
if [ -z "$PLUGIN_ROOT" ] || [ ! -f "$PLUGIN_ROOT/install.sh" ]; then
  PLUGIN_ROOT="$(ls -d "$HOME"/.claude/plugins/cache/*/ollama-quota/*/ 2>/dev/null | sort -V | tail -1)"
fi
bash "$PLUGIN_ROOT/install.sh"
```

Then tell the user to restart Claude Code. The installer preserves the existing
statusline (claude-hud) and appends the Ollama line below it. Do not print
`~/.claude/settings.json` or any tokens.
