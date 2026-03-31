# DOCX Viewer Upgrade — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-31 |
| **Status** | Complete |
| **PRD** | None (viewer improvement, not a new feature) |
| **Total** | 6 tasks: 2S, 3M, 1L |
| **Suggested order** | Sequential: #1 → #2 → #3 → #4 → #5 → #6 |

**Context:**

The DOCX viewer currently uses mammoth.js, which is a *semantic* converter — it strips all visual styling (fonts, sizes, colors, table shading, code block backgrounds, callout formatting) and produces minimal HTML. Our DOCX export creates richly styled documents that mammoth cannot faithfully reproduce. The `docx-preview` library renders DOCX files with full visual fidelity by parsing the OOXML structure directly and generating styled DOM elements.

**Key constraint:** mammoth.js must remain as a dependency — it powers the "Convert to Markdown" feature in `src/lib/import-utils.ts` (`docxToMarkdown()`). Only the *rendering* path in `DocxViewer.tsx` switches to `docx-preview`.

**Risks:**

- `docx-preview` injects its own CSS into the page; may conflict with Tailwind or editor styles — isolate via `styleContainer` parameter or scoped wrapper
- `docx-preview` renders inline styles for fonts; these may reference fonts not available on the system (Inter, Source Serif 4, JetBrains Mono are bundled for PDF export but not installed system-wide) — acceptable degradation, Word does the same
- Find-in-document (Cmd+F) currently uses `dom-search.ts` which walks text nodes and wraps matches in `<mark>` elements — must verify this still works with `docx-preview`'s DOM structure
- Dark mode: `docx-preview` renders with the document's original colors (typically black-on-white); dark mode inversion may need a wrapper approach (white background island) rather than forcing dark colors

---

### #1 — Replace mammoth rendering with docx-preview in DocxViewer ✅

**Description:** Rewrite the rendering path in `DocxViewer.tsx` to use `docx-preview`'s `renderAsync()` instead of mammoth's `convertToHtml()`. Key changes:

- Import `renderAsync` from `docx-preview`
- Remove the mammoth import (mammoth stays in `import-utils.ts` only)
- Replace the `dangerouslySetInnerHTML` div with a container ref that `renderAsync()` renders into
- Pass the binary `ArrayBuffer` from `getBinaryData()` directly to `renderAsync()`
- Use a separate `<style>` element (or a wrapper div) as the `styleContainer` parameter to isolate docx-preview's CSS from the rest of the app
- Configure options: `{ inWrapper: true, ignoreWidth: false, ignoreHeight: true, breakPages: false, renderHeaders: true, renderFooters: true, className: "docx-preview-body" }`
- Remove `DOMPurify.sanitize()` — `docx-preview` builds DOM directly, not via innerHTML

Keep the existing toolbar, FindBar, and "Convert to Markdown" button unchanged. The `onConvertToMarkdown` prop still receives the raw HTML — but since we no longer have mammoth HTML readily available, the callback should be changed to pass `null` or be refactored (handled in #3).

**Complexity:** M (30-60 min)
**Category:** frontend
**Dependencies:** None
**Files:**
- Modify `src/components/editor/viewers/DocxViewer.tsx`

---

### #2 — Style the docx-preview container for light and dark mode ✅

**Description:** Add CSS to properly contain and style the `docx-preview` output:

- Add a `.docx-preview-wrapper` class in `editor.css` (or `globals.css`) that:
  - Sets `max-width: 720px`, `margin: 0 auto`, padding consistent with other viewers
  - Ensures the document renders on a white background regardless of app theme (DOCX documents are authored with light backgrounds)
  - In dark mode: wrap in a white-background island with subtle border/shadow, similar to how PDF viewers handle dark mode (the document content stays light, the surrounding chrome is dark)
- Override `docx-preview`'s default wrapper styles if they conflict (e.g., forced widths, margins)
- Ensure scrollbar styling is consistent with the rest of the app
- Test with all three export templates (Clean, Academic, Report) in both light and dark mode

**Complexity:** M (30-60 min)
**Category:** frontend
**Dependencies:** Depends on #1
**Files:**
- Modify `src/styles/editor.css` or `src/styles/globals.css`
- Modify `src/components/editor/viewers/DocxViewer.tsx` (add wrapper classes)

---

### #3 — Update "Convert to Markdown" to work without mammoth HTML ✅

**Description:** The current `onConvertToMarkdown` callback receives the mammoth HTML string. Since rendering now uses `docx-preview`, this HTML is no longer available in the viewer. The callback in `EditorViewerContainer.tsx` already bypasses the passed HTML and re-reads from `getBinaryData()` + calls `docxToMarkdown()` directly, so the `_html` parameter is unused.

- Change `onConvertToMarkdown` prop type from `(html: string, fileName: string) => void` to `(fileName: string) => void`
- Update `DocxViewer.tsx` and `EditorViewerContainer.tsx` accordingly
- Remove the `html` state variable from `DocxViewer` since it's no longer needed
- Verify "Convert to Markdown" still works end-to-end

**Complexity:** S (< 15 min)
**Category:** frontend
**Dependencies:** Depends on #1
**Files:**
- Modify `src/components/editor/viewers/DocxViewer.tsx`
- Modify `src/components/editor/EditorViewerContainer.tsx`

---

### #4 — Verify and fix find-in-document (Cmd+F) with docx-preview DOM ✅

**Description:** The find-in-document feature uses `dom-search.ts` to walk text nodes and wrap matches in `<mark>` elements. Verify this works with `docx-preview`'s generated DOM structure:

- Open a DOCX file, press Cmd+F, search for text that appears in the document
- Verify matches are highlighted and navigation (Enter/Shift+Enter) scrolls correctly
- If `docx-preview` uses shadow DOM or iframes, `dom-search.ts` won't reach the text nodes — investigate and fix
- If `docx-preview`'s DOM structure causes issues with text node walking (e.g., deeply nested spans with inline styles), test edge cases: text split across runs, tables, headers
- Fix any issues found — likely the `contentRef` needs to point to the `docx-preview` body container rather than a wrapper div

**Complexity:** M (30-60 min)
**Category:** frontend
**Dependencies:** Depends on #1
**Files:**
- Modify `src/components/editor/viewers/DocxViewer.tsx` (adjust contentRef target if needed)
- Possibly modify `src/lib/dom-search.ts` (if structural fixes needed)

---

### #5 — Add loading state and error handling ✅

**Description:** `docx-preview`'s `renderAsync()` is async and may take longer than mammoth for complex documents. Add proper loading UX:

- Show a skeleton or spinner while `renderAsync()` is processing
- Handle errors gracefully (invalid DOCX, corrupted file) with the existing error state pattern
- Handle the case where `getBinaryData()` returns null (file not yet loaded)
- Log any `docx-preview` rendering issues to console for debugging

**Complexity:** S (< 15 min)
**Category:** frontend
**Dependencies:** Depends on #1
**Files:**
- Modify `src/components/editor/viewers/DocxViewer.tsx`

---

### #6 — Write tests and update docs ✅

**Description:** Add tests and update documentation:

- If a DocxViewer test file exists, update it for the new rendering approach. If not, add basic tests verifying the component renders without crashing, shows loading state, and handles missing data.
- Update `docs/features/document-formats.md`: change the DOCX Viewer section from "Powered by mammoth.js" to describe the docx-preview rendering with mammoth.js retained for markdown conversion
- Update `docs/architecture.md` if the DOCX viewer is mentioned there

**Complexity:** M (30-60 min)
**Category:** frontend
**Dependencies:** Depends on #1, #2, #3, #4, #5
**Files:**
- Create or modify `src/components/editor/viewers/__tests__/DocxViewer.test.tsx`
- Modify `docs/features/document-formats.md`
- Possibly modify `docs/architecture.md`
