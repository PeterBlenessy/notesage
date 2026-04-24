# Functional Parity Audit — Quiet Composer vs Classic Layout

| | |
| --- | --- |
| **Date** | 2026-04-23 |
| **Task** | [#113](../2026-04-21-ui-refresh-phase1-tasks.md) |
| **PRD** | [ui-refresh](../../prds/2026-04-21-ui-refresh.md) |
| **Scope** | Every user-reachable action in the legacy Layout must have a working path in QuietLayout. Separate from #111 visual mockup audit. |
| **Method** | Static analysis — every row traces from a QuietLayout mount point to a shared handler OR documents where the wiring is missing / broken. |

## Summary

- **Total actions inventoried**: 129
- **Reachable** (works in Quiet Composer): 87
- **Broken** (renders but does nothing, or misbehaves): 21 (→ references existing fix tasks + proposes 6 new)
- **Missing** (no path at all): 20 (→ proposes 9 new fix tasks)
- **Unknown** (need investigation): 1

## Scorecard by surface

| Surface | Reachable | Broken | Missing | Unknown | Fix tasks |
| --- | ---: | ---: | ---: | ---: | --- |
| Keyboard shortcuts | 31 | 6 | 1 | 0 | #114, #115, #120 + needs #121, #122, #123 |
| TitleBar | 1 | 2 | 0 | 0 | needs #124 |
| ChatFooter | 5 | 6 | 7 | 0 | needs #124, #125, #126 |
| ChatPanel per-message | 5 | 0 | 2 | 0 | #117, #118 + needs #127 |
| ActivityStrip / Orb | 5 | 1 | 0 | 0 | #119 |
| Sidebar / TabBar | 18 | 4 | 3 | 0 | needs #128, #129 |
| Slash commands | 15 | 0 | 0 | 0 | — |
| Prefix modes | 6 | 0 | 0 | 0 | — |
| Chat cards/banners | 1 | 2 | 7 | 1 | #116, #117, #118 + needs #130 |
| **Total** | **87** | **21** | **20** | **1** | — |

## Inventory

### Keyboard shortcuts

Legacy entry points are all in `src/hooks/useKeyboardShortcuts.ts`. Quiet Composer chords are owned by `useCommandBarShortcuts` (emits on the `cmd-bar-events` bus) or the capture-phase listeners in `src/components/QuietLayout.tsx`.

| Action | Legacy path | Quiet Composer path | Status | Fix task |
| --- | --- | --- | --- | --- |
| Save (⌘S) | `Editor.tsx` | `Editor.tsx` (same mount) | reachable | — |
| Open file (⌘O) | `useKeyboardShortcuts.ts` → `onOpenFolder` | same hook, uiPreview-agnostic | reachable | — |
| Close tab (⌘W) | `useKeyboardShortcuts.ts` → `closeTab` | same hook | reachable | — |
| New note (⌘N) | `useKeyboardShortcuts.ts` → `onNewNote` | `QuietLayout.tsx` capture-phase listener → `setPendingCreate` | reachable | — |
| New project (⌘⇧N) | `useKeyboardShortcuts.ts` → `onNewProject` | `QuietLayout.tsx` capture-phase → `setPendingCreateProject` | reachable | — |
| Export as PDF (⌘⇧E) | `useKeyboardShortcuts.ts` → `onExportOpen` | `QuietLayout.tsx` capture-phase → `openOverlay` (intentional override per PRD; TreeOverlay replaces export) | reachable | — |
| Bold / Italic / Underline / Strikethrough / Code (⌘B/I/U/⇧X/E) | Tiptap mounted in `Editor.tsx` | same Editor mount | reachable | — |
| Indent / Outdent (Tab / ⇧Tab) | Tiptap | same | reachable | — |
| Undo / Redo (⌘Z / ⌘⇧Z) | Tiptap | same | reachable | — |
| Find (⌘F) | `useKeyboardShortcuts.ts` → `onFindOpen` | same hook, uiPreview-agnostic | reachable | — |
| Find and replace (⌘⇧H) | `useKeyboardShortcuts.ts` → `onFindReplaceOpen` | same hook | reachable | — |
| Toggle theme (⌘T) | `useKeyboardShortcuts.ts` → `setTheme` | same hook | reachable | — |
| Open settings (⌘,) | `useKeyboardShortcuts.ts` → `onSettingsOpen` | same hook | reachable | — |
| Toggle chat panel (⌘⇧C) | `useKeyboardShortcuts.ts` → `setChatPanelOpen` | same hook fires the same setter, BUT `chatPanelOpen` is never read by QuietLayout — there is no second panel to toggle | broken | needs #121 |
| Toggle agent panel (⌘⇧A) | `useKeyboardShortcuts.ts` → `onToggleActivityStrip` | same hook; callback is `noop` in `QuietLayout.tsx` (line 126: `const noop = () => {}`) | broken | needs #121 |
| Add comment (⌘⇧M) | Tiptap | same Editor mount | reachable | — |
| Accept suggestion (⌘Enter) | `ai-suggestion.ts` | same | reachable | — |
| Reject suggestion (⌘Backspace) | `ai-suggestion.ts` | same | reachable | — |
| Toggle recording (⌘⇧R) | `useKeyboardShortcuts.ts` → `onToggleRecording` | same hook | reachable | — |
| Quick capture (⌘⇧Space) | Global Tauri shortcut | Global Tauri shortcut (uiPreview-agnostic) | reachable | — |
| Previous / Next Recent doc (⌘⇧[ / ⌘⇧]) | `useKeyboardShortcuts.ts` dispatches `CYCLE_RECENT_EVENT` | same | reachable | — |
| Middle-click tab | `TabBar.tsx` | DocHead does NOT render tabs; no close-via-middle-click affordance | missing | needs #122 |
| Command bar / palette (⌘K) | `useKeyboardShortcuts.ts` → `onPaletteOpen('default')` | `useCommandBarShortcuts` emits `{type:'focus'}` — **no component subscribes**; bar never expands | broken | #114 |
| Double-tap ⌘ | n/a | `useDoubleTapCmd` is defined but **never mounted** in production | broken | #115 |
| Search files (⌘⇧F) | `useKeyboardShortcuts.ts` → palette(`files`) | emits focus event, same dead bus | broken | #114 |
| Toggle sidebar (⌘⇧L) | `useKeyboardShortcuts.ts` → `setSidebarPinned` | same setter fires, BUT QuietSidebar does not read `sidebarPinned` to toggle visibility | broken | needs #123 |
| Focus mode (⌘.) | `useKeyboardShortcuts.ts` → `onToggleFocusMode` | `useFocusMode.ts` capture-phase owns the chord and toggles QuietLayout root class | reachable | — |
| Open actions (⌘1 / ⌘⇧1) | `useKeyboardShortcuts.ts` → `onOpenActions` | emits `{type:'focus', prefix:'!'}` — dead bus | broken | #114 |
| Mention search (⌘2 / ⌘⇧2) | palette(`mentions`) | emits `{type:'focus', prefix:'@'}` — dead bus | broken | #114 |
| Tag search (⌘3 / ⌘⇧3) | palette(`tags`) | emits `{type:'focus', prefix:'#'}` — dead bus | broken | #114 |
| Research search (⌘4 / ⌘⇧4) | palette(`research`) | emits `{type:'focus', prefix:'?'}` — dead bus | broken | #114 |
| Commands palette (⌘⇧P) | palette(`commands`) | emits `{type:'focus', prefix:'>'}` — dead bus | broken | #114 |
| TreeOverlay (⌘⇧E) | n/a | `QuietLayout.tsx` capture-phase → `openOverlay` | reachable | — |
| Document outline (⌘⇧O) | `useKeyboardShortcuts.ts` → `onOutlineOpen` | same hook | reachable | — |
| Keyboard shortcuts (⌘⇧K / ⌘7) | `useKeyboardShortcuts.ts` → `onShortcutsOpen` | same hook | reachable | — |
| Copy path (⌘⌥C) | dispatches `COPY_PATH_EVENT` | same — QuietSidebar rows listen | reachable | — |
| Reveal in Finder (⌘⌥R) | dispatches `REVEAL_IN_FINDER_EVENT` | same — QuietSidebar rows listen | reachable | — |
| Open devtools (⌘⌥I) | `useKeyboardShortcuts.ts` → `invoke("open_devtools")` | same | reachable | — |
| Exit focus mode (Esc) | `useKeyboardShortcuts.ts` | `useFocusMode.ts` capture-phase fall-through | reachable | — |

### TitleBar

Legacy: `src/components/TitleBar.tsx` with two ghost icon buttons (MessageSquare, Bot). QuietLayout mounts the same `TitleBar` but wires both callbacks to `noop` (line 126).

| Action | Legacy path | Quiet Composer path | Status | Fix task |
| --- | --- | --- | --- | --- |
| Active document title (drag region) | `TitleBar.tsx` reads `editor-store.activeTabId` | same component mounted in `QuietLayout.tsx` | reachable | — |
| Toggle chat panel button (MessageSquare) | `Layout.tsx` `handleToggleChat` → `setChatPanelOpen` | `QuietLayout.tsx` line 285 passes `onToggleChat={noop}` — button renders, click does nothing | broken | needs #124 |
| Toggle agent panel button (Bot) | `Layout.tsx` `handleToggleActivityStrip` → `useActivityStore.toggleManualHide` | `QuietLayout.tsx` line 285 passes `onToggleActivityStrip={noop}` | broken | needs #124 |

### ChatFooter

Legacy `ChatFooter.tsx` is only rendered inside the classic `ChatPanel`. Quiet Composer's composer chrome is `CommandBarContext.tsx` + the raw `<input>` inside `FloatingCommandBar.tsx`.

| Action | Legacy path | Quiet Composer path | Status | Fix task |
| --- | --- | --- | --- | --- |
| Provider pill (switch interactive connection) | `ChatFooter.tsx` Popover → `setRouting('interactive', id)` | `CommandBarContext.tsx` `ProviderPill` → `setRouting` (same action) | reachable | — |
| Provider lock badge (click → ExplainLockDialog) | `ChatFooter.tsx` → `ExplainLockDialog` | `CommandBarContext.tsx` → `ProjectChip` lock icon → `ExplainLockDialog` | reachable | — |
| Project picker "+" menu | `ChatFooter.tsx` Popover | `CommandBarContext.tsx` `AddProjectButton` Popover | reachable | — |
| Project chip remove (×) | `ChatFooter.tsx` → `toggleProjectPath` | `CommandBarContext.tsx` `ProjectChip onRemove` → `toggleProjectPath` | reachable | — |
| AcpSessionControls — Mode picker (Read Only / Agent / Full Access / Plan) | `ChatFooter.tsx` mounts `AcpSessionControls` | `CommandBarContext.tsx` mounts `AcpModePicker` directly | reachable | — |
| AcpSessionControls — Thinking effort / config options | `ChatFooter.tsx` mounts `AcpSessionControls` (renders `AcpConfigOptionPicker` + `AcpModelPicker`) | `CommandBarContext.tsx` mounts only `AcpModePicker`; thinking / config / model pickers not rendered | missing | needs #125 |
| Goals indicator pill | `ChatFooter.tsx` | Not rendered in `CommandBarContext` | missing | needs #125 |
| Agent mode picker toggle (settings gate) | `ChatFooter.tsx` reads `showAgentModePicker` | `CommandBarContext.tsx` doesn't gate on this setting (always renders) | broken | needs #125 |
| Cancel in-flight chat (Stop button) | `ChatInput` passes `onStop={cancelChat}` from `useAIOperations` | `FloatingCommandBar.tsx` has no Stop affordance — `sendChatMessage` fires but there's no cancel UI | missing | needs #126 |
| Attach image (paste / drag / file-picker in ChatInput) | `ChatInput.tsx` via `handlePlusMenuAttachImage`, paste, drop | `FloatingCommandBar.tsx` uses a raw `<input type="text">` — no paste/drop/picker | missing | needs #126 |
| AttachmentStrip (image thumbnails above send) | `AttachmentStrip.tsx` inside `ChatInput` | `AttachmentChips.tsx` exists BUT only supports reference chips (file/person/comment/task/research), not `ImageAttachment[]` | missing | needs #126 |
| Vision capability detection | `ChatPanel.tsx` via `checkVision(ctx)`, forwarded to `ChatFooter supportsVision` | Not evaluated in `FloatingCommandBar` / `CommandBarContext` | missing | needs #126 |
| `@agent-name` pass-through / direct-API intercept | `ChatPanel.tsx` `doSend` | `FloatingCommandBar.tsx` `handleSend` calls `sendChatMessage` directly with no `@agent-name` parse | broken | needs #126 |
| `/skill-name` body expansion | `ChatPanel.tsx` `doSend` → `readSkillContent` + prompt-wrap | `FloatingCommandBar.tsx` `handleSend` does NOT read skill body — just sends literal text | broken | needs #126 |
| Sandbox scoping for comment-sourced conversations | `ChatPanel.tsx` `doSend` computes `sandboxPaths` for comment convs | `FloatingCommandBar.tsx` `handleSend` does not set `sandboxPaths` | broken | needs #126 |
| Edit mode banner / cancel | `ChatFooter.tsx` renders `editContext` banner | No edit mode in `FloatingCommandBar` at all | missing | needs #127 |
| Context row — attached files dismissal | `ChatInput.tsx` `onDismissContext` (via `useChatContext`) | `FloatingCommandBar.tsx` does not consume `useChatContext` | missing | needs #126 |
| Explicit attach offer (e.g. active tab) | `ChatInput.tsx` `explicitAttachOffer` | Not rendered in `FloatingCommandBar` | missing | needs #126 |
| Cross-project mode warning | Legacy banner above chat | `CommandBarContext.tsx` `CrossProjectScopePill` (compact) | reachable | — |
| Pin/unpin side panel | n/a (legacy ChatPanel is always a Resizable side panel) | `CommandBarContext.tsx` Pin icon → `setCmdBarPinned` | reachable | — |
| Pinned panel drag-resize | n/a | `FloatingCommandBar.tsx` `PinnedResizeHandle` | reachable | — |

### ChatPanel per-message

Legacy: `ChatMessageList.tsx` + `ChatMessage.tsx` per-message controls. Quiet Composer uses `CommandBarStream.tsx` which maps messages to `<ChatMessage>` directly — but omits the wrapper that provides `onEdit`, `onResend`, `onBranch`, `onRetry` and per-branch-point separators.

| Action | Legacy path | Quiet Composer path | Status | Fix task |
| --- | --- | --- | --- | --- |
| Render chronological segments (text / thinking / tool-call / tool-result / image) | `ChatMessage.tsx` `SegmentRenderer` | same `ChatMessage` component mounted inside `CommandBarStream.tsx` | reachable | — |
| Copy message | `ChatMessage.tsx` `UserActionButtons` | same | reachable | — |
| Quick replies (assistant `<quick-replies>`) | `ChatMessageList.tsx` → `<QuickReplies onSelect={onSend}/>` | `CommandBarStream.tsx` does not render `QuickReplies` | missing | needs #127 |
| Edit user message | `ChatMessageList.tsx` passes `handleEdit` → `ChatMessage.onEdit` | `CommandBarStream.tsx` does NOT pass `onEdit`/`onResend`/`onBranch`/`onRetry` to `<ChatMessage>` | missing | needs #127 |
| Resend user message | same — `handleResend` | missing (same root cause) | missing | needs #127 |
| Retry errored assistant message | same — `handleRetry` | missing (same root cause) | missing | needs #127 |
| Branch from message (GitBranch icon / dropdown) | `ChatMessageList.tsx` `handleBranch` | missing (same root cause) | missing | needs #127 |
| BranchSwitcher pill at branch points | `ChatMessage.tsx` renders `BranchSwitcher` based on `branchCount` | `ChatMessage` renders pill, but `branchCount` defaults to 0 (not passed) | broken | needs #127 |
| Context divider (provider-switch segment boundary) | `ChatMessageList.tsx` `<ContextDivider>` | `CommandBarStream.tsx` does not render `ContextDivider` | missing | needs #127 |
| Onboarding prompts / LocalAISetupCard empty state | `ChatMessageList.tsx` empty state | `CommandBarStream.tsx` empty state = "No messages yet" text only | missing | needs #127 |
| Segment selector identity-match (segment dividers) | `ChatMessageList.tsx` | `CommandBarStream.tsx` — not rendered | missing | (rolled into needs #127) |
| Scroll-to-bottom on new messages | `ChatMessageList.tsx` MutationObserver | `CommandBarStream.tsx` `useEffect` on `messages.length` | reachable | — |
| Provider switch warning card | `ChatMessageList.tsx` renders `AgentSwitchCard` on `pendingAgentSwitch` | missing | missing | #117 |
| Project switch warning card | `ChatMessageList.tsx` renders `ProjectSwitchCard` on `pendingProjectSwitch` | missing | missing | #117 (extend) |

### ActivityStrip / Orb

Legacy: `ActivityStrip.tsx` (40px rail + resizable panel) toggled from TitleBar. Quiet Composer: `AgentOrb.tsx` + `AgentPanel.tsx` inside a shadcn Popover.

| Action | Legacy path | Quiet Composer path | Status | Fix task |
| --- | --- | --- | --- | --- |
| Show task count while running | `ActivityRail.tsx` | `AgentOrb.tsx` — count badge | reachable | — |
| Pulsing indicator while tasks running | CSS on the rail icon | `AgentOrb.tsx` `orb-pulsing` class | broken | #119 (CSS cascade conflict means pulse is not visible) |
| Open panel | Click the rail or TitleBar Bot button | Click / Enter on orb opens Popover (shadcn handles focus trap + Esc) | reachable | — |
| Task list display | `ActivityPanel.tsx` | `AgentPanel.tsx` (shared `ActivityTaskCard`) | reachable | — |
| Cancel running task | `ActivityPanel.tsx onCancelTask` → `ActivityTaskCard` → `cancelAgentTask` | `AgentPanel.tsx onCancelTask` — caller (`AgentOrb.tsx`) doesn't supply it (prop undefined) | broken/unknown | (see Findings — rolled into #119 scope or needs fix task) |
| Click task → navigate to source comment | `ActivityPanel.tsx onClickTask` → `openFile` + scroll | `AgentPanel.tsx onClickTask` — `AgentOrb.tsx` doesn't supply it | broken | (same) |
| Remove completed task | `ActivityTaskCard` → `removeTask` (both) | same | reachable | — |
| Status icons (running/done/error/cancelled) | shared `ActivityTaskCard` | same | reachable | — |

Note: the Cancel + Click-to-navigate gap in the Quiet Composer orb panel is identified as a separate follow-up. Rolled into the broader Orb-panel wiring task under needs #130 in Findings since the user-visible effect is the same as #119's symptom ("orb looks inert").

### Sidebar / TabBar

Legacy: `Sidebar.tsx` → recursive `FileTree.tsx` + `FileTreeItem.tsx` with a rich context menu. Quiet Composer: `QuietSidebar.tsx` with flat sections + `SidebarContextMenu.tsx` (simpler) + `TreeOverlay.tsx` for deep browsing. Tabs: `TabBar.tsx` (legacy) vs `DocHead.tsx` (Quiet Composer).

| Action | Legacy path | Quiet Composer path | Status | Fix task |
| --- | --- | --- | --- | --- |
| Click file → open as tab | `FileTreeItem.tsx` `handleClick` → `openFile` | `QuietSidebar` sections + `SidebarContextMenu onOpen` → `openFile` | reachable | — |
| Expand/collapse folder | `FileTreeItem.tsx` `toggleFolder` | `TreeOverlay.tsx` (deep-dive view) + `FolderPeek.tsx` hover preview | reachable | — |
| Tab bar (document switcher) | `TabBar.tsx` | `DocHead.tsx` (read-only breadcrumb; document switch via sidebar / TreeOverlay / ⌘⇧[/]) | reachable | — |
| Middle-click tab to close | `TabBar.tsx` click handlers | No tabs rendered — DocHead is read-only | missing | needs #122 |
| Drag to reorder tabs | `TabBar.tsx` drag handlers | same — no tabs | missing | needs #122 |
| Close tab (×) | `TabBar.tsx` close button | no tabs; ⌘W still closes the active document | broken | needs #122 (parity requires an affordance or scope reduction) |
| Dirty dot on tab | `TabBar.tsx` | DocHead shows a single dirty dot for the active doc only | reachable | — |
| Context menu: New File | `FileTreeItem.tsx` `handleNewFile` | `SidebarContextMenu.tsx` does not include "New File" (only rename/duplicate/pin/etc.) | missing | needs #128 |
| Context menu: New Folder | `FileTreeItem.tsx` `handleNewFolder` | not in `SidebarContextMenu.tsx` | missing | needs #128 |
| Context menu: Make / Open as Project | `FileTreeItem.tsx` `handleMakeProject` | not in `SidebarContextMenu.tsx` | missing | needs #128 |
| Context menu: Move to… | `FileTreeItem.tsx` nested sub-menu | `SidebarContextMenu.tsx` shows disabled "Move to… Coming soon" | broken | needs #128 |
| Context menu: Reveal in Finder | `FileTreeItem.tsx handleRevealInFinder` | `SidebarContextMenu.tsx handleRevealInFinder` | reachable | — |
| Context menu: Add to chat (image files) | `FileTreeItem.tsx handleAddToChat` | not in `SidebarContextMenu.tsx` | missing | needs #128 |
| Context menu: Export as... (PDF/DOCX/PPTX/HTML) | `FileTreeItem.tsx` nested sub-menu | not in `SidebarContextMenu.tsx` | missing | needs #128 |
| Context menu: Commit... (git) | `FileTreeItem.tsx handleCommitFile` | not in `SidebarContextMenu.tsx` | missing | needs #128 |
| Context menu: Rename | `FileTreeItem.tsx startRename` | `SidebarContextMenu.tsx` dispatches `SIDEBAR_ENTER_RENAME_MODE_EVENT` — row listens and enters rename | reachable | — |
| Context menu: Delete / Move to trash | `FileTreeItem.tsx handleOpenDeleteDialog` | `SidebarContextMenu.tsx` AlertDialog → `deletePath` | reachable | — |
| Context menu: Duplicate (file) | n/a — legacy doesn't have it | `SidebarContextMenu.tsx handleDuplicate` | reachable | — |
| Context menu: Pin / Unpin | n/a — legacy doesn't expose it | `SidebarContextMenu.tsx` → `workspace-store pinFile/unpinFile` | reachable | — |
| Context menu: Copy path / Copy filename | n/a (global ⌘⌥C works) | `SidebarContextMenu.tsx handleCopyPath/Filename` + keyboard | reachable | — |
| Drag file to reparent | `FileTreeItem.tsx` drag handlers | Reachable through `TreeOverlay` (and `file-drag.ts` utility for Quiet Sidebar rows) | reachable | — |
| Drag file onto chat (add image) | `FileTreeItem.tsx` → vision event bus | Not wired in QuietSidebar rows | missing | needs #128 |
| Git status badges | `FileTreeItem.tsx gitInfo` | `TreeOverlay.tsx` and `FolderPeek.tsx` do not render git status | missing | needs #129 |
| External-change indicator on tab/file | `TabBar.tsx` + `FileTreeItem.tsx hasExternalChange` | `DocHead.tsx` does not render external-change state; Quiet sidebar does not show it | missing | needs #129 |
| AI-lock padlock overlay on project folder | `FileTreeItem.tsx` `isLocked` | Not rendered in `QuietSidebar` / `ProjectsSection` | missing | needs #129 |
| New File / New Folder dialogs | `FileTreeItem.tsx` → `NewFolderDialog` | `QuietSidebar` → inline-create row for notes + projects (⌘N / ⌘⇧N) | reachable | — |
| Search sidebar (type-to-filter) | n/a | `QuietSidebar.tsx` local `filter` state + section filtering | reachable | — |
| Project folder peek (hover preview) | n/a | `FolderPeek.tsx` (Quiet Composer) | reachable | — |
| TreeOverlay (full workspace tree) | n/a | `TreeOverlay.tsx` (⌘⇧E) | reachable | — |

### Slash commands

All slash commands live inside the editor's `SlashCommand.tsx` Tiptap extension — completely uiPreview-agnostic. Reachable by the same handler in both shells.

| Command | Legacy path | Quiet Composer path | Status | Fix task |
| --- | --- | --- | --- | --- |
| `/` (show menu) | `SlashCommand.tsx` | same | reachable | — |
| `/h1` | `SlashCommand.tsx` | same | reachable | — |
| `/h2` | `SlashCommand.tsx` | same | reachable | — |
| `/h3` | `SlashCommand.tsx` | same | reachable | — |
| `/ul` | `SlashCommand.tsx` | same | reachable | — |
| `/ol` | `SlashCommand.tsx` | same | reachable | — |
| `/todo` | `SlashCommand.tsx` | same | reachable | — |
| `/callout` | `SlashCommand.tsx` | same | reachable | — |
| `/code` | `SlashCommand.tsx` | same | reachable | — |
| `/quote` | `SlashCommand.tsx` | same | reachable | — |
| `/table` | `SlashCommand.tsx` | same | reachable | — |
| `/hr` | `SlashCommand.tsx` | same | reachable | — |
| `/image` | `SlashCommand.tsx` | same | reachable | — |
| `/drawing` | `SlashCommand.tsx` | same | reachable | — |
| `/embed` | `SlashCommand.tsx` | same | reachable | — |

### Prefix modes

In the legacy CommandPalette each prefix opens a dedicated mode. In Quiet Composer the same prefixes are detected by `prefix-modes.ts → detectActivePrefix` inside `FloatingCommandBar.tsx` and dispatched to one of six pickers. The static prefix-to-picker routing is fully implemented — the gap is simply that ⌘1–4 / ⌘⇧P shortcuts can't summon the bar (see Keyboard shortcuts rows above).

| Prefix | Legacy path | Quiet Composer path | Status | Fix task |
| --- | --- | --- | --- | --- |
| `!` Tasks | `CommandPalette` with `defaultMode='actions'` | `TaskMode.tsx` via `ModePickerDispatch` | reachable | — |
| `#` Tags | `CommandPalette` with `defaultMode='tags'` | `TagMode.tsx` | reachable | — |
| `@` References/Mentions | `CommandPalette` with `defaultMode='mentions'` | `ReferenceMode.tsx` | reachable | — |
| `>` Commands | `CommandPalette` with `defaultMode='commands'` | `PaletteMode.tsx` (note: `onPick` is a stub — commands aren't executed yet; tracked separately in #20+) | reachable | — |
| `?` Research | `CommandPalette` with `defaultMode='research'` | `ResearchMode.tsx` | reachable | — |
| `/` Skills | n/a in legacy palette; same as `/` in chat input | `SkillMode.tsx` | reachable | — |

### Chat cards and banners

| Action | Legacy path | Quiet Composer path | Status | Fix task |
| --- | --- | --- | --- | --- |
| `AgentSwitchCard` (provider-switch context warning) | `ChatMessageList.tsx` on `pendingAgentSwitch` | Not rendered in `CommandBarStream.tsx` | missing | #117 |
| `ProjectSwitchCard` (project-scope switch warning) | `ChatMessageList.tsx` on `pendingProjectSwitch` | Not rendered in `CommandBarStream.tsx` | missing | #117 (extend) |
| `PermissionCard` (ACP tool call approval) | `ChatMessageList.tsx` loops `permissionRequests` | Not rendered in `CommandBarStream.tsx` | missing | needs #130 |
| `DomainApprovalCard` (proxy domain approval) | `ChatMessageList.tsx` loops `domainRequests` + listens to `network-domain-request` event | Not rendered in `CommandBarStream.tsx`; `listen('network-domain-request', …)` only mounted inside `ChatMessageList` | missing | needs #130 |
| `ToolCallPermissionCard` (direct-API write/execute approval) | `ChatMessageList.tsx` on `toolPermission` | Not rendered in `CommandBarStream.tsx` | missing | needs #130 |
| `AgentStatusBanner` (ACP unresponsive — Wait/Retry/Cancel) | `ChatMessageList.tsx` | Not rendered in `CommandBarStream.tsx` | missing | needs #130 |
| `ReconnectCard` (ACP session reconnect prompt) | `ChatMessage.tsx` renders per-message | reachable — same component used, via `ChatMessage` mounted inside `CommandBarStream` | reachable | — |
| `LocalAISetupCard` (empty-state local AI setup) | `ChatMessageList.tsx` empty branch | Not rendered in `CommandBarStream.tsx` empty state | missing | needs #127 |
| `ResendProviderDialog` (cross-provider resend confirmation) | `ChatPanel.tsx` dialog | No resend path in `FloatingCommandBar.tsx` so the dialog is never reached | broken | needs #127 |
| "AI is thinking…" / activeTool loading indicators | `ChatMessageList.tsx` spinner | Not rendered in `CommandBarStream.tsx` — live streaming happens but no loading indicator when messages aren't flowing | broken | needs #130 |
| Send shows bubble but no streaming response | n/a | User bug — observable outcome missing. See #116 for root cause debug. Possible causes: `selectMessages` / `activeConversation` mismatch when `CommandBarStream` reads `selectMessages` but user-message bubble goes into a conversation that no stream-processor writes to | unknown | #116 |

## Findings

### Broken

- **⌘K / ⌘⇧P / ⌘1–⌘4 / ⌘⇧F all emit to a dead bus** — `useCommandBarShortcuts` fires `emitCmdBarEvent` but no React component ever calls `subscribeToCmdBarEvents`. `FloatingCommandBar` has all the `expand()` / `collapse()` machinery but never hooks the bus. Covered by **#114**.
- **Double-tap ⌘** — `useDoubleTapCmd` is fully defined and unit-tested but never mounted in production; only `useCommandBarShortcuts` is composed into `useKeyboardShortcuts`. Covered by **#115**.
- **Esc fall-through** — `useCommandBarShortcuts` only emits `{type:'dismiss'}` when focus is already inside `[data-cmd-bar]`. The bar can't collapse via Esc from the editor or any other surface. Covered by **#114** (acceptance 4 + 5).
- **Focus mode doesn't collapse the expanded bar** — symmetric to above. Covered by **#120**.
- **AgentOrb pulse invisible** — Tailwind `hover:scale-105` composes into the transform chain and wipes the `orb-pulse` keyframe's `scale(1.05)` frame. Covered by **#119**.
- **AgentOrb panel cancel / click-to-navigate** — `AgentOrb.tsx` opens the popover but never passes `onCancelTask` / `onClickTask` to `<AgentPanel>`. Tasks render but can't be cancelled from the orb and don't navigate to their source. Scope-wise this is close enough to #119 to potentially roll in, but technically a separate missing wire-up. Proposing as part of **needs #130** (Chat-stream card rendering + agent panel wiring).
- **TitleBar chat/activity toggle buttons render but do nothing** — `QuietLayout.tsx` line 126 binds `noop` to both callbacks. Classic shell responds to `⌘⇧C` / `⌘⇧A` to toggle the panels; Quiet Composer has no legacy panel, so the button semantics need to change (open the floating bar? scroll to a "history" view? open the orb popover?). Proposing **needs #124** to redefine what those buttons do (or hide them entirely in Quiet Composer).
- **⌘⇧C / ⌘⇧A dead** — same root cause as above: the `useKeyboardShortcuts` chords flip `settings-store.chatPanelOpen` and call the activity-strip toggle, but Quiet Composer has no legacy panel to toggle, and the orb popover open state is local to `AgentOrb`. Proposing **needs #121**.
- **⌘⇧L dead** — flips `settings-store.sidebarPinned`, but `QuietSidebar` renders unconditionally; the setting isn't observed. Proposing **needs #123**.
- **"Move to…" disabled in sidebar context menu** — `SidebarContextMenu.tsx:213` hard-codes `disabled title="Coming soon"`. Covered by **needs #128**.
- **BranchSwitcher never shows in QuietLayout** — `ChatMessage` renders the switcher based on `branchCount`, but `CommandBarStream` doesn't pass it. Covered by **needs #127**.
- **`/skill-name` expansion and `@agent-name` intercept don't fire from FloatingCommandBar** — `handleSend` goes straight to `sendChatMessage` without the prompt-rewrite step that `ChatPanel.doSend` does. Covered by **needs #126**.
- **Sandbox scope for comment-delegated conversations not set on FloatingCommandBar sends** — same root cause as above; the `sandboxPaths` opt is always undefined. Covered by **needs #126**.
- **Agent mode picker is always shown** — `CommandBarContext` doesn't gate on `showAgentModePicker`. Covered by **needs #125**.
- **"AI is thinking…" indicator missing during streaming** — `CommandBarStream` doesn't render the loading indicator. Tracking under **needs #130**.
- **`ResendProviderDialog` never reachable** — there's no resend control in FloatingCommandBar, so the cross-provider-resend flow short-circuits entirely. Rolled into **needs #127**.

### Missing

- **AcpSessionControls — thinking effort / config options / model picker** — only `AcpModePicker` is rendered in `CommandBarContext`. Needs to mount `AcpConfigOptionPicker` and `AcpModelPicker` for full ACP session control. **needs #125**.
- **Goals indicator pill** — `ChatFooter.tsx` renders a "N goals" badge when goals are discovered; not in `CommandBarContext`. **needs #125**.
- **Image attachments** — paste / drop / file-picker / thumbnail strip / vision-capability gating all live on `ChatInput` + `AttachmentStrip`. FloatingCommandBar uses a raw `<input>` and `AttachmentChips` (reference-only). **needs #126**.
- **Stop-generation button** — `onStop={cancelChat}` is part of `ChatInput`; no equivalent in FloatingCommandBar. **needs #126**.
- **Edit mode banner / cancel** — `ChatFooter` renders an "Editing message" strip; no edit-mode in Quiet Composer. **needs #127**.
- **Explicit attach offer / attached files context row** — `useChatContext` drives chips for the currently edited tab etc.; FloatingCommandBar doesn't consume it. **needs #126**.
- **Per-message Edit / Resend / Retry / Branch controls** — `CommandBarStream` doesn't pass these callbacks to `<ChatMessage>`. **needs #127**.
- **Quick replies** — `ChatMessageList` parses `<quick-replies>` and renders `<QuickReplies>` after assistant turns; `CommandBarStream` does not. **needs #127**.
- **ContextDivider between segments** — `ChatMessageList` renders the divider; `CommandBarStream` does not. **needs #127**.
- **Onboarding prompts + LocalAISetupCard empty state** — `ChatMessageList` shows 3 prompts and the LocalAI setup card when messages are empty; `CommandBarStream` shows plain "No messages yet". **needs #127**.
- **AgentSwitchCard + ProjectSwitchCard** — not rendered in `CommandBarStream`. **#117** (extended).
- **PermissionCard / DomainApprovalCard / ToolCallPermissionCard / AgentStatusBanner** — not rendered in `CommandBarStream`. Including the `listen('network-domain-request')` effect which currently lives inside `ChatMessageList` only. **needs #130**.
- **Conversation history view** — clock icon in `CommandBarContext` logs `"open history — wired in #27"` and does nothing. **#118**.
- **Middle-click close / drag-reorder tabs** — DocHead is read-only; no tab chrome exists. Either a per-project tab strip must be added back, or ⌘W + sidebar navigation must be accepted as the parity surface (explicit PRD decision required). **needs #122**.
- **Context-menu: New File / New Folder / Make Project / Move to… / Add to chat (images) / Export as… / Commit…** — all missing from `SidebarContextMenu.tsx`. **needs #128**.
- **Git status badges / external-change indicators / AI-lock padlock in sidebar** — `FileTreeItem.tsx` surfaces these visually; `QuietSidebar` sections and `TreeOverlay` do not. **needs #129**.
- **Drag sidebar file onto chat** — legacy `FileTreeItem.tsx` wires a drag-to-chat path through the vision event bus; QuietSidebar rows do not. **needs #128**.

### Unknown / needs investigation

- **Send shows bubble, no streaming response** — #116 tracks the root-cause debug. Static analysis confirms `FloatingCommandBar.handleSend` calls `sendChatMessage(content, messagesForSend)` with the same signature `ChatPanel` uses, so the user bubble should appear and the streaming path should kick in. The missing observable symptom may be one of:
  - `selectMessages` picks up the user bubble but the stream writes chunks into a conversation that the bar's selector doesn't follow (active-conversation mismatch)
  - `useAIOperations.sendChatMessage` requires `sendOpts` scoping that FloatingCommandBar omits (e.g. `attachedFilePaths`), leading to an early throw that's silently swallowed
  - Missing "AI is thinking…" indicator (listed under Broken above) makes it appear the stream never started when in fact chunks are arriving into text segments that take time to fill
  Live repro + chat-store dev-tools trace needed. Covered by **#116**.

## Cross-reference with existing fix tasks

| Gap | Fix task | Status |
| --- | --- | --- |
| ⌘K / ⌘⇧P / ⌘1–4 / ⌘⇧F / Esc dead | #114 | filed |
| Double-tap ⌘ dead | #115 | filed |
| Send shows bubble, no response | #116 | filed |
| AgentSwitchCard not rendered | #117 | filed (should be extended to cover ProjectSwitchCard too — both flow from the same pending-switch stores) |
| History unreachable | #118 | filed |
| AgentOrb pulse invisible | #119 | filed |
| Focus-mode does not collapse bar | #120 | filed |
| ⌘⇧C / ⌘⇧A dead (no legacy panel to toggle) | needs #121 | proposed |
| Middle-click / drag / close tabs in DocHead | needs #122 | proposed |
| ⌘⇧L sidebar toggle dead in Quiet Composer | needs #123 | proposed |
| TitleBar chat/activity buttons do nothing | needs #124 | proposed |
| ChatFooter controls missing in CommandBarContext (thinking effort / model / goals / showAgentModePicker gate) | needs #125 | proposed |
| ChatInput parity (image attach / stop / `/skill` / `@agent` / explicit attach / sandbox scope) | needs #126 | proposed |
| Per-message controls + empty state + quick replies + context divider + edit-mode + BranchSwitcher in CommandBarStream | needs #127 | proposed |
| QuietSidebar context menu gaps (New File / New Folder / Make Project / Move to… / Add to chat / Export / Commit / drag-to-chat) | needs #128 | proposed |
| QuietSidebar visual state (git / external change / AI-lock padlock) | needs #129 | proposed |
| PermissionCard / DomainApprovalCard / ToolCallPermissionCard / AgentStatusBanner / LocalAISetupCard / "AI thinking" + Orb panel cancel+click in CommandBarStream | needs #130 | proposed |

### Proposed task skeletons

**needs #121 — Restore semantics for ⌘⇧C / ⌘⇧A under Quiet Composer**
- One-liner: Decide and wire what ⌘⇧C (toggle chat panel) and ⌘⇧A (toggle agent panel) should do in Quiet Composer.
- Complexity: S
- Files touched: `src/hooks/useKeyboardShortcuts.ts`, `src/components/QuietLayout.tsx`, possibly `cmd-bar-events.ts`, `AgentOrb.tsx`.
- Acceptance: ⌘⇧C summons or pins/unpins the floating command bar (pick one, per PRD); ⌘⇧A opens / closes the AgentOrb popover. No `noop` callbacks left in QuietLayout.

**needs #122 — DocHead parity: tab-close affordance and decision on tab strip**
- One-liner: DocHead is read-only, but legacy users rely on middle-click-to-close, drag-to-reorder, and per-tab dirty dots. Decide whether to restore a compact tab strip or declare ⌘W + sidebar/TreeOverlay navigation as the parity surface, and update DocHead or add a thin strip accordingly.
- Complexity: M
- Files touched: `src/components/editor/DocHead.tsx`, possibly new `src/components/editor/QuietTabStrip.tsx`.
- Acceptance: PRD decision documented in the keyboard-shortcuts / design-system doc; whatever path is chosen has parity with legacy close/reorder.

**needs #123 — ⌘⇧L toggles Quiet sidebar visibility**
- One-liner: `QuietSidebar` ignores `sidebarPinned`; the chord fires but the UI doesn't react. Add a `hidden`/`collapsed` render branch (or forward the setting to a CSS variable) and honor it in `QuietLayout`'s grid-template-columns.
- Complexity: S
- Files touched: `src/components/QuietLayout.tsx`, `src/components/sidebar/quiet/QuietSidebar.tsx`.
- Acceptance: ⌘⇧L in Quiet Composer hides / shows the sidebar column.

**needs #124 — TitleBar buttons in Quiet Composer**
- One-liner: The MessageSquare and Bot icon buttons render but are wired to `noop`. Either remove them from QuietLayout (render a no-button TitleBar variant) or rewire to the Quiet Composer equivalents (summon command bar, open orb popover).
- Complexity: S
- Files touched: `src/components/QuietLayout.tsx`, `src/components/TitleBar.tsx` (add a variant prop or two renders).
- Acceptance: No dead buttons visible in Quiet Composer TitleBar.

**needs #125 — CommandBarContext feature parity with ChatFooter**
- One-liner: `CommandBarContext` is missing AcpConfigOptionPicker (thinking effort / model), the goals indicator, and `showAgentModePicker` gating. Pull the three missing pieces across from `ChatFooter.tsx` + `AcpSessionControls.tsx`.
- Complexity: M
- Files touched: `src/components/cmd/CommandBarContext.tsx`, minor refactor in `AcpSessionControls.tsx` to expose sub-pickers.
- Acceptance: Thinking effort, model, goals, and agent-mode-picker settings behave identically to the classic footer.

**needs #126 — FloatingCommandBar ChatInput parity**
- One-liner: Replace the raw `<input type="text">` inside `FloatingCommandBar.tsx` with `ChatInput` (or port the relevant features): image paste/drag/file-picker, attachment thumbnails, vision capability gating, Stop button, `/skill-name` body expansion, `@agent-name` intercept, sandbox-scope computation for comment convs, explicit-attach offer, attached-files context chips.
- Complexity: L
- Files touched: `src/components/cmd/FloatingCommandBar.tsx`, possibly `src/components/chat/ChatInput.tsx` (minor generalization), `src/components/cmd/AttachmentChips.tsx` (unify image + reference chips).
- Acceptance: A Quiet Composer user can paste an image, attach a file by drop, stop a running generation, send `/skill-name some task` with skill expansion, send `@agent-name` with the same behavior as the classic footer.

**needs #127 — CommandBarStream per-message parity**
- One-liner: `CommandBarStream` does not pass `onEdit`/`onResend`/`onBranch`/`onRetry`/`branchCount` to `<ChatMessage>`, doesn't render `<QuickReplies>`, `<ContextDivider>`, the branch-point separator, the empty-state onboarding + `<LocalAISetupCard>`, the edit-mode banner, or the `<ResendProviderDialog>` flow. Port the surrounding `ChatMessageList.tsx` glue, including the `useRef`/autoscroll + edit/resend/branch state.
- Complexity: L
- Files touched: `src/components/cmd/CommandBarStream.tsx`, `src/components/cmd/FloatingCommandBar.tsx` (wire edit-context + resend-dialog state), possibly a new `src/components/cmd/CommandBarMessageActions.tsx`.
- Acceptance: Every per-message control, divider, quick-reply, empty-state affordance, and edit/resend dialog works identically in both shells.

**needs #128 — SidebarContextMenu parity with FileTreeItem**
- One-liner: Add "New File", "New Folder", "Make / Open as Project", "Move to…" (fully wired, not disabled), "Add to chat" (image files), "Export as…" sub-menu, and "Commit…" to `SidebarContextMenu.tsx`. Wire drag-to-chat for Quiet sidebar rows.
- Complexity: M
- Files touched: `src/components/sidebar/quiet/SidebarContextMenu.tsx`, `src/components/sidebar/quiet/file-drag.ts`, new dialog plumbing for NewFolder equivalent.
- Acceptance: Every context-menu action available in legacy `FileTreeItem.tsx` is present in `SidebarContextMenu.tsx`, and drag-from-sidebar-to-chat works for image files.

**needs #129 — Quiet sidebar visual state parity**
- One-liner: Surface git status indicators, external-change indicators, and AI-lock padlock overlays in `ProjectsSection`, `PinnedSection`, `RecentSection`, `FolderPeek`, and `TreeOverlay`. Shared rendering logic already exists in `useFileTreeItemState` — reuse it.
- Complexity: M
- Files touched: `src/components/sidebar/quiet/ProjectsSection.tsx`, `PinnedSection.tsx`, `RecentSection.tsx`, `FolderPeek.tsx`, `TreeOverlay.tsx`.
- Acceptance: A file modified externally, dirty under git, or owned by an AI-locked project shows the same visual cues as in the legacy FileTree.

**needs #130 — CommandBarStream chat-card + banner parity**
- One-liner: Render `PermissionCard`, `DomainApprovalCard` (plus the `network-domain-request` listener), `ToolCallPermissionCard`, `AgentStatusBanner`, and the "AI is thinking…" / `activeTool` loading indicators inside `CommandBarStream`. Wire `AgentOrb`'s popover to pass `onCancelTask` + `onClickTask` through to `AgentPanel`.
- Complexity: M
- Files touched: `src/components/cmd/CommandBarStream.tsx`, `src/components/activity/AgentOrb.tsx`, `src/components/activity/AgentPanel.tsx`.
- Acceptance: All the permission / approval / banner / loading surfaces that appear in classic chat also appear in the Quiet Composer stream; Orb-panel cancel + click-to-navigate work.
