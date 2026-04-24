# UI Refresh Phase 1 — Batch Plan (in-flight)

Pointer document for continuing `docs/tasks/2026-04-21-ui-refresh-phase1-tasks.md` across sessions.

## Status as of 2026-04-23

- **Tasks done (100/127)** — Revised 2026-04-24 after completing the #113 functional-parity audit (`docs/tasks/qa/2026-04-23-functional-parity.md`). The audit inventoried 129 user-reachable actions across 9 surfaces: **87 reachable, 21 broken, 20 missing, 1 unknown**. #114–#120 (first integration-gap batch) covered seven of the gaps; **ten more filed as #121–#130** (second batch): #121 restore semantics for ⌘⇧C/⌘⇧A, #122 DocHead tab-close/strip decision, #123 ⌘⇧L sidebar visibility, #124 TitleBar button cleanup, #125 CommandBarContext parity (thinking/model/goals/mode-gate), #126 FloatingCommandBar ChatInput parity (image attach/Stop/`/skill`/`@agent`/sandbox scope), #127 CommandBarStream per-message parity (edit/resend/branch/QuickReplies/empty state), #128 SidebarContextMenu parity, #129 Quiet sidebar visual state (git/external-change/AI-lock), #130 CommandBarStream cards/banners (Permission/Domain/ToolCall/AgentStatus) + orb panel cancel/click wiring. #113 ✅ landed. **Currently in flight: none. Next up: fan out #114–#130 fixes in dependency order (#114 unblocks most).**
- **Tests passing**: 4103/4103 frontend, 43/43 perf, typecheck clean, contrast audit 22/22 pass. (Rust unchanged.)
- **Restructure note (2026-04-23):** Originally the post-Foundation work was filed in `phase2-tasks.md` and Phase 1 was claimed "closed at 100/100". On re-reading the PRD success criteria with the user, both decisions were wrong — the success criteria require functionality, not just the new shell. The 8 tasks in `phase2-tasks.md` were folded back into `phase1-tasks.md` as M1.11–M1.13 plus a new #107 (switch-back banner), and `phase2-tasks.md` was deleted. Phase 2 (release semantics: default for new installs) reverts to the PRD's roadmap section — no separate task file until Phase 1 actually ships.
- **Task status marks**: 🚧 on launch, ✅ on merge. Both via `git apply --cached` to bypass the markdown formatter. Expected by user; see `feedback_task_status_marks.md` in auto-memory.
- **Known follow-ups tracked in** `2026-04-21-ui-refresh-phase1-followups.md` (F1 pinned-delete cleanup; F2 tag-seed wiring).
- **Workflow**: manual worktrees + parent-commits — see `.claude/skills/implement-tasks/SKILL.md` (validated 2026-04-22). Ignore `Agent isolation: "worktree"` for this codebase.
- **Markdown formatter quirk**: a hidden formatter strips ✅ markers and `\|` table escapes on every Edit/sed of `*.md` files. Use `git apply --cached` for ✅ marks (writes directly to git index).

## M1.3 Sidebar + Chrome — batch plan (33 tasks, #30–#62)

### Batch G1 — Foundations (4 parallel)

| # | Files | Notes |
| --- | --- | --- |
| #30 | new `QuietSidebar.tsx` + 4 section sub-files (`PinnedSection.tsx`, `ProjectsSection.tsx`, `RecentSection.tsx`, `TagsSection.tsx`) — extract sections into separate files so G2 can fill them in parallel without overlap | sidebar shell with empty sections |
| #39 | new `SidebarInlineEdit.tsx` | rename/create primitive |
| #48 | new `DocHead.tsx` + `QuietLayout.tsx` mount | breadcrumb (replaces TabBar in QuietLayout) |
| #49 | `Toolbar.tsx` refactor | floating pill with backdrop blur |

### Batch G2 — Sidebar section wiring (4 parallel — depends G1's #30 split)

- #31 PinnedSection wiring (workspace-store)
- #32 ProjectsSection wiring (flat list with file counts)
- #33 RecentSection wiring (editor-store, cap 5 + show-more)
- #34 TagsSection wiring (SQLite top tags, cap 5)

### Batch G3 — Sidebar features (4 parallel after G1)

- #36 new `FolderPeek.tsx` (hover popover, one level deep)
- #38 new `TreeOverlay.tsx` (⌘⇧E full tree, role="tree")
- #45 new `SidebarContextMenu.tsx` (shadcn context-menu)
- #47 new `FilePreview.tsx` (500ms hover, first 10 lines)

### Batch G4 — Sidebar dependents (4 sequential, all small)

- #37 FolderPeek keyboard (after #36)
- #46 Copy path / Reveal in Finder (after #45; may need Tauri command)
- #43 type-to-filter (modifies QuietSidebar)
- #44 drag-to-pin (after #31; modifies QuietSidebar)

### Batch G5 — Inline edit modes (3 sequential — all touch QuietSidebar)

- #40 inline rename (F2/double-click)
- #41 inline create note (⌘N + `+` on project)
- #42 inline create project (⌘⇧N + `+` on Projects header)

### Batch G6 — Chrome foundations (4 parallel after #49 lands)

- #50 `useFadeOnType.ts` + globals.css `.typing` class
- #52 `StatusBar.tsx` simplified strip
- #55 new `FocusPill.tsx`
- #57 new `ViewerToolbarPill.tsx` shared primitive

### Batch G7 — Chrome dependents

- #51 quiet-chrome presets (after #50; settings panel)
- #53 `StatusTray.tsx` popover (after #52)
- #54 status-bar dots (after #52; overlaps with #52, sequential)
- #56 `useFocusMode.ts` + Esc fall-through (after #55, #50)
- #35 sidebar composition settings (after #30; settings + settings-store)

### Batch G8 — Viewer toolbar adoption (5 parallel after #57)

- #58 PdfViewer
- #59 EpubViewer
- #60 DocxViewer
- #61 PptxViewer
- #62 CodeEditor language pill

## After M1.3

- M1.4 Settings shell (#63–#68, 6 tasks)
- M1.5 Removals + external-change rewire (#69–#74, 6 tasks)
- M1.6 State + plumbing (#75–#77, 3 tasks)
- M1.7 Accessibility (#78–#87, 10 tasks)
- M1.8 Performance benchmarks (#88–#92, 5 tasks)
- M1.9 Docs + release prep (#93–#98, 6 tasks)
- M1.10 Pre-ship validation (#99–#100, 2 tasks)

## How to resume

User prompt to a fresh session, after `/clear`:

> Continue Phase 1 of the UI refresh from the batch plan in `docs/tasks/2026-04-21-ui-refresh-phase1-batches.md`. Start with Batch G1.

That's enough — the plan file references the canonical tasks file and SKILL.md, both of which contain everything needed (workflow, conventions, current ✅ state).
