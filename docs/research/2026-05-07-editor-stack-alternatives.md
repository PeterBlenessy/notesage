# Editor Stack Alternatives — Tiptap/ProseMirror Replacements

**Date:** 2026-05-07 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | — | Not yet planned |

User reports performance limitations on the current Tiptap v2 + ProseMirror + `prosemirror-markdown` stack and observes that since documents live as markdown on disk and AI agents consume/produce markdown, the rich-text intermediate layer may be unnecessary overhead. This doc evaluates four alternatives — CodeMirror 6 markdown, Milkdown, Lexical, and a "fix in place" approach — against the concrete extension surface in `src/components/editor/extensions/` and the measured numbers in `docs/performance-baseline.md`.

---

## Executive Summary

**The user's intuition is partly right and partly wrong.** Right: the markdown round-trip pipeline in `setMarkdownInEditor` / `loadRawMarkdownIntoEditor` (`src/lib/markdown.ts:1037–1104`) is doing far more work than it needs to — eleven sequential string-rewriting passes per load, plus tiptap-markdown's markdown-it tokenization, plus ProseMirror node construction, plus 38 custom Tiptap extensions worth of plugin initialisation. The baseline confirms it: 100 KB markdown takes 254 ms median to parse (`docs/performance-baseline.md:25`), and that's measured *without* the ~12 string-rewrite passes that production load does. Wrong: replacing the engine wholesale would not turn a 254 ms parse into a 2 ms parse — most editor frameworks that produce a structured document model (Milkdown, Lexical, Tiptap) sit on the same broad cost curve, because the actual cost is "produce a typed AST for 100 KB of markdown and mount a few thousand DOM nodes," not "ProseMirror specifically." The exception is **CodeMirror 6, which doesn't produce a node-tree for the document at all** — it edits text and decorates it with widgets — and that's where the big wins are.

**There are three real options.** (1) **Stay on Tiptap, fix the actual hot paths.** The 254 ms parse number is dominated by `prosemirror-markdown` + tiptap-markdown + the 11-pass HTML pre-encoder, all of which can be attacked without touching the engine. Lowest risk; recovers an estimated 50–70 % of the parse cost; preserves all 8,200 lines of custom extensions; ships in days, not months. (2) **Move to CodeMirror 6 in "Obsidian Live Preview" style** — markdown is the document model, custom blocks become `WidgetType` block decorations, ghost text / search / tags / comments stay as inline decorations. We already ship CM6 (it's the source-mode editor and the code-file editor, ~21 packages already installed). This is the option that genuinely matches the user's intuition. Highest reward at large doc sizes (CM6 routinely handles million-line files in Obsidian and VS Code). Largest migration cost — every Tiptap node-spec extension becomes a CM6 plugin, and inline rich-text affordances (BubbleMenu marks, slash command at-cursor, Tiptap's nested-list keymap) need to be re-implemented. (3) **Move to Milkdown.** Same engine (ProseMirror) so no perf win — only the surface API changes. Not recommended; you'd take all the migration cost with none of the perf benefit.

**Recommendation: Phase 1 fix-in-place, then re-measure.** Before migrating off ProseMirror, exhaust the in-stack wins: collapse the 11 pre/post-processors into one regex sweep, defer `bundled-skills`-style costs, lazy-load extensions, audit `setContent` against the known Tiptap memory-leak bug. If the real-world metric the user cares about (probably tab open or initial load on a large file) drops below the pain threshold, ship that. If it doesn't, **Phase 2 is CodeMirror 6 with markdown as the source model** — a months-long but architecturally cleaner project that aligns with the user's framing. Lexical is rejected: its markdown round-trip story is weaker than Tiptap's (markdown is an import/export afterthought, not the source model), and migrating off ProseMirror is only worth doing if the destination is genuinely different. Keeping ProseMirror under a new wrapper isn't different.

The rest of this doc walks through each option, the actual perf hot paths, and the concrete migration shape for the recommended path.

---

## 1. Where the time actually goes today

Before judging alternatives, name the cost. Three sources of measurement:

**Synthetic benchmark** (`src/perf/markdown.perf.test.ts`, run on M3 / 24 GB):

| Doc size | Parse (ms median) | Serialize (ms median) |
| --- | --- | --- |
| 1 KB | 19 | 0.25 |
| 10 KB | 51 | 0.73 |
| 50 KB | 139 | 5.3 |
| 100 KB | 254 | 10.3 |

Parse cost is roughly linear in size beyond 10 KB and includes ~15 ms of editor-creation overhead. Decoration rebuilds (search, tags) are sub-millisecond at 100 KB — not a bottleneck.

**Production load pipeline** (`src/lib/markdown.ts:1073–1104`, `loadRawMarkdownIntoEditor`):

```
rawMarkdown
  → stripAnnotationsFromMarkdown
  → stripNodeIdComments
  → extractTableColumnMetadata
  → stripGhostTaskItems
  → normalizeEmptyTaskItems
  → convertMermaidToHtml
  → convertCalloutsToHtml
  → convertPageBreaksToHtml
  → convertTocToHtml
  → convertLinkPreviewsToHtml
  → convertDrawingsToHtml
  → convertChartsToHtml
  → convertInlineDrawingsToHtml
  → convertInlineChartsToHtml
  → encodeImagePathSpaces
  → convertDataUriImagesToHtml
  → editor.setContent(...)               ← tiptap-markdown parse + ProseMirror tree build
  → EditorState.create(...)              ← reset undo (rebuilds plugin state for ALL extensions)
  → applyTableColumnMetadata             ← second pass over doc
  → applyNodeIdsToEditor                 ← third pass
  → applyAnnotationsToEditor (rAF)       ← fourth pass
```

That's **eleven** string-rewrite passes plus a four-pass post-load fixup, running on every file open / tab restore / external change. Each pass is `O(n)` over the markdown text, and the regex passes are not cheap because some involve global multi-line patterns. On a 100 KB doc, each pass is roughly 1–5 ms; the eleven of them likely sum to 30–60 ms before tiptap-markdown even sees the input.

**Extension surface load cost.** `src/components/editor/extensions/` holds 38 files totaling **8,210 lines** of custom Tiptap plugin code:

| Class | Files | Examples |
| --- | --- | --- |
| Custom node specs | 7 | `callout`, `drawing`, `chart`, `mermaid`, `link-preview`, `page-break-node`, `local-image` |
| Decoration plugins | 11 | `comment-mark`, `inline-diff`, `search-highlight`, `tag-highlight`, `mention-highlight`, `date-highlight`, `ghost-text`, `ai-suggestion`, `page-breaks`, `toc`, `decoration-factory` |
| Suggestion popups | 4 | `slash-command`, `tag-suggestion`, `mention-suggestion`, `date-suggestion` |
| Table extensions | 7 | `table-aggregation`, `table-sort`, `table-filter`, `table-sparkline`, `table-header-attrs`, `table-header-menu`, `table-markdown` (custom serializer) |
| Behaviour | 6 | `link-click`, `paste-handler`, `send-to-ai`, `typography-overrides`, `themed-highlight`, `drag-handle` (deferred) |

Every editor instantiation initialises every plugin. ProseMirror pays this on every `setContent` because `EditorState.create` is run inside `loadRawMarkdownIntoEditor` to clear the undo history. That's the second hidden cost: roughly 8K LOC of plugin init per file open.

**Probable Tiptap-internal hits the team is feeling.** Two concrete signals reported in the Tiptap issue tracker that match this codebase's shape: (a) `setContent` causes node/ProseMirror-instance leaks if not paired with `editor.destroy()` ([ueberdosis/tiptap#499](https://github.com/ueberdosis/tiptap/issues/499)) — `Editor.tsx` uses a single shared editor and swaps state via `view.updateState` rather than destroying, which sidesteps the leak but pays the plugin re-init cost; (b) editors with thousands of nodes get quadratic slowdowns on large incremental edits ([ueberdosis/tiptap#4491](https://github.com/ueberdosis/tiptap/issues/4491)). The 100 KB perf fixture has roughly 1,500–2,500 ProseMirror nodes depending on content density, which is right on that boundary.

---

## 2. Option A — CodeMirror 6 with markdown as the source model

| Attribute | Details |
| --- | --- |
| Engine | CodeMirror 6 + `@lezer/markdown` (incremental, fragment-reusing parser) |
| Document model | Plain text + `Tree` (Lezer syntax tree) — **no node tree, no AST mutation** |
| Markdown round-trip | Trivially perfect — markdown IS the document |
| Decoration system | Inline marks + block widgets via `Decoration.replace` / `Decoration.widget`; viewport-only by default (huge perf win) |
| React components in widgets | Supported via `WidgetType.toDOM` rendering React subtree (manual mount/unmount) |
| Already in stack | Yes — 21 `@codemirror/*` packages installed, used by `SourceModeEditor` and `CodeEditor` for code files |
| Public users at scale | Obsidian (live preview), Notion's mobile editor, VS Code (editor), iA Writer — all handle million-line documents |
| License | MIT |
| Last release | `@codemirror/view` 6.41.0, `@codemirror/lang-markdown` 6.5.0 — actively maintained |

### Why this fits the user's mental model

The user's argument was: "we keep documents as markdown, AI works on them as markdown, the layers we have add unnecessary overhead." That's literally the CM6 model. The buffer is the markdown text. There is no parse-to-AST step on every keystroke — Lezer reuses tree fragments incrementally, so a typed character only re-parses the surrounding paragraph. There is no serialize step on save — `editor.state.doc.toString()` IS the markdown. The eleven pre-processors and four post-processors in `markdown.ts` collapse to **zero** because the conversions exist only to round-trip through ProseMirror's structured model; CM6 never leaves text.

### What you keep, what you lose, what you rebuild

**Keep cleanly:**
- All decoration-only extensions: search-highlight, tag-highlight, mention-highlight, date-highlight, comment-mark, ai-suggestion, inline-diff, ghost-text, page-breaks. CM6 decorations are if anything more ergonomic than ProseMirror's — single `StateField<DecorationSet>` per concern, viewport-aware, smaller boilerplate. The decoration-rebuild benchmarks are already sub-ms; they'd stay sub-ms.
- All suggestion popups (slash-command, tag-suggestion, mention-suggestion, date-suggestion): trigger logic is keymap-driven and the popup is a normal React portal. CM6 has `@codemirror/autocomplete` for the discovery half.
- Source-of-truth pipeline: read file → set buffer → write file. No intermediate format.

**Lose / harder:**
- **Inline rich-text rendering** (bold/italic shown as `**bold**` vs. shown as **bold**). Two strategies, both viable:
  - "Source view" (what `SourceModeEditor` does today): show the markdown as-is with syntax highlighting. Simpler.
  - "Live preview" (Obsidian, Typora, codemirror-rich-markdoc): use `Decoration.mark` to style the text and conditionally hide the syntax markers when the cursor isn't on the line. Harder, but solved territory — see `codemirror-rich-markdoc` and Obsidian's open-source plugins for reference. The widget-on-line-break restriction noted in CM6 docs is real but worked around by every Obsidian plugin doing this.
- **Custom block widgets that look like editable nodes** (callout, drawing, chart, link-preview, mermaid, dynamic table). CM6 strategy: the source markdown stays as a fenced block (` ```chart ` or ` > [!note] `); a `Decoration.replace` swaps the lines for a React-mounted widget when the cursor is outside the block, and reveals the source when inside. This is the Obsidian Live Preview pattern. Cost: one `WidgetType` per kind, ~150–300 LOC each, plus a ViewPlugin that scans Lezer's syntax tree and emits the decorations. Total estimate: ~2,000–3,000 LOC across the 7 custom node types.
- **Dynamic tables.** This is the hardest piece. Tiptap's `@tiptap/extension-table` gives Tiptap-native cell selection, column resize, header keymap. CM6 has no native table model. Two paths: (a) keep tables as markdown text and add a "table editor" that materialises a temporary widget over a table block when focused (like a spreadsheet popup); (b) drop in a separate React-rendered table component as a block widget and lose in-cell text editing affordances. Either way, this is the single largest design question of the migration.
- **`UniqueID` / per-node id**. Currently used for in-session comment anchoring. CM6 anchors to character offsets, mapped through `ChangeSet.mapPos`, which is functionally equivalent — but the existing `.notesage/comments/{uuid}.json` sidecars expect node-IDs. Migration path: persist character offsets on save and re-derive on load, or keep node-IDs in HTML comments.
- **Tiptap's BubbleMenu floating UI**. CM6 has its own equivalents (`@codemirror/view`'s `tooltip` extension and `@codemirror/lint` style overlays). Re-implementation is straightforward but not a one-line swap.

**Rebuild from scratch:**
- The markdown ↔ HTML conversion shims in `markdown.ts` (callouts, drawings, charts, link previews, page breaks, TOC, mermaid, inline charts, inline drawings, data URI images). All of these go away. Not a rebuild — a deletion.
- `table-markdown.ts` (custom GFM table serializer for ProseMirror): goes away. Tables are markdown.
- The per-tab `EditorState` cache (`Editor.tsx`'s cachedEditorStatesRef): goes away. CM6's state is cheap to recreate; the equivalent is keeping the buffer Text + transaction history per tab in a `Map<tabId, EditorState>` which is what the source mode already does.

### Performance ceiling

Realistic numbers, drawn from comparable projects:

| Operation | Current Tiptap (100 KB) | CM6 expectation (100 KB) | Source |
| --- | --- | --- | --- |
| Initial load (parse + mount) | ~280 ms (254 ms parse + ~25 ms render) | < 30 ms | Lezer is incremental, no ProseMirror tree build, viewport-only render |
| Keystroke latency (decorations rebuild) | already sub-ms | sub-ms (viewport-only) | both fine |
| Memory per open document | ~5–15 MB ProseMirror state + plugin state | ~1–3 MB Text rope + Tree fragments | both fine, CM6 cheaper |
| Largest doc the editor handles fluidly | ~100–200 KB before degradation | millions of lines (Obsidian) | upstream evidence |

The big win is **cold open + tab switch**. The decoration-rebuild path is already fast enough that CM6 won't help there.

### Migration complexity

Honest estimate: 6–10 engineer-weeks to ship feature parity for a maintainer who knows both ecosystems, longer for someone learning CM6 patterns. The deletion side (markdown.ts shim layer) recovers ~600–800 LOC. The reimplementation side is dominated by:

| Workstream | LOC est. | Risk |
| --- | --- | --- |
| Buffer/IPC plumbing (load file → CM6 state → save file) | 200 | Low — `SourceModeEditor` already does this |
| All 11 decoration plugins ported | 1,200 | Low — straightforward; CM6 decorations are simpler than ProseMirror |
| 4 suggestion popups | 600 | Low — `@codemirror/autocomplete` does most of it |
| 7 custom block widgets (callout, drawing, chart, mermaid, link-preview, page-break, image) | 2,500 | Medium — design pattern is Obsidian's, well-trodden, but each one is React-mount work |
| Dynamic table editing | 1,200 | High — no obvious off-the-shelf solution |
| Live-preview rich text (bold/italic/headings inline) | 800 | Medium — `codemirror-rich-markdoc` is a reference but minimal |
| Slash command (cursor-position popup, block insertion, AI actions) | 400 | Low |
| BubbleMenu rebuild | 300 | Low |
| Markdown round-trip tests reframed (text in == text out) | trivial | the win — most current round-trip test scaffolding becomes a noop |

Rough total: ~7,200 LOC new, ~800 LOC deleted, net ~6,400 LOC churn. Most of it is mechanical port work; the table question is the one that needs design.

---

## 2b. Sub-option — Hybrid: WYSIWYG Tiptap for editing, CM6 as the canonical surface

Don't migrate yet — first ask whether the existing `SourceModeEditor` (already CM6) could be promoted from "source view" to default and Tiptap demoted to an opt-in WYSIWYG mode. If most users live in source mode anyway, the perf problem goes away with no migration. Currently the toggle is per-tab. This is essentially free to test and would tell you whether the CM6 path is worth the full migration before committing.

---

## 3. Option B — Milkdown (ProseMirror + Remark)

| Attribute | Details |
| --- | --- |
| Engine | ProseMirror (same as Tiptap) |
| Markdown | Remark (mdast) instead of markdown-it |
| Latest version | 7.20.0 (March 2026), 11.4k GitHub stars, actively maintained |
| Crepe | A "batteries-included" higher-level wrapper since 7.5.0 — opinionated UI, less plugin assembly |
| License | MIT |

### Why it doesn't help

Milkdown sits on top of ProseMirror. Its document model is a ProseMirror node tree. Its parse step is "remark mdast → ProseMirror tree" instead of "markdown-it tokens → ProseMirror tree" — but the dominating cost (constructing thousands of typed nodes) is identical. There is no published evidence that Milkdown's parse is meaningfully faster than `prosemirror-markdown`, and architecturally there's no reason it would be.

What Milkdown does offer over Tiptap: cleaner composition API, batteries-included Crepe editor, slightly better-documented internals. But none of those address performance, and migrating to Milkdown would still cost most of the 8,200 LOC rewrite — every custom Tiptap extension becomes a Milkdown plugin (different lifecycle, different schema declaration, different keymap registration). All migration cost, no perf benefit.

**Verdict: do not pursue.**

---

## 4. Option C — Lexical

| Attribute | Details |
| --- | --- |
| Engine | Lexical (Meta) — own immutable state model, no ProseMirror, no virtual DOM |
| Latest version | 0.44.0 (April 2026), 23.4k GitHub stars, ~1.1M weekly npm downloads |
| Markdown | `@lexical/markdown` — import/export only; markdown is not the source model |
| Performance claim | Designed for Facebook/Workplace scale; minimal reconciliation, only re-renders changed text ranges |
| License | MIT |
| Tooling | TypeScript 74 %, Vitest, Playwright |

### Strengths

- Real production scale (Facebook comments / Messenger / Workplace docs).
- Immutable state model is faster than ProseMirror for very large documents in collaborative editing scenarios — that's the use case Meta optimised for.
- Plugin/transformer model is approachable; less surface than ProseMirror.
- Better React integration story than Tiptap (Tiptap's React layer is famously thin and leaks plugin lifecycle into hooks).

### Weaknesses for Notesage specifically

- **Markdown is import/export, not source.** `@lexical/markdown` parses markdown into Lexical's node tree once on load and serialises out on save. That's exactly the round-trip cost the user is complaining about, with a different label. Recent Lexical releases ([@facebook/lexical CHANGELOG](https://github.com/facebook/lexical/blob/main/CHANGELOG.md)) include multiple fixes for ordered-list escaping and round-trip double-escapes, signalling that markdown round-trip fidelity is still being chased.
- **Decoration model is different and weaker** for the kinds of annotations Notesage relies on. Lexical has "node decorators" (React subtree mounted at a node position) and class-based formatting, but the equivalent of "highlight every match of /foo/ across the document with two CSS classes that distinguish current vs other matches and survive document edits" — i.e. SearchHighlight, TagHighlight, CommentMark, AISuggestion — is implemented through node-tree mutation patterns rather than ProseMirror's pure-decoration overlay. Some of the inline-diff and comment-anchor tricks would need redesign.
- **Custom node migration cost is roughly equal to a Tiptap → Milkdown port** — every Tiptap node spec becomes a Lexical `DecoratorNode`/`ElementNode` subclass. ~6,000 LOC of churn.
- **Smaller ecosystem of off-the-shelf rich blocks** for the kinds of things Notesage has (charts, drawings, link previews). Each becomes a `DecoratorNode` you write yourself.

### When Lexical would be the right answer

If Notesage's bottleneck were "live multi-user collaborative editing with hundreds of concurrent cursors," Lexical would beat ProseMirror handily. That isn't the bottleneck. The bottleneck is "open a 100 KB markdown file fast and don't drop frames while typing." Lexical doesn't help with the first (markdown is still parsed on load) and matches ProseMirror on the second (both are fast enough already).

**Verdict: do not pursue. Same migration cost as CodeMirror, less perf benefit, weaker fit for the markdown-native model the user described.**

---

## 5. Option D — Stay on Tiptap, fix the actual hot paths

Before committing to a migration, attack the things measurably costing time. None of these requires changing engines.

### D1. Collapse the 11-pass HTML pre-encoder

`setMarkdownInEditor` and `loadRawMarkdownIntoEditor` chain 11 string-rewrite passes (callouts, drawings, charts, link previews, page breaks, TOC, mermaid, inline charts, inline drawings, data URI images, image-path encoding). Each is `O(n)` over the markdown.

Fix: a single `markdown-to-internal-html` pass that walks the text once and emits all the placeholder HTML in one go. Tooling: a comrak or `markdown-it` plugin pipeline that runs in one pass instead of 11 regex sweeps. Estimated win: 30–60 ms shaved off 100 KB load.

### D2. Make `loadRawMarkdownIntoEditor` not destroy + recreate plugin state

The current implementation calls `editor.chain().setContent(...)` then immediately `EditorState.create({ doc, plugins })` to clear undo history. That second step rebuilds every plugin's initial state from scratch on every load — including the 11 decoration plugins, which then re-derive their entire `DecorationSet` on the first frame. For the comment-mark and tag-highlight plugins this means re-walking the doc.

Fix: replace `EditorState.create` with a transaction that sets `addToHistory: false` and then explicitly clears history via the history extension's API. Estimated win: 10–30 ms per tab open at 100 KB and proportional to extension count.

### D3. Audit `setContent` against the leak issue

[ueberdosis/tiptap#499](https://github.com/ueberdosis/tiptap/issues/499) reports that switching documents with `setContent` leaks node and ProseMirror instances. The current `Editor.tsx` keeps a single shared editor and only calls `view.updateState`, which avoids the leak — but the per-tab `cachedEditorStatesRef` could pin large states in memory if `closeTab` doesn't delete. Worth a memory profile across many tab open/close cycles.

### D4. Lazy-load extensions

Currently every editor instance loads all 38 extensions even for files that don't use them (a plain prose document still pays for chart, drawing, mermaid, link-preview, table-aggregation, table-sort, table-filter, table-sparkline, etc.). Lower-effort cousin: split the extension list into "always" (paragraph, headings, lists, marks, search, comments, ghost-text) and "on-demand" (the 7 custom block specs + 7 table extensions), and only register the on-demand set when the doc actually contains the corresponding nodes after a fast scan. Estimated win: 20–40 ms on the typical doc.

### D5. Defer suggestion-extension wiring

`tag-suggestion`, `mention-suggestion`, `date-suggestion`, and `slash-command` are only useful when the user is typing — they don't need to be active on the first paint of a freshly loaded doc. Wire them lazily after first idle. Modest but free.

### D6. Re-measure the real-world metric

The synthetic benchmark says 254 ms for 100 KB parse. The user reports performance limitations but the actual end-user metric isn't pinned down (tab switch? open a long doc? typing latency? scroll?). `[perf:tab-load]` is instrumented in `Editor.tsx:138-157` — capture a few traces at the size where the user feels pain and compare to the synthetic budget. Without that, any optimisation is speculative.

### Total realistic Phase 1 win

D1 + D2 + D4 + D5 in aggregate: probably half the parse cost. 100 KB tab open might drop from ~280 ms to ~140 ms. Not transformative but easily achievable in 1–2 weeks with no migration risk.

---

## Comparison

| Criterion | Tiptap (today) | Tiptap fix-in-place (Option D) | CodeMirror 6 (Option A) | Milkdown (B) | Lexical (C) |
| --- | --- | --- | --- | --- | --- |
| Engine | ProseMirror | ProseMirror | Lezer + CM6 (text + tree) | ProseMirror | Lexical (proprietary) |
| Markdown is the source model | No (intermediate ProseMirror tree) | No | **Yes** | No | No (import/export) |
| 100 KB parse, end-to-end load | ~280 ms | ~140 ms (est.) | < 30 ms (est.) | ~280 ms | ~250 ms (similar shape) |
| Decoration system fitness for our needs | excellent | excellent | excellent | excellent | adequate (different model) |
| Custom block ergonomics | excellent (NodeView + ReactNodeViewRenderer) | excellent | good (WidgetType + manual React mount) | excellent | good (DecoratorNode) |
| Inline rich-text | native | native | requires live-preview decoration trick | native | native |
| Dynamic table support | excellent (Tiptap table) | excellent | poor (no native model — biggest design risk) | excellent | adequate |
| Already in stack | yes (38 extensions, 8.2K LOC) | yes | yes (21 packages, source mode + code editor) | no | no |
| Migration risk | none | low | medium-high (table redesign, live-preview UX) | high (full rewrite, no perf win) | high (full rewrite, weak markdown story) |
| LOC churn estimate | 0 | 200–500 | ~6,400 net | ~6,000 net | ~6,000 net |
| Engineer-weeks | 0 | 1–2 | 6–10 | 6–10 | 6–10 |
| Aligns with user's "markdown-native" framing | no | no | **yes** | no | no |
| License | MIT | MIT | MIT | MIT | MIT |

## Recommendation

**Two-phase approach.**

**Phase 1 — Fix in place (1–2 weeks).** Implement D1–D5 from Option D. Specifically:
1. Capture `[perf:tab-load]` traces from the user's actual workload — pin down the metric we're optimising.
2. Collapse `markdown.ts`'s 11 pre-processors and 4 post-processors into one walk per direction.
3. Replace `EditorState.create` history-clear with the history extension's clear API.
4. Lazy-register custom block extensions (chart, drawing, mermaid, link-preview, page-break, table-*, ai-suggestion) based on doc content scan.
5. Defer `tag-suggestion` / `mention-suggestion` / `date-suggestion` / `slash-command` until first user idle.
6. Re-measure and ship. If the perceived perf complaint is gone, stop here — the cost of a migration is not justified.

**Phase 2 — CodeMirror 6 markdown (only if Phase 1 isn't enough).** If the user's pain persists after Phase 1, commit to migrating off ProseMirror to CM6. Sequencing:
1. **Spike (1 week):** prototype the live-preview decoration approach for headings, bold, italic, links, and one custom block (callout). Validate the React-mount pattern in a `WidgetType.toDOM`. Validate that decoration-rebuild stays sub-ms at 100 KB. Validate the table strategy (this is the riskiest unknown — pick one of the two design options before committing).
2. **Phase 2a (3 weeks):** port all decoration-only extensions (search, tags, mentions, dates, comments, ghost-text, ai-suggestion, inline-diff). Ship behind a feature flag (`settings.editorEngine: "tiptap" | "cm6"`) so the rollout can be gradual and reversible.
3. **Phase 2b (3–4 weeks):** port the 7 custom block widgets and the 4 suggestion popups.
4. **Phase 2c (1–2 weeks):** dynamic tables. Design choice gate: in-cell editing with a popover spreadsheet, or block-level table widget without in-cell affordances.
5. **Phase 2d (1 week):** delete the 11-pass markdown shim layer in `markdown.ts`, the per-tab `cachedEditorStatesRef`, and the Tiptap dependency tree.

**Reject Milkdown and Lexical.** Both carry the same migration cost as CM6 with far weaker matches to the user's actual problem statement. Milkdown is ProseMirror under a new name; Lexical's markdown story is import/export, not source-model.

## Open Questions

- **What's the actual user-facing metric that hurts?** Tab open latency, typing lag at large doc sizes, scroll jank, tab-switch latency, app cold start, something else? The synthetic 254 ms parse number suggests tab open is the prime suspect, but that needs confirming with `[perf:tab-load]` traces from the user's machine. Without this, Phase 1's success criterion is undefined.
- **Dynamic table strategy in CM6.** This is the single largest design unknown if Phase 2 happens. Worth a separate spike before committing.
- **How committed is the team to live-preview WYSIWYG vs. source-with-syntax-highlighting?** If users would accept a styled source view (which `SourceModeEditor` already provides) as the default, the CM6 migration becomes dramatically simpler — most of the live-preview decoration work disappears. Worth user-testing.
- **Comment anchor migration.** The current sidecar JSON keys comments by per-node UUIDs (`UniqueID` extension). CM6 uses character offsets. A migration would need to translate one to the other on first load and keep the sidecar format stable. Doable but needs a forward-and-back-compat plan.
- **External providers' assumptions.** Direct-API tools `read_file` / `write_file` and Copilot LSP `textDocument/didOpen` already see markdown. Nothing in the AI-providers layer (`docs/features/ai-providers.md`) assumes the editor's internal model — so the migration is invisible to that layer. Worth confirming in code.
- **Cost of running both engines in parallel during the rollout.** A feature flag means both Tiptap (~38 extensions, ~8.2K LOC) and CM6 are built into the bundle for some weeks. Bundle size impact and the decision on when to drop the legacy path need a plan.

## Sources

- Notesage performance baseline ([`docs/performance-baseline.md`](../performance-baseline.md))
- Notesage editor architecture ([`docs/features/editor-architecture.md`](../features/editor-architecture.md))
- Notesage markdown shim layer (`src/lib/markdown.ts:1037–1104`)
- [Tiptap issue #499 — setContent memory leak](https://github.com/ueberdosis/tiptap/issues/499)
- [Tiptap issue #4491 — slow with large content](https://github.com/ueberdosis/tiptap/issues/4491)
- [Tiptap issue #5031 — large doc Vue 2 → Vue 3 quadratic slowdown](https://github.com/ueberdosis/tiptap/issues/5031)
- [Tiptap performance guide](https://tiptap.dev/docs/guides/performance)
- [CodeMirror 6 decoration example](https://codemirror.net/examples/decoration/)
- [@lezer/markdown — incremental markdown parser](https://github.com/lezer-parser/markdown)
- [codemirror-rich-markdoc — CM6 markdown live-preview prototype](https://github.com/segphault/codemirror-rich-markdoc)
- [Ixora — CM6 interactive markdown extensions](https://codeberg.org/retronav/ixora)
- [Obsidian editor extensions docs](https://docs.obsidian.md/Plugins/Editor/Editor+extensions)
- [Milkdown 7.20.0 — ProseMirror + Remark](https://github.com/Milkdown/milkdown)
- [Lexical 0.44.0 — Meta's editor framework](https://github.com/facebook/lexical)
- [PkgPulse — Tiptap vs Lexical vs Slate vs Quill 2026](https://www.pkgpulse.com/guides/tiptap-vs-lexical-vs-slate-vs-quill-rich-text-editor-2026)
