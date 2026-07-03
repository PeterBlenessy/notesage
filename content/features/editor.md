---
feature: editor
title: The Editor
status: shipped
category: write
summary: "A calm writing surface — markdown that reads like a finished document, with tables, callouts, charts, and drawings."
order: 10

shortcuts:
  - id: bold
    keys: "⌘B"
    label: Bold
  - id: italic
    keys: "⌘I"
    label: Italic
  - id: paste-plain
    keys: "⌘⇧V"
    label: Paste as plain text

capabilities:
  markdownRoundTrip: true
  richText: true

screenshots:
  - editor-light.png
  - editor-dark.png

# Keep marketing/in-app copy free of engine names — those belong in docs/features.
forbidden:
  - ProseMirror
  - Tiptap
---

## [web]

**A calm place to write.** Notesage feels like a premium sheet of paper — type in plain markdown or format as you go, and your words always stay exactly as you wrote them. Start a line with `/` to drop in a table, callout, chart, or drawing, and everything reads beautifully in light or dark.

## [deep]

### What it does

The editor is a rich-text surface that stays true to markdown. Type raw markdown or format visually — headings, lists, tables, code, callouts — and it always saves back to a clean `.md` file you could open in any other app. Nothing is trapped in a proprietary format.

### Beyond plain text

- **Tables that work** — sort, filter, total a column, even drop in a tiny inline chart.
- **Callouts** — Note, Tip, Warning, and Important blocks to make key points stand out.
- **Charts and drawings** — embed a live chart or a quick sketch right in the page, no second app.
- **Link previews** — paste a URL and it becomes a rich card with title and image.

### Example

Start a line with `/` and pick *Table*. Type your data, click a column header to sort, and turn on the totals row — a budget or a reading list becomes a living document, still stored as ordinary markdown.

### When to use it

Any time you'd reach for a notes app or a plain text file but want it to look finished — meeting notes, essays, specs, reading lists, journals.

### Tips

- Press {{shortcut:bold}} / {{shortcut:italic}} for quick formatting, or select text for the floating toolbar.
- {{shortcut:paste-plain}} pastes as plain text when you don't want markdown auto-formatting.
- Set your font, size, and spacing in **Settings → Editor** — the same styling flows through to export.

## [in-app]

Just type. Use the toolbar or shortcuts like {{shortcut:bold}} and {{shortcut:italic}} to format, or start a line with `/` to insert a heading, list, table, callout, code block, chart, or drawing. Your work saves automatically, and every note is a clean markdown file on disk you can open in anything.

## [social]

Write in markdown, read like a finished document. Tables, callouts, charts and drawings — in a calm editor that gets out of your way. Light or dark, your words stay yours.
