---
feature: sidebar
title: Sidebar & Projects
status: shipped
category: organize
summary: "A curated sidebar of what you actually reach for — pins, projects, recents, tags, and mentions."
order: 10

shortcuts:
  - id: toggle-sidebar
    keys: "⌘⇧L"
    label: Show/hide the sidebar
  - id: search-tags
    keys: "⌘3"
    label: Search tags

capabilities:
  perProjectSettings: true

screenshots:
  - sidebar.png
---

## [web]

**Everything one glance away.** A calm, curated sidebar keeps your pinned notes, projects, recent files, tags, and mentions within reach — no sprawling file tree to wade through. Hover a project to peek inside without opening it.

## [deep]

### What it does

The sidebar is deliberately not a file tree. Instead of every folder and file, it surfaces the handful of things you actually return to: pinned notes, your projects, recent files, and your tags and mentions — in fixed, predictable sections. Less to scan, faster to reach.

### Projects, not just folders

A project is a folder with a memory: its own settings, AI context, and — if you want — its own locked assistant. Grouping work into projects keeps a client, a book, or a research topic self-contained, and keeps the AI's view scoped to just that work.

### Peek before you open

Hover a project (or press → on a focused row) and a peek shows its top-level contents without opening anything — so you can glance inside and keep moving. Deeper folders expand inline when you want them.

### Example

You keep three projects — *Essays*, *Client — Acme*, *Research*. A tag click on `#draft` via {{shortcut:search-tags}} gathers every unfinished piece across all three; {{shortcut:toggle-sidebar}} tucks the whole thing away when you want just the page.

### When to use it

All the time, quietly — it's the spine you navigate by. It earns its keep when your workspace grows past what a flat file list can handle.

### Tips

- Drag the right edge to resize; the width is remembered.
- Start typing while it's focused to filter every section at once.
- Pin the notes you touch daily so they're always at the top.

## [in-app]

Your sidebar lists Pinned, Projects, Folders, Recent, Tags, and Mentions. Press {{shortcut:toggle-sidebar}} to show or hide it, and {{shortcut:search-tags}} to jump to any tag across every note. Drag its right edge to resize, and just start typing to filter the list.

## [social]

No endless file tree — just what you actually reach for: pins, projects, recents, tags, mentions. Hover to peek inside a project. ⌘⇧L to tuck it away.
