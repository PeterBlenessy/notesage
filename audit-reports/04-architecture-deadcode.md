# Architecture & Dead-Code Audit — Notesage

Date: 2026-06-03 · Auditor: staff-eng pass · Repo: `/home/user/notesage` · Read-only.

Scope: (A) architecture/decomposition & boundary integrity; (B) dead code (unused exports,
orphaned files, unused deps). Verified against the rules in CLAUDE.md / docs/architecture.md:
ProseMirror is single source of truth, all I/O via Tauri commands, Zustand stores with clear
boundaries, one component per file, no `any`.

## Headline

The codebase is in good architectural health. The two hard boundary rules hold: **no frontend
filesystem access** (zero `@tauri-apps/plugin-fs` imports in `src/`) and **ProseMirror remains the
edit source of truth** (the `editor-store.content` field is a save/restore snapshot synced on
blur/save, not a competing live edit path). `any` discipline is excellent — ~4 real `as any`
casts, all justified by third-party type gaps. Rust commands are tightly managed (202 commands,
201 registered; the 1 delta is a multiline-handler grep artifact, not a dead command).

The real debt is **size**: a handful of files have grown into 1000–2800 line god-objects, and
there is **~1700 lines of fully-dead frontend code** plus **7 redundant npm dependencies**.

---

## Top 12 largest non-test source files

| Lines | File | Verdict |
| --- | --- | --- |
| 2832 | `src/components/cmd/FloatingCommandBar.tsx` | **SPLIT** — god-component, main fn ~1430 lines |
| 2279 | `src/lib/pptx-parser.ts` | Large but cohesive single-responsibility parser; acceptable |
| 2168 | `src-tauri/src/export/markdown_to_docx.rs` | Large converter; cohesive; low priority |
| 2007 | `src-tauri/src/commands/acp.rs` | Command + session-lifecycle mix; candidate split |
| 1776 | `src-tauri/src/export/markdown_to_pptx.rs` | Cohesive converter; low priority |
| 1645 | `src/components/sidebar/quiet/ProjectsSection.tsx` | **SPLIT** — main component 924 lines |
| 1481 | `src-tauri/src/commands/local_inference.rs` | Lifecycle + catalog + FIM; candidate split |
| 1444 | `src/lib/markdown.ts` | Two responsibilities (PM round-trip + 15 HTML converters) |
| 1424 | `src-tauri/src/commands/transcription.rs` | Capture + transcribe + model mgmt; candidate split |
| 1409 | `src-tauri/src/commands/copilot_lsp.rs` | Cohesive LSP orchestrator; acceptable |
| 1148 | `src/components/editor/StatusBar.tsx` | **SPLIT** — 1 file holds 11 components |
| 1143 | `src/hooks/useAcpLifecycle.ts` | Hook + 6 module-level mutable singletons |

(For reference, the largest files overall are tests: `settings-store.test.ts` 2463,
`useAgentTaskOperations.test.ts` 2062, `ProjectsSection.test.tsx` 2024.)

---

## A. Architecture findings

### A1. FloatingCommandBar is a 2832-line god-component
**Severity: High**
**Location:** `src/components/cmd/FloatingCommandBar.tsx` (main `FloatingCommandBar` function spans
L175–1608 — a single ~1430-line component), then 7 more components in the same file
(`PinnedResizeHandle` L1608, `ExpandedResizeHandle` L1740, `TopResizeHandle` L1868,
`CompactContent` L1986, `ExpandedContent` L2117–2626, `PrefixModeBadge` L2636,
`ModePickerDispatch` L2700, `VerbDiscoveryMenu` L2793).
**Evidence:** 9 top-level components + interfaces in one file; 82 hook/effect call sites; the docs
describe this as "the chat surface" carrying chat, prefix-mode pickers, pinned-panel resize,
attachment chips, and accessibility wiring — at least 5 distinct concerns. Violates "one component
per file."
**Impact:** Highest-churn UI file in the repo (it IS the chat panel + command palette). Any change
forces a full mental reload; merge conflicts concentrate here; the 1430-line main function defeats
component-level reasoning and testing. `CommandBarContext.tsx` (1000 lines, 8 components) is a
sibling with the same smell.
**Fix:** Extract the 8 already-separate sub-components into their own files
(`cmd/resize/{PinnedResizeHandle,ExpandedResizeHandle,TopResizeHandle}.tsx`,
`cmd/CompactContent.tsx`, `cmd/ExpandedContent.tsx`, `cmd/ModePickerDispatch.tsx`,
`cmd/VerbDiscoveryMenu.tsx`). Then lift the resize/width/height state machine (the
`PINNED_*`/`EXPANDED_*` constant clusters at L101–127 + their handlers) into a
`useCommandBarGeometry` hook. Target: the orchestrator file under ~500 lines.

### A2. useAcpLifecycle uses module-level mutable singletons for callbacks/timers
**Severity: Medium**
**Location:** `src/hooks/useAcpLifecycle.ts:44–82` — `let _homeDir`, `let eagerSessionPromise`,
`let unresponsiveTimerId`, `let onUnresponsiveCallback`, `let retryCallback`,
`let keepWaitingCallback`, exposed via module-scope getters `getRetryCallback()` /
`getKeepWaitingCallback()` / `startUnresponsiveTimer()` (L77–105). Main hook body is L122–1143
(~1021 lines).
**Evidence:** Six pieces of mutable state live at module scope rather than in a store or ref,
mutated by a React hook and read by exported free functions. This is a hidden global — it works
only because the app mounts exactly one ACP lifecycle.
**Impact:** Cross-cutting boundary leak: state that conceptually belongs to `agent-status-store`
lives in a hook module, making it untestable in isolation and fragile under StrictMode
double-invoke / future multi-window. The 1021-line hook body also mixes session restore, the
unresponsive timer, eager session creation, and reconnect.
**Fix:** Move the unresponsive-timer + retry/keep-waiting callbacks into `agent-status-store`
(which already owns the banner state per docs). Split the restore/reconnect logic into a
`useAcpSessionRestore` helper. Keep `useAcpLifecycle` as the thin orchestrator.

### A3. ProjectsSection main component is 924 lines
**Severity: Medium**
**Location:** `src/components/sidebar/quiet/ProjectsSection.tsx` — `ProjectsSection` L329–1253
(924 lines), then `ProjectRow` L1253, `ChildRow` L1459.
**Evidence:** The exported component carries project listing, inline-create, inline-rename,
context-menu wiring, drag/drop, and child-row peek in one body before the two row components even
begin.
**Impact:** Hardest sidebar file to modify; the inline-edit + drag logic is interleaved with
render. `FoldersSection.tsx` (885) and `SidebarContextMenu.tsx` (882) are peers with similar mass.
**Fix:** Extract `ProjectRow`/`ChildRow` to sibling files; pull the inline-create/rename signal
handling (already coordinated via `quiet-sidebar-store`) and drag handlers into hooks
(`useProjectInlineEdit`, `useProjectRowDrag`).

### A4. StatusBar.tsx holds 11 components (one-component-per-file violation)
**Severity: Medium**
**Location:** `src/components/editor/StatusBar.tsx` (1148 lines). Ten indicator sub-components
defined before the export: `InlineCompletionIcon` L15, `CopilotMaxCharsSlider` L56,
`FimContextSlider` L77, `ActionsIndicator` L98, `IndexProgressIndicator` L126,
`AgentInstructionsIndicator` L161, `ModelDownloadIndicator` L221,
`OutOfScopeCompletionsIndicator` L293, `LocalAIIndicator` L338, then `StatusBar` L465 (~681 lines).
**Evidence:** 11 independently-testable components in one module.
**Impact:** Each indicator subscribes to different stores; bundling them defeats isolated testing
and re-render reasoning. `StatusTray.tsx` (861) is the popover sibling with the same pattern.
**Fix:** Move each indicator into `src/components/editor/status/` as its own file; `StatusBar`
becomes a layout shell that composes them.

### A5. markdown.ts mixes ProseMirror round-trip with 15 HTML pre/post converters
**Severity: Low**
**Location:** `src/lib/markdown.ts` (1444 lines) — 15 `convert*ToHtml` functions
(`convertCalloutsToHtml` L275 … `convertPageBreaksToHtml` L1054) alongside the core PM conversion
(`getMarkdownFromEditor` L1076, `loadRawMarkdownIntoEditor` L1149, `streamingHydrate` L1305,
`prepareInitialContent` L1429).
**Evidence:** Two responsibilities in one module: (1) the markdown↔ProseMirror serialization that
is the documented round-trip contract, and (2) a large bank of markdown→HTML string transforms
used to feed the editor's `setContent`.
**Impact:** Lower than the component findings — the converters are genuinely part of the WYSIWYG
load path (not the Rust export path), so this is cohesive-ish. But the file is large enough that
the core round-trip functions are buried.
**Fix (optional):** Extract the `convert*ToHtml` bank to `src/lib/markdown-html-converters.ts`,
re-export for compatibility. Leaves `markdown.ts` as the round-trip surface only.

### A6. Documentation drift: sidebar has a 6th section ("Folders") undocumented
**Severity: Low (doc integrity, not code)**
**Location:** `src/components/sidebar/quiet/FoldersSection.tsx` (885 lines), imported and rendered
at `src/components/sidebar/quiet/QuietSidebar.tsx:10` and `:209`.
**Evidence:** design-system.md and workspace.md both state the Quiet Sidebar order is
"Pinned → Projects → Recent → Tags → Mentions" (5 sections), but the shipped sidebar renders a
`FoldersSection` too.
**Impact:** A 885-line surface is invisible to anyone working from the docs; the
architecture.md sidebar inventory also omits it.
**Fix:** Add `FoldersSection.tsx` to the Quiet Sidebar inventory in architecture.md /
design-system.md / workspace.md, or remove it if it was meant to be cut.

---

## B. Dead-code findings

### B1. Seven redundant npm dependencies in package.json
**Confidence: Confident** (verified against `pnpm-lock.yaml` transitive graph + zero `src/` refs)
**Location:** `package.json` dependencies.
**Evidence:**
- `@tiptap/extension-underline`, `@tiptap/extension-link`, `@tiptap/extension-list-keymap`,
  `@tiptap/extension-horizontal-rule` — **zero direct imports** in `src/`; the lockfile shows all
  four are already transitive deps of `@tiptap/starter-kit@3.23.6` (which the editor uses via
  `useEditor.ts:2` `import StarterKit`). Tiptap v3 starter-kit bundles them.
- `@tiptap/extension-bubble-menu`, `@tiptap/extension-floating-menu` — zero direct imports; the
  app's bubble menu comes from `@tiptap/react/menus` (`BubbleMenu.tsx:1`). Both are transitive deps
  of `@tiptap/react@3.23.6` per the lockfile.
- `@tauri-apps/plugin-global-shortcut` (^2.3.1) — **zero references** in `src/` AND `src-tauri/`
  (no Cargo dep, no capability grant). Matches the docs: Quick Capture / global-shortcut "never
  shipped".
**Impact:** Phantom dependency surface — supply-chain audit noise, slower installs, and a false
signal that global-shortcut is wired (it isn't).
**Fix:** Remove all 7 from `package.json` dependencies. (The tiptap ones still resolve transitively;
verify a `pnpm install` + `pnpm typecheck` after.)

### B2. ~1700 lines of fully-orphaned frontend files (zero importers anywhere)
**Confidence: Confident** (each verified to have 0 non-test references; the two test-only ones
flagged separately)
**Location / line counts:**
| File | Lines | Note |
| --- | --- | --- |
| `src/components/editor/extensions/drag-handle.ts` | 491 | docs mark DragHandle "deferred — needs unified gutter design"; never wired into the editor |
| `src/components/goals/GoalTemplateDialog.tsx` | 262 | no importers |
| `src/components/chat/SkillCommandMenu.tsx` | 178 | superseded by cmd-bar SkillMode; 0 refs |
| `src/components/editor/BranchDiffSelector.tsx` | 166 | git-diff selector; 0 refs (feature reached another way) |
| `src/components/chat/AgentCommandMenu.tsx` | 141 | superseded by cmd-bar; 0 refs |
| `src/components/sidebar/BranchIndicator.tsx` | 107 | 0 refs |
| `src/components/editor/extensions/table-formatting.ts` | 61 | listed in editor-architecture.md as active, but 0 imports |
| `src/lib/project-templates.ts` | 48 | New Project templates; 0 refs (dialog was removed in Classic Layout deletion) |
| `src/components/editor/viewers/DocxPlaceholder.tsx` | 17 | 0 refs |
| `src/components/editor/viewers/PdfPlaceholder.tsx` | 17 | 0 refs |
**Total: ~1588 lines.**
**Evidence:** `grep -rln <basename> src` excluding self + tests returns 0 for each. Several
correspond to features the docs say were removed (Classic Layout deletion removed `NewNoteDialog`/
`NewProjectDialog` → `project-templates.ts` orphaned; cmd-bar prefix modes replaced
`SkillCommandMenu`/`AgentCommandMenu`).
**Impact:** Dead weight that misleads readers (e.g. `table-formatting.ts` and `drag-handle.ts`
appear in editor-architecture.md's extension inventory as if active). `drag-handle.ts` alone is 491
lines of unused ProseMirror plugin code.
**Fix:** Delete all 10 files. Update editor-architecture.md to drop `TableFormatting` /
`DragHandle` rows (DragHandle is already struck-through; TableFormatting is not).

### B3. Two files referenced only by tests (dead in production)
**Confidence: Confident**
**Location:**
- `src/components/SymbolSearchResults.tsx` (184 lines) — only referenced by
  `src/components/__tests__/truncated-filename-tooltips.test.tsx:471` (dynamic `import`). No
  production importer.
- `src/components/sidebar/SyncedIcon.tsx` (40 lines) — only referenced by a `vi.mock` in
  `FileTreeItem.test.tsx:17`. No production importer.
**Evidence:** Non-test ref count = 0 for both; test ref count = 1 each.
**Impact:** Tests assert behaviour of components nothing ships — false coverage signal; the tests
will pass forever regardless of app correctness.
**Fix:** Confirm the production surfaces these once backed (the cmd-bar symbol picker /
FileTreeItem) and either re-wire or delete the component + its orphaned test. Note `FileTreeItem.tsx`
itself (834 lines) is used inside TreeOverlay, so `SyncedIcon` may have been inlined — verify before
deleting.

### B4. tauri-plugin-fs initialized but ungranted (redundant registration)
**Confidence: Likely** (intentional-but-redundant; low risk)
**Location:** `src-tauri/src/lib.rs:41` `.plugin(tauri_plugin_fs::init())`.
**Evidence:** The plugin is registered, but per the hardened capability surface (docs +
`tauri-capability-surface.test.ts`) **no `fs:allow-*` permissions are granted**, and the renderer
never imports `@tauri-apps/plugin-fs`. So the plugin's IPC commands are reachable by nothing.
**Impact:** Minor — initializes an unused plugin and slightly widens the attack surface the
capability lock-down is explicitly trying to close. The Cargo dep `tauri-plugin-fs = "2"` exists
only for this init.
**Fix:** If nothing in Rust uses the plugin's Tauri commands (it doesn't appear to — file I/O goes
through the hand-rolled `commands/file.rs`), drop the `.plugin(tauri_plugin_fs::init())` line and
the Cargo dep. Re-run `cargo test` + the capability-surface test.

---

## Non-findings (verified clean — recorded to prevent re-litigation)

- **FS boundary intact.** Zero `@tauri-apps/plugin-fs` and zero `node:fs` imports in `src/`
  (outside perf/parser tests that read fixtures). All I/O routes through Tauri commands.
- **ProseMirror source-of-truth intact.** `editor-store.content` is the markdown snapshot synced
  on blur/save (`Editor.tsx:268` `updateTabContent` after diffing against `activeTab.content`), not
  a live edit channel. No `setContent` pushes Zustand→PM as the edit path.
- **`any` discipline strong.** ~4 real `as any` casts repo-wide, all third-party gaps
  (`DrawingEditor.tsx:285/288` Excalidraw props, `toc.ts:187` `ReactNodeViewRenderer`,
  `perf/harness.ts:140` + `external-diff.ts:146` tiptap-markdown storage — the latter even has a
  typed helper `editor-storage.ts` to discourage it). No `any[]` / `<any>` abuse in app code.
- **Rust commands well-managed.** 202 `#[tauri::command]` fns, 201 in `generate_handler!`; the 1
  delta is a grep artifact of the multiline handler list, not a dead/unregistered command.
- **Deprecated paths intentionally retained, not dead.** `startMessageIndex` (chat-store) is the
  documented v5-migration fallback behind `startMessageId`; `ai-store` is the documented v1
  migration/fallback store; `openTabs` → `openDocuments` rename is fully complete (0 stragglers).
