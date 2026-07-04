---
description: Show an interactive checklist of TODO.md items, let the user pick which ones to work on this session, mark them in progress, and mark them done as they're completed.
---

# /todo-session

This command is synchronous (not background) — it needs the user's input.

## Step 1

Read `./TODO.md`. If it doesn't exist or has no unfinished items, tell the user there's nothing to work on yet and suggest `/todo` or `/todo-scan`.

## Step 2

List every unfinished item (lines starting with `- [ ]` or `- [~]`) from both `## Manual` and `## Auto-detected`, numbered, and showing which section/tag each belongs to. Example:

```
1. [Manual] Fix login redirect bug
2. [TODO] Refactor foo() (src/foo.js:42)
3. [FIXME] Handle null response (src/bar.py:10)
```

## Step 3

Ask the user which numbers they want to work on this session (they may pick several, e.g. "1, 3").

## Step 4

For each selected item, change its `- [ ]` to `- [~]` directly in TODO.md.

## Step 5

Work through the selected items (in the order given, or as the user directs). As soon as an item is fully implemented and verified, change its `- [~]` to `- [x]` in TODO.md and tell the user which item was just marked done.

If the item just closed is from `## Auto-detected` (its label has the form `path:LINE`), also clean up the source comment it points to:

1. Take the line number from the label text (the link target itself only points at the file, not a line) and read that line of the file.
2. If the line, trimmed of whitespace, is entirely a comment (starts with `//`, `#`, `/*`, `<!--`, or `--`) — delete the whole line.
3. If the tag is a trailing comment after real code on the same line (e.g. `doSomething(); // TODO: fix`) — remove just the trailing comment portion, leaving the code intact.
4. Manual items have no file link — never touch source files for those.
