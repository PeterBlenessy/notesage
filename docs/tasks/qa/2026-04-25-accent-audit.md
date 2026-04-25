# Accent color audit — 2026-04-25

Follow-up ticket spawned from live-test 2026-04-25 #144 fix. The accent
class swap now lands on `<html>` (`useAccent` mounted in `App.tsx`), and
the AppearanceSettings swatches match the actual `--accent` values from
`globals.css`. The user clarified the intent: they want Apple-style
brand colour treatment — when accent is set, all primary surfaces
(orb, highlighted rows, active toolbar buttons, selected items) should
pick up the user's colour at a low-alpha tint, while neutral chrome
stays grey.

## Sweep policy

- **Tint level:** `12%` (Apple-style soft selection).
- **Hover:** stays neutral grey (Apple-style — only SELECTED rows tint).
- **Approach:** one sweep with a checklist below.

## Token strategy

- `--color-accent-primary` resolves to `var(--accent, var(--color-primary))`.
  When no accent class is on `<html>`, it falls back to neutral grey →
  UI is byte-identical for users who haven't picked an accent.
- For backgrounds / surfaces that should "tint" with the brand, use
  Tailwind v4 arbitrary syntax: `bg-[var(--color-accent-primary)]/12`.
- For full-saturation marks (orb fill while running, primary CTA bg,
  switch on-state, dirty dot, focus rings), use the variable directly:
  `bg-[var(--color-accent-primary)]`.
- Hover states intentionally KEEP `hover:bg-accent/50` (the neutral
  shadcn `--color-accent` token) and `hover:bg-muted/50`. Apple's
  highlight-the-selected pattern.
- **Skipped on purpose** — semantic colours stay as-is:
  - Destructive red (errors, delete confirmations)
  - Local AI green / amber / red (server state)
  - Recording red (audio capture)
  - Diff green / red (added / removed)
  - Syntax highlighting (code semantics)

## Sweep checklist (2026-04-25 sweep)

### Sidebar / navigation

- [x] `PinnedSection` — active row `bg-muted` → tinted
- [x] `ProjectsSection` — active row `bg-muted` → tinted
- [x] `TreeOverlay` — active row `bg-muted` → tinted
- [x] `SettingsShell` v2 — active nav item `bg-accent` → tinted
- [x] `TabBar` — active tab `bg-muted` → tinted
- [x] `TitleBar` — chat-panel-open + agent-panel-expanded toggles → tinted

### Agent orb

- [x] `AgentOrb` — running surface `bg-foreground/85` → full-saturation
      `bg-[var(--color-accent-primary)]` while `isActive`. Idle
      keeps the dark neutral so the orb stays unobtrusive.

### Editor toolbar + pickers

- [x] `Toolbar` — formatting active state (bold/italic/strike/code/
      codeBlock) `bg-accent` → tinted
- [x] `HeadingPicker` — current level `bg-accent` → tinted
- [x] `CalloutPicker` — current type `bg-accent` → tinted
- [x] `TableGridPicker` — open / table-active `bg-accent` → tinted
- [x] `TableToolsPopover` — open `bg-accent` → tinted
- [x] `LinkButton` — isLink active + selected suggestion → tinted

### Editor suggestion menus

- [x] `slash-command` — selected item `bg-accent` → tinted
- [x] `mention-suggestion` — selected item → tinted
- [x] `tag-suggestion` — selected item → tinted
- [x] `date-suggestion` — selected item → tinted

### Cmd bar mode pickers

- [x] `CommandBarContext` — goal pill, active provider row → tinted
      (hover stays neutral)
- [x] `CommandBarHistory` — highlighted row → tinted
- [x] `SkillMode` — selected `bg-accent text-accent-foreground` → tinted
- [x] `TagMode` — selected → tinted
- [x] `ResearchMode` — active row `bg-muted` → tinted
- [x] `TaskMode` — active row `bg-muted` → tinted

### Settings v2 (segmented controls)

- [x] `AppearanceSettings` — color-mode + accent-picker active option
      `border-foreground bg-accent text-foreground` → tinted (border
      stays foreground so the active option keeps its strong outline)
- [x] `EditorSettings` — measurement-unit segmented control active
      option → tinted

### Document viewers

- [x] `PptxViewer` — toolbar active toggles (notes / comments / search) → tinted
- [x] `PptxZoomControls` — active fit-mode → tinted
- [x] `PdfViewer` — toolbar active state → tinted
- [x] `DocxViewer` — toolbar active state → tinted

### shadcn primitives (cascade through everything)

- [x] `ui/dropdown-menu` — focus + state=open → tinted (so dropdown
      items highlight in accent on hover)
- [x] `ui/context-menu` — focus + state=open → tinted
- [x] `ui/command` — `data-[selected=true]` → tinted
- [x] `ui/select` — focus → tinted

### Already accent-driven before this sweep

- Primary action buttons (`var(--color-accent-primary)` direct)
- Switch on-state (already accent)
- Tab dirty dot (already accent)
- Editor link colour (already accent)
- MicButton recording icon (live-test 2026-04-25 batch)
- Cmd bar Send button (already accent)

## Open follow-ups (NOT in this sweep)

- [ ] **System swatch / dot reads orange instead of the actual macOS
      accent.** `--accent-system-value` is only fetched when the user
      has already picked `accent === 'system'`. The System swatch in
      the picker uses `var(--accent-system-value, oklch(68% 0.21 37))`
      which falls back to orange before the fetch runs. Fix: have
      `useAccent` always invoke `get_system_accent_color` on mount
      (regardless of the currently-selected accent) and write the
      result to `--accent-system-value`. Tests already cover the
      success / null cases — extend to assert the unconditional fetch.
- [ ] **Sliders (track fill + thumb)** — Tailwind / shadcn slider uses
      `bg-primary` for the filled portion. Should pick up the accent
      so the user can see their brand colour in the slider track.
      Requires a CSS override in `globals.css` since the slider's
      internals are styled via shadcn defaults. Out of scope for the
      first sweep; needs a careful look at the Radix slider DOM.
- [ ] **Tag badge + mention badge backgrounds** — currently a muted
      neutral via the `--ns-tag-*` tokens. Could pick up a low-alpha
      accent tint to brand them; design call needed.
- [ ] **Legacy chat panel (Classic Layout)** — `ChatPanel.tsx`,
      `ChatHistoryView.tsx`, `ChatFooter.tsx`, `BranchSwitcher.tsx`
      etc. all have `bg-accent` in active states but were skipped
      because the user's primary surface is Quiet Composer. They
      benefit indirectly from the ui/ primitive sweep; full rewrite
      can be a Phase 2 follow-up if classic shell sticks around.
- [ ] **Legacy classic sidebar** (`FileTreeItem`, `ExplorerFolderItem`,
      `ProjectItem`, `SidebarPanel`) — same rationale as above.
- [ ] **Legacy non-v2 settings panels** (`AISettings`, `SkillsSettings`,
      `PromptsSettings`, `SyncSettings`, `ProjectSettings`,
      `McpServersSettings`) — same rationale.

## Verification

Test live in the running app:

1. Open Settings > Appearance, pick **Orange** — sidebar active row,
   active nav item, active toolbar button, selected dropdown items,
   active tabs should all tint orange. Orb pulses orange while a task
   is running.
2. Pick **Blue** — same surfaces tint blue.
3. Pick **Default** (neutral) — surfaces revert to grey (no
   chromatic surprise).
4. Hover any row — hover stays neutral grey.

`657 tests pass across QuietLayout / sidebar / cmd-bar / settings v2 /
StatusBar / StatusTray / editor`. Typecheck clean.
