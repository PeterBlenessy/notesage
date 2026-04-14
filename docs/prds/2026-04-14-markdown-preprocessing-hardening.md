# PRD: Markdown Preprocessing Pipeline Hardening

**Date:** 2026-04-14
**Status:** Draft
**Priority:** High — data integrity risk

## Problem

The markdown preprocessing pipeline in `src/lib/markdown.ts` uses 13+ regex-based string transformations on raw markdown text before it reaches the parser. These regexes:

1. **Are not context-aware** — they match inside code blocks, frontmatter, and other contexts where they shouldn't
2. **Corrupt files on save** — because the save path regenerates markdown from ProseMirror's document model, any parsing mistake is persisted immediately
3. **Compound over cycles** — a misparse on open → escaped output on save → worse misparse on next open (the `!\[\]` escaping spiral)
4. **Have caused production bugs** — ghost task items (#3128), empty checklist loops, data URI bracket escaping

The root cause: we're patching around markdown-it's parsing limitations with text-level regexes instead of extending the parser properly.

## Current Pipeline Inventory

### Input Path (raw markdown → editor)

| # | Function | Lines | Pattern Type | Context-Aware? | Risk | Plugin Candidate? |
|---|----------|-------|-------------|----------------|------|-------------------|
| 1 | `normalizeEmptyTaskItems` | 163-170 | Regex | No | Medium | Yes (markdown-it rule) |
| 2 | `stripGhostTaskItems` | 194-251 | Line-by-line + regex | Partial | **High** | No (ProseMirror-aware) |
| 3 | `convertMermaidToHtml` | 475-491 | Regex (fenced block) | No | Medium | **Yes** (fence rule) |
| 4 | `convertCalloutsToHtml` | 270-319 | Line-by-line | Partial | Medium | **Yes** (blockquote rule) |
| 5 | `convertPageBreaksToHtml` | 837-842 | Regex (HTML comment) | No | Low | Keep (specific pattern) |
| 6 | `convertTocToHtml` | 808-813 | Regex (HTML comment) | No | Low | Keep (specific pattern) |
| 7 | `convertLinkPreviewsToHtml` | 350-419 | Line-by-line | Partial | Medium | **Yes** (blockquote rule) |
| 8 | `convertDrawingsToHtml` | 434-444 | Regex (image) | No | Medium | **Yes** (image rule) |
| 9 | `convertChartsToHtml` | 455-464 | Regex (image) | No | Medium | **Yes** (image rule) |
| 10 | `convertInlineDrawingsToHtml` | 529-541 | Regex (fenced block) | No | Medium | **Yes** (fence rule) |
| 11 | `convertInlineChartsToHtml` | 506-518 | Regex (fenced block) | No | Medium | **Yes** (fence rule) |
| 12 | `encodeImagePathSpaces` | 574-592 | Regex (image) | Partial | Medium | **Yes** (image rule) |
| 13 | `convertDataUriImagesToHtml` | 557-566 | Regex (image) | Partial | Medium | **Yes** (image rule) |

### Output Path (editor → markdown)

| # | Function | Lines | Notes |
|---|----------|-------|-------|
| 14 | `decodeImagePathSpaces` | 597-606 | Inverse of #12 |
| 15 | `stripGhostTaskItems` | 194-251 | Also runs on output |
| 16 | `restorePageBreaks` | 848-853 | Inverse of #5 |
| 17 | `restoreTocComments` | 819-824 | Inverse of #6 |
| 18 | `injectAnnotationsIntoMarkdown` | 105-145 | Annotation serialization |

### Known Fragility

- **Fenced block regexes (#3, #10, #11):** `` ```chart `` inside a `` ```markdown `` block will be incorrectly matched
- **Image regexes (#8, #9, #12, #13):** Match inside code blocks and inline code
- **Ghost task stripping (#2):** Surgical fix for ProseMirror bug; high risk of collateral damage
- **Callout/link preview (#4, #7):** Line-by-line parsers don't check for code block context

## Solution: markdown-it Plugin Migration

Replace regex preprocessing with markdown-it plugins where possible. Plugins operate on the token stream, are context-aware (skip code blocks), and compose cleanly.

### Phase 1 — Fenced Code Block Handlers (Low Risk)

Migrate fenced block handlers to a single markdown-it fence plugin:

- [ ] `convertMermaidToHtml` → markdown-it fence rule for `mermaid`
- [ ] `convertInlineChartsToHtml` → markdown-it fence rule for `chart`
- [ ] `convertInlineDrawingsToHtml` → markdown-it fence rule for `excalidraw`

**Approach:** Register a custom `fence` renderer that checks `token.info` (the language tag). If it matches `mermaid`, `chart`, or `excalidraw`, emit the appropriate `<div>` HTML. Otherwise, fall through to the default renderer. This is the standard markdown-it way to handle custom fenced blocks.

**Test coverage needed:**
- Fixture: fenced blocks inside other fenced blocks (nested)
- Fixture: fenced blocks inside indented code blocks
- Fixture: fenced blocks with extra whitespace in language tag
- All existing fixtures must still round-trip

### Phase 2 — Image Handlers (Medium Risk)

Consolidate image preprocessing into a single markdown-it inline rule:

- [ ] `convertDrawingsToHtml` → image rule for `.excalidraw` destinations
- [ ] `convertChartsToHtml` → image rule for `.notesage/charts/*.json` destinations
- [ ] `convertDataUriImagesToHtml` → image rule for `data:` destinations
- [ ] `encodeImagePathSpaces` / `decodeImagePathSpaces` → image rule with space handling

**Approach:** Override markdown-it's `image` rule to:
1. Parse the standard `![alt](dest)` syntax
2. Check the destination: `.excalidraw` → emit drawing div, `.json` chart path → emit chart div, `data:` → emit `<img>` tag, spaces → encode for asset protocol
3. Fall through to default for all other images

**Test coverage needed:**
- Fixture: images inside code blocks (must NOT be transformed)
- Fixture: images inside inline code (must NOT be transformed)
- Fixture: data URI images with various MIME types (svg+xml, png, jpeg, gif)
- Fixture: data URI images with escaped brackets (import tool artifacts)
- Fixture: images with spaces in paths
- Fixture: mixed image types in same document
- All existing image/drawing/chart fixtures must still round-trip

### Phase 3 — Blockquote Handlers (Medium Risk)

Migrate callout and link preview parsing to markdown-it blockquote rules:

- [ ] `convertCalloutsToHtml` → markdown-it blockquote rule for `[!type]`
- [ ] `convertLinkPreviewsToHtml` → markdown-it blockquote rule for `[!link]`

**Approach:** Register a `core` rule that walks the token stream after parsing, finds `blockquote_open` tokens whose first content matches `[!type]` or `[!link]`, and replaces them with appropriate HTML tokens.

**Test coverage needed:**
- Fixture: callout inside code block (must NOT be transformed)
- Fixture: nested blockquotes with callout
- Fixture: callout immediately after another callout
- Fixture: link preview with all metadata fields
- All existing callout and link preview fixtures must still round-trip

### Phase 4 — Task Item Cleanup (High Risk, Careful)

- [ ] `normalizeEmptyTaskItems` → markdown-it rule for task normalization
- [ ] Evaluate `stripGhostTaskItems` — this is a ProseMirror output bug, not a parsing issue. Consider fixing the root cause in the Tiptap extension instead of post-hoc cleanup.

**Test coverage needed:**
- Fixture: empty task items
- Fixture: task items inside code blocks (must NOT be normalized)
- Fixture: mixed task and bullet lists
- Ghost task item regression tests

### Keep As-Is (Low Risk, Specific Patterns)

These are safe to keep as regex:
- `convertPageBreaksToHtml` / `restorePageBreaks` — exact HTML comment match
- `convertTocToHtml` / `restoreTocComments` — exact HTML comment match
- `stripAnnotationsFromMarkdown` / `injectAnnotationsIntoMarkdown` — ProseMirror-aware serialization

## Implementation Strategy

### Plugin Architecture

Create `src/lib/markdown-plugins/` with one file per plugin:

```
src/lib/markdown-plugins/
  fence-blocks.ts      — Phase 1: mermaid, chart, excalidraw fenced blocks
  image-handlers.ts    — Phase 2: drawings, charts, data URIs, path spaces
  blockquote-blocks.ts — Phase 3: callouts, link previews
  task-normalize.ts    — Phase 4: task item cleanup
  index.ts             — Plugin registration
```

### Migration Pattern (per function)

1. Write the markdown-it plugin
2. Add targeted unit tests for the plugin
3. Add edge case fixtures (code blocks, nesting, etc.)
4. Wire the plugin into the markdown-it instance (tiptap-markdown config)
5. Remove the old regex function from the preprocessing chain
6. Verify ALL existing round-trip fixtures still pass
7. Verify ALL existing unit tests still pass

### Plugin Registration

tiptap-markdown exposes a `parse.setup` hook per extension where plugins can be registered on the markdown-it instance:

```typescript
// In a custom Tiptap extension
addStorage() {
  return {
    markdown: {
      parse: {
        setup(md: MarkdownIt) {
          md.use(fenceBlocksPlugin);
          md.use(imageHandlersPlugin);
        },
      },
    },
  };
}
```

Alternatively, if tiptap-markdown's `Markdown` extension allows direct `md.use()` access, register there.

## Test Strategy

### Existing Coverage (must not regress)

- 32 round-trip fixture files in `tests/fixtures/*.md`
- 7 dedicated test files for preprocessing functions (~1,700 lines)
- 1,028-line edge case test suite

### New Coverage Required

**Phase 1 fixtures:**
- `tests/fixtures/fenced-in-fenced.md` — `` ```chart `` inside `` ```markdown `` (must not transform)
- `tests/fixtures/fenced-edge-cases.md` — whitespace, empty blocks, unclosed blocks

**Phase 2 fixtures:**
- `tests/fixtures/images-in-code-blocks.md` — image syntax inside fenced/indented code (must not transform)
- `tests/fixtures/data-uri-images-extended.md` — SVG, PNG, JPEG, GIF, escaped brackets, empty alt, inline positioning
- `tests/fixtures/image-path-spaces.md` — spaces in local paths, relative and absolute

**Phase 3 fixtures:**
- `tests/fixtures/callouts-in-code.md` — callout syntax inside code block (must not transform)
- `tests/fixtures/nested-blockquotes.md` — callouts inside nested blockquotes

**Unit tests per plugin:**
- Direct plugin tests: input token stream → expected output tokens
- Integration tests: full parse → serialize round-trip
- Negative tests: content inside code blocks must pass through unchanged

## Quality Gates

- [ ] All 32+ existing round-trip fixtures pass
- [ ] All ~2,626 existing unit tests pass
- [ ] New edge case fixtures added and passing
- [ ] TypeScript typecheck passes
- [ ] Performance benchmarks pass (`pnpm test:perf`)
- [ ] Manual test: open Apple Notes import files with data URI images — images render
- [ ] Manual test: open files with callouts, drawings, charts, mermaid — all render
- [ ] Manual test: open → save → reopen cycle — file content unchanged (no bracket escaping, no ghost items)
- [ ] Manual test: code blocks containing markdown syntax are not transformed

## Non-Goals

- Changing the ProseMirror document model or serialization
- Migrating annotation or table metadata systems (they're ProseMirror-aware, not parser-aware)
- Replacing tiptap-markdown with a different library
- Supporting non-CommonMark markdown extensions beyond what we already handle

## Rollout

Each phase can be shipped independently. Phase 1 (fenced blocks) is lowest risk and highest value — it eliminates the most common false-match vector (matching inside code blocks). Start there.
