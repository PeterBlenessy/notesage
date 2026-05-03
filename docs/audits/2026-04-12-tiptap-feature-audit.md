# Tiptap Feature Audit

**Date:** 2026-04-12 **Tiptap version:** v3.22.3 (all @tiptap packages) **Notesage version:** 0.30.2

## Current Coverage Summary

Notesage uses **26 official Tiptap packages** and **32+ custom extensions**. This audit compares our implementation against the full official Tiptap extension catalog (68 free + 9 paid = 77 total) and evaluates the build-vs-buy trade-off for each feature.

---

## Master Feature Matrix

Legend for **Source** column:

- **Tiptap** = using the official `@tiptap` package as-is
- **Tiptap + Custom** = official package extended with our own code on top
- **Custom** = entirely our own implementation, no official equivalent used
- **Not implemented** = feature doesn't exist in Notesage yet

Legend for **Switch to Tiptap?** column:

- **Already using** = we use the official package
- **Keep custom** = our implementation is better suited to our needs (with rationale)
- **Adopt** = we should add this official extension
- **Skip** = not worth implementing
- **N/A** = paid or requires major architecture change

### Nodes

| Feature | Tiptap Official | Source | Our Implementation | Switch to Tiptap? | Rationale |
| --- | --- | --- | --- | --- | --- |
| Document | `@tiptap/extension-document` | Tiptap | Via StarterKit | Already using | — |
| Paragraph | `@tiptap/extension-paragraph` | Tiptap + Custom | `ParagraphWithOverrides` adds transient font/size/line-height attributes | Keep custom | Official paragraph doesn't support transient typography overrides; switching would lose per-paragraph font control without markdown pollution |
| Text | `@tiptap/extension-text` | Tiptap | Via StarterKit | Already using | — |
| Heading | `@tiptap/extension-heading` | Tiptap + Custom | `HeadingWithOverrides` adds transient font/size/weight/color attributes | Keep custom | Same rationale as Paragraph — transient attributes are key to our typography system |
| Blockquote | StarterKit | Tiptap | Via StarterKit | Already using | — |
| Bullet List | StarterKit | Tiptap | Via StarterKit | Already using | — |
| Ordered List | StarterKit | Tiptap | Via StarterKit | Already using | — |
| List Item | StarterKit | Tiptap | Via StarterKit | Already using | — |
| Hard Break | StarterKit | Tiptap | Via StarterKit | Already using | — |
| Horizontal Rule | StarterKit | Tiptap | Via StarterKit | Already using | — |
| Code Block | `@tiptap/extension-code-block-lowlight` | Tiptap | Replaces StarterKit's plain CodeBlock; syntax highlighting via lowlight | Already using | — |
| Table | `@tiptap/extension-table` | Tiptap + Custom | Official table + 5 custom plugins (sort, filter, aggregation, sparkline, header menu) + custom markdown serializer | Keep custom | Our table system far exceeds what Tiptap provides; `TableKit` bundle doesn't include any of our dynamic features |
| Table Cell | `@tiptap/extension-table-cell` | Tiptap | With custom border/padding styling | Already using | — |
| Table Header | `@tiptap/extension-table-header` | Tiptap + Custom | `TableHeaderWithAttrs` adds colType, colCurrency, colAggregation, colSortDirection | Keep custom | Column metadata attributes are essential for dynamic tables; official extension has no concept of column types |
| Table Row | `@tiptap/extension-table-row` | Tiptap | No special config | Already using | — |
| Task List | `@tiptap/extension-task-list` | Tiptap | Custom styling (list-none, pl-0) | Already using | — |
| Task Item | `@tiptap/extension-task-item` | Tiptap | Nested: true, flex layout | Already using | — |
| Image | `@tiptap/extension-image` | Tiptap + Custom | `LocalImage` extends Image to resolve local paths via Tauri asset protocol | Keep custom | Desktop app needs Tauri path resolution; official Image only handles URLs |
| Audio | `@tiptap/extension-audio` | Not implemented | — | Skip | Note-taking app; audio embeds not a priority. We have voice transcription instead. |
| Details | `@tiptap/extension-details` (3 pkgs) | Not implemented | — | **Adopt** | Collapsible sections are a core note-taking feature (Notion, Obsidian have it). Medium effort: need markdown round-trip + export pipeline support. |
| Emoji | `@tiptap/extension-emoji` | Not implemented | — | Skip | System emoji input (Cmd+Ctrl+Space) works fine; adding an emoji node type would complicate markdown serialization for minimal gain |
| Mathematics | `@tiptap/extension-mathematics` | Not implemented | — | **Adopt** | High-value for academic/technical users. KaTeX dependency (\~300KB). Needs `$...$` markdown support + Typst/HTML export. |
| Mention | `@tiptap/extension-mention` | Custom | `MentionHighlight` (decoration-based, not node-based) | Keep custom | Official Mention inserts actual nodes into the document model, breaking markdown round-tripping. Our decoration approach renders `@name` as badges without modifying the document. Zero serialization complexity. |
| YouTube | `@tiptap/extension-youtube` | Not implemented | — | Skip (low priority) | Could complement link preview cards, but low value for a note-taking app. If added, should extend `/embed` slash command. |
| Twitch | `@tiptap/extension-twitch` | Not implemented | — | Skip | No use case for a note-taking app |

### Marks

| Feature | Tiptap Official | Source | Our Implementation | Switch to Tiptap? | Rationale |
| --- | --- | --- | --- | --- | --- |
| Bold | StarterKit | Tiptap | Via StarterKit | Already using | — |
| Italic | StarterKit | Tiptap | Via StarterKit | Already using | — |
| Strike | StarterKit | Tiptap | Via StarterKit | Already using | — |
| Code | StarterKit | Tiptap | Via StarterKit | Already using | — |
| Link | StarterKit | Tiptap + Custom | Official Link + custom `LinkClick` extension for internal/external navigation | Keep custom | `LinkClick` handles Tauri tab opening for internal links — official Link only opens URLs in browser |
| Underline | `@tiptap/extension-underline` | Tiptap | Standalone package | Already using | — |
| Highlight | `@tiptap/extension-highlight` | Tiptap + Custom | Extended as `ThemedHighlight` with semantic color names (`data-color` attribute) | Keep custom | Official Highlight stores raw hex colors; our version uses semantic names (yellow, green, blue, etc.) that work correctly across light/dark themes |
| Text Style | `@tiptap/extension-text-style` | Tiptap | Base mark for Color extension | Already using | — |
| Subscript | `@tiptap/extension-subscript` | Not implemented | — | **Adopt** | Small effort, completes formatting palette. Useful for chemistry (H₂O), footnote refs. Needs `~sub~` markdown support. |
| Superscript | `@tiptap/extension-superscript` | Not implemented | — | **Adopt** | Pairs with Subscript. Useful for math (x²), ordinals (1st). Needs `^sup^` markdown support. |

### Functionality — Free

| Feature | Tiptap Official | Source | Our Implementation | Switch to Tiptap? | Rationale |
| --- | --- | --- | --- | --- | --- |
| StarterKit | `@tiptap/starter-kit` | Tiptap | Core bundle | Already using | — |
| Placeholder | `@tiptap/extension-placeholder` | Tiptap | "Start typing or press '/' for commands..." | Already using | — |
| Text Align | `@tiptap/extension-text-align` | Tiptap | Heading + paragraph types | Already using | — |
| Color | `@tiptap/extension-color` | Tiptap | 8-color text palette via TextStyle | Already using | — |
| Bubble Menu | `@tiptap/extension-bubble-menu` | Tiptap | AI actions on text selection | Already using | — |
| Floating Menu | `@tiptap/extension-floating-menu` | Tiptap | **Installed but not mounted** — in package.json only | Evaluate | Could show formatting hints on empty lines. Low priority. |
| Dropcursor | StarterKit | Tiptap | Via StarterKit | Already using | — |
| Gapcursor | StarterKit | Tiptap | Via StarterKit | Already using | — |
| History | StarterKit | Tiptap | Via StarterKit (undo/redo) | Already using | — |
| Character Count | `@tiptap/extension-character-count` | Custom | Word count + reading time computed in `StatusBar.tsx` from `editor.state.doc.textContent` | Keep custom | Our implementation also computes reading time and integrates with the status bar layout. Switching to official would add a dependency for something we already do in \~10 lines. |
| Drag Handle | `@tiptap/extension-drag-handle-react` | Custom | `drag-handle.ts` (deferred, pending unified gutter design) | Keep custom | Our drag handle is integrated with a planned unified left-gutter system (drag + annotations). Adopting official would mean re-integrating later. |
| Font Family | `@tiptap/extension-font-family` | Custom | `typography-overrides.ts` (transient, not serialized to markdown) | Keep custom | **Critical difference:** Official Font Family serializes to inline HTML styles, which would pollute markdown output. Our version applies fonts as transient ProseMirror attributes — they affect rendering but vanish on serialize. This is essential for clean markdown round-tripping. |
| Font Size | `@tiptap/extension-font-size` | Custom | `typography-overrides.ts` (transient) | Keep custom | Same rationale as Font Family — transient attributes vs HTML inline styles |
| Line Height | `@tiptap/extension-line-height` | Custom | `typography-overrides.ts` (transient) | Keep custom | Same rationale as Font Family |
| Typography | `@tiptap/extension-typography` | Custom | `typography-overrides.ts` (smart quotes, em dashes, ellipsis) | Keep custom | Our version is already integrated. Official would be equivalent. Not worth the churn of switching. |
| Background Color | `@tiptap/extension-background-color` | Custom | `ThemedHighlight` with semantic color names | Keep custom | Our implementation is theme-aware (semantic names, not hex values). Official uses raw colors that break across themes. |
| Trailing Node | `@tiptap/extension-trailing-node` | Not implemented | — | **Adopt** | Trivial: 1 package, 1 line of config, zero risk. Fixes the annoying case where users can't click below the last block to add content. |
| List Keymap | `@tiptap/extension-list-keymap` | Not implemented | — | **Adopt** | Trivial: 1 package, 1 line of config. Backspace at list start lifts item, Enter on empty item exits list. Immediate polish improvement. |
| Table of Contents | `@tiptap/extension-table-of-contents` | Not implemented | We have `Cmd+Shift+O` outline in command palette | **Adopt (low priority)** | Could power a persistent floating outline panel. We already have heading-based outline, so this adds discoverability rather than capability. |
| UniqueID | `@tiptap/extension-unique-id` | Not implemented | — | **Adopt (foundational)** | Stable node IDs would improve comment anchoring (currently position-based), enable deep linking, and prepare for collaboration. Challenge: IDs need to survive markdown round-trip. |
| Focus | `@tiptap/extension-focus` | Not implemented | — | **Adopt (low priority)** | Adds CSS class to focused node — could enhance focus mode (Cmd+.) with paragraph dimming. Trivial to add. |
| Invisible Characters | `@tiptap/extension-invisible-characters` | Not implemented | — | Skip (low priority) | Show whitespace/tabs/breaks. Useful for debugging but niche. Would need a toggle in UI. |
| File Handler | `@tiptap/extension-file-handler` | Not implemented | Custom paste/drop handling for images | Evaluate | Could unify file drop handling across types (images, PDFs, audio). We already handle images; incremental value is low. |
| Selection | `@tiptap/extension-selection` | Not implemented | — | Skip | CSS class on selected nodes. No clear use case beyond what browser selection styling provides. |
| Collaboration | `@tiptap/extension-collaboration` | Not implemented | — | N/A | Requires Yjs backend (Hocuspocus). Major architectural addition. On long-term roadmap but not a quick win. |
| Collaboration Caret | `@tiptap/extension-collaboration-caret` | Not implemented | — | N/A | Depends on Collaboration. Same timeline. |
| ListKit | `@tiptap/extension-list-kit` | Not used | — | Skip | Bundle of list extensions we already use individually |
| TableKit | `@tiptap/extension-table-kit` | Not used | — | Skip | Bundle of table extensions we already use individually |
| TextStyleKit | `@tiptap/extension-text-style-kit` | Not used | — | Skip | Bundle of TextStyle extensions; we cherry-pick what we need |

### Functionality — Paid

| Feature | Tier | Est. Cost | Source | Our Implementation | Switch to Tiptap? | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| Comments | Start | \~$50/mo | Custom | `CommentMark` + comment-store + AI agent delegation + multi-turn threads + apply-to-document | Keep custom | **Our version exceeds Tiptap's.** We have AI delegation, threaded conversations, inline diff application. Tiptap's is basic threaded comments only. |
| Export | Start | \~$50/mo | Custom | Typst PDF + docx-rs + ppt-rs + HTML (4 formats) | Keep custom | **Our version exceeds Tiptap's.** We export to 4 formats with templates; Tiptap only does DOCX. Our Rust-side pipeline is faster and more capable. |
| AI Generation | Start | \~$50/mo | Custom | `AISuggestion` + `GhostText` + `ChatPanel` + multi-provider + tool calling | Keep custom | **Our version exceeds Tiptap's.** Multi-provider (Anthropic, OpenAI, Ollama, Copilot, local), tool calling, agent delegation, skill system. Tiptap's is a single-provider text completion. |
| AI Toolkit | Add-on | Custom pricing | Custom | Tool calling + skill system + MCP + 6 built-in tools | Keep custom | **Different approach.** We use open standards (Agent Skills, MCP) vs Tiptap's proprietary API. Ours is more extensible. |
| Pages | Team | \~$150/mo | Custom | `PageBreaks` + `PageBreakNode` + header/footer zones with editable content | Keep custom | **Comparable.** Our print layout mode with three-decoration architecture works well. Tiptap's is more polished but not worth the cost. |
| Import | Start | \~$50/mo | Partial | mammoth.js for "Convert to Markdown" (DOCX -&gt; MD) | Evaluate | Tiptap's preserves formatting into ProseMirror doc model. Our mammoth.js path loses some formatting. Low priority — users rarely import DOCX. |
| Snapshot | Start | \~$50/mo | Not implemented | — | N/A | Document version snapshots. Could be useful but we have git integration for version history. |
| Compare Snapshots | Team | \~$150/mo | Not implemented | — | N/A | We have `InlineDiff` for external changes and git branch diff review. Could be extended for arbitrary version comparison. |
| Tracked Changes | Add-on | Custom pricing | Not implemented | — | N/A | Per-user track changes with attribution. Would be high-value for collaboration but requires major work regardless of build vs buy. |

---

## Custom Extensions with No Tiptap Equivalent

These are entirely Notesage-specific — Tiptap has nothing comparable:

| Extension | Description | Complexity |
| --- | --- | --- |
| **Callout** | Note/Tip/Warning/Important blocks with Obsidian `> [!type]` markdown | Medium — node + input rule + markdown serialization |
| **Drawing** | Inline Excalidraw canvas with ReactNodeViewRenderer | High — Excalidraw integration, sidecar storage, cleanup plugin |
| **Chart** | 10 chart types via Recharts with visual data editor | High — ReactNodeViewRenderer, data editor UI, fenced code storage |
| **MermaidBlock** | Mermaid diagram live rendering | Medium — ReactNodeViewRenderer, mermaid.js integration |
| **LinkPreview** | Rich OpenGraph preview cards with paste detection | Medium — OG fetch, ReactNodeViewRenderer, prompt UI |
| **TagHighlight** | `#tag` badge decorations with click-to-search | Low — decoration plugin, workspace tag index |
| **MentionHighlight** | `@mention` badge decorations with click-to-search | Low — decoration plugin, workspace mention index |
| **DateHighlight** | `//YYYY-MM-DD` badge decorations | Low — decoration plugin |
| **DateSuggestion** | Date picker popup triggered by `//` | Medium — calendar UI, Tiptap suggestion |
| **TagSuggestion** | `#` autocomplete from workspace index | Low — Tiptap suggestion + SQLite query |
| **MentionSuggestion** | `@` autocomplete from workspace index | Low — Tiptap suggestion + SQLite query |
| **SearchHighlight** | Find/replace with match decorations | Medium — regex matching, navigation, performance monitoring |
| **AISuggestion** | Inline AI diff (green insert, red delete) with accept/reject | Medium — decoration plugin, keyboard shortcuts |
| **GhostText** | Copilot/local inline completion ghost text | Medium — widget decoration, Tab/Escape handling |
| **InlineDiff** | Shared diff decorations for external changes + git review | Medium — diff-match-patch integration, accept/reject per hunk |
| **CommentMark** | Comment highlights with status classes + position sync | High — position tracking, Zustand sync, status lifecycle |
| **SendToAI** | Right-click "Add to chat" on images/drawings | Low — context menu, vision detection |
| **TableFilter** | Row filtering with input widget | Medium — decoration plugin, transient state |
| **TableSort** | Click-to-sort headers with indicators | Medium — collator sorting, widget decorations |
| **TableAggregation** | Column aggregation footer (sum/avg/count/min/max) | Medium — computation engine, footer decoration |
| **TableSparkline** | `{{spark:...}}` inline SVG charts | Low — regex detection, SVG rendering |
| **TableHeaderMenu** | Right-click column config (type, currency, aggregation) | Medium — context menu, React portal |
| **SlashCommand** | `/` block insertion menu (14+ types) | Medium — Tiptap suggestion, Tippy.js, ReactRenderer |
| **PageBreaks** | Print layout page boundaries with header/footer zones | High — three-decoration architecture, variable resolution |
| **LinkClick** | Internal file navigation on link click | Low — click handler, Tauri tab integration |

---

## Summary: Build vs Buy Scorecard

| Decision | Count | Extensions |
| --- | --- | --- |
| **Already using Tiptap official** | 18 | StarterKit contents, Table, TaskList/Item, CodeBlockLowlight, Placeholder, TextAlign, Color, BubbleMenu, Underline, TextStyle |
| **Tiptap + our custom layer** | 7 | Paragraph, Heading, Table, TableHeader, Image, Link, Highlight |
| **Keep custom (better than Tiptap)** | 10 | Character Count, Drag Handle, Font Family/Size/Line Height, Typography, Background Color, Mention, Comments, Export, AI, Pages |
| **Adopt from Tiptap (recommended)** | 6 | Trailing Node, List Keymap, Subscript, Superscript, Mathematics, Details |
| **Adopt from Tiptap (low priority)** | 3 | Table of Contents, UniqueID, Focus |
| **Skip** | 7 | Audio, Emoji, Twitch, Selection, Invisible Characters, ListKit/TableKit/TextStyleKit bundles |
| **N/A (paid or major architecture)** | 6 | Collaboration, Collaboration Caret, Tracked Changes, Snapshot, Compare Snapshots, Import |
| **No Tiptap equivalent** | 25+ | Callout, Drawing, Chart, Mermaid, LinkPreview, TagHighlight, SearchHighlight, AISuggestion, GhostText, InlineDiff, etc. |

---

## Recommended Implementation Order

| \# | Feature | Source | Effort | Impact | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Trailing Node | `@tiptap/extension-trailing-node` | Trivial | Medium | 1 line of config. Fixes end-of-document UX. |
| 2 | List Keymap | `@tiptap/extension-list-keymap` | Trivial | Medium | 1 line of config. Better list editing. |
| 3 | Subscript | `@tiptap/extension-subscript` | Small | Medium | \+ toolbar button + `~sub~` markdown |
| 4 | Superscript | `@tiptap/extension-superscript` | Small | Medium | \+ toolbar button + `^sup^` markdown |
| 5 | Mathematics / LaTeX | `@tiptap/extension-mathematics` | Medium | High | KaTeX, `$...$` markdown, export pipeline |
| 6 | Collapsible Details | `@tiptap/extension-details` (3 pkgs) | Medium | High | `<details>` HTML markdown, export pipeline |
| 7 | UniqueID | `@tiptap/extension-unique-id` | Small | Foundational | Stable node IDs for comment anchoring, deep links |
| 8 | Table of Contents | `@tiptap/extension-table-of-contents` | Medium | Medium | Persistent outline panel |
| 9 | Focus | `@tiptap/extension-focus` | Trivial | Low | Enhanced focus mode paragraph dimming |

Items 1-2: under 30 minutes combined, immediate polish. Items 3-4: a couple hours, completes the formatting palette. Items 5-6: highest-impact feature additions for expanding the user base to academic/technical writers.

---

---

# ProseMirror Direct Usage Audit

Tiptap wraps ProseMirror, but many features require dropping below Tiptap's abstraction. This section audits every place Notesage uses ProseMirror directly, evaluates whether each usage is necessary, and identifies the cost of maintaining raw ProseMirror code vs using Tiptap's API.

## ProseMirror Packages Used

All accessed via `@tiptap/pm/*` re-exports (version-locked to Tiptap 3.22.3):

| Package | Via | Used In | Purpose |
| --- | --- | --- | --- |
| `@tiptap/pm/state` | `prosemirror-state` | 20+ files | `Plugin`, `PluginKey`, `EditorState`, `Transaction`, `TextSelection` |
| `@tiptap/pm/view` | `prosemirror-view` | 14 files | `Decoration`, `DecorationSet`, `EditorView` |
| `@tiptap/pm/model` | `prosemirror-model` | 10 files | `Node`, `Fragment`, `DOMParser`, `Schema` |
| `@tiptap/pm/transform` | `prosemirror-transform` | 2 files | `Mapping` (position tracking through changes) |
| `prosemirror-markdown` | Direct dep | 1 file | `MarkdownParser`, `MarkdownSerializer` (via tiptap-markdown) |

**Not used directly:** `prosemirror-commands`, `prosemirror-keymap`, `prosemirror-inputrules`, `prosemirror-history`, `prosemirror-schema-basic`, `prosemirror-schema-list`, `prosemirror-dropcursor`, `prosemirror-gapcursor`, `prosemirror-collab`, `prosemirror-changeset`, `prosemirror-menu` — all consumed through Tiptap's abstractions or StarterKit.

---

## Master ProseMirror Usage Matrix

Legend for **Could use Tiptap instead?**:

- **No — required** = Tiptap has no equivalent API; ProseMirror is the only option
- **No — better at PM level** = Tiptap has a partial equivalent but PM gives us something we need (perf, control, correctness)
- **Partially** = Some parts could use Tiptap, others can't
- **Yes** = Could be refactored to Tiptap's API
- **Yes but not worth it** = Could switch but the churn cost exceeds the benefit

### Decoration-Based Extensions (8 files)

These are the core ProseMirror usage — Tiptap has **zero** decoration management API. Every extension that shows visual overlays without modifying the document must use raw ProseMirror.

| Extension | PM APIs Used | Could use Tiptap instead? | Complexity | Rationale |
| --- | --- | --- | --- | --- |
| `tag-highlight.ts` | `Plugin`, `PluginKey`, `Decoration.inline`, `DecorationSet` | **No — required** | Medium | Inline decorations for `#tag` badge rendering. Rebuilt on every doc change. Tiptap has no decoration API. |
| `mention-highlight.ts` | `Plugin`, `PluginKey`, `Decoration.inline`, `DecorationSet` | **No — required** | Medium | Same pattern as tag-highlight for `@mention` badges. |
| `date-highlight.ts` | `Plugin`, `PluginKey`, `Decoration.inline`, `DecorationSet`, `EditorView.posAtCoords()` | **No — required** | Medium | Date badge decorations + click-to-open date picker via coordinate-to-position mapping. |
| `search-highlight.ts` | `Plugin`, `PluginKey`, `Decoration.inline`, `DecorationSet`, `Transaction.setMeta/getMeta`, `EditorView.domAtPos()`, `tr.replaceWith()`, `schema.text()` | **No — required** | High | Find/replace with match navigation, DOM scrolling, regex search, replace operations. Heavy PM usage — manages match indices, current/other decoration classes, and document mutations. |
| `ghost-text.ts` | `Plugin`, `PluginKey`, `Decoration.widget`, `DecorationSet`, `Transaction.setMeta/getMeta`, `tr.insertText()`, `schema.text()` | **No — required** | High | Copilot-style inline completions. Widget decoration at cursor position. Tab-to-accept creates a transaction that inserts text and clears the ghost. |
| `comment-mark.ts` | `Plugin`, `PluginKey`, `Decoration.inline`, `DecorationSet`, `tr.mapping.map()` | **No — required** | High | Comment highlight decorations with **position remapping** through edits. When the document changes, comment anchor positions are mapped through the transaction's mapping to stay in sync. Syncs remapped positions back to Zustand store on every `docChanged`. |
| `ai-suggestion.ts` | `Plugin`, `PluginKey`, `Decoration.inline`, `Decoration.widget`, `DecorationSet`, `DOMParser.fromSchema()`, `tr.setMeta/getMeta` | **No — required** | High | AI diff overlay (green insert, red strikethrough delete, accept/reject buttons). Uses `DOMParser` to parse markdown-rendered HTML into PM nodes for insertion. Both inline and widget decorations. |
| `inline-diff.ts` | `Plugin`, `PluginKey`, `Decoration.inline`, `Decoration.widget`, `DecorationSet`, `tr.mapping.map()`, `decorations.map()` | **No — required** | High | External change review + git branch diff. Position mapping tracks hunks through concurrent edits. Accept/reject per-hunk via transaction metadata. |

**Verdict:** All 8 are **necessarily ProseMirror**. Tiptap's Extension API provides `addProseMirrorPlugins()` as an escape hatch specifically because decorations cannot be done any other way. This is not technical debt — it's the intended architecture.

### Table Extensions (6 files)

| Extension | PM APIs Used | Could use Tiptap instead? | Complexity | Rationale |
| --- | --- | --- | --- | --- |
| `table-sort.ts` | `Plugin`, `PluginKey`, `Decoration.widget`, `DecorationSet`, `EditorState`, `EditorView`, `Node`, `Fragment`, `node.forEach()`, `tr.setNodeMarkup()` | **No — required** | High | Sorts table rows by reordering `Fragment` children. Sort indicator widgets on headers. Direct node tree manipulation — Tiptap's command API doesn't support Fragment reordering. |
| `table-filter.ts` | `Plugin`, `PluginKey`, `Decoration.widget`, `Decoration.node`, `DecorationSet` | **No — required** | Medium | Filter input widget decoration + node decorations to hide rows. |
| `table-aggregation.ts` | `Plugin`, `PluginKey`, `Decoration.widget`, `DecorationSet` | **No — required** | Medium | Footer row widget with computed aggregation values (sum/avg/count/min/max). |
| `table-sparkline.ts` | `Plugin`, `PluginKey`, `Decoration.widget`, `DecorationSet` | **No — required** | Low | Replaces `{{spark:...}}` text with inline SVG widget decorations. |
| `table-header-menu.ts` | `Plugin`, `PluginKey`, `Decoration.widget`, `DecorationSet`, DOM event handling | **No — required** | Medium | Right-click handler + type badge widget decorations on header cells. |
| `table-formatting.ts` | `Plugin`, `Decoration.inline`, `DecorationSet` | **No — required** | Low | Cell formatting decorations (alignment, number display). |

**Verdict:** All 6 are **necessarily ProseMirror**. Our dynamic table system is built entirely on the decoration layer. `prosemirror-tables` (consumed via Tiptap's Table extension) handles the schema and cell selection; our plugins add the dynamic features on top.

### Other Extensions Using PM Directly (5 files)

| Extension | PM APIs Used | Could use Tiptap instead? | Complexity | Rationale |
| --- | --- | --- | --- | --- |
| `drag-handle.ts` | `Plugin`, `PluginKey`, `TextSelection.create()`, `EditorState`, `EditorView`, `view.nodeDOM()`, `view.domAtPos()` | **No — better at PM level** | High | Needs DOM-to-position mapping (`nodeDOM`, `domAtPos`) for positioning drag handles. Needs `TextSelection.create()` for selection after drop. Tiptap has an official Drag Handle extension but it doesn't support our planned unified gutter design. |
| `link-click.ts` | `Plugin`, `PluginKey`, DOM event handlers (`click`, `contextmenu`) | **No — better at PM level** | Low | Intercepts link clicks to route internal links to Tauri tabs. Needs to return `true` from click handler to prevent ProseMirror's default. Tiptap's `addKeyboardShortcuts` doesn't cover click events. |
| `send-to-ai.ts` | `Plugin`, DOM event handler (`contextmenu`) | **No — better at PM level** | Low | Right-click "Add to chat" on images/drawings. Same pattern as link-click — DOM event interception. |
| `page-breaks.ts` | `Plugin`, `PluginKey`, `Decoration.widget`, `DecorationSet` | **No — required** | High | Three-decoration architecture for page boundaries. Widget decorations for header/footer zones. |
| `callout.ts` | `InputRule` (via Tiptap), `Node` schema definition | **Partially** | Medium | Node definition uses Tiptap's API correctly. The `addInputRules()` and `addNodeView()` are Tiptap-native. Only the node schema extends PM concepts, which is expected. |

### Utility Files Using PM Directly (8 files)

| File | PM APIs Used | Could use Tiptap instead? | Cost of current approach | Rationale |
| --- | --- | --- | --- | --- |
| `src/lib/markdown.ts` | `EditorState.create()`, `tr.setMeta()`, `doc.descendants()`, `tr.setNodeAttribute()`, `editor.view.dispatch()`, `editor.view.updateState()` | **Partially** | Medium | `EditorState.create()` (line \~914) bypasses Tiptap to create a fresh state with cleared undo history — needed for tab restoration. Could use `editor.commands.clearHistory()` if available. `view.updateState()` is used for per-tab EditorState cache restore — no Tiptap equivalent. `view.dispatch(tr)` could be `editor.chain()` in some cases but not all (batch operations). |
| `src/lib/pm-replace.ts` | `Transaction`, `tr.insertText()`, `tr.delete()`, `tr.replaceWith()`, `CommentMarkPluginKey.getState()`, `doc.descendants()` | **No — better at PM level** | Medium | Text replacement with mark preservation and comment anchor resolution. Needs direct transaction control for atomic multi-step replacements. `editor.chain()` would work for simple cases but not for the position-dependent replacement logic here. |
| `src/lib/pm-text-search.ts` | `Node` (`doc.descendants()`, `node.isText`, `node.text`) | **No — required** | Low | Document tree traversal for text search with whitespace normalization. `doc.descendants()` has no Tiptap equivalent. |
| `src/lib/pm-line-map.ts` | `Node` (`doc.descendants()`, `node.type.name`, `node.nodeSize`, `node.textContent`) | **No — required** | Low | Maps markdown lines to PM positions for diff highlighting. Pure document tree analysis. |
| `src/lib/external-diff.ts` | `DOMParser.fromSchema()`, `Node` (`doc.descendants()`) | **No — required** | Medium | Parses HTML to PM doc for diffing, then walks both doc trees. No Tiptap abstraction for `DOMParser`. |
| `src/components/editor/editor-utils.ts` | `TextSelection.create()`, `tr.setSelection()`, `view.dispatch()`, `view.domAtPos()`, `doc.descendants()` | **No — better at PM level** | Low | Scroll-to-position, find-text-position utilities. Need DOM coordinate lookups and selection manipulation. |
| `src/components/editor/Editor.tsx` | `EditorState` (type annotation) | **Yes but not worth it** | Zero | Just a TypeScript type import for the per-tab cache `Map<string, EditorState>`. |
| `src/components/editor/extensions/toc.ts` | `PluginKey`, `Node`, `doc.descendants()`, `doc.resolve()`, `view.domAtPos()` | **No — required** | Low | Heading extraction + click-to-scroll. Document traversal + DOM position mapping. |

### Hooks Using PM Directly (2 files)

| File | PM APIs Used | Could use Tiptap instead? | Cost of current approach | Rationale |
| --- | --- | --- | --- | --- |
| `src/hooks/useCommentOperations.ts` | `Transaction`, `doc.textBetween()`, `CommentMarkPluginKey.getState()` | **Partially** | Low | `doc.textBetween()` for extracting anchor text — no Tiptap equivalent. Plugin state access for remapped positions — no Tiptap equivalent. Transaction type is used for `onTransaction` callback typing. |
| `src/hooks/useEditorTabSwitch.ts` | `EditorState` (cache restore via `view.updateState()`) | **No — required** | Medium | Per-tab EditorState cache preserves undo/redo, selection, and plugin states across tab switches. `view.updateState()` is the only way to swap the entire editor state. Tiptap's `setContent()` would lose all plugin state and undo history. |

---

## ProseMirror API Coverage

### APIs We Use vs Full API Surface

| PM Package | Total Key APIs | APIs We Use | Coverage | What We Don't Use |
| --- | --- | --- | --- | --- |
| `prosemirror-state` | Plugin, PluginKey, EditorState, Transaction, Selection, TextSelection, NodeSelection, AllSelection, SelectionRange | Plugin, PluginKey, EditorState, Transaction, TextSelection | 56% | NodeSelection, AllSelection, SelectionRange, Plugin `filterTransaction`/`appendTransaction` |
| `prosemirror-view` | EditorView, Decoration (3 types), DecorationSet, NodeView, DirectEditorProps (20+ handlers) | EditorView, Decoration.inline, Decoration.widget, DecorationSet, handleDOMEvents, handleClick | 40% | Decoration.node (rare), NodeView (use ReactNodeViewRenderer instead), most DirectEditorProps handlers |
| `prosemirror-model` | Schema, Node, NodeType, Mark, MarkType, Fragment, Slice, ResolvedPos, NodeRange, ContentMatch, DOMParser, DOMSerializer | Node, Fragment, DOMParser, Schema (via editor.schema) | 33% | Slice (handled by Tiptap), ResolvedPos (mostly), Mark/MarkType (via Tiptap), DOMSerializer, ContentMatch |
| `prosemirror-transform` | Transform, Step (7 types), Mapping, StepMap, MapResult, helper functions | Mapping.map() (via tr.mapping) | 10% | Direct Step creation, custom transforms, helper functions |
| `prosemirror-commands` | 25+ commands, baseKeymap | None directly | 0% | All consumed via Tiptap's `addKeyboardShortcuts()` or StarterKit |
| `prosemirror-keymap` | keymap(), keydownHandler() | None directly | 0% | Consumed via Tiptap's `addKeyboardShortcuts()` |
| `prosemirror-inputrules` | InputRule, inputRules(), wrapping/textblock helpers | Via Tiptap's `addInputRules()` | 100% (indirect) | — |
| `prosemirror-history` | history(), undo(), redo(), closeHistory() | Via StarterKit | 100% (indirect) | — |
| `prosemirror-tables` | tableEditing, columnResizing, CellSelection, TableMap, 15+ commands | Via Tiptap Table extension | \~80% (indirect) | Direct TableMap access, CellSelection |
| `prosemirror-collab` | collab(), sendableSteps(), receiveTransaction() | None | 0% | Future: real-time collaboration |
| `prosemirror-changeset` | ChangeSet, Change | None | 0% | Future: tracked changes / version compare |
| `prosemirror-menu` | menuBar, MenuItem, Dropdown | None | 0% | Not needed — we use React UI |

### Unused ProseMirror APIs Worth Knowing About

| API | Package | What it does | Potential use in Notesage |
| --- | --- | --- | --- |
| `Decoration.node()` | `prosemirror-view` | Applies attributes/classes to an entire node's DOM element | Could simplify table row hiding in `table-filter.ts` (currently using node decorations but could be cleaner) |
| `Plugin.appendTransaction()` | `prosemirror-state` | Automatically appends a follow-up transaction after any change | Could enforce document invariants (e.g., always having a trailing paragraph — alternative to the Tiptap Trailing Node extension) |
| `Plugin.filterTransaction()` | `prosemirror-state` | Block certain transactions from being applied | Could prevent edits in read-only regions or locked sections |
| `NodeSelection` | `prosemirror-state` | Select a single node (image, drawing, chart) | Could improve selection UX for atom nodes — show a blue outline, enable Delete key |
| `prosemirror-collab` | `prosemirror-collab` | OT-based collaborative editing | Foundation for real-time collaboration (roadmap) |
| `prosemirror-changeset` | `prosemirror-changeset` | Track accumulated changes from a base document | Could power tracked changes / revision history without the Tiptap paid extension |
| `Slice` | `prosemirror-model` | Represents a cut piece of document with open ends | Could improve paste handling for complex content (tables, callouts) |
| `ResolvedPos` | `prosemirror-model` | Position with full structural context (parent chain, depth, index) | Could improve comment anchoring — resolve positions to semantic locations (e.g., "3rd paragraph in 2nd section") instead of raw offsets |

---

## Cost Analysis: Maintaining ProseMirror Code

### Complexity by Category

| Category | Files | Total Lines (est.) | Maintenance Cost | Risk Level |
| --- | --- | --- | --- | --- |
| Decoration extensions | 14 | \~3,500 | **High** — decoration rebuild logic, position mapping, transaction metadata patterns are complex but well-understood | Low — stable ProseMirror API, hasn't broken across Tiptap upgrades |
| Document traversal utilities | 4 | \~400 | **Low** — `doc.descendants()` is the most stable API in ProseMirror | Very low |
| Transaction manipulation | 3 | \~300 | **Medium** — direct `view.dispatch()` and `tr.replaceWith()` need care to avoid corrupting state | Low — well-tested patterns |
| EditorState management | 2 | \~150 | **Medium** — `EditorState.create()` and `view.updateState()` are powerful but bypassing Tiptap | Medium — could conflict with future Tiptap state management changes |
| DOMParser usage | 2 | \~100 | **Low** — stable API, straightforward usage | Very low |

### What Would Break If Tiptap Changes

| Tiptap Change | Impact on Our PM Code | Likelihood |
| --- | --- | --- |
| Tiptap stops re-exporting `@tiptap/pm/*` | All 41 files need import path changes | Very low — this is a core feature of Tiptap |
| ProseMirror Plugin API changes | All 14 decoration extensions | Very low — ProseMirror API has been stable for 8+ years |
| Tiptap changes how extensions mount plugins | Need to update `addProseMirrorPlugins()` return | Low — would be a major breaking change |
| Tiptap adds native Decoration API | Could simplify extensions, but migration is optional | Medium (Tiptap has discussed this) — would be additive, not breaking |
| ProseMirror DecorationSet.map() behavior changes | Comment anchoring, inline diff tracking could break | Very low — core API, heavily tested |

### Refactoring Opportunities

| Current Pattern | Could Become | Effort | Benefit | Recommendation |
| --- | --- | --- | --- | --- |
| Direct `editor.view.dispatch(tr)` in utilities | `editor.chain().command(({ tr }) => { ... }).run()` | Small per-file | Clearer Tiptap idiom, better error handling | **Yes — gradual migration** when touching these files |
| `EditorState.create()` in markdown.ts | `editor.commands.clearHistory()` (if exists) or keep | Small | Slightly cleaner | **Evaluate** — current approach works and is well-understood |
| Per-extension Plugin boilerplate | Shared `createDecorationPlugin()` helper | Medium | \~50% less boilerplate across 14 extensions | **Yes — worthwhile** if we add more decoration extensions |
| `doc.descendants()` everywhere | Shared traversal utilities | Small | Centralized, testable | **Already done** — `pm-text-search.ts` and `pm-line-map.ts` exist |

---

## Summary: ProseMirror Usage Scorecard

| Verdict | Count | Files |
| --- | --- | --- |
| **Necessarily ProseMirror** (no Tiptap equivalent exists) | 30 | All decoration extensions, document traversal, DOMParser, EditorState cache, position mapping |
| **Better at PM level** (Tiptap partial equivalent but PM gives us more control) | 6 | drag-handle, link-click, send-to-ai, pm-replace, editor-utils, comment operations |
| **Could use Tiptap but not worth the churn** | 3 | Editor.tsx type import, some view.dispatch() calls, EditorState.create() |
| **Should gradually migrate to Tiptap** | 2 | Some utility `view.dispatch()` → `editor.chain()`, boilerplate reduction |

**Overall assessment:** Our ProseMirror usage is **appropriate and well-motivated**. 36 of 41 files using PM directly are doing so because Tiptap has no equivalent. The remaining 5 are borderline cases where either approach works. There is no significant technical debt from our PM usage — the real cost is complexity, not incorrectness.

The biggest opportunity is a shared decoration plugin factory to reduce boilerplate across our 14 decoration-based extensions, which would pay off if we continue adding decoration-based features.