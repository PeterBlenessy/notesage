# Rich Link Preview Cards — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Status** | Complete |
| **PRD** | [rich-link-preview-cards](../prds/2026-03-29-rich-link-preview-cards.md) |
| **Research** | [rich-content-editor-features](../research/2026-03-29-rich-content-editor-features.md) |
| **Total** | 13 tasks: 4S, 6M, 3L |
| **Suggested order** | Backend (#1-#2) → Extension (#3) → NodeView (#4-#5) → Markdown (#6-#7) → Paste/Slash/Context (#8-#10) → PDF (#11) → Tests (#12) → Polish (#13) |

### Risks & Open Questions

- **HTML parsing crate:** PRD suggests `scraper` (\~50KB, CSS selectors) or regex. `scraper` is significantly more robust for real-world HTML (tag attributes in any order, single/double quotes, self-closing tags). Regex works for the limited set of `<meta>` tags but is fragile with edge cases. Recommend `scraper` unless crate size is a concern.
- **Markdown format interaction with callouts:** The PRD uses `> [!link](url)` syntax, extending the callout `> [!type]` pattern. The callout preprocessor (from callout blocks feature) needs to NOT match `[!link]` — it must be excluded from callout types. If callouts ship first, add `link` to an exclusion list. If link previews ship first, the preprocessor needs to be aware of this reserved type from the start.
- **Favicon loading:** Favicons are loaded via `<img>` from external URLs. Some sites block cross-origin favicon loading. The `/favicon.ico` fallback may also fail. Consider using a public favicon service (e.g., `https://www.google.com/s2/favicons?domain=example.com`) as a secondary fallback.
- **Paste detection scope:** The PRD says "paste on empty line." Need to carefully define "empty line" in ProseMirror terms — an empty paragraph node where the paste replaces the entire content. Must not trigger on paste into text, code blocks, or other non-paragraph contexts.

---

### #1 — Add `fetch_link_metadata` Tauri command ✅

**Description:** Create a new Rust command that fetches a URL, parses `<head>` for OpenGraph and standard meta tags, and returns structured metadata. Add the `scraper` crate for HTML parsing (or use regex if preferred).

Parsing priority:

- Title: `og:title` → `<title>` → empty
- Description: `og:description` → `<meta name="description">` → empty
- Image: `og:image` → empty
- Site name: `og:site_name` → domain from URL
- Favicon: `<link rel="icon">` → `<link rel="shortcut icon">` → `{origin}/favicon.ico`

Timeout: 5 seconds. User-agent header to avoid bot blocks. Follow redirects (max 3). Only parse HTML responses (skip binary/non-HTML content types).

Register the command in `lib.rs` `generate_handler![]`.

**Complexity:** L **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/Cargo.toml` — add `scraper` dependency
- `src-tauri/src/commands/link_preview.rs` — new file
- `src-tauri/src/commands/mod.rs` — add module
- `src-tauri/src/lib.rs` — register command in handler

---

### #2 — Add `fetchLinkMetadata` frontend API binding ✅

**Description:** Add the `fetchLinkMetadata` function to `src/lib/tauri.ts` that invokes the `fetch_link_metadata` Tauri command. Define the `LinkMetadata` TypeScript interface.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/lib/tauri.ts` — add `fetchLinkMetadata` method and `LinkMetadata` type

---

### #3 — Create LinkPreview Tiptap node extension (schema only) ✅

**Description:** Create the `LinkPreview` atom node extension with attrs: `url`, `title`, `description`, `siteName`, `imageUrl`, `faviconUrl`. Implement `parseHTML` to match `<div data-link-preview="...">`, `renderHTML` to output a placeholder. Add `insertLinkPreview(url)` command.

Register in `useEditor.ts` and export from `extensions/index.ts`.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/components/editor/extensions/link-preview.ts` — new file
- `src/components/editor/extensions/index.ts` — export `LinkPreview`
- `src/hooks/useEditor.ts` — register in extensions array

---

### #4 — Implement LinkPreview NodeView — card component ✅

**Description:** Create the `ReactNodeViewRenderer` for the LinkPreview node. Renders three states:

**Loading state:** URL text + skeleton placeholders (title, description, image) with `animate-pulse`.

**Loaded state:** Card with favicon + site name, title (semibold), description (muted, max 2 lines, ellipsis), URL (muted, truncated), and optional image (right-aligned, 120×80px, rounded, `object-cover`). Click opens URL in system browser via `shell.open`.

**Error state:** Minimal card with link icon + URL + "Preview unavailable" muted text.

Design: subtle border, `rounded-lg`, hover background shift, consistent with the neutral palette.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- `src/components/editor/LinkPreviewCard.tsx` — new React component
- `src/components/editor/extensions/link-preview.ts` — add `addNodeView()` with `ReactNodeViewRenderer`
- `src/styles/editor.css` — add link preview card styles

---

### #5 — Implement metadata fetch and population on insert ✅

**Description:** Wire up the metadata fetching. When a `LinkPreview` node is inserted (via any creation path):

1. Node renders in loading state
2. Call `tauriApi.fetchLinkMetadata(url)`
3. On success: update node attrs with metadata via a ProseMirror transaction
4. On failure: update node to error state (set title to null, keep URL)

Handle the attr update through a command or direct transaction dispatch. Metadata is stored in node attrs — once populated, the card works offline.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #2, #4 **Files:**

- `src/components/editor/LinkPreviewCard.tsx` — add fetch logic on mount
- `src/components/editor/extensions/link-preview.ts` — add `updateLinkPreview` command

---

### #6 — Add link preview markdown parsing ✅

**Description:** Parse the `> [!link](url)` blockquote format into a `LinkPreview` node. The format is:

```markdown
<div data-link-preview="https://example.com" data-title="Title" data-description="Description text" data-site-name="site.com"></div>
```

Add a markdown preprocessor (or extend the callout preprocessor) that detects blockquotes starting with `[!link](url)` and converts them to `<div data-link-preview>` HTML elements. Extract title (bold line), description (plain line), and site name (last line) from the subsequent blockquote lines.

Must NOT conflict with callout types. Regular blockquotes and callouts must be unaffected.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- `src/lib/markdown.ts` — add link preview preprocessor
- `src/components/editor/extensions/link-preview.ts` — add `parseHTML` rules

---

### #7 — Add link preview markdown serialization ✅

**Description:** Serialize the `LinkPreview` node to:

```markdown
<div data-link-preview="url" data-title="Title" data-description="Description" data-site-name="sitename.com"></div>
```

Use the `addStorage() → markdown.serialize` pattern. If title/description are null, omit those lines. Always include the URL line.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- `src/components/editor/extensions/link-preview.ts` — add `addStorage()` with `markdown.serialize`

---

### #8 — Add paste-to-preview detection ✅

**Description:** Detect when a URL is pasted on an empty paragraph and show an inline prompt. Implement as a ProseMirror plugin or Tiptap extension that:

1. Intercepts paste events
2. Checks if pasted content is a single URL (regex: starts with `http://` or `https://`)
3. Checks if the target is an empty paragraph
4. Shows a small floating prompt below: "Create link preview?" with Accept (✓) / Dismiss (✕) buttons
5. Accept: replace paragraph with `LinkPreview` node, fetch metadata
6. Dismiss: keep pasted text as-is
7. Auto-dismiss after 5 seconds

The prompt should be a ProseMirror widget decoration or a React portal positioned relative to the paragraph.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #3, #5 **Files:**

- `src/components/editor/extensions/link-preview.ts` — add paste handler plugin
- `src/components/editor/LinkPreviewPrompt.tsx` — new component for the inline prompt

---

### #9 — Add `/embed` slash command ✅

**Description:** Add an `/embed` slash command that prompts for a URL input, then inserts a `LinkPreview` node and fetches metadata. Use the `link` Lucide icon.

The command should insert a temporary input field (or use a simple prompt) where the user types/pastes a URL and presses Enter.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #3, #5 **Files:**

- `src/components/editor/extensions/slash-command.tsx` — add embed command

---

### #10 — Add "Convert to preview card" context menu ✅

**Description:** Add a "Convert to preview card" option to the link right-click context menu. When clicked:

1. Read the link's `href`
2. Delete the inline link
3. Insert a `LinkPreview` block node at the same position
4. Fetch metadata

Check how existing context menus work in the editor (likely via Tiptap's `BubbleMenu` or a custom context menu extension).

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #3, #5 **Files:**

- `src/components/editor/extensions/link-click.ts` — add context menu option (or new file if context menu is separate)

---

### #11 — Add link preview rendering in Typst/PDF export ✅

**Description:** Extend the Typst converter to handle `> [!link](url)` blocks. Detect the pattern in the comrak AST (blockquote whose first text matches `[!link](url)`) and render as a styled Typst block:

- Bordered box with subtle background
- Site name text at top
- Title in semibold
- Description in muted text
- URL at the bottom
- No image (text-only in PDF)

**Complexity:** M **Category:** backend **Dependencies:** None (parallelizable) **Files:**

- `src-tauri/src/export/markdown_to_typst.rs` — detect `[!link]` blockquotes, render styled block

---

### #12 — Add unit and round-trip tests ✅

**Description:** Write tests covering:

**Rust tests:**

- HTML meta tag parsing: full metadata, partial metadata, missing tags, non-HTML content, timeout
- Real-world HTML samples (GitHub page, blog post, minimal page)

**Frontend tests:**

- Markdown parsing: `> [!link](url)` → LinkPreview node, with/without metadata lines
- Markdown serialization: LinkPreview node → blockquote format, partial metadata
- Round-trip fixture: `tests/fixtures/link-previews.md`
- URL detection regex: valid URLs, non-URLs, edge cases
- Card component: loading/loaded/error states render correctly

**Complexity:** S **Category:** both **Dependencies:** Depends on #1, #6, #7 **Files:**

- `tests/fixtures/link-previews.md` — new round-trip fixture
- `src-tauri/src/commands/link_preview.rs` — add `#[cfg(test)]` module
- `src/components/editor/extensions/__tests__/link-preview.test.ts` — new test file

---

### #13 — Polish and visual QA ✅

**Description:** Final polish:

- Card appearance in light and dark mode (and soft contrast)
- Skeleton animation smoothness
- Hover transitions
- Image rendering with various aspect ratios
- Cards with no image (text-only layout)
- Cards with very long titles/descriptions (truncation)
- Error state styling
- Paste prompt positioning and auto-dismiss timing
- Delete card → converts to plain URL text (not full deletion)
- Verify no console errors from external image loading

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #1-#12 **Files:**

- `src/styles/editor.css` — tune card styles
- `src/components/editor/LinkPreviewCard.tsx` — visual refinements