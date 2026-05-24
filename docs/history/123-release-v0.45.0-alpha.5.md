# Release v0.45.0-alpha.5

**Date:** 2026-05-24
**Previous version:** 0.45.0-alpha.4
**Channel:** Alpha

The first alpha after Classic Layout was removed — Quiet Composer is now the only editor shell. Also restores warm-click load time for large documents, which had regressed during the layout transition.

## Changes

### Improvements

- **Quiet Composer is now the only editor shell.** The earlier multi-column workspace with tab strips, the activity panel rail, the chat panel, and the command palette modal has been removed. Everything you used to do there now lives in one of the surfaces you already know: the floating command bar (⌘K) for prompts, palettes, and quick switches; the flat sidebar for Pinned / Projects / Recent / Tags / Mentions; and the document switcher (⌃Tab / ⌃⇧Tab) for cycling recent files. One coherent interface instead of two parallel ones.

- **Large markdown documents reopen in under a second.** A regression introduced during the layout transition meant the editor's document state was being thrown away every time you switched to another file and back. Returning to a long note now feels instant — roughly six times faster on a 500 KB document — and your undo history is preserved across switches.

### Fixes

- **PDF, DOCX, and EPUB viewers no longer log a teardown error.** Switching from an open EPUB to a different file fired one final layout callback after the EPUB had unmounted, throwing a `paginator.js` error into the developer console. The error was non-fatal — the new viewer rendered normally — but it cluttered the console and broke the "clean console after viewer swap" expectation.

## Under the hood

### Editor cache survives single-document eviction

Quiet Composer is a single-document shell — opening any new file evicts the previous one. The per-document `EditorState` cache that powers instant click-back restores was keyed by tab id, which is freshly minted on each open in this shell. The lookup with the new id always missed, forcing every warm click through full worker-parse plus streaming hydrate. Re-keyed the cache by file path so it survives eviction and reopen.

WebDriver-driven measurement on a 502 KB book fixture: warm-click pipeline cost dropped from ~2.3 s to ~320 ms across three back-to-back cycles. (PR #346)

Also picked up an upstream Tiptap fix that removed a per-keystroke document-tree traversal in the Placeholder extension — a separate, additive perf restoration. (PR #346)

### AW pipeline reads from an in-repo feedback corpus

Every AW skill now loads `.claude/feedback/INDEX.md` at start and pulls in the curated rules that target it. Behavioural corrections from interactive sessions — accumulated previously only in local memory — now live in the repo as `feedback_*.md` files with structured frontmatter, indexed automatically, and visible to every future automated run. New corrections land through a `save-feedback` user skill that writes the rule file, regenerates the index, and stages the change for review.

The full six-phase integration: rule promotion, per-skill loaders, structural skill additions, curated rule lists, the save-feedback skill, and a `VALIDATION.md` confirming the corpus catches known past failure modes. (PR #337, closes #336)

### EPUB renderer teardown guard

Added a one-line null guard on `paginator.js`'s `expand()` method that mirrors the existing guard on `render()` — the vendored foliate-js was missing the same defence on the sibling call path. (PR #344)

### Classic Layout deletion

Removed `Layout.tsx`, `TabBar`, `ChatPanel`, `ChatFooter`, `ActivityStrip`, `CommandPalette`, `NewNoteDialog`, `NewProjectDialog`, `KeyboardShortcutsDialog`, `PreviewInvitation`, `RevertInvitation`, and the legacy `SettingsDialog`. Quiet Composer's components stand on their own. CI selectors updated to match the surviving shell; a handful of Classic-only regression tests retired. (PR #333)

### CI runner image pin

Pinned the Real Tauri E2E job to `macos-26` so it stays on Safari 26.4 — the rolled-forward `macos-15-arm64` image bundled Safari 26.5, whose WKWebView regressed the openFile sentinel poll. Belt-and-braces regression-lock test added so future rotations don't silently re-break.
