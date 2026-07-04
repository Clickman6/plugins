---
description: Scan the codebase for TODO/FIXME/BUG-style comments and add them to the "Auto-detected" section of TODO.md, grouped by tag, with file:line labels linking to the file.
---

# /todo-scan

This command is run manually and does its own search — no separate script, no hooks. Just follow these steps directly.

## Step 1 — read config (if any)

Read `.claude/settings.json` in the project root (use the Read tool — don't shell out to `jq`, it isn't guaranteed to be installed, and reading files outside the project root is blocked by the sandbox anyway). Look for a `plugins["todo@plugins"]` entry with optional keys:

- `tags` — array of tags to search for. Default if missing: `["TODO", "FIXME", "BUG", "HACK", "XXX", "NOTE", "OPTIMIZE"]`
- `excludeDirs` — array of directory names to skip. Default: `[".git", "node_modules", "vendor", "dist", "build", "coverage", ".next", "nuxt", "out"]`
- `extensions` — array of file extensions to search. Default: `["js", "jsx", "ts", "tsx", "py", "go", "rb", "php", "blade.php", "java", "c", "cpp", "cs", "rs", "swift", "kt"]`

If the file or key doesn't exist, just use the defaults above.

## Step 2 — search

Run a grep like this from the project root (build the `--include` and `--exclude-dir` flags from the extensions/excludeDirs lists resolved in Step 1):

```
grep -rnE "(//|#|/\*|<!--|--)[[:space:]]*(TODO|FIXME|BUG|HACK|XXX|NOTE|OPTIMIZE)\b" \
  --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" \
  --include="*.py" --include="*.go" --include="*.rb" --include="*.php" --include="*.blade.php" \
  --include="*.java" --include="*.c" --include="*.cpp" --include="*.cs" \
  --include="*.rs" --include="*.swift" --include="*.kt" \
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=vendor \
  --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage \
  --exclude-dir=.next --exclude-dir=nuxt --exclude-dir=out .
```

Swap the tag list and include/exclude flags for whatever was resolved from settings in Step 1.

The pattern requires a comment marker (`//`, `#`, `/*`, `<!--`, `--`) shortly before the tag, so it mostly skips false positives like a variable literally named `todo` in code.

## Step 3 — parse and format each match

Each grep result line looks like `path/to/file.ext:LINE:content`. For each one:

1. Figure out which tag matched.
2. Take the text after the tag (strip the tag itself, an optional colon, and leading whitespace; also strip trailing comment closers like `*/` or `-->`).
3. Format it as a link whose visible label keeps the line number but whose target is just the file (no line anchor):
   ```
   - [ ] [path/to/file.ext:LINE](path/to/file.ext) — <comment text>
   ```
   Example: `- [ ] [src/auth.js:23](src/auth.js) — implement user authentication`

   Note: the label (`path/to/file.ext:LINE`) is only a human-readable reference — the link itself points at the whole file, not a specific line, on GitHub or locally.

## Step 4 — preserve existing checkbox status

Before overwriting anything, read the current `## Auto-detected` section of `./TODO.md` (if the file/section exists yet). For every existing line there of the form `- [X] [path:LINE](...) — ...`, record the pair (`path:LINE`, `X`) taken from the **label** (the bracketed text), not the link target — e.g. label `src/auth.js:23` → `~`.

This is a lookup by file+line only, not by comment text. If a file's line numbers shifted since the last scan, the label won't match and the item is treated as new (starts at `[ ]`) — no fuzzy text matching, that's not worth the complexity here.

## Step 5 — update TODO.md

Open `./TODO.md` (create it with the standard skeleton — see `/todo` — if missing). Replace everything under the `## Auto-detected` heading with fresh subsections, one per tag that actually has matches. For each new item, look up its `path:LINE` label in the map from Step 4: if found, reuse that checkbox status instead of defaulting to `[ ]`. E.g.:

```
## Auto-detected
### TODO
- [~] [src/auth.js:23](src/auth.js) — implement user authentication
### FIXME
- [ ] [src/bar.py:10](src/bar.py) — handle null response
```

(`src/auth.js:23` above kept its `[~]` from before the rescan because the same `path:LINE` label was found.)

Only include subsections for tags that found at least one match. Leave `## Manual` completely untouched.

## Step 6 — report

Tell the user a short summary: total items found, broken down by tag, e.g. "Found 7 items — TODO: 4, FIXME: 2, BUG: 1."
