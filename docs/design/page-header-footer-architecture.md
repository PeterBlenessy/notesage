# Design: Page Headers & Footers — Decoration Architecture

## Problem

The current implementation uses an absolute-positioned overlay to render header/footer zones independently of page break gap decorations. This causes:

- Positioning bugs (zones drift, misalign on startup, break when gap toggle changes)
- Complex Y-coordinate math that's fragile and hard to debug
- Separate rendering path for page 1 header and last page footer ("edge zones")
- Overlay rebuild conflicts with the React portal used for inline editing

## Constraint

ProseMirror has no page concept. The `.ProseMirror` element contains a flat list of block nodes (paragraphs, headings, tables, etc.). We cannot wrap nodes in `<div class="page">` containers. Pages are a visual illusion created by measuring node heights, computing page boundaries, and inserting **widget decorations** between nodes.

## Design: Three Decorations Per Page Boundary

Instead of one combined gap decoration, we use three separate decorations:

```
.ProseMirror (paddingTop: 0, paddingBottom: 0 in print layout)
  ├── [top-margin decoration]      ← page 1 header lives here
  ├── <h1>Title</h1>
  ├── <p>Content...</p>
  ├── [bottom-margin decoration]   ← page 1 footer lives here
  ├── [gap decoration]             ← visual spacer only (32px grey strip)
  ├── [top-margin decoration]      ← page 2 header lives here
  ├── <h2>Next section</h2>
  ├── <p>More content...</p>
  ├── [bottom-margin decoration]   ← last page footer lives here
```

| Decoration | Class | Height | Content |
| --- | --- | --- | --- |
| `top-margin` | `.page-top-margin` | `marginTop` from settings (px) | Header zone |
| `bottom-margin` | `.page-bottom-margin` | `marginBottom` from settings (px) | Footer zone |
| `gap` | `.page-gap` | 32px | Empty grey strip |

### Page 1 and last page

- **Page 1**: `top-margin` decoration at position 0 (`side: -1`). No gap above it.
- **Last page**: `bottom-margin` decoration at `doc.content.size` (`side: 1`). No gap below it.
- **Between pages**: `bottom-margin` + `gap` + `top-margin` at the break position.

No special "edge zone" handling. The same decoration type is used everywhere.

### `.ProseMirror` padding

- **Print Layout ON**: `paddingTop: 0; paddingBottom: 0`. All margins are decorations.
- **Print Layout OFF**: `paddingTop: {setting}; paddingBottom: {setting}`. No decorations; padding provides margins.

The `calculate()` function reads the margin settings directly (from the Zustand store, not from CSS computed style) to compute `usablePerPage = pageHeight - marginTop - marginBottom`.

### Print Layout vs Continuous

Rename "Page Break Gaps" to **"Print Layout"**.

| Mode | Decorations | Headers/Footers | Gaps | `.ProseMirror` padding |
| --- | --- | --- | --- | --- |
| Print Layout ON | top-margin + gap + bottom-margin at each break; top-margin at pos 0; bottom-margin at end | Visible and editable | 32px grey strip | 0 |
| Print Layout OFF | None | Not displayed | None | From margin settings |

In Print Layout OFF, no decorations are inserted. The document flows continuously. Left/right padding stays the same in both modes.

### Header/footer zone DOM structure

Each margin decoration creates a container div with a zone child:

```html
<div class="page-top-margin" contenteditable="false" style="height: 95px">
  <div class="page-header-zone" data-page="1">
    <span class="page-hf-col page-hf-left">My Report</span>
    <span class="page-hf-col page-hf-center"></span>
    <span class="page-hf-col page-hf-right">Page 1</span>
  </div>
</div>
```

- The margin div is the container with a fixed height.
- The zone div is a flex child, vertically centered.
- No absolute positioning. The zone is a normal flow child of the margin.

### Inline editing

When a zone is clicked:

1. Click event fires `PAGE_HF_CLICK_EVENT` with the zone element
2. `Editor.tsx` sets `hfEditState` and adds `.page-hf-editing` class to the zone
3. React renders `PageHeaderFooterEditor` via `createPortal` into the zone element
4. CSS hides the text spans and shows the edit UI
5. On close, the class is removed and decorations refresh

The portal target is the zone div inside the margin decoration. Same approach as now.

### Preventing recalculation during editing

When `.page-hf-editing` is present in the DOM, `calculate()` returns early. This prevents ProseMirror dispatches from interfering with the React portal. After the editor closes, a `refreshZones` call triggers recalculation to show updated content.

### Height measurement

The `calculate()` function measures content node heights via `editorView.nodeDOM(offset)`. Widget decorations are NOT document nodes — ProseMirror tracks nodes by document position, not DOM position. So margin and gap decorations are automatically excluded from height measurement.

**Risk:** A widget at position 0 might cause `editorView.nodeDOM(0)` to return the wrong element. If this happens, we fall back to keeping `.ProseMirror` `paddingTop` for page 1 only and not inserting a top-margin decoration at position 0. This would be the only special case.

### Gap decoration (simplified)

The gap decoration becomes a simple empty div:

```html
<div class="page-gap" contenteditable="false"></div>
```

CSS: `height: 32px; background: var(--color-muted);`

No gradient, no `--page-remainder`, no margin space. The remainder space is handled by adjusting the `bottom-margin` decoration's height or by a separate padding widget (as today).

Actually — the remainder space is the unused content area at the bottom of the page. It should appear as blank page background, not as part of any decoration. Currently it's embedded in the gap height. With three separate decorations, the remainder can be a fourth decoration or simply part of the bottom-margin's visual space.

**Decision:** The bottom-margin decoration handles the remainder. Its visual height = `remainder + marginBottom`. The bottom `marginBottom` pixels show the footer zone. The top `remainder` pixels are blank page background. CSS can handle this:

```css
.page-bottom-margin {
  height: var(--page-bottom-margin-height); /* set inline: remainder + marginBottom */
  display: flex;
  align-items: flex-end; /* footer zone sits at the bottom of the margin area */
}
```

This keeps it to three decorations (not four) and the footer is always at the bottom of the margin area, regardless of how much remainder space there is.

Similarly, the top-margin's zone sits at the top:

```css
.page-top-margin {
  height: var(--page-top-margin-height); /* just marginTop, no remainder */
  display: flex;
  align-items: flex-start;
}
```

### Tick marks in continuous mode

Currently, small tick marks show at the left/right margins in continuous mode. With Print Layout OFF, no decorations exist, so no tick marks. This is correct per the spec: continuous mode shows no page boundaries at all.

## Implementation Tasks

### Task 1: Rename toggle (S)

- `SettingsDialog.tsx`: Change label from "Page Break Gaps" to "Print Layout", update description
- Optional: rename `pageBreaks` store key to `printLayout` (or just change the label)

### Task 2: Rewrite `calculate()` — three decorations (L)

- Remove the single gap decoration factory
- Build three decoration types: `top-margin`, `gap`, `bottom-margin`
- Page 1: insert `top-margin` at position 0
- Last page: insert `bottom-margin` at `doc.content.size`
- Between pages: insert all three at break position
- Bottom margin height = `remainder + marginBottom` (footer anchored at bottom via CSS)
- Top margin height = `marginTop` (header anchored at top via CSS)
- Gap height = 32px
- In Print Layout OFF: insert nothing, zero-out all decorations
- Zero `.ProseMirror` `paddingTop`/`paddingBottom` in print layout mode
- Read margin values from settings store directly (not from CSS computed style)
- Zone elements created by `createZoneElement()` (existing function, minimal changes)

### Task 3: Rewrite CSS (M)

- Remove `.page-break-gap` and all its rules (visible/continuous modes, gradients, tick marks)
- Remove `.page-zone-overlay` and all overlay positioning
- Add `.page-top-margin`: flex container, `align-items: flex-start`, extends into left/right margins
- Add `.page-bottom-margin`: flex container, `align-items: flex-end`, extends into left/right margins
- Add `.page-gap`: simple background color, extends into left/right margins
- Zone styles (`.page-header-zone`, `.page-footer-zone`): remove `position: absolute`, use normal flow
- Keep `.page-hf-editing`, `.page-hf-editor`, `.page-hf-input` styles (they work as-is)

### Task 4: Update `Editor.tsx` (M)

- Set `paddingTop: 0; paddingBottom: 0` when `isPaperMode && printLayout === 'visible'`
- Keep existing `paddingTop`/`paddingBottom` when not in print layout
- Remove the overlay-related code (`__refreshPageZones`)
- After closing editor, trigger `scheduleCalculation` via a custom event or store change
- Keep the `createPortal` approach for inline editing

### Task 5: Verify position 0 widget (S)

- Test that `editorView.nodeDOM(0)` returns the correct content node when a widget is inserted at position 0
- If it breaks, implement fallback: keep `paddingTop` for page 1, don't insert top-margin at position 0, inject header zone as direct DOM child of `.ProseMirror`

### Task 6: Test & fix (M)

- All test plan items from the Verification section
- Fix any issues with the dropdown chevrons (currently not clickable — may be resolved by removing the overlay)
- Verify exports still work (they read from frontmatter, not from decorations — should be unaffected)

## Files to change

| File | Change |
| --- | --- |
| `page-breaks.ts` | Rewrite: three decorations per break, margin decorations contain zones, no overlay |
| `editor.css` | Replace overlay/gap CSS with margin decoration CSS |
| `Editor.tsx` | Zero padding in print layout, remove overlay code, keep portal |
| `SettingsDialog.tsx` | Rename "Page Break Gaps" to "Print Layout" |
| `settings-store.ts` | Optional: rename `pageBreaks` to `printLayout` |
| `PageHeaderFooterEditor.tsx` | No change (portal target is the zone div, same API) |
| `page-settings.ts` | No change |

## Verification

1. Print Layout ON: every page has header/footer in margin areas, 32px gap strip between pages
2. Print Layout OFF: continuous flow, no headers/footers, no gaps, no tick marks
3. Editing: click zone → inputs appear in-place → changes persist on close
4. All checkboxes, inputs, and dropdowns work without lag or flicker
5. App restart: zones appear immediately with correct content and positioning
6. Toggling Print Layout: zones appear/disappear cleanly
7. Single-page document: header at top, footer at bottom, no gap
8. Different first page / odd-even / page number start all work correctly
9. Exports: headers/footers appear in PDF, DOCX, HTML with correct content
10. Left/right margins consistent in both modes
