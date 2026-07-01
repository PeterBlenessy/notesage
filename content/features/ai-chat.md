---
feature: ai-chat
title: AI Chat & Command Bar
status: shipped
category: ai
summary: "One quiet command bar to ask your AI, search, and run skills — right beside your notes."
order: 10

shortcuts:
  - id: command-bar
    keys: "⌘K"
    label: Open the AI command bar

capabilities:
  bringYourOwnAI: true
  pinnablePanel: true

screenshots:
  - ai-chat.png
  - quiet-composer-light.png
  - quiet-composer-dark.png

forbidden:
  - Zustand
---

## [web]

**Think alongside your notes.** A single command bar sits quietly at the bottom of the window. Summon it, ask a question, and the assistant answers right where you're working — then it fades away again. Prefer a permanent side panel? Pin it. Connect the AI you already use, or run one entirely offline.

## [deep]

### What it does

The command bar is one place to talk to your notes. It sits quietly at the bottom of the window; summon it and it grows into a composer with the full conversation, then collapses back to a thin pill when you're done. Ask a question, and the answer arrives right where you're working — no separate chat window, no context-switch.

### One bar, many jobs

The same bar is also how you get around. A prefix changes what it does: `#` searches tags, `@` references a file or person, `?` searches your research, and `/` runs a skill. So "ask the AI" and "find that note" share the same muscle memory.

### Pin it when you want a panel

Prefer a persistent chat beside your document? Pin the bar and it docks to the right edge as a full panel, and the document reflows to make room. Unpin to send it back to its quiet floating state.

### Example

Mid-paragraph you press {{shortcut:command-bar}}, type "tighten this and suggest a heading," and paste the answer. Then, still in the bar, you type `#roadmap` to jump to a tagged note — same tool, no reach for the mouse.

### When to use it

Any time a question would otherwise send you to a browser: rewording, brainstorming, summarising a selection, or checking a fact — kept beside your work, on the AI you chose.

### Tips

- Double-tap ⌘ is a second way to summon it.
- Connect the assistant you already use, or a fully offline model — the bar behaves the same either way.
- An ambient orb shows when a background task is running, so long jobs never block your writing.

## [in-app]

Press {{shortcut:command-bar}} (or double-tap ⌘) to open the command bar, then type your question. Start with `#` to search tags, `@` to reference a file or person, `?` to search your research, or `/` to run a skill. Pin the bar to the right edge for a permanent chat panel.

## [social]

One quiet command bar for everything: ask your AI, search tags, jump to a note, run a skill. Summon it with ⌘K — and it fades away when you're done.
