# todo (Claude Code plugin)

Part of the [plugins](../README.md) marketplace repo.

Commands:

- `/todo <note>` — add a note to `TODO.md`. Runs on Haiku for speed, synchronously like any other command.
- `/todo-scan` — scan the codebase for TODO/FIXME/BUG-style comments and file them into `TODO.md` under "Auto-detected", grouped by tag, with `file:line` labels linking to the file. Pure grep, no external script, run manually.
- `/todo-session` — interactive checklist: pick which items to work on, mark them in progress, mark them done as you finish. Closing an auto-detected item also removes the source comment it points to.
- `/todo-clean` — remove completed (`- [x]`) items from `TODO.md`.

## Install

See the [repo README](../README.md#install) for adding the marketplace. Once added:
```
/plugin install todo@plugins
```

**Quick test (no install, this session only):**
```
claude --plugin-dir ./todo
```
(run from the repo root, so the path resolves to this plugin's own folder)

## Configuration

**Important:** Claude Code's sandbox blocks reading files outside the current working directory, so this plugin's settings must live in the **project-level** `.claude/settings.json` — not `~/.claude/settings.json`.

Add to `.claude/settings.json` (inside the project root):

```json
{
  "plugins": {
    "todo@plugins": {
      "tags": ["TODO", "FIXME", "BUG", "HACK", "XXX", "NOTE", "OPTIMIZE"],
      "excludeDirs": [".git", "node_modules", "vendor", "dist", "build", "coverage", ".next", "nuxt", "out"],
      "extensions": ["js", "jsx", "ts", "tsx", "py", "go", "rb", "php", "blade.php", "java", "c", "cpp", "cs", "rs", "swift", "kt"]
    }
  }
}
```

All keys are optional — omit any of them to fall back to the defaults shown above.

- `tags` / `excludeDirs` / `extensions`: used by `/todo-scan`.

There's no dedicated settings UI for custom plugin keys — you can either edit this file yourself, or just ask Claude in chat to do it.

## Notes / honest limitations

- `/todo` only asks a clarifying question when the note is too vague to record at all (max 2, short) — otherwise it just records it, no matter how sparse.
- `/todo-scan` regenerates the "Auto-detected" section on each run, but carries over existing `[~]`/`[x]` checkbox status by matching the `path:LINE` label. If a file's line numbers shifted since the last scan, that item's label won't match and it's treated as new (starts at `[ ]`) — there's no fuzzy matching by comment text.
- Closing an "Auto-detected" item in `/todo-session` (marking it `[x]`) also deletes the source comment at that line — the whole line if it's a standalone comment, or just the trailing part if it shares a line with code. Manual items are never touched this way.
- Auto-detected links point at the whole file, not a specific line — the line number is only in the visible label, so there's nothing that needs GitHub's `#Lxx` anchors to work.
- The plugin key in settings.json (`todo@plugins`) depends on the marketplace name matching what's in the repo's `.claude-plugin/marketplace.json` — if you rename the marketplace, update the key in `commands/todo.md` and `commands/todo-scan.md` too.
- `${CLAUDE_PLUGIN_ROOT}` (the usual way plugins reference their own bundled files) is documented to be unreliable inside command markdown files specifically — this is why `/todo-scan` doesn't bundle a script and instead has the agent run `grep` directly.

## License

MIT — see [LICENSE](../LICENSE).
