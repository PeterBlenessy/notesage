---
title: Mixed-content fixture for preview-fidelity E2E
id: 11111111-2222-3333-4444-555555555555
tags: [fixture, preview]
---

# Heading 1 — Mixed content fixture

This fixture exercises the comrak HTML preview pipeline (PRD § "Layer 1") with
the same node mix the live Tiptap editor produces, so screenshot-diff and
behaviour assertions in `e2e/preview-fidelity.spec.ts` cover the realistic
visual surface.

## Lists, code, blockquotes

- Bullet item one with **bold** and *italic*
- Item two with `inline code`
- Item three with [an internal link](./other.md) and [an external link](https://example.com)
  - Nested item
  - Another nested item

1. Numbered item one
2. Numbered item two

> Blockquote with a `code span` inside it.

```rust
// Code block — comrak hands this to syntect, which emits inline-styled spans.
// The live editor renders via lowlight for the same visual approximation.
fn main() {
    let value = 42;
    println!("{}", value);
}
```

## Tables

| Item       | Quantity | Price (USD) |
| ---------- | -------: | ----------: |
| Coffee     |        2 |       3.50  |
| Tea        |        1 |       2.75  |
| Pastry     |        3 |       4.25  |

## Plain-text divergences (intentional)

These render as plain text in the preview but as styled badges in the editor.
The diff test masks them — see `e2e/preview-fidelity.spec.ts` allowlist.

- Tag: #productivity
- Mention: @peter
- Date: //2026-05-05

## Closing paragraph

Final paragraph so the document has a non-trivial vertical extent for the
scroll-height parity check.
