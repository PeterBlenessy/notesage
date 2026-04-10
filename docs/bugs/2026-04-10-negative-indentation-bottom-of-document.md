# Bug: Negative indentation at bottom of document

|  |  |
| --- | --- |
| **Date** | 2026-04-10 |
| **Severity** | Medium |
| **Status** | Open |
| **Affects** | Editor content area, cursor positioning |

## Problem

At the bottom of a markdown document, the cursor and typed text are placed in the left margin — outside the normal content area. This appears as a negative indentation where text starts to the left of where it should.

## Expected behavior

The cursor and text should always remain within the editor content area boundaries, respecting the same left margin/padding as the rest of the document.

## Likely cause

Could be related to:
- ProseMirror editor padding/margin CSS not applying to the last block
- The editor's bottom padding being insufficient, causing the browser to scroll the content area in a way that misaligns the cursor
- A CSS interaction between the editor content area's `max-width: 720px` centering and the scroll container
- Possibly introduced or exacerbated by recent changes to editor NodeView rendering (inline attachments)

## Analysis (2026-04-10)

**Status:** Could not reproduce on development laptop. Deferred until reproducible.

**Investigation performed:**

- Reviewed all `.ProseMirror` CSS in `editor.css` — padding-left/right applied uniformly via CSS variables, no special rules for last child, no negative margins on content elements
- Confirmed `box-sizing: border-box` is set globally (Tailwind v4 preflight) — padding is included in width
- Layout structure is sound: scroll container → flex centering wrapper → content wrapper (`maxWidth: 720px`) → `.ProseMirror` (padding from CSS vars)
- Negative margins exist ONLY on `.page-top-margin`, `.page-bottom-margin`, `.page-gap` — these are print layout decorations, only active in paper mode (A4/A5/Letter + Print Layout toggle)
- ProseMirror's Gapcursor is enabled via StarterKit but uses `position: absolute` with `display: none` by default — unlikely to cause visible misplacement in normal editing
- Checked Tiptap's injected CSS — `.ProseMirror { position: relative; white-space: pre-wrap; }` — no width or indentation overrides
- No `text-indent`, negative `margin-left`, or width anomalies found on paragraph, heading, or list styles
- FrontmatterBlock renders before EditorContent but is a standard block div (`mb-2`) — doesn't affect bottom of document

**Possible causes not yet ruled out (need reproduction):**
- Browser/WebKit rendering bug specific to certain document content or scroll position
- Interaction between contenteditable, padding, and cursor placement in WKWebView (Tauri's webview)
- Specific document structure (e.g., chart/drawing atom node as last block → gapcursor at wrong offset)

**Decision:** Wait until the bug can be reproduced, then use DevTools in the Tauri webview (right-click → Inspect Element) to examine computed styles on the affected paragraph.

## Key files

- `src/styles/editor.css` — editor-specific styles, ProseMirror overrides
- `src/components/editor/Editor.tsx` — main editor component, layout structure
- `src/styles/globals.css` — global layout styles
