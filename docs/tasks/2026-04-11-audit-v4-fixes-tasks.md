# Audit v4 Fixes — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-11 |
| **Status** | Not started |
| **PRD** | — (audit-driven fixes) |
| **Audit** | [2026-04-11-full](../audit/2026-04-11-full.md) |
| **Total** | 28 tasks: 14S, 10M, 4L |
| **Suggested order** | Bug fixes (#1-#8) → Performance (#9-#14) → Accessibility (#15-#18) → Decomposition (#19-#24) → Error UX (#25-#27) → Documentation (#28) |

**Scope:** All HIGH findings and selected MEDIUM findings from the 2026-04-11 audit. LOW findings and large decomposition tasks (pptx-parser, export converters) are deferred as they are refactoring work without user-facing impact.

**Risks:**

- Render performance changes (#9-#14) affect hot paths — test thoroughly for regressions
- Async flow fixes (#3-#8) are subtle — verify with concurrent usage scenarios
- Large file decomposition (#19-#24) has high blast radius — split into separate PRs

---

## Bug Fixes — Memory Leaks & Async Flows

### #1 — Fix useLocalAI listener cleanup race condition ✅

**Description:** Replace the async cleanup pattern in useLocalAI with the mounted-flag pattern used in useSandboxViolations. Currently `return () => { unlisten.then((fn) => fn()); }` can leak if unmount happens before the Promise resolves.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/hooks/useLocalAI.ts`

---

### #2 — Fix useAcpLifecycle cancel escalation cleanup on unmount ✅

**Description:** Add a useEffect that cleans up pending escalation timers and listeners when the component unmounts. Currently, if a user cancels and unmounts before the 5-second timeout, the listener stays active.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/hooks/useAcpLifecycle.ts`

---

### #3 — Fix useCopilotChat conversationIdRef "pending" sentinel race ✅

**Description:** Add a cleanup effect that resets `conversationIdRef` to null on unmount. Add a check that prevents `sendChatMessage` from proceeding while ref is "pending" (await or reject).

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/hooks/useCopilotChat.ts`

---

### #4 — Add completion-fired flag to prevent double onComplete in ACP tasks ✅

**Description:** In useAgentTaskOperations, both the `acp-session-update` listener (`agent_turn_complete`) and the `acpSessionPrompt` promise can fire `onComplete`. Add `let completionFired = false` to ensure only one path executes.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/hooks/useAgentTaskOperations.ts`

---

### #5 — Guard post-completion callbacks with tasksMap.has() check ✅

**Description:** In useAgentTaskOperations, guard all `onComplete()` and `onError()` callback invocations with `if (tasksMap.has(taskId))` to prevent post-unmount state updates on orphaned tasks.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/hooks/useAgentTaskOperations.ts`

---

### #6 — Clear pending permission requests on ACP connection error ✅

**Description:** In useAcpLifecycle, add `usePermissionStore.getState().clearRequestsForInstance(instanceId)` in the final catch block when retry fails, so stale permission cards don't remain for dead agents.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/hooks/useAcpLifecycle.ts`

---

### #7 — Add conversation ID filter to useCopilotChat generateText ✅

**Description:** The `generateText` callback registers listeners without conversationId filtering (unlike `sendChatMessage` which has `isOurEvent()`). Add the same filter to prevent chunk mixing on concurrent calls.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/hooks/useCopilotChat.ts`

---

### #8 — Fix ACP lock scope — clone sender before .await ✅

**Description:** In acp.rs, multiple commands hold the `state.agents` mutex lock while calling `handle.cmd_tx.send().await`. Clone the sender and release the lock before the async send to reduce contention.

**Complexity:** M\
**Category:** backend\
**Dependencies:** None\
**Files:** `src-tauri/src/commands/acp.rs`

---

## Performance — Zustand Selector Fixes & Memoization

### #9 — Convert Editor.tsx useEditorStore to individual selectors ✅

**Description:** Replace `const { tabs, activeTabId, updateTabContent, ... } = useEditorStore()` (8 fields) with individual selectors: `const tabs = useEditorStore((s) => s.tabs)`. This prevents the editor from re-rendering on unrelated store changes.

**Complexity:** M\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/editor/Editor.tsx`

---

### #10 — Convert Editor.tsx useSettingsStore to individual selectors ✅

**Description:** Replace `const { showFloatingToolbar, toolbarVisible, contentWidth, ... } = useSettingsStore()` (12 fields) with individual selectors. Any settings change currently triggers a full editor re-render.

**Complexity:** M\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/editor/Editor.tsx`

---

### #11 — Convert ChatMessage useChatStore to individual selectors ✅

**Description:** Replace `const { isLoading, deleteMessage } = useChatStore()` with selectors. ChatMessage renders in a list — when isLoading toggles, ALL messages currently re-render.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/chat/ChatMessage.tsx`

---

### #12 — Wrap ChatMessage with React.memo() ✅

**Description:** ChatMessage is rendered in a list but not memoized. Wrap the export with `memo()`. Ensure props are stable (fix inline callbacks in ChatMessageList first).

**Complexity:** S\
**Category:** frontend\
**Dependencies:** #11, #13\
**Files:** `src/components/chat/ChatMessage.tsx`

---

### #13 — Replace inline callbacks in ChatMessageList map with useCallback ✅

**Description:** In `messages.map()`, inline arrow functions for onResend, onEdit, onRetry, onBranch are recreated every render. Extract to useCallback-wrapped handlers or move outside the map.

**Complexity:** M\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/chat/ChatMessageList.tsx`

---

### #14 — Convert TabBar useEditorStore to individual selectors ✅

**Description:** Replace `const { tabs, activeTabId, setActiveTab, closeTab, reorderTab, pendingCloseTabId, setPendingCloseTabId } = useEditorStore()` (7 fields) with selectors. TabBar is always-visible and re-renders on any editor state change.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/tabs/TabBar.tsx`

---

## Accessibility

### #15 — Fix FindBar disabled button contrast ✅

**Description:** Three disabled buttons (Previous, Next, Replace) use `disabled:opacity-50` with `text-muted-foreground`, failing WCAG AA. Change to `disabled:opacity-70` or use a different approach that maintains 4.5:1 contrast.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/editor/FindBar.tsx`

---

### #16 — Fix SyncSettings checkbox contrast ✅

**Description:** Checkbox icon has `opacity-0 group-hover:opacity-40` when unselected. At 40% opacity, fails WCAG AA. Change to `group-hover:opacity-100` or use `text-foreground/50`.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/settings/SyncSettings.tsx`

---

### #17 — Add aria-label to FindBar icon-only buttons ✅

**Description:** Replace/toggle, Previous, Next, and Close buttons use `title` but no `aria-label`. Add aria-labels: "Toggle replace options", "Previous match", "Next match", "Close find bar".

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/editor/FindBar.tsx`

---

### #18 — Add aria-label to ChatInput icon-only buttons ✅

**Description:** Cancel edit, microphone, attach image, and send buttons use `title` instead of `aria-label`. Add proper aria-labels for screen reader support.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/chat/ChatInput.tsx`

---

## Large File Decomposition

### #19 — Decompose copilot_lsp.rs into sub-modules ✅

**Description:** Split the 2,218-line copilot_lsp.rs into: `copilot_protocol.rs` (JSON-RPC encoding, protocol constants), `copilot_signin.rs` (device code auth flow), `copilot_models.rs` (model parsing, fallback models). Keep main `copilot_lsp.rs` as orchestrator (\~1000 lines).

**Complexity:** L\
**Category:** backend\
**Dependencies:** None\
**Files:** `src-tauri/src/commands/copilot_lsp.rs` → split into 4 files

---

### #20 — Decompose pptx-parser.ts — extract color and XML utilities ✅

**Description:** Extract `pptx-colors.ts` (150 lines: color space conversions, hex/RGB/HSL manipulation) and `pptx-xml-utils.ts` (300 lines: DOM querying, namespace-aware element selection, attribute helpers) from the 3,270-line pptx-parser.ts. First step of a larger decomposition.

**Complexity:** L\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/lib/pptx-parser.ts` → extract to `src/lib/pptx-colors.ts`, `src/lib/pptx-xml-utils.ts`

---

### #21 — Decompose pptx-parser.ts — extract text and shape parsers ✅

**Description:** Extract `pptx-text-parser.ts` (500 lines: paragraph, run, bullet, text style parsing) and `pptx-shape-parser.ts` (350 lines: geometry, fill, stroke, shadow, arrow parsing). Second step.

**Complexity:** L\
**Category:** frontend\
**Dependencies:** #20\
**Files:** `src/lib/pptx-parser.ts` → extract to `src/lib/pptx-text-parser.ts`, `src/lib/pptx-shape-parser.ts`

---

### #22 — Decompose PptxSlideRenderer.tsx into sub-renderers ✅

**Description:** Extract `PptxTextRenderer.tsx` (250 lines), `PptxShapeRenderer.tsx` (250 lines), and `PptxTableRenderer.tsx` (150 lines) from the 1,274-line PptxSlideRenderer.tsx.

**Complexity:** L\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/editor/viewers/PptxSlideRenderer.tsx` → extract 3 components

---

### #23 — Extract AddCustomModelDialog from LocalAISettings ✅

**Description:** Move the \~300-line `AddCustomModelDialog` sub-component from LocalAISettings.tsx to its own file. Also extract ModelCard component (\~150 lines).

**Complexity:** M\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/settings/LocalAISettings.tsx` → `src/components/settings/AddCustomModelDialog.tsx`, `src/components/settings/ModelCard.tsx`

---

### #24 — Decompose skills.rs into sub-modules ✅

**Description:** Extract `skills_frontmatter.rs` (200 lines: YAML parsing, SkillFrontmatter struct) and `skills_tool_parser.rs` (300 lines: tool definition extraction, usage comment parsing, ArgMapping) from the 1,519-line skills.rs.

**Complexity:** M\
**Category:** backend\
**Dependencies:** None\
**Files:** `src-tauri/src/commands/skills.rs` → split into 3 files

---

## Error UX

### #25 — Show toast on action index incremental update failure

**Description:** In action-store.ts, when incremental action index fails after a successful file save, show a subtle warning toast instead of only logging to console. User should know their dashboard may be stale.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/stores/action-store.ts`

---

### #26 — Show error message in symbol search when fetch fails

**Description:** In SymbolSearchResults.tsx, when `fetchItems()` or `findOccurrences()` throws, show a message in the CommandGroup (e.g., "Error loading results") instead of silently logging.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/SymbolSearchResults.tsx`

---

### #27 — Log warnings for permission/domain approval failures

**Description:** In PermissionCard.tsx and ChatMessageList.tsx, replace `.catch(() => {})` with proper error logging and optional transient toast for critical failures (acp_permission_respond, network_domain_respond).

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:** `src/components/chat/PermissionCard.tsx`, `src/components/chat/ChatMessageList.tsx`

---

## Documentation

### #28 — Update architecture docs for missing modules and extensions

**Description:** Add 4 missing command modules to architecture.md structure tree (web_search.rs, link_preview.rs, sandbox.rs, constants.rs). Add 6 missing extensions to editor-architecture.md inventory (chart.ts, mermaid.ts, page-break-node.ts, table-column-types.ts, table-formatting.ts, typography-overrides.ts).

**Complexity:** M\
**Category:** frontend\
**Dependencies:** None\
**Files:** `docs/architecture.md`, `docs/features/editor-architecture.md`