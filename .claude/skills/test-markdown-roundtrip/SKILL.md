---
name: test-markdown-roundtrip
description: Use when modifying markdown parsing, serialization, Tiptap schema changes, or any code that affects how markdown is converted to/from the ProseMirror document model.
user-invocable: true
---

# Markdown Round-Trip Integrity

## Critical Rule

Markdown round-tripping MUST be lossless:

```
.md file → Parse → ProseMirror doc → Serialize → .md file
```

Output must equal input (whitespace-normalized). This is the #1 spec requirement — "must pass before any PR."

## The Pipeline

- Parse/serialize entry points: `src/lib/markdown.ts`
- Library: `tiptap-markdown`, extended per-node via `addStorage().markdown`
- Test: `src/lib/__tests__/markdown-roundtrip.test.ts`
- Fixtures: `tests/fixtures/*.md`
- Run: `pnpm test` (round-trip runs as part of the unit suite — there is no separate `test:roundtrip` script)

## What Round-Trip Actually Verifies

Each fixture goes through **two passes**:

1. `input → parse → serialize` ; assert output equals input (fixture is in canonical form)
2. `pass1 output → parse → serialize` ; assert equals pass1 output (serialization is idempotent)

Idempotence catches serializers that flip between equivalent forms on consecutive saves.

## Adding a Test Case

1. Write a markdown fixture at `tests/fixtures/<name>.md` exercising the syntax
2. The test auto-discovers all `*.md` files — no test-file edit needed
3. Run `pnpm test`; the fixture must pass both passes

**First pass fails:** the fixture isn't in canonical form. Either update the fixture to match the serializer's canonical output, or fix the serializer.

**Second pass fails:** serialization is non-idempotent. Fix the serializer.

See `examples/roundtrip-test.template.ts` for the canonical shape if you need a similar loop elsewhere.

## Adding a Markdown-Serializable Node

Any Tiptap node that must round-trip needs `addStorage().markdown.{serialize, parse}`.

See `examples/markdown-serializable-node.template.ts` for the canonical shape. Real references:

- `src/components/editor/extensions/page-break-node.ts` — minimal atom node, HTML-comment serialization
- `src/components/editor/extensions/callout.ts` — block node with content + attributes

## Acceptable vs Unacceptable Normalization

**Acceptable (canonical form enforcement):**
- Trailing whitespace stripped
- Blank-line count normalized (max one blank line between blocks)
- Preferred emphasis/bullet markers (`**bold**`, `-` for bullets)

**Unacceptable (content loss):**
- Any text, link, or formatting missing
- Heading level or list type changed
- List items or table rows reordered
- Link titles, image alt text, or code block language dropped

## Common Pitfalls

- **Trailing whitespace in serializer output** — strip before comparing
- **Inconsistent blank lines** — normalizer collapses 3+ newlines to 2
- **Nested list indentation** — tiptap-markdown expects 2-space indent
- **Table alignment markers** — alignment must be stored on the cell node
- **Image alt text with special characters** — escape in serialization
- **Code block language dropped** — must be stored as a node attribute

## Debug Workflow

1. Isolate the failing fixture to the minimum reproduction
2. Log the three forms: input → ProseMirror doc JSON → serialized output
3. Inspect the ProseMirror doc — is content preserved? (parse problem vs. serialize problem)
4. If parse: the HTML preprocessing pipeline or a tiptap-markdown extension is dropping something
5. If serialize: the node's `addStorage().markdown.serialize` is the culprit

## Related

- `/test-frontend` — runs the round-trip suite as part of `pnpm test`
- `/tiptap-extension` — extension authoring patterns
- @docs/features/editor.md — supported markdown syntax surface
- @docs/features/editor-architecture.md — ProseMirror/Tiptap architecture
