# PRD: Rich Link Preview Cards

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Status** | Complete |
| **Priority** | Medium |
| **Impact** | URLs transform into visual, informative preview cards showing title, description, favicon, and preview image |
| **Research** | [rich-content-editor-features](../research/2026-03-29-rich-content-editor-features.md) |
| **Tasks** | [rich-link-preview-cards-tasks](../tasks/2026-03-29-rich-link-preview-cards-tasks.md) |

## Problem

URLs in Notesage documents are plain clickable text. When writing research notes, reading lists, or reports with references, a raw URL like `https://nivo.rocks/bar/` tells the reader nothing about the destination. Users must click the link to find out what it contains.

Notion, Craft, and Slack all convert URLs into rich preview cards showing the page's title, description, favicon, and preview image — pulled from OpenGraph metadata. This turns a cryptic URL into a visual, informative element that makes documents more readable and professional.

## Goals

1. **Link preview cards** — URLs rendered as styled cards with title, description, site name, favicon, and optional preview image
2. **Simple creation** — paste a URL on its own line or use `/embed` slash command; no manual metadata entry
3. **Cached metadata** — fetched once, stored in the document; works offline after first load
4. **PDF export** — cards render as styled blocks in exported PDFs (text only, no images)
5. **Graceful degradation** — if metadata fetch fails, the URL remains as a normal link

## Non-Goals

- Embedded iframes (YouTube players, tweets, Figma embeds) — significantly more complex, different security model
- Auto-unfurling every link in the document — only explicit conversions (paste on empty line or slash command)
- Real-time metadata refresh — metadata is fetched once and cached in the node
- Custom card styling or templates
- Preview cards in the chat panel

## User Stories

- As a researcher, I want to paste a URL and see it rendered as a card with the page's title and description so my notes are readable without clicking every link
- As a report author, I want reference links to display as polished cards so my document looks professional
- As a user working offline, I want previously fetched link previews to still display correctly

## Technical Approach

### New Tauri Command: `fetch_link_metadata`

A Rust backend command that fetches a URL, parses the HTML `<head>` for OpenGraph and standard meta tags, and returns structured metadata.

```rust
#[tauri::command]
pub async fn fetch_link_metadata(url: String) -> Result<LinkMetadata, String>
```

**Parsing priority:**

1. `og:title` → `<title>` fallback
2. `og:description` → `<meta name="description">` fallback
3. `og:image` → first `<meta property="og:image">`
4. `og:site_name` → domain extracted from URL
5. Favicon: `<link rel="icon">` → `<link rel="shortcut icon">` → `/favicon.ico` fallback

**Implementation:** Use `reqwest` (already a dependency) to fetch the HTML. Parse with a lightweight approach — regex or a small HTML parser like `select.rs` or `scraper`. No full browser rendering needed.

**Timeout:** 5 seconds. On failure, return an error and the frontend falls back to a plain link.

**Image handling:** The `og:image` URL is stored in the node attributes. The frontend renders it via `<img src>` directly (no local caching of images for v1). For PDF export, the image is omitted (text-only card).

### Tiptap Node Extension

A new `LinkPreview` block node:

```typescript
{
  group: 'block',
  atom: true,
  attrs: {
    url: { default: '' },
    title: { default: null },
    description: { default: null },
    siteName: { default: null },
    imageUrl: { default: null },
    faviconUrl: { default: null },
  },
}
```

The node stores all metadata as attributes — once fetched, it's self-contained and works offline.

### Creation Flow

**Paste detection:**

1. User pastes a URL on an empty line (or the line contains only the URL)
2. A small inline prompt appears below: "Create link preview?" with Accept/Dismiss
3. On accept: insert `LinkPreview` node, call `fetch_link_metadata`, populate attributes
4. On dismiss: keep as plain text link

**Slash command:**

1. `/embed` → text input for URL
2. On enter: insert `LinkPreview` node, fetch metadata, populate

**Converting existing links:**

- Right-click a link → "Convert to preview card" in context menu
- The inline link is replaced with a `LinkPreview` block node

### Loading State

While metadata is being fetched, the card shows a skeleton loading state:

- URL displayed as text
- Pulsing skeleton placeholders for title, description, and image
- Transitions smoothly to the full card when data arrives

### Error Handling

If the fetch fails (timeout, network error, non-HTML response):

- Show a minimal card with just the URL and domain name
- Subtle error indicator (muted text: "Preview unavailable")
- The URL remains clickable
- No retry — user can delete and re-insert to retry

### Markdown Serialization

Serialize as a fenced block with metadata in a compact format:

```markdown
<div data-link-preview="https://nivo.rocks/bar/" data-title="Nivo — Bar Chart" data-description="Beautiful bar charts built on D3 and React with SVG output" data-site-name="nivo.rocks"></div>
```

This reuses the blockquote syntax with a `[!link]` type marker (extending the callout pattern). Other renderers show it as a styled blockquote, which is an acceptable fallback.

**Parse:** Detect blockquotes starting with `[!link](url)` and create a `LinkPreview` node. The subsequent lines populate title, description, and site name.

**Serialize:** Output the blockquote format with metadata from node attributes.

### PDF Export

Cards render in Typst as a styled block:

- Bordered box with subtle background
- Site name + favicon placeholder (text only)
- Title in semibold
- Description in muted text
- URL at the bottom
- No image in PDF (images require download at export time — deferred)

## UI/UX

### Card Design

```
┌─────────────────────────────────────────────────┐
│  [🌐] nivo.rocks                                │
│                                                 │
│  Nivo — Bar Chart                     ┌───────┐ │
│  Beautiful bar charts built on        │       │ │
│  D3 and React with SVG output         │ image │ │
│                                       │       │ │
│  nivo.rocks/bar/                      └───────┘ │
└─────────────────────────────────────────────────┘
```

- Subtle border (`border-border`), rounded corners (`rounded-lg`)
- Favicon (16px) + site name in muted text at the top
- Title: `text-sm font-semibold`, foreground color
- Description: `text-xs text-muted-foreground`, max 2 lines, truncated with ellipsis
- URL: `text-xs text-muted-foreground`, truncated
- Preview image: right-aligned, 120px × 80px, rounded corners, `object-cover`
- If no image: card is text-only, slightly narrower
- Hover: subtle background shift, cursor pointer
- Click: opens URL in system browser (via existing `shell.open`)
- Max width: follows editor content width (no wider than text)

### Loading State

```
┌─────────────────────────────────────────────────┐
│  https://nivo.rocks/bar/                        │
│  ████████████████████████████          ┌───────┐ │
│  ████████████████████                  │ ░░░░░ │ │
│  ██████████████                        └───────┘ │
└─────────────────────────────────────────────────┘
```

Skeleton animation using Tailwind's `animate-pulse` on `bg-muted` rectangles.

### Error State

```
┌─────────────────────────────────────────────────┐
│  🔗 https://nivo.rocks/bar/                     │
│  Preview unavailable                            │
│  nivo.rocks                                     │
└─────────────────────────────────────────────────┘
```

Minimal card with the URL still clickable. Muted styling.

### Paste Prompt

When a URL is pasted on an empty line, a subtle inline prompt appears:

```
https://nivo.rocks/bar/
  ┌──────────────────────────────────┐
  │  Create link preview?  ✓  ✕     │
  └──────────────────────────────────┘
```

Small floating element below the URL. Accept (✓) converts to card; dismiss (✕) keeps plain text. Auto-dismisses after 5 seconds.

### Deleting a Card

Select the card → Backspace/Delete. Converts back to a plain text URL (not full deletion — preserves the link).

## Data Model

### Rust Struct

```rust
#[derive(Serialize, Deserialize)]
pub struct LinkMetadata {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    pub image_url: Option<String>,
    pub favicon_url: Option<String>,
}
```

### Tiptap Extension

```typescript
// src/components/editor/extensions/link-preview.ts
interface LinkPreviewAttrs {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
}
```

### New Tauri Command

```rust
// src-tauri/src/commands/file.rs (or new link.rs)
#[tauri::command]
pub async fn fetch_link_metadata(url: String) -> Result<LinkMetadata, String>
```

### Frontend API

```typescript
// src/lib/tauri.ts
async fetchLinkMetadata(url: string): Promise<LinkMetadata>
```

## Dependencies

| Dependency | Purpose | Notes |
| --- | --- | --- |
| `scraper` (Rust) | HTML parsing for meta tag extraction | \~50KB, MIT, CSS selector API. Alternative: regex-based parsing (no new dep but more fragile) |

`reqwest` is already a dependency. `scraper` is the only potential new crate — it provides CSS selector-based HTML parsing which is significantly more robust than regex for extracting `<meta>` tags. If bundle size is a concern, regex parsing is feasible for the limited set of tags we need.

## Quality Gates

### Functional

- [x] Pasting a URL on an empty line shows "Create link preview?" prompt

- [x] Accepting the prompt fetches metadata and renders a card

- [x] `/embed` slash command accepts a URL and creates a preview card

- [x] Card displays title, description, site name, favicon, and image when available

- [x] Card displays gracefully with partial metadata (no title, no image, etc.)

- [x] Click on card opens URL in system browser

- [x] Loading state shows skeleton while metadata is being fetched

- [x] Error state shows minimal card when fetch fails

- [x] Delete card converts back to plain text URL

- [x] Right-click link → "Convert to preview card" works

### Markdown Round-Trip

- [x] Link preview serializes to `> [!link](url)` blockquote format

- [x] Parsing the format creates a `LinkPreview` node with metadata

- [x] Regular blockquotes and callouts are not affected

- [x] Round-trip test passes for cards with full metadata and partial metadata

### PDF Export

- [x] Cards render as styled text blocks in PDF (no image)

- [x] Title, description, and URL are present

- [x] Cards without metadata render as plain URL

### Design

- [x] Cards look polished in both light and dark mode

- [x] Skeleton loading animation is smooth

- [x] Card styling matches Notesage's neutral aesthetic

- [x] Hover state is subtle and consistent

- [x] Image renders with rounded corners and proper aspect ratio

### Testing

- [x] Rust unit tests for HTML meta tag parsing (various real-world HTML samples)

- [x] Unit tests for markdown parse/serialize of link preview nodes

- [x] Unit tests for URL detection on paste

- [x] All existing markdown round-trip tests continue to pass

## Out of Scope

- **Embedded iframes** (YouTube, Figma, tweets) — different security model, requires sandboxing; separate feature
- **Auto-unfurling all links** — only explicit conversion (paste prompt or slash command); auto-unfurling is annoying and slow
- **Image caching to disk** — v1 loads images directly from URL; local caching is an optimization for later
- **Metadata refresh** — fetched once and stored; no periodic re-fetch
- **Custom card appearance** — single card design for all URLs
- **Link preview in chat** — editor feature only
- **Social media embeds** — Twitter/X cards, Instagram posts require platform-specific APIs