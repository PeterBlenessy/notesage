---
name: User-facing release notes must not include developer-facing detail
description: The Features / Improvements / Fixes sections of docs/history/*.md are extracted into user-visible release notes (changelog viewer + update dialog). Strip dev-facing detail from those sections — version numbers, crate names, alert IDs, transitive dep mechanics, etc. Put those in "Under the hood".
type: feedback
originSessionId: e0a9c6e6-c7bb-4748-a54a-f7fbc33596a2
aw_applies: no
---
The `### Features` / `### Improvements` / `### Fixes` sections of `docs/history/NNN-release-vX.Y.Z.md` are extracted by `scripts/generate-changelog.ts` into the user-visible in-app changelog AND into the update-available dialog (via the `notes` field of `latest.json` — see PR #268's automation that's coming).

**These sections are USER-FACING. Treat them like product copy, not engineer copy.**

Forbidden in user-facing bullets:
- Specific version numbers (`11.14.0 → 11.15.0`)
- Crate / library / package names (`rand`, `mermaid`, `tiptap`, `react`)
- Alert / advisory identifiers (`#62 Gantt-chart DoS`, `classDef HTML injection`, `Dependabot alert #57`)
- Distribution mechanics (`transitive dependency`, `Cargo.lock`, `pnpm-lock`)
- Internal terms (`custom loggers`, `Rust crate`, `IPC Origin Confusion`)
- File paths or commit hashes
- Architecture jargon (`global addAttributes`, `streamingHydrate`, `setNodeMarkup`)

Right shape for the bullet:
- Lead with **what the user can do differently** or **what got safer/faster/clearer**
- Optional second sentence on **where to find it** or **what to know**
- Stop. Move all the rest to `## Under the hood`.

**Bad example** (what the v0.45.0-alpha.0 notes shipped):
> mermaid security alerts (4) closed. mermaid 11.14.0 → 11.15.0 closes Dependabot alerts about Gantt-chart DoS, classDef HTML injection, configuration CSS injection, and classDef CSS injection. If you embed mermaid diagrams in your documents, this is a meaningful security pickup.

**Good rewrite:**
> Mermaid diagrams are safer. Several sanitization issues that affected Mermaid blocks in documents are fixed in this release. If you embed mermaid diagrams from untrusted sources, you're now protected.

**Bad example:**
> rand low-severity alert closed (transitive). A Rust dependency that pulls in the rand crate was advanced; the unsoundness with custom loggers no longer applies.

**Good rewrite:**
> _(this one probably shouldn't be in the user-facing section at all — drop it, or roll into a generic "security and stability improvements" bullet)_

For the dev-facing details (the alert IDs, the specific version bumps, the dependency mechanics, the commit refs), put them in `## Under the hood` — that section is NOT extracted by the generator and is for engineer-level review of what shipped.

**How to apply:**
- When writing a release history file, draft Features / Improvements / Fixes for a non-technical user scrolling through versions.
- Then write a separate `## Under the hood` for engineer-level detail.
- The release skill at `.claude/skills/release/SKILL.md` should be patched to call this out explicitly with examples.
- The changelog generator could (as a safety net) detect and strip common dev-facing patterns — but the source-of-truth fix is the history file itself.

Tracking issue: filed after the 2026-05-15 v0.45.0-alpha.0 release when the user pointed out the mermaid / rand bullets.
