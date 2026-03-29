# PRD: Callout Blocks

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Status** | Complete |
| **Priority** | High |
| **Impact** | Every document can use structured, visually distinct callouts for notes, tips, warnings, and important information |
| **Research** | [rich-content-editor-features](../research/2026-03-29-rich-content-editor-features.md) |
| **Tasks** | [callout-blocks-tasks](../tasks/2026-03-29-callout-blocks-tasks.md) |

## Problem

Notesage documents lack visual hierarchy beyond headings, bold, and blockquotes. When writing reports, tutorials, or documentation, users need a way to draw attention to specific information — a tip, a warning, an important note — without resorting to bold text or custom formatting that doesn't survive markdown round-tripping.

Obsidian's `> [!type]` callout syntax has become a de facto standard adopted by many tools. Supporting it in Notesage enables interoperability and gives users a familiar, powerful formatting tool.

## Goals

1. **Four callout types** (Note, Tip, Warning, Important) rendered as styled blocks with icons and semantic accent colors
2. **Obsidian-compatible syntax** (`> [!type] Title`) for markdown round-tripping and cross-tool interoperability
3. **Simple creation UX** — slash command `/callout` and toolbar button, no syntax knowledge required
4. **Beautiful rendering** in both the editor and PDF export
5. **Rich content inside** — callouts support all inline formatting (bold, italic, code, links, etc.)

## Non-Goals

- Custom callout types or user-defined colors — four built-in types cover the vast majority of use cases
- Collapsible/foldable callouts — adds complexity for minimal benefit in a note editor
- Nested callouts (callout inside callout) — edge case, not worth the parser complexity
- Callout blocks in the chat panel — editor feature only

## User Stories

- As a report author, I want to insert a warning callout so that critical information stands out visually from the surrounding text
- As a user editing an Obsidian-exported markdown file, I want `> [!tip]` blocks to render as styled callouts so my notes look correct without manual conversion
- As a user, I want to create a callout from the slash command menu or toolbar without knowing the markdown syntax

## Technical Approach

### Callout as a Custom Tiptap Node

A new `Callout` node extension wrapping a blockquote-like container with a `type` attribute.

**ProseMirror schema:**

```typescript
{
  group: 'block',
  content: 'block+',        // supports paragraphs, lists, code blocks inside
  attrs: {
    type: { default: 'note' },  // 'note' | 'tip' | 'warning' | 'important'
    title: { default: null },   // optional custom title (null = use type name)
  },
  defining: true,
}
```

The node renders as a `<div>` with CSS classes for styling: `callout callout-note`, `callout callout-tip`, etc.

### Markdown Round-Tripping

**Parse:** Detect blockquotes whose first line matches `[!type]` or `[!type] Custom Title`:

```markdown
<div class="callout callout-tip" data-callout-type="tip" data-title="Pro Tip">
<p>This is a helpful suggestion.
It can span multiple lines.</p>
</div>
```

The markdown parser (`prosemirror-markdown` / custom parse rules) converts this into a `Callout` node instead of a regular `blockquote`.

**Serialize:** The serializer outputs the Obsidian-compatible syntax. The first line contains `[!type]` (plus optional title), subsequent lines are the callout body prefixed with `> `.

**Edge case:** A regular blockquote that happens to start with `[!` but isn't a valid callout type should remain a plain blockquote.

### Callout Types

| Type | Lucide Icon | Light Accent | Dark Accent | CSS Variable |
| --- | --- | --- | --- | --- |
| `note` | `info` | `oklch(70% 0.02 240)` | `oklch(65% 0.02 240)` | `--color-callout-note` |
| `tip` | `lightbulb` | `oklch(70% 0.05 145)` | `oklch(65% 0.05 145)` | `--color-callout-tip` |
| `warning` | `triangle-alert` | `oklch(70% 0.05 75)` | `oklch(65% 0.05 75)` | `--color-callout-warning` |
| `important` | `circle-alert` | `oklch(65% 0.06 25)` | `oklch(60% 0.06 25)` | `--color-callout-important` |

Colors use very low chroma — tinted neutrals, not saturated colors. This fits the design system's near-neutral palette while still conveying semantic meaning (same exception as diff colors and highlights).

### Slash Command & Toolbar Integration

**Slash command:** `/callout` opens a submenu with the four types, each showing its icon and name. Selecting one inserts an empty callout block.

**Toolbar:** Add a callout button (using the `info` icon) to the top toolbar, after the blockquote button. Clicking it shows a small dropdown with the four types. If the cursor is inside a callout, the button shows the current type and allows changing it.

**Keyboard shortcut:** None — callouts are not frequent enough to warrant one.

### PDF Export

The Typst markdown-to-typst converter (`markdown_to_typst.rs`) needs a callout handler. Callouts render as a styled box with:

- Colored left border (3-4px, matching the callout type color)
- Light tinted background
- Icon + type label in bold on the first line
- Body text below

## UI/UX

### Editor Rendering

```
┌ ▌ ℹ  Note ─────────────────────────────────────┐
│ ▌ This is a note callout. The left border uses  │
│ ▌ the type's accent color. The background is a  │
│ ▌ very subtle tint of the same hue.             │
└─────────────────────────────────────────────────┘
```

- 3px left border in the type's accent color
- Very subtle background tint (5-8% opacity of the accent color)
- Icon + type label on the first line (or custom title if provided)
- Icon and label in the accent color, label in small caps or semibold
- Body text in normal foreground color
- Standard paragraph spacing inside
- Rounded corners (matching the app's border-radius)
- Smooth transition on hover (subtle border intensity change)

### Type Switching

Click the icon/label area of an existing callout → dropdown to switch type. The callout re-renders with the new icon, color, and label instantly.

### Creating a Callout

1. Type `/callout` → pick type from submenu
2. Or click the toolbar callout button → pick type
3. An empty callout block appears with cursor inside
4. Type content — all inline formatting works (bold, italic, code, links)

### Deleting a Callout

Backspace at the start of an empty callout removes the callout wrapper, converting it to a regular paragraph (same pattern as blockquotes).

## Data Model

### New Tiptap Extension

```typescript
// src/components/editor/extensions/callout.ts
export type CalloutType = 'note' | 'tip' | 'warning' | 'important';

// Tiptap Node extension with:
// - attrs: { type: CalloutType, title: string | null }
// - parseHTML: matches <div class="callout callout-{type}">
// - renderHTML: outputs <div class="callout callout-{type}"> with icon + label
```

### CSS Variables (globals.css)

```css
--color-callout-note: oklch(70% 0.02 240);
--color-callout-note-bg: oklch(70% 0.02 240 / 0.06);
--color-callout-tip: oklch(70% 0.05 145);
--color-callout-tip-bg: oklch(70% 0.05 145 / 0.06);
--color-callout-warning: oklch(70% 0.05 75);
--color-callout-warning-bg: oklch(70% 0.05 75 / 0.06);
--color-callout-important: oklch(65% 0.06 25);
--color-callout-important-bg: oklch(65% 0.06 25 / 0.06);
```

### Markdown Parser Changes

Extend `prosemirror-markdown` parse rules or add a custom input rule:

- Detect `> [!type]` at blockquote start
- Valid types: `note`, `tip`, `warning`, `important` (case-insensitive)
- Extract optional title from the remainder of the first line
- Convert to `Callout` node instead of `blockquote`

### Markdown Serializer Changes

Add a serializer for the `callout` node type:

- First line: `> [!{type}]` or `> [!{type}] {title}` if custom title exists
- Subsequent lines: `> {content}` (each paragraph/block prefixed with `> `)

### Typst Export Changes

Add callout rendering to `markdown_to_typst.rs`:

- Detect callout blocks in the markdown AST (or handle them as a custom node type)
- Output a Typst `#block()` with colored left border and background

## Dependencies

- No new libraries required
- Uses existing Lucide icons (`info`, `lightbulb`, `triangle-alert`, `circle-alert`)
- Extends existing Tiptap/ProseMirror infrastructure
- Extends existing `prosemirror-markdown` parse/serialize pipeline

## Quality Gates

### Functional

- [x] Four callout types render with correct icon, color, and label

- [x] `/callout` slash command inserts callout with type selection

- [x] Toolbar button inserts callout with type selection

- [x] Rich content inside callouts (bold, italic, code, links, lists)

- [x] Type switching via click on icon/label area

- [x] Backspace at start of empty callout converts to paragraph

- [x] Cursor navigation into/out of callout blocks works naturally

### Markdown Round-Trip

- [x] `> [!tip]` parses to a Tip callout node

- [x] `> [!warning] Custom Title` parses with the custom title preserved

- [x] Serializing a callout produces valid `> [!type]` syntax

- [x] Round-trip test: parse → serialize → compare passes for all four types

- [x] Regular blockquotes starting with `[!` but invalid type remain as blockquotes

- [x] Multi-paragraph callouts round-trip correctly

### PDF Export

- [x] Callouts render in PDF with colored left border and tinted background

- [x] All four types have distinct visual treatment in PDF

- [x] Icon/label rendered in the callout header

### Design

- [x] Callouts look polished in both light and dark mode

- [x] Colors are tinted neutrals, not saturated — fits the Notesage aesthetic

- [x] Smooth transitions on hover and type switch

- [x] Consistent spacing and border-radius with the rest of the editor

### Testing

- [x] Unit tests for callout markdown parsing (all types, with/without title)

- [x] Unit tests for callout markdown serialization

- [x] Round-trip test fixtures added to `tests/fixtures/`

- [x] All existing markdown round-trip tests continue to pass

## Out of Scope

- **Custom callout types** — four types cover the vast majority of use cases; custom types add UI complexity for minimal benefit
- **Collapsible callouts** — Obsidian supports `> [!tip]-` for collapsed, but this adds interaction complexity
- **Nested callouts** — callout inside callout is an edge case; the parser and renderer complexity isn't justified
- **Callout keyboard shortcut** — not frequent enough to warrant dedicated shortcut space
- **Callout in chat messages** — editor feature only; chat uses its own markdown renderer