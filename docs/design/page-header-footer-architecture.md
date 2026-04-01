---
page:
  header:
    left: Left
    center: "{page}"
    right: Right
    differentFirstPage: true
    firstPage:
      left: Left
      center: "{title}"
      right: Right
    differentOddEven: true
    oddPage:
      left: Left
      center: odd page
      right: Right
    evenPage:
      left: Left - 2nd page
      center: even page
      right: Right
  footer:
    left: left
    center: center
    right: right
---

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

Similarly, the top-margin's zone is vertically centered:

```css
.page-top-margin {
  height: /* marginTop, set inline by JS */;
  display: flex;
  align-items: center;
  pointer-events: none; /* prevent ProseMirror cursor placement */
}
```

Footer zones get an explicit `style.height` matching `marginBottomPx` set in JS, so they fill the margin portion and center text within it. The remainder space above sits empty.

### Tick marks in continuous mode

With Print Layout OFF, no decorations exist, so no tick marks or page boundaries.

## Implementation Status: Complete

All tasks have been implemented. Key implementation decisions and lessons:

### Settings rename

`pageBreaks: "visible" | "continuous"` replaced with `printLayout: boolean` in `settings-store.ts`. Migration (v2→v3) converts old values. The `data-page-breaks` DOM attribute was removed entirely — the plugin reads state directly from Zustand stores.

### Reading state from stores, not DOM

The plugin initially read `--page-height` CSS variable and `data-page-breaks` attribute from the DOM. This caused race conditions: the Zustand subscription fired before React committed the new attribute values. Fix: read `contentWidth`, `printLayout`, and margin values directly from `useSettingsStore.getState()`, and compute `pageHeight` from the `CONTENT_HEIGHTS` constant.

### Decoration key fingerprinting

ProseMirror reuses widget DOM when the decoration `key` matches. After editing header/footer content, the old key still matched, so the factory function didn't re-run and updated values weren't visible until app restart. Fix: include a `settingsFingerprint()` (JSON of header/footer/title) in each decoration key, so content changes bust the cache.

### Event isolation for inline editing

The `PageHeaderFooterEditor` React component is portaled into the zone element (a DOM node inside a ProseMirror widget decoration). Three layers of event isolation were needed:

1. **Pointer/clipboard/drag events** — stopped at the zone element (outside React's tree) in bubble phase. This prevents ProseMirror from acting on them while allowing React's capture-phase delegation to fire synthetic events (critical for Radix dropdown menus).
2. **Keyboard events** — stopped at the container element (`.page-hf-editor`) in bubble phase. Escape closes the editor; all other keys stay in the inputs.
3. **`pointer-events: none`** on margin containers — prevents ProseMirror from placing a cursor in the margin area. Zones override with `pointer-events: auto`.

Earlier approaches that stopped propagation on the React container itself killed React synthetic events (React 18 delegates from the root via capture phase — if native bubble propagation is stopped before reaching the root, synthetic events never fire).

### Editor store subscription narrowing

The full `useEditorStore.subscribe(scheduleCalculation)` fired on every keystroke (via `updateTabContent`), causing unnecessary RAF scheduling. Fixed by tracking `activeTabId` manually and only scheduling when it changes. The `docChanged` path in the plugin's `view.update()` handles content edits.

### Position 0 widget

Inserting a widget at position 0 with `side: -1` works correctly — `editorView.nodeDOM(0)` still returns the first content node, not the widget. No fallback was needed.

## Files changed

| File | Change |
| --- | --- |
| `page-breaks.ts` | Rewrite: three decorations per break, zones embedded in margin decorations, settings fingerprint keys, store-based state reads |
| `editor.css` | Replaced overlay/gap CSS with `.page-top-margin`, `.page-bottom-margin`, `.page-gap` |
| `Editor.tsx` | Zero padding in print layout, `hfEditStateRef` for stable close callback, removed `data-page-breaks` attribute |
| `SettingsDialog.tsx` | Renamed "Page Break Gaps" to "Print Layout" |
| `settings-store.ts` | `pageBreaks: "visible"/"continuous"` → `printLayout: boolean` with v3 migration |
| `PageHeaderFooterEditor.tsx` | Event isolation moved to zone element, added clipboard/drag event blocking |
| `FrontmatterBlock.tsx` | Fixed `[object Object]` display for nested frontmatter values |
| `page-settings.ts` | No change |

## Verification

All items verified:

 1. ✅ Print Layout ON: every page has header/footer in margin areas, 32px gap strip between pages
 2. ✅ Print Layout OFF: continuous flow, no headers/footers, no gaps
 3. ✅ Editing: click zone → inputs appear in-place → changes persist on close
 4. ✅ All checkboxes, inputs, and dropdowns work (including variable chevrons)
 5. ✅ App restart: zones appear immediately with correct content and positioning
 6. ✅ Toggling Print Layout: zones appear/disappear cleanly
 7. ✅ Single-page document: header at top, footer at bottom, no gap
 8. ✅ Different first page / odd-even / page number start all work correctly
 9. ✅ Exports: headers/footers appear in PDF, DOCX, HTML with correct content
10. ✅ Left/right margins consistent in both modes
11. ✅ Copy/paste works in header/footer inputs (not intercepted by ProseMirror)
12. ✅ No stray cursor on margin area clicks