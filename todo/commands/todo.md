---
description: Add a note to TODO.md.
argument-hint: [your note]
model: haiku
---

# /todo

**Scope guardrail — read this first:** this command does exactly one thing: add one line to `TODO.md`. Whatever the note describes — a bug, a feature, a refactor — do not investigate the code, do not draft a fix plan, do not start implementing it, and do not open any file other than `TODO.md` (and `.claude/settings.json` to read config). Recording the note is the entire job, no matter how obvious or small the described fix looks.

User's raw note: $ARGUMENTS

- Default to **not asking anything**. Reformulate the note into one clear, concise task line and record it, even if it's missing minor detail (e.g. "fix the login redirect" with no file mentioned is fine to record as-is).
- Only ask a clarifying question (max 2, short) when the note is so unclear that no reasonable single-line task can be written at all (e.g. a single disconnected word with no context). Don't ask just because some detail is missing if the note is otherwise recordable.
- Open `./TODO.md` in the project root. If it doesn't exist, create it with this skeleton:
  ```
  # TODO

  ## Manual

  ## Auto-detected
  ```
- Append a new line under `## Manual`: `- [ ] <reformulated note>`
- Confirm briefly what was added.
