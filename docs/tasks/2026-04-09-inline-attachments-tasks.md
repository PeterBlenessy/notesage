# Inline Attachments — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-09 |
| **Status** | Done |
| **Note** | Export tasks (#9-#11) reverted and blocked on [inline chart/drawing export bug](../bugs/2026-04-10-inline-chart-drawing-export.md) — needs redesign |
| **PRD** | [inline-attachments](../prds/2026-04-09-inline-attachments.md) |
| **Total** | 16 tasks: 5S, 7M, 4L |
| **Suggested order** | Parser (#1-#2) → Chart extension (#3-#5) → Drawing extension (#6-#8) → SVG cache (#9) → Export (#10-#11) → Migration (#12-#13) → Skill (#14) → Tests (#15) → Cleanup (#16) |

### Risks & Open Questions

- **Large chart JSON in ProseMirror attributes** — chart data is typically &lt;2KB, but a 30-row multi-series chart could be \~5KB. ProseMirror stores attributes in memory per node; this should be fine but worth monitoring.
- **Excalidraw scene size** — complex drawings can be 10-50KB of JSON. Storing this as a node attribute is viable but makes the ProseMirror doc heavier. Fenced code block serialization keeps it out of the DOM except during parse/serialize.
- **Rust export parsers** — the Typst, HTML, PPTX, and DOCX exporters all parse markdown in Rust via comrak. They need to recognize the new ```` ```chart ```` fenced block syntax and extract the JSON. comrak exposes code blocks with info strings, so this should be straightforward.
- **Drawing round-trip fidelity** — Excalidraw scene JSON includes `appState` (viewport, zoom, selection) which changes on every interaction. The serializer should strip volatile fields to prevent dirty-on-open.

---

## Chart Inline (Parser + Extension)

### #1 — Add `convertInlineChartsToHtml` parser function ✅

**Description:** Add a new function in `markdown.ts` that matches ```` ```chart\n{...}\n``` ```` fenced code blocks and converts them to `<div data-chart-json="..." data-type="chart" class="chart-block"></div>` HTML elements. The JSON content should be HTML-attribute-escaped. Keep the existing `convertChartsToHtml` (sidecar image syntax) as a legacy fallback — both functions run in the preprocessing pipeline.

**Acceptance criteria:**

- ```` ```chart\n{"type":"bar",...}\n``` ```` → div with `data-chart-json` attribute
- Multi-line pretty-printed JSON works
- Regular code blocks (```` ```json ````, ```` ```js ````) are not affected
- Empty ```` ```chart\n\n``` ```` blocks produce a div with empty/null `data-chart-json`
- Old `![chart](/.notesage/charts/...)` syntax still works via the existing converter

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/lib/markdown.ts`, `src/lib/__tests__/chart-markdown.test.ts`

---

### #2 — Add `convertInlineDrawingsToHtml` parser function ✅

**Description:** Same pattern as #1 but for ```` ```excalidraw ```` fenced code blocks → `<div data-drawing-json="..." data-type="drawing" class="drawing-block"></div>`. Keep the existing `convertDrawingsToHtml` as a legacy fallback.

**Acceptance criteria:**

- ```` ```excalidraw\n{...}\n``` ```` → div with `data-drawing-json` attribute
- Old `![drawing](/.notesage/drawings/...)` syntax still works
- Other code blocks unaffected

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/lib/markdown.ts`, `src/lib/__tests__/drawing-markdown.test.ts`

---

### #3 — Add `chartJson` attribute to chart extension ✅

**Description:** Add a `chartJson: string | null` attribute to the Chart node in `chart.ts`. Parse it from `data-chart-json` on the HTML element. Keep `chartId` for backward compatibility during migration. Update `parseHTML` to accept divs with either `data-chart-id` or `data-chart-json`.

**Acceptance criteria:**

- Chart nodes can carry inline JSON data as an attribute
- Nodes with `chartJson` don't need `chartId`
- Nodes with only `chartId` (legacy) still parse correctly
- TypeScript compiles cleanly

**Complexity:** S **Category:** frontend **Dependencies:** #1 **Files:** `src/components/editor/extensions/chart.ts`

---

### #4 — Update chart serializer to write fenced code blocks ✅

**Description:** Change the `addStorage.markdown.serialize` method in `chart.ts` to output ```` ```chart\n{json}\n``` ```` instead of `<div data-chart-id="{id}" data-type="chart" class="chart-block"></div>`. The serializer reads `chartJson` from the node attribute. If `chartJson` is null but `chartId` is present (legacy node not yet migrated), fall back to the old image syntax so the file isn't corrupted before migration runs.

**Acceptance criteria:**

- Nodes with `chartJson` serialize as fenced code blocks
- JSON is pretty-printed with 2-space indent
- Legacy nodes (only `chartId`) still serialize as image syntax
- Round-trip: parse inline → serialize → content matches

**Complexity:** M **Category:** frontend **Dependencies:** #3 **Files:** `src/components/editor/extensions/chart.ts`

---

### #5 — Rewrite ChartNodeView to read from `chartJson` attribute ✅

**Description:** Simplify `ChartNodeView` to read chart data directly from `node.attrs.chartJson` instead of loading from sidecar files via async IPC. Remove the `useActiveProject` hook, `loadChart()` call, `loaded` state, and the async loading lifecycle. If `chartJson` is present, `JSON.parse()` it synchronously. If only `chartId` is present (legacy), keep the old loading path as fallback.

When the user edits a chart in `ChartEditorPanel`, update `chartJson` on the node via a ProseMirror transaction (instead of calling `saveChart()`). This makes the document dirty and triggers auto-save, which writes the inline code block.

**Acceptance criteria:**

- Charts with `chartJson` render immediately (no "Loading chart..." state)
- Charts work in files opened from explorer folders (no project needed)
- Editing a chart updates the node attribute and marks the document dirty
- Legacy charts (only `chartId`) still load from sidecar
- Chart duplication copies `chartJson` to the new node
- Download SVG/PNG still works (reads from rendered DOM)

**Complexity:** L **Category:** frontend **Dependencies:** #3, #4 **Files:** `src/components/editor/charts/ChartNodeView.tsx`, `src/components/editor/charts/ChartEditorPanel.tsx`

---

## Drawing Inline (Extension)

### #6 — Add `drawingJson` attribute to drawing extension ✅

**Description:** Add a `drawingJson: string | null` attribute to the Drawing node in `drawing.ts`. Parse from `data-drawing-json`. Keep `drawingId` for backward compatibility. Update `parseHTML` to accept either format.

**Acceptance criteria:**

- Drawing nodes can carry inline Excalidraw scene JSON
- Nodes with `drawingJson` don't need `drawingId`
- Legacy `drawingId`-only nodes still parse
- TypeScript compiles

**Complexity:** S **Category:** frontend **Dependencies:** #2 **Files:** `src/components/editor/extensions/drawing.ts`

---

### #7 — Update drawing serializer to write fenced code blocks ✅

**Description:** Change the drawing serializer to output ```` ```excalidraw\n{json}\n``` ```` instead of `<div data-drawing-id="{id}" data-type="drawing" class="drawing-block"></div>`. Strip volatile `appState` fields (scrollX, scrollY, zoom, selectedElementIds, cursorButton) before serializing to prevent dirty-on-open. Legacy nodes fall back to old syntax.

**Acceptance criteria:**

- Nodes with `drawingJson` serialize as ```` ```excalidraw ```` blocks
- Volatile appState fields stripped
- Legacy nodes (only `drawingId`) use old image syntax
- Round-trip: parse inline → serialize → content matches

**Complexity:** M **Category:** frontend **Dependencies:** #6 **Files:** `src/components/editor/extensions/drawing.ts`

---

### #8 — Rewrite DrawingPreview and DrawingEditor to read from `drawingJson` ✅

**Description:** Update `DrawingPreview` to read scene data from `node.attrs.drawingJson` instead of loading from sidecar files. Remove `useActiveProject` dependency for inline drawings. When the user saves from `DrawingEditor`, update `drawingJson` on the node via ProseMirror transaction. Keep the legacy `drawingId` loading path as fallback.

SVG preview generation (for the static preview in the document) should work from the in-memory scene data — no sidecar file needed.

**Acceptance criteria:**

- Inline drawings render immediately from `drawingJson`
- Drawings work in files opened from explorer folders
- Saving from DrawingEditor updates the node attribute
- Legacy drawings (only `drawingId`) still load from sidecar
- SVG preview generated from in-memory data

**Complexity:** L **Category:** frontend **Dependencies:** #6, #7 **Files:** `src/components/editor/DrawingPreview.tsx`, `src/components/editor/DrawingEditor.tsx`

---

## SVG Cache

### #9 — Implement content-hash SVG cache for exports ❌ reverted — blocked on [export bug](../bugs/2026-04-10-inline-chart-drawing-export.md), needs redesign

**Description:** Create a `src/lib/svg-cache.ts` utility that manages SVG preview caching in `.notesage/cache/`. Key files by content hash (first 12 chars of SHA-256 of the JSON). Provide `writeSvgCache(json, svg, filePath)` that finds or creates the nearest `.notesage/cache/` directory (walking up from the file's location, or using the file's own directory as fallback). Provide `readSvgCache(json, filePath)` that returns cached SVG or null.

The cache is best-effort — if no `.notesage/` dir can be found and we can't create one, skip caching silently. Exports that need SVG can always regenerate from the JSON in-memory.

**Acceptance criteria:**

- `writeSvgCache` stores SVG keyed by content hash
- `readSvgCache` returns cached SVG or null
- Cache directory created automatically if `.notesage/` exists
- No error if `.notesage/` can't be found/created
- Different chart data produces different cache keys

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/lib/svg-cache.ts`

---

## Export Updates (Rust)

### #10 — Update Rust exporters to parse ```` ```chart ```` fenced blocks ❌ reverted — blocked on [export bug](../bugs/2026-04-10-inline-chart-drawing-export.md), needs redesign

**Description:** Update the comrak-based markdown parsers in `markdown_to_typst.rs`, `markdown_to_html.rs`, `markdown_to_pptx.rs`, and `markdown_to_docx.rs` to recognize ```` ```chart ```` fenced code blocks. Extract the JSON content from the code block's literal text. For PPTX, parse into the `SlideChart` model. For Typst/HTML, render the cached SVG or a placeholder. Keep the existing `![chart](/.notesage/charts/...)` image-syntax handling as a legacy fallback.

comrak exposes code blocks via `NodeValue::CodeBlock { info, literal }` — match on `info == "chart"` and parse `literal` as JSON.

**Acceptance criteria:**

- PDF export renders inline charts (via SVG or placeholder)
- PPTX export converts inline chart JSON to native charts
- HTML export renders inline charts
- DOCX export renders inline charts
- Legacy sidecar image references still work in all exporters

**Complexity:** L **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/export/markdown_to_typst.rs`, `src-tauri/src/export/markdown_to_html.rs`, `src-tauri/src/export/markdown_to_pptx.rs`, `src-tauri/src/export/markdown_to_docx.rs`

---

### #11 — Update Rust exporters to parse ```` ```excalidraw ```` fenced blocks ❌ reverted — blocked on [export bug](../bugs/2026-04-10-inline-chart-drawing-export.md), needs redesign

**Description:** Same as #10 but for ```` ```excalidraw ```` blocks in drawings. The exporters need the SVG rendering — they should look for the cached SVG file (via content hash), or fall back to a placeholder. The SVG path resolution changes from `/.notesage/drawings/{id}.svg` to `/.notesage/cache/drawing-{hash}.svg`.

**Acceptance criteria:**

- PDF export renders inline drawings via cached SVG
- PPTX export embeds inline drawing SVGs
- HTML export embeds inline drawing SVGs as data URIs
- DOCX export embeds inline drawing SVGs
- Legacy sidecar image references still work
- Missing SVG cache produces a placeholder (not an error)

**Complexity:** L **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/export/markdown_to_typst.rs`, `src-tauri/src/export/markdown_to_html.rs`, `src-tauri/src/export/markdown_to_pptx.rs`, `src-tauri/src/export/markdown_to_docx.rs`

---

## Migration

### #12 — Auto-migrate sidecar charts to inline on save ✅

**Description:** When the chart serializer encounters a node with `chartId` but no `chartJson` (legacy sidecar format), trigger migration:

1. The `ChartNodeView` already loads the sidecar data into memory (legacy path)
2. On save, the serializer checks: if the node has `chartJson`, write inline. If it has only `chartId` but the component has loaded the data, set `chartJson` on the node attribute before serializing.
3. After successful save, delete the old sidecar files (`.json` and `.svg`) with a toast: "Migrated chart to inline format"

This should happen in `ChartNodeView` — when it loads from sidecar (legacy path), it should immediately update the node attribute with `chartJson`, converting it to inline. The next save will write the inline format.

**Acceptance criteria:**

- Opening a file with sidecar charts loads them normally
- Saving the file converts chart references to inline code blocks
- Old sidecar `.json` and `.svg` files deleted after save
- Toast shown with migration count
- Idempotent — re-saving doesn't re-migrate

**Complexity:** M **Category:** frontend **Dependencies:** #5 **Files:** `src/components/editor/charts/ChartNodeView.tsx`, `src/lib/chart-storage.ts`

---

### #13 — Auto-migrate sidecar drawings to inline on save ✅

**Description:** Same pattern as #12 but for drawings. When `DrawingPreview` loads from sidecar (legacy `drawingId`), update the node attribute with `drawingJson`. Next save writes inline. Delete old sidecar files.

**Acceptance criteria:**

- Opening a file with sidecar drawings loads them normally
- Saving converts to inline code blocks
- Old sidecar `.excalidraw` and `.svg` files deleted after save
- Toast shown

**Complexity:** M **Category:** frontend **Dependencies:** #8 **Files:** `src/components/editor/DrawingPreview.tsx`, `src/lib/drawing-storage.ts`

---

## Skill Update

### #14 — Update insert-chart skill for inline format ✅

**Description:** Update `bundled-skills/insert-chart/` — SKILL.md workflow, CHART-SCHEMA.md format, and EXAMPLES.md to use fenced code blocks instead of sidecar files. The skill no longer needs to create directories, generate UUIDs, or write files. It just writes a ```` ```chart ```` code block into the markdown.

**Acceptance criteria:**

- SKILL.md workflow describes the new inline format
- CHART-SCHEMA.md shows the fenced code block wrapper
- EXAMPLES.md uses inline code blocks
- No references to `.notesage/charts/` for source data
- Agents can create charts by writing text only

**Complexity:** S **Category:** frontend **Dependencies:** #1, #4 **Files:** `bundled-skills/insert-chart/SKILL.md`, `bundled-skills/insert-chart/references/CHART-SCHEMA.md`, `bundled-skills/insert-chart/references/EXAMPLES.md`

---

## Tests

### #15 — Update and add round-trip tests for inline format ✅

**Description:** Update existing markdown round-trip tests to cover the new fenced code block syntax for charts and drawings. Add test fixtures with inline charts and drawings. Ensure the parse → serialize → compare cycle preserves the fenced blocks exactly. Update `chart-markdown.test.ts` and `drawing-markdown.test.ts` with new parser function tests.

**Acceptance criteria:**

- Round-trip test fixture with ```` ```chart ```` block passes
- Round-trip test fixture with ```` ```excalidraw ```` block passes
- Both old (sidecar image) and new (inline) formats tested in parser tests
- Serializer tests verify fenced code block output
- All existing tests still pass

**Complexity:** S **Category:** frontend **Dependencies:** #1, #2, #4, #7 **Files:** `tests/fixtures/inline-chart.md`, `tests/fixtures/inline-drawing.md`, `src/lib/__tests__/chart-markdown.test.ts`, `src/lib/__tests__/drawing-markdown.test.ts`, `src/lib/__tests__/markdown-roundtrip.test.ts`

---

## Cleanup

### #16 — Remove project-root dependency from chart/drawing rendering path ✅

**Description:** After inline format is working and migration is in place, clean up the rendering path:

1. Remove the local `useActiveProject` helper from `ChartNodeView.tsx` (replaced by direct attribute read)
2. Remove `chart-storage.ts` imports from `ChartNodeView` (only needed for migration and SVG cache, not rendering)
3. Remove `drawing-storage.ts` imports from `DrawingPreview` (same)
4. Add deprecation comments on `loadChart`, `saveChart`, `loadDrawing`, `saveDrawing` — they remain for migration but are no longer used for new charts
5. Update `docs/features/editor.md` and `docs/features/editor-architecture.md` to document the inline format

**Acceptance criteria:**

- Chart rendering has no dependency on `useActiveProject` or `findOwningProject`
- Drawing rendering has no dependency on `useActiveProject` or `findOwningProject`
- Storage modules have deprecation notices
- Feature docs updated

**Complexity:** S **Category:** frontend **Dependencies:** #5, #8, #12, #13 **Files:** `src/components/editor/charts/ChartNodeView.tsx`, `src/components/editor/DrawingPreview.tsx`, `docs/features/editor.md`, `docs/features/editor-architecture.md`

---

## Test Tasks

Tests are embedded within tasks #1, #2, #15. Additional test coverage:

- Parser tests for both old and new formats (#1, #2)
- Round-trip fixtures for inline charts and drawings (#15)
- Rust export tests for fenced block parsing (#10, #11 — each includes updating existing Rust `#[test]` functions)