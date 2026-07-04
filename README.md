# plugins

A personal collection of Claude Code plugins, distributed through one marketplace.

## Plugins

- [`todo`](todo/README.md) — manage a project `TODO.md`: add notes, scan code for TODO/FIXME/BUG-style comments, run an interactive session picker, and clean up completed tasks.

## Install

**From GitHub:**
```
/plugin marketplace add Clickman6/plugins
/plugin install todo@plugins
```

**From a local clone:**
```
/plugin marketplace add /path/to/plugins
/plugin install todo@plugins
```

Then run `/plugin list` to confirm it's installed and enabled.

## Structure

One marketplace (`.claude-plugin/marketplace.json`) at the repo root, one subfolder per plugin. To add a new plugin: create a subfolder with its own `.claude-plugin/plugin.json`, `commands/`, etc., then add an entry to `marketplace.json` pointing `source` at that subfolder.

## License

MIT — see [LICENSE](LICENSE).
