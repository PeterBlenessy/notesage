# Research: Rich Content Editor Features

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Purpose** | Survey advanced editor features across competitor apps to inform Notesage rich content roadmap |
| **Scope** | Drawings, charts, dynamic tables, link embeds, callouts — features for report generation |

| Stage | Link | Status |
| --- | --- | --- |
| [Callout Blocks](../prds/2026-03-29-callout-blocks.md) | Admonition blocks (Note, Tip, Warning, Important) with Obsidian-compatible syntax | Complete |
| [Callout Blocks — Tasks](../tasks/2026-03-29-callout-blocks-tasks.md) | 10 tasks: CSS → Extension → Markdown → Slash/Toolbar → Typst → Tests → Polish | Complete |
| [Drawing Canvas](../prds/2026-03-29-drawing-canvas.md) | Inline Excalidraw editor, SVG export, sidecar storage | Complete |
| [Drawing Canvas — Tasks](../tasks/2026-03-29-drawing-canvas-tasks.md) | 14 tasks: Setup → Extension → Sidecar → NodeView → Markdown → UX → PDF → Tests → Polish | Complete |
| [Inline Charts](../prds/2026-03-29-inline-charts.md) | Chart blocks (shadcn/ui Charts + Recharts), data editor panel, 6 chart types, PDF export | Complete |
| [Inline Charts — Tasks](../tasks/2026-03-29-inline-charts-tasks.md) | 15 tasks: Setup → Types → Extension → Sidecar → Theming → Renderers → NodeView → Editor → Markdown → PDF → Tests | Complete |
| [Dynamic Table Enhancements](../prds/2026-03-29-dynamic-table-enhancements.md) | Column aggregations, typed columns, sort/filter, sparklines | Draft |
| [Dynamic Table Enhancements — Tasks](../tasks/2026-03-29-dynamic-table-enhancements-tasks.md) | 14 tasks: Metadata → Formatting → Aggregation → Sorting → Filtering → Sparklines → Context menu → PDF → Tests | Not started |
| [Rich Link Preview Cards](../prds/2026-03-29-rich-link-preview-cards.md) | URL embed cards with OpenGraph metadata, cached images | Complete |
| [Rich Link Preview Cards — Tasks](../tasks/2026-03-29-rich-link-preview-cards-tasks.md) | 13 tasks: Backend → Extension → NodeView → Markdown → Paste/Slash/Context → PDF → Tests → Polish | Complete |

## Design Philosophy

Features must be **simple to use and produce beautiful results**. Think designer, not developer. No feature should make the app feel more complex — each should feel like a natural extension of the writing surface.

## 1. Drawing & Diagrams

### Competitor Survey

| App | Feature | UX Pattern | Visual Quality |
| --- | --- | --- | --- |
| **Obsidian** | Excalidraw plugin (2M+ downloads) | Full whiteboard canvas, inline in document | Hand-drawn aesthetic, charming |
| **Logseq** | Excalidraw whiteboards | Core feature, dedicated whiteboard mode | Same Excalidraw style |
| **Craft** | Native sketch blocks | Tap to draw, inline in document | Polished, native feel |
| **Moss Notes** | Drawing canvas with Apple Pencil | Dedicated drawing mode, images stored inline | Clean, minimal |
| **Notion** | Limited — Mermaid code blocks only | Fenced code block renders to diagram | Functional, not beautiful |

### Libraries Evaluated

**Excalidraw** (Recommended)

- Fully open source (MIT), no license costs
- React component: `@excalidraw/excalidraw`
- Hand-drawn/sketchy aesthetic — charming and distinctive
- Shapes, arrows, text, freehand drawing, connectors, images
- 100K+ GitHub stars, massive community
- \~500KB bundle addition
- Scene stored as JSON, exportable as SVG/PNG
- [github.com/excalidraw/excalidraw](https://github.com/excalidraw/excalidraw)

**tldraw** (Rejected — requires production license)

- React SDK, modern infinite canvas
- More polished than Excalidraw, SDK-first design
- Production use requires paid license key — **disqualified**
- [tldraw.dev](https://tldraw.dev/)

**draw.io / diagrams.net** (Alternative for structured diagrams)

- Open source, no license costs
- Professional diagram types: UML, network, flowcharts, org charts, ER diagrams
- XML-based storage, iframe or self-hosted rendering
- More suited for technical/architecture diagrams than freehand drawing
- [diagrams.net](https://www.diagrams.net/)

**Mermaid.js** (Rejected for report use)

- Functional but not beautiful — outputs are developer-oriented, not designer-quality
- Good for code architecture documentation, not for polished reports
- Syntax-heavy: requires learning a DSL

### Recommendation

**Excalidraw** as the primary drawing tool — freehand, shapes, arrows, text. Natural and immediate to use. The hand-drawn aesthetic is distinctive and warm, aligning with Notesage's design philosophy. **draw.io** as a secondary option if users need precise, structured diagrams (UML, flowcharts).

## 2. Charts & Data Visualization

### Competitor Survey

| App | Feature | UX Pattern |
| --- | --- | --- |
| **Notion** | Native charts (bar, line, donut, number) | `/chart` command, configure axes, auto-updates from database |
| **Coda** | 15+ chart types tied to tables | Select table data → insert chart, live updates |
| **Moss Notes** | Inline charts | Clean, minimal aesthetic |
| **Obsidian** | Charts plugin (Chart.js wrapper) | YAML/JSON in code block → rendered chart |
| **Google Docs** | Linked Charts from Sheets | Insert → Chart → create or import |

### Chart Types Most Valuable for Reports

1. **Bar/Column** — comparing categories (budgets, metrics, scores)
2. **Line** — trends over time (progress, growth, performance)
3. **Pie/Donut** — composition and proportions
4. **Area** — cumulative values over time
5. **Sparklines** — tiny inline charts in table cells for trends

### Libraries Evaluated

**shadcn/ui Charts + Recharts** (Selected — 2026-03-29)

- shadcn/ui already has a [Charts component](https://ui.shadcn.com/charts) built on Recharts — design system mandate says "use shadcn/ui first"
- Recharts: 31.9M weekly npm downloads, 26.9K GitHub stars, actively maintained (committed 2026-03-29)
- React 19 compatible (Recharts v3.x)
- SVG output, PDF-friendly
- Uses the same CSS variable theming as the rest of Notesage — light/dark/soft-contrast works automatically
- Composable primitives: `ChartContainer`, `ChartTooltip`, `ChartLegend`, `ChartConfig`
- MIT license, free
- Only adds `recharts` as a dependency (\~139KB gzipped, tree-shakeable)

**Nivo** (Rejected — 2026-03-29)

- React-native, built on D3, outputs SVG
- Beautiful defaults out of the box
- **Red flags:** Homepage (nivo.rocks) deployment paused, last npm release May 2025 (10 months ago). react-spring dependency adds animation weight. Slower maintenance cadence.
- \~14K GitHub stars, \~650K weekly downloads (20x less than Recharts)
- Would introduce a separate theming paradigm (Nivo theme objects) instead of using shadcn/ui's CSS variable system

**Victory** (Rejected)

- 11.3K stars, 408K weekly downloads — declining
- Formidable → NearForm acquisition slowed development
- Last commit 3+ months ago, React 19 compatibility unconfirmed

**visx** (Rejected)

- Low-level D3 + React primitives from Airbnb
- 3-5x implementation effort for equivalent output
- 20.7K stars but last release Nov 2025

**Chart.js** (Rejected)

- Canvas-based (rasterized), not SVG — blurry when scaled, poor PDF export
- Functional but not report-quality output

**Observable Plot** (Rejected)

- Not a React library — imperative DOM API clashes with React/ProseMirror declarative model
- Requires custom wrappers for every chart type

**Other evaluated:** Tremor (222KB, wraps Recharts — use Recharts directly), frappe-charts (React wrapper dead since 2023), uPlot (canvas, no pie charts), lightweight-charts (financial only)

### Recommendation

**shadcn/ui Charts (Recharts)** — follows the design system mandate, uses the same CSS variable theming, most actively maintained SVG chart library in the React ecosystem, and avoids introducing a separate theming paradigm.

## 3. Dynamic Tables with Computed Summaries

### Competitor Survey

| App | Feature | UX Pattern |
| --- | --- | --- |
| **Coda** | Column-level formulas, Summarize builder | Click column → pick SUM/AVG/COUNT → shows in summary row. No cell-level formulas — column-level computed values are simpler. |
| **Notion** | Database properties with formulas, rollups | Property types with formula editor. Powerful but complex. |
| **Excel/Sheets** | Full cell-level formulas | Too complex for a note-taking app. |
| **Airtable** | Relational database with formulas | Spreadsheet UI with typed columns. |

### Key Insight from Coda

Coda intentionally **does not support cell-level formulas**. Their tables are relational databases with column-level computed values. This is far simpler for users and covers 90% of use cases. The "Summarize" feature is a no-code builder: click a column, pick an aggregation, see the result in a footer row. This is the right model for a note editor.

### Feature Tiers

**Tier 1 — Column aggregations (recommended first)**

- Footer row with SUM, AVERAGE, COUNT, MIN, MAX per column
- Auto-detect numeric columns
- Visual: distinct muted background, smaller text, label like "Sum: 1,234"
- Covers 80% of report table needs

**Tier 2 — Typed columns + sort/filter**

- Column types: text, number, currency, percentage, date, checkbox
- Numbers auto-format with locale-aware separators
- Sort by column header click (ascending/descending with arrow indicator)
- Filter row for temporary view filtering

**Tier 3 — Cell formulas (deferred)**

- `=SUM(A1:A5)`, `=B2*C2`, basic arithmetic
- Requires expression parser, dependency graph, recalculation engine
- Enormous complexity — skip unless strong demand

**Tier 4 — Cross-table relations (out of scope)**

- Notion-style relations and rollups
- Requires document-level mini-database — not appropriate for a note editor

### Markdown Serialization

GFM tables don't support column types or aggregations. Options:

- **HTML comments in header cells**: `| Price <!-- type:currency, summary:sum --> |` — round-trips cleanly, invisible to other renderers
- **Sidecar metadata files**: `.notesage/table-meta/` — keeps markdown clean but adds file management complexity

Recommended: HTML comments approach.

## 4. Rich Link Preview Cards

### Competitor Survey

| App | Feature | UX Pattern |
| --- | --- | --- |
| **Notion** | Paste URL → "Create bookmark" | Card with title, description, favicon, preview image from OpenGraph |
| **Craft** | Paste URL → rich preview | Beautiful inline card with hero image |
| **Slack/Discord** | Auto-unfurling | Rich cards with OG metadata |
| **Coda** | URL → card display | Cards as visual display format for links |

### OpenGraph Protocol

The Open Graph protocol enables any web page to become a rich object. Tags in the page's `<head>`:

- `og:title` — Page title
- `og:description` — Brief description
- `og:image` — Preview image URL
- `og:site_name` — Website name
- Favicon from `<link rel="icon">`

APIs like [opengraph.io](https://www.opengraph.io/link-preview-api) provide unfurling services, but we can implement this directly in Rust (fetch HTML, parse meta tags) for zero external dependencies.

### Card Design

```
┌─────────────────────────────────────────────────┐
│  [favicon] Site Name                            │
│  Title of the Page                    [image]   │
│  Description text, truncated to                 │
│  two lines maximum...                           │
│  example.com                                    │
└─────────────────────────────────────────────────┘
```

Clean, bordered card with subtle shadow. Image on the right, text on the left. Click opens URL in system browser.

## 5. Callout / Admonition Blocks

### Competitor Survey

| App | Feature | UX Pattern |
| --- | --- | --- |
| **Obsidian** | `> [!tip]` syntax | Beautiful colored blocks with icons |
| **Notion** | Callout blocks | Emoji + colored background |
| **Quarto** | Five types (note, tip, warning, caution, important) | Distinct colors and icons |
| **MkDocs Material** | 12 admonition types | Colored left border, icon, collapsible |
| **MyST Markdown** | 10 admonition types | Directive syntax with named variants |

### Recommended Types

| Type | Icon (Lucide) | Accent Color | Use Case |
| --- | --- | --- | --- |
| **Note** | `info` | Neutral grey | General information, context |
| **Tip** | `lightbulb` | Muted green | Helpful suggestions, best practices |
| **Warning** | `alert-triangle` | Muted amber | Cautions, potential issues |
| **Important** | `alert-circle` | Muted red | Critical information, breaking changes |

Colors are an exception to the neutral palette — they convey semantic meaning (like diff colors in the editor). Defined as CSS variables with light/dark variants.

### Syntax Compatibility

Obsidian's `> [!type]` syntax is becoming a de facto standard. Adopting it ensures interoperability:

```markdown
<div class="callout callout-tip" data-callout-type="tip" data-title="Pro Tip">
<p>This is a helpful suggestion that stands out visually.</p>
</div>
```

## 6. Table Sparklines

### What They Are

Tiny inline SVG charts (\~60px × 20px) rendered inside table cells. Show trends at a glance without taking up space.

### Where They're Used

- **Google Sheets** — `=SPARKLINE()` function
- **Financial dashboards** — ubiquitous for trend visualization
- **Data tables in reports** — show direction alongside numbers

### Implementation

Custom SVG generation. Libraries: `@fnando/sparkline` (2KB, MIT) or hand-rolled SVG paths. Data sourced from cells in the same row or manually specified.

## Priority Ranking

Based on design impact, user simplicity, and report generation value:

| \# | Feature | Effort | Why This Priority |
| --- | --- | --- | --- |
| **1** | **Drawing canvas (Excalidraw)** | High | Most requested. Transforms what's possible in a note. Freehand + shapes + arrows covers diagrams, sketches, annotations. |
| **2** | **Callout blocks** | Low | Highest visual impact per effort. Makes every document more structured and polished. |
| **3** | **Charts (shadcn/ui + Recharts)** | Medium | Core to report generation. Beautiful SVG charts inline in documents. |
| **4** | **Dynamic table summaries** | Medium | Computed footer rows make tables actionable. Essential for reports with numbers. |
| **5** | **Rich link preview cards** | Medium | Turns plain URLs into visual, informative cards. Great for research and references. |
| **6** | **Table sparklines** | Low | Polish feature — best added after charts and dynamic tables exist. |

## Sources

- [Notion Charts Guide](https://www.notion.com/help/guides/charts-visualize-data-track-progress-in-notion)
- [Notion Chart View](https://www.notion.com/help/charts)
- [Coda Summarize Table Data](https://help.coda.io/hc/en-us/articles/39555846704269-Summarize-table-data)
- [Coda Formulas](https://coda.io/formulas)
- [Designing a Beautiful Doc (Coda)](https://coda.io/@john/designing-a-beautiful-doc)
- [Excalidraw GitHub](https://github.com/excalidraw/excalidraw)
- [tldraw SDK](https://tldraw.dev/)
- [Nivo Data Visualization](https://nivo.rocks)
- [Nivo vs Recharts (Speakeasy)](https://www.speakeasy.com/blog/nivo-vs-recharts)
- [JS Chart Libraries 2026 (Luzmo)](https://www.luzmo.com/blog/javascript-chart-libraries)
- [Obsidian Admonitions Plugin](https://github.com/javalent/admonitions)
- [Quarto Callout Blocks](https://quarto.org/docs/authoring/callouts.html)
- [MkDocs Material Admonitions](https://squidfunk.github.io/mkdocs-material/reference/admonitions/)
- [OpenGraph Link Preview API](https://www.opengraph.io/link-preview-api)
- [Note Apps Feature Comparison 2026](https://noteapps.info/best_note_taking_apps_2026)
- [Zapier Best Note Taking Apps 2026](https://zapier.com/blog/best-note-taking-apps/)