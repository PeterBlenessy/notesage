# PRD: Inline Attachments — Embedded Chart & Drawing Data

|  |  |
| --- | --- |
| **Date** | 2026-04-09 |
| **Status** | Done |
| **Note** | Export of inline charts/drawings not yet implemented — tracked in [export bug](../bugs/2026-04-10-inline-chart-drawing-export.md) |
| **Priority** | High |
| **Impact** | Charts and drawings become fully portable — copy a .md file and everything renders, no sidecar files to lose or sync |

## Problem

Charts and drawings are stored as **sidecar files** in `.notesage/charts/` and `.notesage/drawings/`, referenced from markdown via image syntax (`<div data-chart-id="{id}" data-type="chart" class="chart-block"></div>`). This creates three problems:

1. **Not portable.** Moving or sharing a `.md` file without its `.notesage/` directory breaks all charts and drawings. They show "Loading chart..." forever. Markdown files with charts are not redistributable.

2. **Requires a registered project.** The `useActiveProject` hook resolves sidecar paths from the project root via `findOwningProject`. Files opened from explorer folders (not registered projects) can never load charts or drawings — they silently fail with no error message.

3. **Fragile coupling.** The sidecar file can be deleted, moved, or desync'd independently of the markdown. Orphan cleanup runs on a 5-second delay, but race conditions with undo, tab switches, and iCloud sync make this fragile.

Meanwhile, the markdown ecosystem has a proven pattern for embedding structured data: **fenced code blocks with a language tag**. Mermaid diagrams (```` ```mermaid ````), Vega-Lite charts (```` ```vega-lite ````), and PlantUML (```` ```plantuml ````) all use this approach. It's standard markdown, renders as readable JSON/text in any viewer, and requires zero external files.

## Goals

1. **Charts inline** — chart JSON embedded in ```` ```chart ```` fenced code blocks, fully self-contained in the markdown file
2. **Drawings inline** — Excalidraw scene data embedded in ```` ```excalidraw ```` fenced code blocks
3. **Zero sidecar files for source data** — the markdown file is the single source of truth
4. **SVG caches in** `.notesage/` — derived SVG previews (for PDF/PPTX export) still stored in `.notesage/cache/` as a performance optimization, regenerated on demand if missing
5. **No project requirement** — charts and drawings work in any opened file, regardless of project registration
6. **Backward compatibility** — existing sidecar-based documents continue to work; one-time migration converts sidecar references to inline blocks on save
7. **Skill parity** — `insert-chart` skill updated to write inline code blocks instead of sidecar files

## Non-Goals

- **Images** — binary data doesn't embed well in markdown; images remain as file references
- **Real-time collaboration on embedded data** — same single-user model as today
- **External editor support** — we don't need other editors to render the charts, just preserve the code blocks
- **Compression** — chart JSON is small (typically &lt;2KB); no need to compress or minify

## User Stories

- As a **user**, I want to copy a `.md` file to another folder or share it with someone, and have all charts render without any additional files
- As a **user**, I want to open a `.md` file from an explorer folder (not a project) and see charts render immediately
- As a **user**, I want to view chart data as readable JSON in any markdown editor or on GitHub
- As an **AI agent**, I want to create charts by writing a code block in the markdown file, without needing filesystem access to `.notesage/charts/`
- As a **user**, I want my existing documents with sidecar charts to automatically migrate to the inline format

## Technical Approach

### New Markdown Format

#### Charts

Before (sidecar):

```markdown
<div data-chart-id="abc123" data-type="chart" class="chart-block"></div>
```

After (inline):

```markdown
<div data-chart-json="{
  &quot;type&quot;: &quot;bar&quot;,
  &quot;title&quot;: &quot;Revenue&quot;,
  &quot;data&quot;: [{&quot;category&quot;: &quot;Q1&quot;, &quot;value&quot;: 142}],
  &quot;config&quot;: {&quot;xLabel&quot;: &quot;&quot;, &quot;yLabel&quot;: &quot;&quot;, &quot;showGrid&quot;: true, &quot;showLegend&quot;: false, &quot;colorScheme&quot;: &quot;neutral&quot;}
}" data-type="chart" class="chart-block"></div>
```

#### Drawings

Before (sidecar):

```markdown
<div data-drawing-id="abc123" data-type="drawing" class="drawing-block"></div>
```

After (inline):

```markdown
<div data-drawing-json="{&quot;type&quot;:&quot;excalidraw&quot;,&quot;version&quot;:2,&quot;elements&quot;:[...],&quot;appState&quot;:{...}}" data-type="drawing" class="drawing-block"></div>
```

### Parser Changes (`markdown.ts`)

Replace `convertChartsToHtml()` and `convertDrawingsToHtml()`:

- **Old:** Regex matches `![chart](/.notesage/charts/...)` image syntax → HTML div
- **New:** Regex matches ```` ```chart\n{...}\n``` ```` fenced blocks → HTML div with `data-chart-json` attribute containing the JSON
- **Backward compat:** Keep the old image-syntax regex as a fallback path — if detected, load from sidecar and render (but flag for migration on next save)

The parser should handle both formats simultaneously during the migration period.

### Serializer Changes (chart extension `addStorage.markdown.serialize`)

- **Old:** `s.write("<div data-chart-id="{id}" data-type="chart" class="chart-block"></div>\n\n")`
- **New:** ```` s.write("```chart\n" + JSON.stringify(chartData, null, 2) + "\n```\n\n") ````

The chart data is already in memory (the `ChartNodeView` holds it in state). The serializer reads it from the node attribute.

### Node Attribute Changes

#### Chart Extension (`chart.ts`)

Add a `chartJson` attribute to store the inline data:

```typescript
chartJson: {
  default: null as string | null,
  parseHTML: (el: HTMLElement) => el.getAttribute("data-chart-json"),
  renderHTML: (attrs) => attrs.chartJson ? { "data-chart-json": attrs.chartJson } : {},
}
```

Remove `chartId` as the primary identifier. Charts no longer need a UUID — the data lives on the node. For SVG cache keying, derive a hash from the JSON content.

#### Drawing Extension (`drawing.ts`)

Add a `drawingJson` attribute:

```typescript
drawingJson: {
  default: null as string | null,
  parseHTML: (el: HTMLElement) => el.getAttribute("data-drawing-json"),
  renderHTML: (attrs) => attrs.drawingJson ? { "data-drawing-json": attrs.drawingJson } : {},
}
```

### Data Flow Changes

#### Chart Loading (current → new)

**Current:** Open file → parse markdown → extract chartId → `loadChart(chartId, projectRoot)` → Tauri IPC read `.notesage/charts/{id}.json` → parse JSON → render

**New:** Open file → parse markdown → extract JSON from code block → set as node attribute → render directly from attribute. No IPC, no filesystem, no project root needed.

#### Chart Saving (current → new)

**Current:** Edit chart in panel → `saveChart(chartId, projectRoot, data)` → Tauri IPC write to `.notesage/charts/{id}.json` → also write SVG to `.notesage/charts/{id}.svg`

**New:** Edit chart in panel → update `chartJson` node attribute via ProseMirror transaction → document auto-saves (serializer writes inline code block). For SVG cache: derive cache key from content hash, write to `.notesage/cache/chart-{hash}.svg` via best-effort background task.

#### Drawing Loading/Saving

Same pattern as charts — data moves from sidecar files to node attributes.

### SVG Preview Cache

SVG previews are needed for PDF and PPTX export. They're derived from the chart/drawing data and can be regenerated.

- **Location:** `.notesage/cache/` (not `charts/` or `drawings/`)
- **Key:** Content hash of the JSON (e.g., `chart-{sha256_prefix}.svg`)
- **Lifecycle:** Written on chart render or edit. If missing at export time, regenerated on the fly.
- **No project requirement:** Cache uses the file's parent directory to find the nearest `.notesage/` folder, falling back to creating one. For files not in any project, cache is optional — export can render SVG in-memory without caching.

### Migration

On save, if the serializer detects a chart/drawing node that was loaded from the old sidecar format (has `chartId` but no `chartJson`):

1. Read the sidecar JSON file
2. Set `chartJson` on the node attribute
3. Serialize as inline code block
4. Delete the sidecar file after successful save (with a toast: "Migrated N charts to inline format")

This is automatic and transparent — users just save their file and it migrates.

### `ChartNodeView` Simplification

The current `ChartNodeView` has a complex loading lifecycle:

1. Extract `chartId` from node attrs
2. Resolve `projectRoot` via `useActiveProject`
3. Call `loadChart()` via Tauri IPC
4. Wait for async result
5. Set `loaded` state

After this change:

1. Read `chartJson` from node attrs
2. `JSON.parse()` it
3. Render

The `useActiveProject` hook, `loadChart()`, `saveChart()`, and the entire `chart-storage.ts` module become unnecessary for chart rendering. The `ChartNodeView` becomes a synchronous, stateless renderer with no IPC dependency.

### Insert-Chart Skill Update

The skill workflow simplifies dramatically:

**Current:** Generate UUID → mkdir `.notesage/charts/` → write JSON file → insert `![chart](...)` markdown

**New:** Write the fenced code block directly into the markdown file:

```markdown
<div data-chart-json="{&quot;type&quot;: &quot;bar&quot;, ...}" data-type="chart" class="chart-block"></div>
```

No filesystem operations, no UUID, no directory creation. The skill just writes text.

## Data Model

### Chart Node Attributes (updated)

```typescript
{
  // New: inline JSON data (primary)
  chartJson: string | null;
  
  // Legacy: sidecar file ID (kept for migration, eventually removed)
  chartId: string | null;
  
  width: number | null;
  height: number;
}
```

### Drawing Node Attributes (updated)

```typescript
{
  // New: inline JSON data (primary)
  drawingJson: string | null;
  
  // Legacy: sidecar file ID (kept for migration, eventually removed)
  drawingId: string | null;
  
  width: number | null;
  height: number;
}
```

### SVG Cache Path

```
<nearest_notesage_dir>/cache/chart-<hash>.svg
<nearest_notesage_dir>/cache/drawing-<hash>.svg
```

Where `<hash>` is the first 12 characters of the SHA-256 of the JSON content.

## Dependencies

No new dependencies. JSON parsing, SHA-256 hashing (`crypto.subtle`), and fenced code block regex are all built-in.

## Quality Gates

### Functional

- [x] Charts in ```` ```chart ```` code blocks render correctly for all 10 chart types

- [x] Drawings in ```` ```excalidraw ```` code blocks render correctly

- [x] Editing a chart via the editor panel updates the inline JSON on save

- [x] Editing a drawing via Excalidraw updates the inline JSON on save

- [x] Charts work in files opened from explorer folders (no project registration needed)

- [x] Charts work in files with no `.notesage/` directory at all

- [x] Copy a `.md` file with charts to a new location — charts render in the new location

- [x] Round-trip: open `.md` → edit nothing → save → inline code blocks preserved identically

### Backward Compatibility

- [x] Files with old `![chart](/.notesage/charts/...)` syntax still render (migration path)

- [x] On save, old sidecar references are automatically converted to inline code blocks

- [ ] Sidecar files cleaned up after successful migration

- [x] Existing chart/drawing tests continue to pass

- [x] Markdown round-trip tests updated and passing

### Export

- [ ] PDF export works with inline charts — **not implemented**, see [bug](../bugs/2026-04-10-inline-chart-drawing-export.md)

- [ ] PPTX export works with inline charts — **not implemented**

- [ ] DOCX export works with inline drawings — **not implemented**

- [ ] HTML export works with inline charts — **not implemented**

### Skill

- [x] `insert-chart` skill writes ```` ```chart ```` blocks instead of sidecar files

- [x] Skill examples updated

- [x] AI agents can create charts without filesystem access

### Design

- [x] No visual change — charts and drawings look identical before and after migration

- [x] Chart JSON is formatted with 2-space indent for readability in source mode

- [x] Code blocks render as the chart (not raw JSON) in WYSIWYG mode

## Out of Scope

- **Image embedding** — binary data doesn't work in code blocks; images remain as file references
- **Link preview embedding** — these are fetched from URLs at render time, not stored
- **Mermaid migration** — Mermaid already uses fenced code blocks (no change needed)
- **Removing** `.notesage/` **entirely** — still needed for project metadata, comments, skills, agents, research, index.db
- **Multi-file chart references** — charts are always inline in the document that displays them