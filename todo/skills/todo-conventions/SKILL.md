---
name: todo-conventions
description: Describes the TODO.md file format used by the todo plugin, and the standing rule for handling bugs/issues noticed while working on something unrelated. Relevant whenever a TODO.md file exists in the project, or when using /todo, /todo-scan, /todo-session, or /todo-clean.
---

# TODO.md conventions

This project's TODO.md has two top-level sections:

- `## Manual` — notes added by the user via `/todo` or `/todo-session`.
- `## Auto-detected` — comments collected from code via `/todo-scan`, grouped into subsections by tag (`### TODO`, `### FIXME`, `### BUG`, etc. — the default tag set is TODO, FIXME, BUG, HACK, XXX, NOTE, OPTIMIZE, or a custom list from plugin settings).

Checkbox states:
- `- [ ]` — not started
- `- [~]` — in progress
- `- [x]` — done

Auto-detected items link to the file itself, not a specific line — the line number lives in the visible label (`path:LINE`), not the link target. Closing an `## Auto-detected` item in `/todo-session` (marking it `[x]`) also removes the source comment at that line — the whole line if it's a standalone comment, or just the trailing comment if it shares a line with code. Manual items are never touched this way, since they have no source link. Re-running `/todo-scan` preserves existing `[~]`/`[x]` status by matching on the `path:LINE` label; items whose line number shifted since the last scan are treated as new.

## Rule: unrelated issues found during other work

If, while working on some other task, you (Claude) notice a bug, problem, or missing piece that is **not related** to the current task, pause and ask the user something like:

"I noticed [short description] while working on [current task]. Want me to: 1) add it to TODO.md, 2) skip it, or 3) fix it right now as part of this session?"

- If they pick **(1)**: append it under `## Manual` in TODO.md as `- [ ] <description> (found while working on <task>)`.
- If they pick **(2)**: do nothing further, continue with the original task.
- If they pick **(3)**: pause the current task, fix the issue, then return to the original task.

Never add something to TODO.md silently without asking, and never silently ignore something you noticed either — always surface it and let the user decide.
