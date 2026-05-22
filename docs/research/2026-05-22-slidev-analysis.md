# Slidev Analysis — Ideas for Notesage

**Date:** 2026-05-22 **Subject:** [sli.dev](https://sli.dev) (Slidev — slidevjs/slidev) **Purpose:** Identify markdown-tooling ideas, syntax extensions, and editor patterns from Slidev that could strengthen Notesage's editor, exports, and developer-oriented note-taking story.

## What Is Slidev?

Slidev is an open-source presentation tool by Anthony Fu. Decks are authored as a single Markdown file, rendered by a Vue 3 + Vite app, and exported to PDF, PNG, PPTX, or a hostable SPA. Its audience is developers who want to write talks the way they write code — in their editor, in version control, with first-class code blocks.

The relevance to Notesage is not "Notesage should become a presentation tool" — it's that Slidev has solved several markdown-editor problems that Notesage will hit (or has already hit) and the syntax conventions it pioneered are increasingly recognised by developer audiences.

## Feature Inventory

| Area | Feature | One-line summary |
| --- | --- | --- |
| Syntax | Slide separator (`---`) | Splits a single Markdown file into ordered slides. |
| Syntax | Headmatter + per-slide frontmatter | First YAML block configures the deck; subsequent blocks (between `---`) configure individual slides (`layout`, `class`, `background`, `transition`, `dragPos`, etc.). |
| Syntax | Presenter notes via `<!-- ... -->` | HTML comment at end of slide becomes speaker notes. |
| Syntax | Slot sugar (`::name::`) | Names a region inside a slide that fills a `<slot name="name">` in the chosen layout. |
| Syntax | MDC (Markdown Components) | Inline attribute syntax — `[label]{.class}`, `::component{prop=value}`, attaches classes / props to elements without leaving Markdown. |
| Syntax | Scoped CSS per slide | Per-slide `<style scoped>` blocks. |
| Syntax | Importing external slides | `src: ./pages/intro.md` in frontmatter — composes a deck from multiple files. |
| Code | Shiki syntax highlighting | TextMate-grammar accuracy across 200+ languages and dual light/dark themes. |
| Code | Line highlighting + animated transitions | `{1,3-5\|7\|all}` syntax. Highlights step through on click. |
| Code | Shiki Magic Move | Animated morphing between code states. `` ```md magic-move `` wraps N fenced blocks; advancing the click counter morphs the previous block into the next. |
| Code | TwoSlash | TypeScript type information rendered inline / on hover for any `ts twoslash` block. |
| Code | Monaco Editor mode | Turn any code block into a live editor (`{monaco}`). |
| Code | Monaco Run | Run JS/TS in the slide (`{monaco-run}`) — output appears below the editor. Custom runners pluggable per-language. |
| Code | Monaco Write | Editable code block where changes update the source file on disk. |
| Code | Import code snippet | `<<< @/snippets/file.ts#region-name ts {2,3\|5}{lines:true}` — transcludes code by VS Code `#region` marker or line range, with full highlight syntax. |
| Code | Code groups | Tabbed code blocks for "same thing in multiple languages". |
| Animation | `v-click`, `v-after`, `v-clicks` | Progressive reveal — each click advances a counter, elements appear when their counter is reached. |
| Animation | Click markers in fenced blocks | `// [!code highlight:1]`-style line markers tied to the click counter. |
| Animation | Slide transitions | Per-deck + per-slide `transition: slide-left/fade/view-transition`. Uses the View Transitions API where supported. |
| Diagrams | KaTeX | LaTeX math. |
| Diagrams | Mermaid | Text-to-diagram. |
| Diagrams | PlantUML | Server-rendered UML diagrams. |
| Drawing | Drauu pen overlay | Live annotation on top of slides during a talk; SVGs persisted to `.slidev/drawings/`, optionally embedded in exports. Stylus auto-detected. |
| Drawing | Rough marker | RoughJS-rendered hand-drawn highlight effect. |
| Layout | Built-in layouts | `cover`, `center`, `image-left/right`, `two-cols`, `iframe`, `quote`, etc. — each is a Vue SFC the slide content slots into. |
| Layout | Global layers | `global-top.vue`, `global-bottom.vue`, `slide-top.vue`, `slide-bottom.vue` — persistent overlays for footers, watermarks, cross-slide animations. |
| Layout | Draggable elements | `<img v-drag="'square'">` — element positions stored in the slide content via regex update; arrow keys, Shift+drag, double-click-to-grab. |
| Layout | Canvas size + transform-component | Set the slide aspect ratio (16:9, 4:3, custom) and scale embedded components. |
| Layout | AutoFitText | Text element that auto-shrinks to fit its container. |
| Components | Built-in Vue components | `<Toc>`, `<Tweet>`, `<Youtube>`, `<Arrow>`, `<VDrag>`, `<VSwitch>`, `<RenderWhen>`, `<LightOrDark>`, `<Link>`, `<Transform>`, etc. |
| Components | Iconify icons | Any `~80k` icons via `<mdi-home />` / `<carbon:add />` element syntax. |
| Presenter | Presenter mode | Separate window with current slide + next slide + notes + timer + drawing tools. |
| Presenter | Remote control | `slidev --remote --tunnel` — phone-as-clicker, optional Cloudflare tunnel + password. |
| Presenter | Recording with camera | RecordRTC + WebRTC — overlay camera feed, drag-to-position, record slides+camera as one stream or two files. |
| Presenter | Timer + click marker | Built-in countdown + per-slide click-count tracking. |
| Export | PDF / PNG / PPTX / SPA | Static exports with optional drawing overlay baked in. |
| Export | OG image generation | Auto-generated `og:image` per slide for sharing. |
| Export | Bundle remote assets | At build time, downloads and inlines remote images so the deck works offline. |
| DX | Vite HMR | Edits in `slides.md` reflect instantly. |
| DX | VSCode extension | Slide navigation, command palette integration, preview. |
| DX | Prettier plugin | Formats Slidev-specific syntax. |
| DX | Themes via npm | `theme: seriph` resolves to an npm package; addons add components. |

## Where Notesage Already Has Parity

| Slidev feature | Notesage equivalent |
| --- | --- |
| Slide separator `---` | PPTX exporter already breaks on H1 **and** on explicit `---` horizontal rules (`docs/features/document-formats.md` — "Slide splitting"). |
| Speaker notes via comment | `> [!notes]` callout maps to PPTX speaker notes pane. |
| Code blocks with chromatic theme | `lowlight` + `--ns-code-*` CSS variables (`editor.md` — "Code blocks with muted chromatic syntax highlighting"). |
| KaTeX math | Already supported (`editor.md` listing). |
| Mermaid diagrams | First-class Tiptap node (`editor-architecture.md` — `Mermaid` extension). |
| Drawing overlay | Inline Excalidraw blocks with sidecar + auto-migration (`editor-architecture.md` — `Drawing` extension). |
| YAML frontmatter as config | Project metadata, research files, drawings, AI lock — all keyed off frontmatter. |
| HMR + Vite | Tauri + Vite dev mode. |
| Themes / dark mode | Theme provider, accent picker, contrast slider, soft-contrast endpoints (`design-system.md`). |
| Built-in icons | Lucide already wired (`design-system.md`). |
| PDF / DOCX / PPTX / HTML export | All four already shipped (`document-formats.md`). |
| Import code into doc | Internal document links, but **no code-snippet transclusion** — gap. |
| Slide transitions | None — gap (Notesage isn't a presentation tool, but see Idea 8 below). |
| Click animations / progressive reveal | None — gap. |
| Magic-move animated code diffs | None — Notesage has static inline diff for AI suggestions and external changes but no animated transition. |
| Monaco / live editable code | Editable code files via CodeMirror 6, no execution (`document-formats.md` — Code File Editor). |
| TwoSlash inline TS types | None — gap (high-impact for Notesage's developer-skewed audience). |
| MDC inline attribute syntax | None — gap. |

## Ideas Notesage Could Adopt

Ranked by impact-per-effort. Each idea names the Slidev surface, the Notesage hook it plugs into, and an estimate of scope.

### Tier 1 — High impact, fits existing architecture

#### 1. Code snippet transclusion (`<<< @/file.ts#region`)

**What:** A markdown syntax that transcludes code from another file in the workspace at parse time. Slidev's syntax: `<<< @/snippets/foo.ts#region-name ts {2,3|5}` — supports VS Code-style `#region`/`#endregion` markers, line ranges, language override, and the full Shiki highlight syntax.

**Why this fits Notesage:** The workspace already indexes every file via SQLite (`docs/architecture.md` — "Document Index"); the resolver only needs a path → content lookup. The pattern is also a natural fit for the existing reference / internal-link grammar — internal links already resolve relative paths via `link-utils.ts`. A code-block-level transclusion is a thin extension of that resolver.

**Notesage hook:**

- New Tiptap extension `CodeSnippetTransclusion` rendered as a `ReactNodeViewRenderer` (same pattern as `Drawing` / `Chart` / `LinkPreview`).
- Markdown serialiser writes `<<< path` syntax; parser materialises the node and fetches via the existing `read_file` Tauri command.
- Filesystem watcher invalidates the materialised content on `file-changed-batch` (the same plumbing that drives external-change review).
- Scope-gated by `isToolCallAllowed` so a doc can't transclude paths outside the chat scope (mirroring the direct-API tool executor).

**Scope:** ~1 week. New node + parse/serialise + watcher hook + scope gate.

#### 2. TwoSlash inline type hints

**What:** Add `twoslash` to the language tag of a TS / JS fenced block; the renderer runs the TypeScript compiler against the snippet and overlays inferred types as hover popovers + inline annotations.

**Why this fits Notesage:** Notesage already pitches itself at developers, and the editor already routes code through a lowlight-based highlighter. Swapping the highlight path to Shiki + the `@shikijs/twoslash` plugin gives Notesage parity with VS Code hover info for any markdown TS block — a unique differentiator over Bear / Craft / Notion.

**Scope concerns:** TwoSlash needs a TS compiler in the renderer. The runtime is `~3MB` minified — acceptable as a lazy-loaded chunk only when the doc actually has a `twoslash` block. Worker thread isolation needed; could re-use the worker infrastructure already used for markdown parsing (`[perf:doc-switch]` — `workerParse`).

**Scope:** ~2 weeks. Plumb Shiki into the existing highlighter, ship a twoslash worker, render hover popovers (already a shadcn primitive).

#### 3. Magic-move animated code transitions (in PPTX export + presentation mode)

**What:** A fenced-block-of-fenced-blocks pattern (` ````md magic-move `) that the export pipeline expands into a sequence of slides with an animated character-level morph between them, powered by `shiki-magic-move`.

**Why this fits Notesage:** The pattern is identical in shape to the existing `` ```chart ``, `` ```excalidraw ``, `` ```mermaid `` fenced extensions. PPTX export already builds slides from H1 boundaries — magic-move just emits N slides from one block. For HTML export the npm package can be embedded directly; for PDF the morph degrades to a sequence of static frames.

**Notesage hook:**

- New `MagicMove` Tiptap atom node, edited in source as a list of N code variants.
- PPTX exporter (`markdown_to_pptx.rs`) emits N slides with PowerPoint morph animation between them (PowerPoint natively supports "Morph" transitions and can interpolate text — but realistically the easy path is per-line fade in/out).
- HTML exporter (`markdown_to_html.rs`) emits a `<shiki-magic-move>` web component with the npm package embedded.

**Scope:** ~1 week for HTML/web; PPTX morph is +1 week.

#### 4. MDC inline attribute syntax for per-element styling

**What:** Apply CSS classes / data attributes to inline and block elements directly in markdown without HTML:

```
This is a [highlighted span]{.highlight .text-lg}

::callout{type=warning}
This is the body.
::

![Image](url){.shadow .rounded-lg width=400}
```

**Why this fits Notesage:** The Tiptap doc already has class-bearing nodes (`Callout`, `Highlight`, tag badges); the round-trip is the issue, not the schema. MDC is a published spec (Nuxt content uses it) so the syntax has community traction.

**Notesage hook:** Markdown parser (`tiptap-markdown` extension) needs an MDC pre-processor. Output is unchanged HTML — the editor doesn't need new node types. The serialiser writes the MDC suffix back. Existing `Themed Highlight`, `Callout`, image alignment, and link-preview attributes all collapse into one unified syntax instead of one extension per attribute family.

**Scope:** ~1.5 weeks for parse + serialise + escape handling.

### Tier 2 — Strategic / new surface

#### 5. Presentation Mode for notes

**What:** A read-only "talk through this doc" mode that splits the active document on H1 (and explicit `---` HR) boundaries, renders one section at a time at the full window, advances on arrow keys / clicker / spacebar, and shows the next section + notes in a presenter window. Reuses the PPTX exporter's slide-splitting logic.

**Why this fits Notesage:** Notesage's audience already exports decks via PPTX; a live "drive this from the editor" mode is the natural next step and saves the round-trip through PowerPoint for ad-hoc sharing. It also pairs with the existing Focus Mode (`⌘.`) — focus mode dims surrounding chrome, presentation mode dims surrounding sections.

**Implementation note:** Slidev's secondary `--remote` window with `slidev --remote --tunnel` would be its own follow-up; v1 should ship single-window with `Esc` to exit.

**Scope:** ~2 weeks for v1 (split, render, navigate, escape). Camera/recording is +3 weeks; defer.

#### 6. Per-section frontmatter (block frontmatter)

**What:** Slidev's pattern of a `---\nkey: value\n---` YAML block *between* sections, configuring the next section. Notesage could use the same pattern for per-section export overrides:

```markdown
# My Doc

Body text here.

---
export: skip
---

# This Section Is Internal Only
```

**Why this fits Notesage:** Currently Notesage has one frontmatter block per file (document-level metadata). Block frontmatter unlocks "this H1 is excluded from PPTX export", "this section has a different template", "this section is a draft", without needing a new sidecar mechanism. The pattern composes with magic-move and `v-click` ideas above.

**Scope:** ~1 week. New markdown parser pass + exporter awareness.

#### 7. Progressive reveal (`v-click` equivalent) for PPTX export

**What:** Markdown-authored sequence markers (e.g. `<!-- click -->` between paragraphs, or MDC `::reveal{at=2}`) translate to PowerPoint click-triggered animations in PPTX export. In the live editor, the markers are invisible; in PPTX they become "appear on click" entries on the slide's animation pane.

**Why this fits Notesage:** PPTX export already produces presentation-quality decks; click-reveal is the single biggest gap between "Notesage exports slides" and "a presenter can talk through them". `ppt-rs` supports the underlying OOXML animation primitives.

**Scope:** ~2 weeks. Parser, exporter, presenter-mode honour the markers, decide on author UX (toolbar button vs MDC syntax).

#### 8. Slide transitions in HTML export

**What:** Slidev's `transition: slide-left` per-slide frontmatter maps to CSS view transitions in the HTML export. Notesage's HTML export currently emits a static document — adding deck-style transitions when the doc is exported "as slides" makes the HTML share path competitive with Slidev's SPA export.

**Why this fits Notesage:** Pairs naturally with Presentation Mode (idea 5). The existing HTML exporter already has template options; this is one more.

**Scope:** ~3 days once Presentation Mode lands.

### Tier 3 — Niche but inspiring

#### 9. Monaco Run (live JS/TS execution in code blocks)

**What:** `{monaco-run}` after a code block turns it into an executable sandbox. JS/TS run in a web worker; output appears below the block.

**Why this fits Notesage:** Crosses into Jupyter-notebook territory. Useful for technical scratch notes, especially as a "verify this snippet works" affordance. The CodeEditor already uses CodeMirror; a worker-isolated runtime + output panel is a known pattern.

**Risk:** Security envelope. Notesage's existing sandboxing is process-level (Seatbelt); browser-execution is a different threat model. Defer until there's a strong user request.

#### 10. Code groups (tabbed code blocks)

**What:** Wrap N code blocks in a tab container; the reader picks the language. Common in docs sites.

**Notesage hook:** Another fenced-of-fenced wrapper, same shape as magic-move. Cheap once magic-move lands.

**Scope:** ~3 days.

#### 11. Global header/footer layers for HTML/PDF export

**What:** Slidev's `global-top.vue` / `global-bottom.vue` persistent overlays. Notesage's PPTX templates already encode header/footer; extending the pattern to HTML and PDF exports normalises behaviour across formats.

**Scope:** ~1 week. Template authoring is the time sink.

#### 12. OG image generation

**What:** Auto-generate an `og:image` per document for HTML export — title, first H2, accent color. Slidev does this per-slide.

**Why this fits Notesage:** Pure HTML-export polish. Doc shared on Slack / Twitter shows a preview card instead of a generic file icon.

**Scope:** ~3 days. Render a 1200×630 PNG via the existing HTML renderer + a headless screenshotter, or compose with `image` crate.

#### 13. Bundle remote assets on export

**What:** Slidev's build step downloads and inlines remote `<img src>` so the deck works offline. Notesage's HTML exporter already inlines local images via data URIs; doing the same for remote URLs would harden the offline story.

**Scope:** ~3 days. Add a fetch-and-inline pass to `markdown_to_html.rs`.

## Out of Scope for Notesage

These Slidev features are real, but they don't earn their keep in a note editor:

| Feature | Why skip |
| --- | --- |
| Vue component embedding | Notesage uses Tiptap node views (React). Exposing a "write arbitrary Vue" surface contradicts the security model and adds a runtime. |
| Remote control / phone clicker | Single-user note editor; presentation use case is rare enough that Presentation Mode (idea 5) without a second device covers 90% of demand. |
| Camera + screen recording | Big scope, niche audience. Voice transcription (`Whisper`) already covers the "narrated note" case; visual recording belongs in a screen-capture tool. |
| PlantUML | Server-side rendering required (Java). Mermaid covers the same ground client-side. |
| RoughJS hand-drawn effects | Decorative. Excalidraw blocks already provide hand-drawn aesthetics where users want them. |
| Drauu live pen overlay on read-mode docs | Mostly redundant with Excalidraw blocks; the marginal use case (annotate a finished doc) is small. |
| Slidev themes as npm packages | Notesage's design-system is opinionated by design (`docs/design-system.md`); a pluggable theme system would dilute the strict-neutral palette guarantees. |
| Iconify (80k icons) | Lucide is enough for a notes app; an icon catalogue this large is a presentation-deck need. |
| `--tunnel` Cloudflare exposure | Notesage is local-first by principle; tunneling contradicts the privacy story. |

## Suggested Sequencing

If Notesage wanted to land Slidev-inspired wins incrementally without a rewrite:

1. **MDC inline attributes (#4)** — unifies several existing extensions and unblocks others. Pure parser change.
2. **Code snippet transclusion (#1)** — high reader value, fits the workspace + index story.
3. **Block frontmatter (#6)** — opens the door to per-section export config without sidecar files.
4. **Magic-move (#3) + code groups (#10)** — reuses fenced-of-fenced node pattern; ships HTML + PPTX together.
5. **TwoSlash (#2)** — heavyweight runtime; worth it for the developer-audience flex but ship after the lighter wins.
6. **Presentation Mode (#5) + progressive reveal (#7) + transitions (#8)** — natural cluster, ships as one PRD.

The first three are Tier-1 cost (≤2 weeks each) with no new runtime; the rest are Tier-2 / Tier-3 with selective adoption.

## Sources

- [Slidev documentation — Why Slidev?](https://sli.dev/guide/why)
- [Slidev documentation — Syntax Guide](https://sli.dev/guide/syntax)
- [Slidev GitHub repository](https://github.com/slidevjs/slidev)
- [Slidev syntax.md source](https://github.com/slidevjs/slidev/blob/main/docs/guide/syntax.md)
- Feature docs (Slidev repo `docs/features/`): `shiki-magic-move.md`, `twoslash.md`, `monaco-run.md`, `draggable.md`, `drawing.md`, `recording.md`, `remote-access.md`, `import-snippet.md`, `global-layers.md`, `frontmatter-merging.md`, `block-frontmatter.md`, `comark.md`, `code-groups.md`.
- [Snyk — Slidev 101: Coding presentations with Markdown](https://snyk.io/blog/slidev-101-coding-presentations-with-markdown/)
- [Elio Struyf — Make impactful presentations with Markdown and Slidev](https://www.eliostruyf.com/impactful-presentations-markdown-slidev/)
