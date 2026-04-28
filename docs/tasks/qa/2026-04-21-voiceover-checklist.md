# VoiceOver Walkthrough — Phase 1 UI Refresh

**Drafted:** 2026-04-23 as part of M1.10 #99 **Run pending:** Phase 2 (gated on F7 — editor mount in QuietLayout). The checklist below covers every Phase 1 surface that shipped; surfaces gated on F7 / F8 are flagged inline.

## How to use this checklist

1. Enable VoiceOver: ⌘F5 (or System Settings → Accessibility → VoiceOver)
2. Set verbosity to "Default" or higher
3. Set rotor: enable Headings, Landmarks, Form Controls
4. Open Notesage (dev mode preferred so console logs are visible)
5. For each surface below, navigate with VO keys (`VO+→`, `VO+↓`, `VO+Space`, etc.) and confirm each line item
6. Log findings inline. P0 = blocks shipping; P1 = ship-without but file as Phase 2 priority; P2+ = nice to have

---

## A. Quiet Composer Preview — opt in via Settings → Appearance → "UI" → "Quiet Composer"

### A1. FloatingCommandBar (`src/components/cmd/FloatingCommandBar.tsx`)

- [x] **Compact pill** announces as button with label "Press ⌘K to ask"

- [x] Pressing **⌘K** (or activating the pill) expands the bar; focus moves to the input

- [x] **Input** announces as combobox (`role="combobox"`) with `aria-haspopup="listbox"` and `aria-autocomplete="list"`

- [x] `aria-expanded` flips to true when a prefix mode is active

- [x] `aria-controls` matches the active picker's listbox id

- [x] Typing `/` mounts the SkillMode picker; **VO announces the listbox + first option**

- [x] ↑ / ↓ moves the highlight; `aria-activedescendant` updates so VO reads the new option without focus moving

- [x] Same coverage for `@` (Reference), `#` (Tag), `?` (Research), `!` (Task), `>` (Palette)

- [x] First Esc clears the active prefix only (announces "no prefix mode" or similar via the badge live region)

- [x] Second Esc collapses the bar

- [x] **Mode change** announced via the `PrefixModeBadge` (`role="status" aria-live="polite"`)

- [x] **wwChat stream** container has `role="log"` + `aria-live="polite"` + `aria-label="Chat stream"` — incremental tokens announce as they arrive

Tab order: input → suggestions → chips → context row

### A2. PinnedPanel mode (`isPinned === true`)

- [x] Outer panel announces as `role="region" aria-label="Chat panel"`

- [x] **Resize handle** announces as `role="slider"` with `aria-valuenow` / min / max in pixels

- [x] ←/→ adjusts width by ±20px; new value re-announces

- [x] **Unpin button** announces as `aria-label="Return chat to floating bar"` when pinned

- [x] When floating, the same button announces as something like "Pin chat to side panel"

### A3. AgentOrb (`src/components/activity/AgentOrb.tsx`) + AgentPanel

- [x] Orb announces as button with `aria-label="Agent — N tasks running"`; the count updates as tasks change

- [x] When N &gt; 1, label uses correct pluralization ("Agent — 2 tasks running")

- [x] Press Enter / Space → AgentPanel popover opens

- [x] Focus traps inside the popover (Tab cycles within; doesn't escape)

- [x] Press Esc → popover closes; focus returns to the orb

- [x] **AgentPanel** announces as `role="region"` with the panel header

- [x] Empty state ("No agent tasks yet") reads correctly

- [x] Task list reads each task's label + status

### A4. QuietSidebar (`src/components/sidebar/quiet/QuietSidebar.tsx`)

- [x] Sidebar announces as `<nav aria-label="Workspace sidebar">`

- [x] Each section announces as a section landmark with its title (Pinned / Projects / Recent / Tags)

- [x] **Roving tabindex**: only the focused row in each section has `tabIndex={0}`; Tab moves between sections, ↑/↓ within

- [x] ↑ at top of section wraps to bottom (or no-ops — confirm against implementation)

- [x] Each row announces with its name + role (button or link) + active state

- [x] **F2** on a focused row enters rename mode AND announces "Renaming " via aria-live

- [x] **macOS Menu key** (or `⌘⇧,`) opens the context menu on the focused row

- [x] **Context menu** announces each item with its label + keyboard shortcut

- [x] **→** on a project row reveals the inline FolderPeek (or expands the existing children inline) — VO reads each child entry

- [x] **Type-to-filter**: typing a printable key while sidebar is focused updates the filter; the FilterBadge announces ("Filter: ab") via `role="status" aria-live="polite"`

Backspace removes one char; Esc clears the filter

### ~~A5. TreeOverlay (~~`src/components/sidebar/quiet/TreeOverlay.tsx`~~)~~

- [ ] **~~⌘⇧E~~** ~~opens the overlay; focus auto-moves to the search input~~

- [ ] ~~Overlay announces as~~ `role="dialog" aria-modal="true" aria-label="Workspace tree"`

- [ ] ~~Tree announces as~~ `role="tree" aria-label="Workspace tree"`

- [ ] ~~Each node announces as~~ `role="treeitem"` ~~with~~ `aria-level` ~~and~~ `aria-expanded` ~~(for directories)~~

- [ ] ~~↓ from the search input moves focus to the first tree node~~

- [ ] ~~↑ at the first node returns focus to the search input~~

- [ ] ~~→: if directory, expands or moves to first child; if expanded, moves to first child~~

- [ ] ~~←: collapses or moves to parent~~

- [ ] ~~Home / End jump to first / last visible node~~

- [ ] ~~Enter / Space on a file opens the file~~

- [ ] **~~Tab~~** ~~wraps within the overlay only (focus trap) — doesn't escape to the editor or sidebar behind~~

- [ ] **~~Esc~~** ~~closes the overlay AND restores focus to the previously focused element (e.g. the editor or sidebar row)~~

- [ ] **~~Known F10 issues~~** ~~— re-pressing ⌘⇧E doesn't toggle close (open-only); overlay covers macOS traffic-light buttons. Document VO impact if any.~~

### A6. FolderPeek (`src/components/sidebar/quiet/FolderPeek.tsx`)

- [x] Hover popover announces as `role="dialog" aria-label="Folder peek — <project>"`

- [x] Each child entry (folder or file) announces as button with name

- [x] "See full tree" footer announces with its label and ⌘⇧E shortcut

- [x] Esc closes the popover (or hover-out grace; confirm VO behavior)

### A7. PermissionCard (`src/components/chat/PermissionCard.tsx`)

- [x] When a permission request appears, the card announces immediately (`role="alert"` / `aria-live="assertive"`)

- [x] Allow button: `aria-label="Allow <kind> <subject>"` — full intent (e.g. "Allow write_file to /path/to/file.md")

- [x] Deny button: equivalent full-intent label

- [x] **Focus moves to Allow** on appearance — VO immediately reads the Allow button

- [x] Dropdown options ("Allow once", "Allow for this session", "Allow always") are reachable + announce correctly

### A8. FocusPill (`src/components/editor/FocusPill.tsx`) + Focus mode

- [x] Press **⌘.** to enter focus mode

- [x] Announcer (`useFocusMode`) reads "Focus mode on. Press Command period to exit."

- [x] FocusPill chrome itself is `aria-hidden="true"` — VO does NOT re-read the pill text (announcer already did the work)

- [x] The × button inside the pill IS exposed and labeled "Exit focus mode"

- [x] Press **⌘.** again or click × → announcer reads "Focus mode off. Chrome restored."

- [x] Focus returns to the pre-focus-mode element

### A9. SettingsShell (`src/components/settings/v2/SettingsShell.tsx`)

- [x] Open Settings (⌘,) — dialog announces with title "Settings"

- [x] Tab order: nav items → close button → content controls

- [x] Esc closes the dialog (Radix default)

- [x] **Focus trap** keeps Tab within the dialog

- [x] Each nav item announces with its label + active state (`aria-current="page"`)

- [x] ↑ / ↓ in the nav cycles items; selection persists

- [x] Each row in the right pane: control announces with `aria-describedby` linking to the description text

- [x] Live preview (Appearance &gt; Live Preview) is `aria-hidden="true"`

### A10. PreviewInvitation (`src/components/PreviewInvitation.tsx`)

- [x] Banner announces as `role="region" aria-label="Preview invitation"`

- [x] "Try it" button focusable + labeled

- [x] "×" button labeled `aria-label="Dismiss preview invitation"`

- [x] Esc / clicking × → banner unmounts; focus returns sensibly (probably to the document or sidebar)

---

## B. Reduced motion verification

Enable: System Settings → Accessibility → Display → Reduce Motion.

- [x] Re-enter Quiet Composer; orb does NOT pulse

- [x] FloatingCommandBar focus → no lift transform

- [x] FloatingCommandBar height/width morph → no animation, snap to size

- [x] FocusPill enter → no fade/slide

- [ ] ~~TreeOverlay open → no slide, snap in~~

- [x] FolderPeek open → no fade

- [x] Settings dialog → no zoom-in animation

- [x] StatusTray popover → no fade

- [x] Toolbar pill fade → snap, no transition

- [x] AgentPanel popover → no Radix animation

---

## ~~C. Legacy Layout sanity (regression)~~

~~After Phase 1, the legacy Layout is still the default for new users. VoiceOver coverage for legacy surfaces should be unchanged:~~

- [ ] ~~TabBar tabs announce correctly + dirty indicator~~

- [ ] ~~ChatPanel input announces as combobox or textbox~~

- [ ] ~~ActivityStrip rail icons announce as buttons with task labels~~

- [ ] ~~PermissionCard already covered above (same component)~~

- [ ] ~~Sidebar (legacy~~ `Sidebar.tsx`~~) still announces tree nodes correctly~~

---

## Findings log

Log P0 / P1 findings as bug tickets in the Phase 2 task file. P2+ findings can go in `2026-04-21-ui-refresh-phase1-followups.md` as Fnn entries.

| Surface | Severity | Description | Filed as |
| --- | --- | --- | --- |
|  |  |  |  |
