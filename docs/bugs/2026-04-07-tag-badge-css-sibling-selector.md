# Bug: Tag badges lose rounded corners and spacing when multiple tags in same paragraph

**Reported:** 2026-04-07
**Severity:** Low (cosmetic)
**Status:** Fixed
**Affects:** All versions

## Symptoms

- Tag badges (`#tag`) normally display with rounded corners (6px) and internal padding that creates a visual gap from surrounding text
- When a paragraph contains multiple tags, some tags lose their border-radius on one side and appear to have no gap from adjacent text
- The first tag in a multi-tag paragraph loses right-side rounding
- The last tag in a multi-tag paragraph loses left-side rounding
- Middle tags lose rounding on both sides
- Tags in single-tag paragraphs or headings look correct

## Root Cause

CSS adjacent sibling combinator (`+`) ignores text nodes. The merge rules intended for cursor-inside-tag splits match ANY two `.tag-badge` elements in the same parent, even with text content between them.

**In `src/styles/editor.css` (lines 914–926):**

```css
/* Intended: merge split decoration when cursor is inside a tag */
.tag-badge:has(+ .tag-badge) {
  border-right: 0;
  padding-right: 0;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.tag-badge + .tag-badge {
  border-left: 0;
  padding-left: 0;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
```

**How CSS `+` works:**

For this DOM (a paragraph with two tags and text between them):
```html
<p>
  text 
  <span class="tag-badge">#tag1</span>
   more text 
  <span class="tag-badge">#tag2</span>
   end
</p>
```

CSS `+` adjacent sibling combinator **ignores text nodes** and only considers element siblings. So `.tag-badge + .tag-badge` matches `#tag2` (its previous element sibling is `#tag1`'s span). And `.tag-badge:has(+ .tag-badge)` matches `#tag1`.

Result: `#tag1` loses right-side rounding, `#tag2` loses left-side rounding — even though they have visible text between them.

## Fix

Remove the CSS sibling merge rules. Add explicit `margin-inline` for consistent spacing.

The cursor-inside-tag split becomes a minor, temporary visual artifact (two mini-badges instead of one seamless badge while cursor is positioned inside a tag). This is far less noticeable than the current bug which permanently breaks rounding on most tags in multi-tag paragraphs.

```css
.tag-badge {
  /* ... existing styles ... */
  margin-inline: 0.1em; /* Consistent gap regardless of surrounding whitespace */
}

/* Remove these rules:
.tag-badge:has(+ .tag-badge) { ... }
.tag-badge + .tag-badge { ... }
*/
```

The same issue may affect `mention-highlight.ts` and `date-highlight.ts` if they use similar CSS patterns.

## Key Files

- `src/styles/editor.css` — `.tag-badge` styles (lines 897–926)
- `src/components/editor/extensions/tag-highlight.ts` — Tag decoration plugin
