# Keyboard-Only Walkthrough — Phase 1 UI Refresh

**Drafted:** 2026-04-23 as part of M1.10 #100
**Run pending:** Phase 2 (gated on F7 — editor mount in QuietLayout, F8 — chat mount). Flows 1, 3, and 4 below require the editor + chat to be mounted in QuietLayout. Flows 2 and 5 are testable today against the legacy Layout.

## How to use this checklist

1. Disconnect (or disable) the mouse / trackpad
2. Open Notesage
3. Run each of the 5 flows below end-to-end using the keyboard only
4. **Any step that requires the mouse = a P0 blocker**. Log it.
5. Use the Settings → Appearance → "UI" toggle to switch between Quiet Composer and Classic for flows that exercise both shells

---

## Flow 1 — Create a new note

**Targets:** ⌘N (classic) / ⌘N (Quiet Composer inline create flow)

**Classic Layout steps:**
1. ⌘N → "New Note" dialog opens (focus auto-moves to the name input)
2. Type the filename
3. Tab to the project picker; ↓ to select; Enter to confirm
4. Submit → the new note opens in the editor; cursor is in the editor

**Quiet Composer steps (gated on F7 + the inline-create flow #41 + #42):**
1. ⌘N → inline-edit row appears at the top of the active project's children in QuietSidebar
2. Type the filename; Enter to commit
3. New file opens in the editor (gated on F7)
4. Cursor is in the editor

**Pass criteria:**
- [ ] Every step reachable via keyboard
- [ ] Final cursor position is in the editor (not the sidebar / dialog)
- [ ] No "Open Project to create a note" toast (assuming you're inside a project context)

---

## Flow 2 — Delegate a comment to an agent

**Targets:** ⌘⇧M to add comment, then delegate to agent

**Classic Layout (testable today):**
1. With a markdown file open and a text selection: ⌘⇧M → comment popover opens
2. Type the comment body
3. Tab to "Delegate to agent" → Enter
4. Comment becomes a delegated task in the activity strip; agent responds in-thread

**Quiet Composer (gated on F7):**
- Same flow but the comment delegation manifests in the AgentPanel popover (orb shows count)

**Pass criteria:**
- [ ] Selection + ⌘⇧M opens the popover
- [ ] All popover controls reachable by Tab
- [ ] Esc cancels the popover; selection preserved
- [ ] After delegation, focus returns to the editor (no orphan focus)

---

## Flow 3 — Export PDF

**Targets:** ⌘⇧E (classic) / via the export menu (Quiet Composer mode preempts this chord for TreeOverlay)

**Classic Layout:**
1. With a markdown file open: ⌘⇧E → Export dialog opens (focus on first control)
2. Tab through template / TOC / page numbers / page size
3. Submit → native save dialog opens
4. ⌘S in save dialog (or Tab to "Save")
5. Toast confirms; "Reveal in Finder" link reachable

**Quiet Composer (gated on F7 + a new export entry point):**
- ⌘⇧E opens the TreeOverlay in this mode. PDF export needs a different entry point — e.g. the document's right-click context menu or a Settings → Export shortcut. Document the new route during Phase 2.

**Pass criteria:**
- [ ] Dialog opens via keyboard
- [ ] Every option reachable
- [ ] Save flow completes without mouse

---

## Flow 4 — Switch provider mid-chat

**Targets:** chat footer provider picker

**Classic Layout (testable when chat is open):**
1. ⌘⇧C → opens chat panel
2. Send a message to provider A
3. Wait for response
4. Tab into the chat footer; activate provider picker; ↓ to provider B; Enter
5. AgentSwitchCard appears → choose "Start fresh" or "Include history"
6. Send another message → provider B receives it

**Quiet Composer (gated on F8 — chat mount):**
- Same flow but the chat surface is the FloatingCommandBar (or pinned panel). Provider picker is in the context row.

**Pass criteria:**
- [ ] Provider picker reachable via Tab from the input
- [ ] AgentSwitchCard's choices reachable + activatable
- [ ] No keyboard trap on the card
- [ ] After switch, focus returns to the input

---

## Flow 5 — Enter and exit focus mode

**Targets:** ⌘.

**Either shell (testable today in classic; Quiet Composer too):**
1. With a markdown file open and cursor in the editor: press ⌘. → focus mode enters
2. Sidebar fades, doc-head fades, status fades, orb dims (Quiet Composer)
3. FocusPill appears at the top center
4. Press ⌘. again (or Tab to the × in the FocusPill and Enter) → focus mode exits
5. **Focus returns to the editor cursor position** (the pre-enter focus)

**Pass criteria:**
- [ ] ⌘. enters reliably
- [ ] FocusPill is visible
- [ ] Esc fall-through chain works: Esc on an open popover closes the popover (not focus mode); Esc with no popover open exits focus mode
- [ ] Exit returns focus to the editor (not the body)

---

## Phase 1 shell coverage (additions to the 5 flows above)

These cover surfaces that aren't in the 5 spec flows but ARE shippable in Phase 1 and worth checking by keyboard:

### S1. Quiet Composer onboarding

- [ ] Classic Layout shows the PreviewInvitation banner on first launch
- [ ] Tab into the banner → "Try it" focused → Enter switches to Quiet Composer
- [ ] Or: Tab to "×" → Enter dismisses

### S2. Sidebar navigation (Quiet Composer)

- [ ] Tab into QuietSidebar → first row of Pinned focused
- [ ] ↓ navigates within Pinned only
- [ ] Tab → moves to first row of Projects
- [ ] ↓ within Projects; → expands a project (peek inline)
- [ ] ⌘⌥C copies path; ⌘⌥R reveals in Finder
- [ ] ⌘⇧, opens the right-click menu via keyboard

### S3. TreeOverlay (Quiet Composer)

- [ ] ⌘⇧E opens overlay; search input focused
- [ ] Type to filter; ↓ moves to first match
- [ ] Tab cycles within overlay only
- [ ] Esc closes + restores focus to the previous element
- [ ] **F10 known issue:** ⌘⇧E doesn't toggle close (re-press is no-op visually). Document.

### S4. FocusBar / Settings keyboard nav

- [ ] ⌘, opens Settings
- [ ] Tab to nav column; ↑ / ↓ cycles items
- [ ] Tab to content; controls reachable
- [ ] Esc closes + focus returns

### S5. Recent document MRU cycling

- [ ] Open 3+ documents
- [ ] ⌘⇧[ cycles backward through MRU
- [ ] ⌘⇧] cycles forward
- [ ] Active editor focus preserved

---

## Findings log

Log all P0 keyboard-trap or mouse-required findings as Phase 2 tasks. The 5 spec flows are P0 by definition — anything that fails them blocks shipping.

| Flow / Surface | Severity | Description | Filed as |
| --- | --- | --- | --- |
|  |  |  |  |
