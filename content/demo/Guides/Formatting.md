# A field guide to formatting

Everything below is real markdown, round-tripped losslessly. Write in rich text; save as clean `.md`.

## Emphasis and inline

You can go **bold**, *italic*, ~~struck through~~, or drop a bit of `inline code` mid-sentence. Link out to [the reference](https://example.com) or across your notes with [On Attention](<../Essays/On Attention.md>).

## Callouts

> [!note]
> Callouts use the Obsidian `> [!type]` syntax and export cleanly to PDF, Word, and slides.

> [!tip]
> Reach for a callout when a line deserves to stand slightly apart — a caveat, an aside, a reminder.

> [!warning]
> Destructive steps and gotchas belong here, where the eye lands first.

## A task list

- [x] Sketch the outline
- [x] Draft the opening
- [ ] Tighten the second half with @alex
- [ ] Hand off to @editor for a read

## Code, highlighted

```typescript
// Syntax highlighting via lowlight — keywords, strings, and types all coloured.
export function attend(thought: string): string {
  const trimmed = thought.trim();
  return trimmed.length > 0 ? trimmed : "…";
}
```

## A blockquote

> We write to know what we think. The page is the mirror.

#writing #craft
