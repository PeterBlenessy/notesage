# Project Isolation — Follow-up UX Notes

Captured during user testing on 2026-04-20 after the Track 1/2 batch
(docs/tasks/2026-04-18-project-data-isolation-tasks.md) shipped. These
are NOT bugs — the enforcement works. They are UX opportunities flagged
by the user during hands-on testing.

## 1. Tray "Recent" — group by project

**Surface:** System tray icon → "Recent" submenu (task #31).

**Today:** Flat list of recently opened files filtered by the chat
footer's selected project scope. With multiple projects selected, the
files are interleaved — no visual cue which file belongs to which project.

**User ask:** "would be nice UX if there was grouping with project when
more than one project is activated, or actually regardless."

**Sketch:** Wrap the list in project-keyed sub-submenus:

```
Recent
├── Project A
│   ├── outline.md
│   └── meeting-notes.md
├── Project B
│   ├── design.md
│   └── research.md
└── Notesage (home library)
    └── quick-capture-2026-04-20.md
```

Even with a single project selected, the grouping header is a reminder
of which project's files these are. Keep "All Recent" as the opt-in
escape hatch.

**Complexity:** S — the `tray-recents.ts` helper already knows each
tab's `projectPath`; new work is just the menu-builder grouping and the
Rust `tray.rs` rendering of sub-submenus.

## 2. Project selection ↔ document editing — clarify the relationship

**Surface:** Editor area vs. chat footer project multi-select.

**User observation (after testing #16 Copilot LSP scope gate + #17 inline
completion scope gate):**

> "The connection between project selection (in chat panel) and
> document editing is not very obvious. We might have to think about
> the UX around this. But ok for now, I want to test it a while."

**The tension:** The user experiences two distinct mental models:

1. **Editor model:** "I click a file in the sidebar, it opens as a tab, I
   edit it." Project boundaries are essentially invisible — it's just a
   file tree.
2. **Chat model:** "I pick projects in the chat footer, and those are
   what the AI can reach." Project boundaries are the primary
   isolation axis.

After this batch, AI features respect project scope even for the file
you're actively editing:

- Tab is outside selected project → Copilot LSP doesn't sync it (#16)
- Tab is outside selected project → no inline completions (#17),
  StatusBar shows "Completions: off (outside project)"
- Tab is outside selected project → can't be auto-attached to chat (#23
  will formalize this)

This is correct security, but users who think in the Editor model will
be surprised when completions silently stop. The StatusBar indicator is
the only current hint and is easy to miss.

**Possible UX directions (NOT decisions — think for a while first):**

- **Visual connection:** when a tab is out-of-scope for the current chat
  footer selection, decorate the tab (muted color, chain-break icon) so
  the editor surface itself signals "this file is not part of the
  current AI scope"
- **Active-project affordance:** a subtle header above the editor
  ("Editing in Project B — chat scoped to Project A. Adjust in footer
  ⟲") visible only when tab and chat are out of sync
- **Auto-sync option:** opt-in setting "When I open a tab, add its
  project to the chat footer selection" — resolves the tension by
  making the two models stay in step
- **Unified "active project" concept:** replace the multi-select footer
  with a primary "working in [Project X]" indicator that both the tab
  area and chat respect. Multi-select becomes an advanced mode.
- **Do nothing** — the StatusBar indicator + "Completions: off" toast
  may be enough once users internalize the model.

**Recommendation:** gather user feedback over the next few days of
testing before committing to a direction. Any of the above is a
follow-up PRD on its own.

**Complexity:** depends on direction chosen. Visual decoration is S;
unified active project is L and may ripple through multi-select
semantics.

---

Both items captured as follow-ups, not blocking the current PRD's
quality gates.
