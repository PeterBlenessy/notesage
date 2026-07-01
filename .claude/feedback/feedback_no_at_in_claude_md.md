---
name: feedback-no-at-in-claude-md
description: Never use @ prefix for large reference docs in CLAUDE.md — @ causes auto-loading into every conversation context regardless of relevance
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 60383eef-539e-476c-81d2-258545915fb7
aw_applies: with-modification
aw_applies_to: [aw-tdd]
aw_note: "Applies as-is when aw-tdd edits CLAUDE.md (rare). Does not apply to AW skill files (which are not @-loaded)."
---

Never prefix large reference doc paths with `@` in CLAUDE.md.

**Why:** The `@` prefix auto-loads the file into every conversation context, regardless of whether that conversation has anything to do with the doc. Large files (>40k chars) burn ~10–17k tokens on every session — even when working on release notes, bug fixes, or unrelated features. This was done to `docs/agentic-workflow.md` (68k chars), causing significant waste, and had to be fixed twice.

**How to apply:** Reference large docs by plain path only (`docs/agentic-workflow.md`, not `@docs/agentic-workflow.md`). Reserve `@` for small, universally-needed files that every coding session legitimately needs (architecture overview, design system, tauri commands, keyboard shortcuts). For large reference docs, split out the bulk into a companion file (e.g. `agentic-workflow-rationale.md`) so the user can load it on demand when needed. See [[feedback-large-file-load-perf]].
