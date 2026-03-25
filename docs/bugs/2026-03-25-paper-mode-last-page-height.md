# Bug: Paper mode last page not rendered as full page

|  |  |
| --- | --- |
| **Date observed** | 2026-03-25 |
| **Status** | Open |
| **Severity** | Low |
| **Impact** | Visual — last page in paper mode appears truncated |
| **Versions affected** | v0.23.0 |

## Symptoms

In paper mode (A4, Letter, or A5), the last page of the document does not extend to the full page height. Instead, it only renders the content lines plus the top/bottom margins, making the last "page" visually shorter than all previous pages.

Expected: every page, including the last one, should be rendered as a full-height page rectangle with whitespace filling the remainder after the content ends — matching how a real printed page would look.

## How to reproduce

1. Open a markdown file with enough content to span multiple pages
2. Switch to paper mode (Settings &gt; Content Width &gt; A4 or Letter)
3. Scroll to the bottom of the document
4. Observe: the last page card/container is shorter than the others

## Relevant files

- `src/styles/editor.css` — `.paper-mode` CSS rules that create page breaks and page styling
- `src/components/editor/editor-utils.ts` — `CONTENT_HEIGHTS` constants for page dimensions
- `src/hooks/useEditorTabSwitch.ts` — page position calculation logic

## Notes

This is a pre-existing CSS issue unrelated to the #31 decomposition refactor. The paper mode page break rendering uses CSS `break-after` / column-based pagination, which doesn't enforce a minimum height on the final page container.