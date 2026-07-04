---
description: Remove completed ("- [x]") items from TODO.md.
---

# /todo-clean

1. Read `./TODO.md`. If it doesn't exist, tell the user there's nothing to clean.
2. Count how many lines start with `- [x]`.
3. Remove all of those lines, from every section (`## Manual` and every subsection under `## Auto-detected`).
4. If removing lines leaves a tag subsection under `## Auto-detected` completely empty, remove that subsection's heading too. Always keep the top-level `## Manual` and `## Auto-detected` headings even if empty.
5. Report how many completed items were removed.
