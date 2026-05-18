# Release v0.44.0-alpha.2

**Date:** 2026-05-11
**Previous version:** 0.44.0-alpha.1
**Channel:** Alpha

This alpha is the real shipping cut of the post-v0.43 work — `v0.44.0-alpha.0`'s CI failed and never reached users, and `v0.44.0-alpha.1` was a tiny test-cleanup patch on top. Everything described in alpha.0's release notes is effectively new for users updating from v0.43 or alpha.1, AND four new HTML viewer security toggles + a visible-folder migration land in this alpha.

## Changes

### Features

- **Block external resources in the HTML viewer.** Settings → System → HTML viewer → "Block external resources" — toggle ON to strip `https://...` URLs from `<img src>`, `<link href>`, `<source srcset>`, and similar attributes before render. Local relative paths and same-directory files still load. Default OFF.

- **Allow scripts in local HTML files (opt-in).** Settings → System → HTML viewer → "Allow scripts" — toggle ON to render HTML files in an isolated `allow-scripts`-only iframe so same-directory `<script src="./local.js">` can execute. External CDN scripts are NOT included (separate toggle below). Default OFF.

- **Unsafe preview mode (per-tab, session-only).** A new toolbar button on each open HTML file shows a security acknowledgment dialog; accept and the file renders in `allow-scripts`-only iframe with raw HTML — CDN scripts and inline `<script>` blocks all execute. Switching tabs resets the toggle. For "I trust this single file" workflows that don't warrant flipping the persistent allow-scripts setting on.

- **Allow `<form>` submissions in HTML viewer.** Settings → System → HTML viewer → "Allow forms" — toggle ON to keep `<form>`, `<input>`, `<button>`, `<select>`, and form-submission attributes (action / method) in the sanitised tree. Useful for local docs that legitimately contain forms. Default OFF.

- **Width + alignment now persist on charts, drawings, link-previews, and images.** Hover the block → pick 25 / 50 / 75 / 100% width and left / center / right alignment from the popover. The choice survives a save and reappears the next time you open the file. *(Originally in alpha.0; first time effectively shipping.)*

- **`Cmd+=` / `Cmd+-` / `Cmd+0` zoom now also works in the PDF viewer.** Markdown editor and PDF share the same shortcut. *(Originally in alpha.0.)*

### Improvements

- **Research and templates folders are now visible in the workspace.** They used to live under `.notesage/` (hidden) and were only reachable through the AI chat. Notesage now creates `research/` and `templates/` at the project root the first time you save research or open a template picker. Existing hidden content is migrated on next launch.

- **HTML files open as a real rendered page.** No iframe wrapper — `.html` files render inline with the same toolbar, theme toggle, `Cmd+T`, and `Cmd+F` as every other viewer. Dangerous tags (`<script>`, `<iframe>`, `<object>`, `<embed>`) are stripped before rendering. *(Originally in alpha.0; the four security toggles above are layered on top of this rewrite.)*

- **Embedded blocks have more breathing room.** Images, charts, drawings, and link-preview cards now sit with a generous margin above and below. *(Originally in alpha.0.)*

- **Status tray completion picker is now a dropdown.** Settings → Inline Completion and the StatusTray popover now show the same control. *(Originally in alpha.0.)*

- **The 494 KB book opens in ~3 seconds again.** Fixes a regression introduced during the alpha.0 branch where the editor's CSS `zoom` property was applied unconditionally and put every descendant in a slow layout-containment path. *(Originally in alpha.0.)*

### Fixes

- **Width / alignment values stop disappearing after a tab-switch.** Schemas in the markdown-parse worker now mirror the production extensions; ProseMirror's DOMParser no longer drops those attributes during reload. *(Originally in alpha.0.)*

- **Editor no longer crashes when you insert a chart, drawing, or link preview.** `<Tooltip>` outside any `<TooltipProvider>` caught by the error boundary; now all four reference implementations are regression-tested. *(Originally in alpha.0.)*

- **Reopening a doc no longer scrolls "a few paragraphs down" before snapping to the right place.** Restores from the live saved ratio (tracked on every scroll, debounced 150 ms) instead of the stale viewport-cache value. *(Originally in alpha.0.)*

- **`Cmd+-` no longer toggles raw markdown mode on Swedish keyboards.** The source-mode chord was matching the physical key position (`event.code === "Slash"`), which on Swedish ISO is the `-` key. Now matches the produced character. *(Originally in alpha.0.)*

- **Image markdown serializer closes the block correctly.** Without the trailing `\n\n` separator, the next heading was concatenated to the same line and its `#` got backslash-escaped — corrupting the saved file. *(Originally in alpha.0.)*

## Known issues — still deferred

- **Image hover toolbar.** Width / alignment still can't be set on images via hover controls (markdown round-trip works, but the popover doesn't appear on hover). Same status as alpha.0.

- **Toolbar align (`Cmd+Shift+L/E/R`) doesn't align embedded blocks.** Chart / drawing / image / link-preview blocks ignore the top-toolbar alignment buttons; alignment for those types is set via the per-block hover popover. A clean unification on the TextAlign extension's `textAlign` attribute caused the streaming-hydrate regression, so toolbar align is currently scoped to text nodes only.

## Under the hood

### Dev process — Agentic Workflow pipeline maturity

This alpha is the first one assembled with material help from the AW pipeline (the `aw-*` workflows that turn issues into PRs). Most of the changes here either landed via that pipeline or improved how it operates:

- **#187 (`aw-pipeline`)** — every stage now reads human comments since the latest `refined` marker. Before this fix, override comments on issues only reached `aw-review`; `aw-refine` / `aw-slice` / `aw-tdd` worked from the body alone and silently dropped corrections, producing PRs that ignored explicit user feedback. Closes the "I said that twice and the agent ignored it" loop.

- **#193 (`aw-review`)** — branch-prefix filter now matches `claude/*` instead of PR author. After the `WORKFLOW_PAT` switch, bot-authored PRs are authored by the PAT owner (not `claude[bot]`), so the old author-based filter rejected every bot PR and `aw-review` silently skipped them.

- **#194 (PRD docs)** — the `aw-ci-repair` PRD + tasks breakdown land before the implementation, so the AW pipeline has filesystem references to read.

- **#202 (`aw-ci-repair`)** — new pipeline addition that auto-fixes recurring CI perf-budget flakes. Two pieces compose: (a) a vitest regression-lock test (`no-bare-perf-budget.test.ts`) that fails when a perf assertion uses a bare numeric literal as its budget; (b) a new `aw-ci-repair` skill + workflow triggered by `workflow_run.completed: failure` on bot-authored draft PRs, auto-patching the same `PERF_BUDGET_MULTIPLIER` wrap on tests missing it. Comments-and-exits on snapshot drift / DOM-changed / anything else outside the documented pattern set. One repair attempt per PR.

### HtmlViewer security architecture

The four new HTML viewer toggles compose on top of alpha.0's DOMPurify rewrite. Render-path priority in the rebuilt viewer:

1. **Unsafe preview mode** (toolbar toggle + dialog, session-only) — raw `content` in `sandbox="allow-scripts"` iframe. Most aggressive.
2. **`htmlViewerAllowScripts` setting** (persistent) — pre-processed HTML (local `<script src="./...">` resolved via `read_file` and inlined) in `sandbox="allow-scripts"` iframe. Local scripts only.
3. **DOMPurify sanitised inline div** — default safe path. `<script>` / `<iframe>` / `<object>` / `<embed>` always stripped regardless of any toggle.

The `htmlViewerAllowForms` and `htmlViewerBlockExternalResources` settings modify the DOMPurify sanitiser config (FORBID_TAGS / attribute hooks), not the render path.

### Performance — multiplier raised to 4x on CI

`test.yml` now sets `PERF_BUDGET_MULTIPLIER=4` for the frontend perf job (up from 3x), and `preview-fidelity.spec.ts`'s p95 timer-delay assertion now honors the same env var instead of a hardcoded 500 ms ceiling. macOS GitHub runners under shared load consistently land 3.3–3.5x the local baseline; 3x left no headroom and three of the last five bot PRs flaked. 4x absorbs current variance without hiding ≥25% real regressions.

### Files Changed

~50 files across 10 PRs (#174, #186, #187, #189, #191, #193, #194, #196, #197, #201, #202) merged on `main` since the v0.44.0-alpha.1 tag.
