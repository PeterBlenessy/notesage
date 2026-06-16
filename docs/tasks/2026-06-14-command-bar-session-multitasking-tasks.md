# Tasks: Command-Bar Session Lifecycle & Concurrent Multitasking

|  |  |
| --- | --- |
| **Date** | 2026-06-14 |
| **Status** | ✅ Complete — all 16 tasks done |
| **PRD** | [command-bar-session-multitasking](../prds/2026-06-14-command-bar-session-multitasking.md) |
| **Total** | 16 tasks: 1S, 11M, 4L |
| **Suggested order** | Foundation (#1) → Engine (#2–#5) → Permissions (#6–#7) → Settings (#8) → History UI (#9–#11) → Orb UI (#12–#14) → Notifications (#15) → Integration tests (#16) |

**Risks / open questions**
- **#2 + #4 are the high-blast-radius core** — they rewrite ACP agent ownership and lift streaming above the command bar. Land them behind the existing behavior (one foreground session) first, then add concurrency (#5). Keep the `taskAgent` path working throughout.
- **ACP under N concurrent processes/sandboxes** is unproven in this app (today max 2: `acpAgent` + `taskAgent`). Validate early in #2 with two real agents before building UI on top.
- **`local_bundled` serializes** — confirm the cap (#5) keeps the llama-server usable under concurrent sends; this is why the cap is load-bearing, not cosmetic.
- Each task carries its **own unit tests** (TDD per CLAUDE.md); **#16** is the cross-cutting integration pass. Run `pnpm typecheck` after any `.ts/.tsx` edit.
- Open product questions from the PRD (cap default 4, queue UX depth, explicit "send to orb", queued-in-orb) are deferred — do **not** expand scope to resolve them here.

---

## Foundation

### #1 — Session run-state model + manager store ✅
- **Description:** New non-persisted store holding `SessionRun` per conversation (`status: idle | queued | running | awaiting_permission | error`, `path`, `streamId?`, `instanceId?`, `startedAt`, `pendingPermissionId?`). On rehydrate/startup, any `running`/`queued` is reset to `error` (mirrors `activity-store`'s interrupted-task handling). Selectors: `getRun(conversationId)`, `runningSessions()`, `foregroundConversationId`. **Acceptance:** store + selectors unit-tested; interrupted→error verified.
- **Complexity:** M · **Category:** frontend · **Depends on:** —
- **Files:** `src/stores/session-run-store.ts` (new), `src/lib/ai/types.ts`

### #2 — ACP agent registry (singleton → per-conversation map) ✅
- **Description:** Convert the module-level `acpAgent` singleton to a `Map<conversationId, AcpAgentState>`. Make the in-flight spawn-promise guard, scope-respawn, and liveness check (`acp_agent_exists`) **per-key**. Thread `conversationId` through `ensureAcpAgent` and the `useAcpLifecycle` / `useAcpSessionListeners` call paths; route inbound `acp-session-update` events to the owning conversation by session id. Generalize the proven `taskAgent` pattern (`useAgentTaskOperations`) into the same registry. **Acceptance:** two distinct conversations each spawn and keep a distinct `instance_id` with no cross-wiring of session updates; existing single-session + comment-delegation behavior unchanged. **High blast radius.**
  - **Landed:** registry + per-key guard/respawn/liveness in `acp-agent-state.ts`; `conversationId` threaded through `useAcpLifecycle` and every consumer (`AcpSessionControls`, `ChatHistoryView`, `ChatMessageList`). Fixed a tool-call segment **cross-wiring bug** in `useAcpSessionListeners.ts` (it indexed segments against `activeConversationId` instead of the listener's own conversation). Folded the `taskAgent` singleton into the registry under a reserved `TASK_AGENT_KEY` with `role: 'task'` (added a `role` option to `ensureAcpAgent`); `useAgentTaskOperations` now reads its agent from the shared registry. Tests: registry `role`/`TASK_AGENT_KEY` coverage added; isolation fixes in `useAcpLifecycle.custom-agent.test.ts` (full registry reset) and `CommandBarContext.test.tsx` (mock `getAcpAgent`). Full suite green (5549).
- **Complexity:** L · **Category:** frontend · **Depends on:** #1
- **Files:** `src/lib/ai/acp-agent-state.ts`, `src/hooks/useAcpLifecycle.ts`, `src/hooks/useAcpSessionListeners.ts`, `src/hooks/useAgentTaskOperations.ts`

### #3 — Per-conversation direct-API stream tracking ✅
- **Description:** Track the in-flight `stream_id` per running conversation so multiple direct-API streams run independently, each writing to its own conversation's messages/segments. Cancel targets the right `stream_id`. **Acceptance:** two direct-API conversations stream concurrently without segment cross-contamination (extends the existing `stream_id` suffixed-event isolation).
- **Complexity:** M · **Category:** frontend · **Depends on:** #1
- **Files:** `src/hooks/useDirectApiChat.ts`, `src/hooks/useAIOperations.ts`
  - **Landed:** The root cause was deeper than stream-id tracking — every streaming-write store action funnelled through `updateActiveConv`, so a background stream wrote into whichever chat was foregrounded. Prior-art research (Zed/Claude Code/Codex/Cline) confirmed the fix: **address writes by conversation id; treat `activeConversationId` as a pure view selector.** Added `updateConv(state, convId, updater)` to `chat-store` and an optional trailing `convId` to the ~18 streaming-write actions (defaults to active → byte-identical for single-session). `useDirectApiChat` now tracks in-flight streams in a `Map<convId, {streamId, cleanup}>` (captured AFTER `addMessage`, which creates the conversation), threads `conversationId` to every write, fixes the two `activeConversationId` segment-index lookups, and `cancelDirectChat(convId?)` targets the right stream. **Bonus (closes the matching ACP gap from #2):** `useAcpSessionListeners` + `buildAcpChatCleanup` + the ACP error/retry writes in `useAcpLifecycle` all thread `conversationId` too. Tests: chat-store owner-aware routing + `useDirectApiChat` two-conversation concurrent-stream isolation. Full suite green (5553).
  - **Deferred to #4:** `setSegmentSessionId` (ACP session-setup write) still targets the active conversation; only reachable once #4 lifts ACP streaming out of the bar. `isLoading`/`activeTool` remain global (per-session status is the session-run-store's job in #4/#5).

### #4 — Always-mounted session manager (decouple streaming from the bar) ✅
- **Description:** Move session ownership (streaming listeners + run-state writes) out of `FloatingCommandBar`'s expanded subtree into an always-mounted `useSessionManager` hook mounted at the `App.tsx` root (per the "mount lifecycle hooks in App.tsx" rule). The command bar becomes a pure view that attaches to the foreground conversation. **Acceptance:** starting a send then collapsing/closing the bar (Esc, Settings, switch) leaves the run going; reopening shows it mid-stream with no lost output.
- **Complexity:** L · **Category:** frontend · **Depends on:** #1, #2, #3 · **High blast radius.**
- **Files:** `src/hooks/useSessionManager.ts` (new), `src/App.tsx`, `src/components/cmd/FloatingCommandBar.tsx`, `src/hooks/useAIOperations.ts`
  - **Reframed (codebase reality):** `FloatingCommandBar` is **already always-mounted** in `QuietLayout` (only its expanded *input subtree* unmounts on collapse), and after #2 the ACP agents live in a module-level registry — so the streaming listeners already survive collapse / Settings / switch. The literal "relocate the listeners" move was therefore unnecessary; operator confirmed skipping it. The real gap was that `session-run-store` (#1) was written by nobody and `isLoading`/`activeTool` were single globals (switching to an idle chat while another streamed wrongly showed "loading").
  - **Landed:** New `src/lib/ai/session-run.ts` transition helpers (`runStarted`/`runRunning`/`runAwaitingPermission`/`runAttachInstance`/`runIdle`/`runError`) wired into ALL four send paths — `useDirectApiChat`, `useAcpLifecycle` (+ `useAcpSessionListeners` cleanup/permission), and `useCopilotChat` — keyed by conversation id, with the run marked active *before* the ACP spawn await so the bar shows "working" during a cold spawn. New always-mounted `useSessionManager()` (`App.tsx`) mirrors `activeConversationId → setForeground` and prunes runs for deleted conversations (gated on a conversation-count decrease, not per-chunk). New `useForegroundLoading()` hook replaces the global `isLoading` in `FloatingCommandBar`, `ChatMessageList`, and `ChatMessage` so loading reflects the **watched** conversation. Tests: `useSessionManager` (foreground sync + orphan prune + `useForegroundLoading` foreground/background), `useDirectApiChat` run-state transitions (running→idle, error). Full suite green (5559); perf green.
  - **Deferred:** `setSegmentSessionId` (ACP session-setup) still writes to the active conversation (from #3) — only matters once true concurrent ACP sends land (#5+; ACP still has a single foreground `cleanupRef`). Copilot streaming writes remain active-conversation-scoped (Copilot was never threaded in #3); only its run-state is per-conversation here.

### #5 — Concurrency cap + queue ✅
- **Description:** Session manager enforces `≤ maxConcurrentSessions` (default 4) live runs; a send beyond the cap enters `queued` and auto-starts when a slot frees (FIFO). **Acceptance:** (cap+1)th send queues and starts on the next completion; verified for both paths.
- **Complexity:** M · **Category:** frontend · **Depends on:** #4, #8
- **Files:** `src/hooks/useSessionManager.ts`, `src/stores/session-run-store.ts`
  - **Landed:** Cap enforced at a **single chokepoint** — `useAIOperations.sendChatMessage` (path-agnostic, so "both paths" covered uniformly) — rather than per-path before each streaming invoke. The per-path "defer the invoke" approach would have duplicated each path's error/cleanup handling across three async functions; the chokepoint is far safer for the same acceptance. Queue primitives live in `src/lib/ai/session-run.ts` (module-level FIFO of start-thunks + `hasSessionCapacity` / `enqueueSend` / `processSendQueue` / `dropQueuedSend`); `session-run-store`'s `queued` status is what UI badges read. `useSessionManager` subscribes to run-state and drains FIFO when a slot frees (re-entrancy-guarded). `cancelChat` drops a still-queued send; the orphan-prune drops a parked send for a deleted conversation. Tests: queue primitives (FIFO, cap, supersede, drop), the `useAIOperations` gate (queues at cap / sends under cap), and `useSessionManager` auto-drain on completion. Full suite green (5576).
  - **One tradeoff (deferred UX):** when a queued send starts after a slot frees, the thunk sets its conversation active and routes — so if you'd navigated to a *different* conversation while it was queued, the view follows the session that just started. In the common rapid-fire case (you stay on the conversation you queued) there's no jump. Showing the queued message before it starts, and "queued in the orb," are explicitly deferred per the PRD's open-questions note.

### #8 — Settings: maxConcurrentSessions + notifyPermissionRequest ✅
- **Description:** Add `maxConcurrentSessions` (clamp 3–5, default 4) and `notifyPermissionRequest` (bool) to `settings-store`; surface in the Settings v2 AI/Advanced panel. **Acceptance:** persisted, clamped, consumed by #5 and #15.
- **Complexity:** M · **Category:** frontend · **Depends on:** —
- **Files:** `src/stores/settings-store.ts`, `src/components/settings/v2/` (AI/Advanced panel)
  - **Landed:** Both settings added with setters (`setMaxConcurrentSessions` clamps `[3,5]` + rounds; `setNotifyPermissionRequest`), defaults (4 / true), persist version bumped 22→23 with a defensive migration. Surfaced in `AISettings` as a new "Sessions" group — a 3–5 Slider for the cap + a Switch for background-permission notifications. `maxConcurrentSessions` is consumed by #5; `notifyPermissionRequest` awaits #15. Tests: clamp/default/round + toggle, plus the AISettings render (ResizeObserver polyfill added for the Slider).

## Permissions

### #6 — Permission request ownership (conversationId) ✅
- **Description:** Add `conversationId` (+ a `foreground` flag) to every pending permission request in `permission-store` (ACP) and `tool-permission-store` (direct-API); populate it where requests are created. Selector: `pendingForConversation(id)`. **Acceptance:** a request is attributable to its session; foreground flag reflects whether that session is currently watched.
- **Complexity:** M · **Category:** frontend · **Depends on:** #1
- **Files:** `src/stores/permission-store.ts`, `src/stores/tool-permission-store.ts`, `src/hooks/useAcpSessionListeners.ts`, `src/hooks/useDirectApiChat.ts`
  - **Landed:** `conversationId?: string | null` added to `PermissionRequest` (ACP) and `PendingToolPermission` (direct-API); populated at creation (`useAcpSessionListeners` addRequest with `cid`, `useDirectApiChat` setPending with `conversationId`). Selector `pendingForConversation(state, id)` in `permission-store`. The "foreground flag" is **derived, not stored** (`useIsRequestForeground(conversationId)` compares against `session-run-store.foregroundConversationId`) so it never goes stale. Legacy requests (no `conversationId`) are treated as foreground. Tests: selector filtering + attribution.

### #7 — Foreground-aware permission auto-deny timeout ✅
- **Description:** Rework the 30s auto-deny: a request from a **non-foreground** session gets a long/no auto-deny (the notification is the time-sensitive signal); foreground requests keep today's timeout. **Acceptance:** backgrounded request does not auto-deny on the old timer; foreground behavior unchanged.
- **Complexity:** M · **Category:** frontend · **Depends on:** #6
- **Files:** `src/stores/permission-store.ts`, `src/stores/tool-permission-store.ts`, `src/components/chat/PermissionCard.tsx`, `src/components/chat/ToolCallPermissionCard.tsx`
  - **Landed:** Only `ToolCallPermissionCard` (direct-API) actually has a 30s auto-deny — the ACP `PermissionCard` has **no** auto-deny timer (confirmed by its own comment; ACP relies on the unresponsive flow). So the rework is in `ToolCallPermissionCard`: its countdown effect now gates on `useIsRequestForeground(request.conversationId)` — it only ticks while the request's session is watched, and freezes (no auto-deny) while backgrounded; switching to that session restarts the 30s. Foreground/legacy behavior unchanged. Tests: auto-denies foreground, does NOT background, legacy (null conv) = foreground.
  - **Out of scope:** `DomainApprovalCard` (network domain approvals) also has a 30s timer but is a separate per-instance flow not in the task's file list and carries no `conversationId` — left as-is.

### #7 — Foreground-aware permission auto-deny timeout
- **Description:** Rework the 30s auto-deny: a request from a **non-foreground** session gets a long/no auto-deny (the notification is the time-sensitive signal); foreground requests keep today's timeout. **Acceptance:** backgrounded request does not auto-deny on the old timer; foreground behavior unchanged.
- **Complexity:** M · **Category:** frontend · **Depends on:** #6
- **Files:** `src/stores/permission-store.ts`, `src/stores/tool-permission-store.ts`, `src/components/chat/PermissionCard.tsx`, `src/components/chat/ToolCallPermissionCard.tsx`

## Settings

### #8 — Settings: maxConcurrentSessions + notifyPermissionRequest
- **Description:** Add `maxConcurrentSessions` (clamp 3–5, default 4) and `notifyPermissionRequest` (bool) to `settings-store`; surface in the Settings v2 AI/Advanced panel. **Acceptance:** persisted, clamped, consumed by #5 and #15.
- **Complexity:** M · **Category:** frontend · **Depends on:** —
- **Files:** `src/stores/settings-store.ts`, `src/components/settings/v2/` (AI/Advanced panel)

## History UI

### #9 — History row status badges ✅
- **Description:** Each `CommandBarHistory` / `ChatHistoryView` row shows a leading status indicator derived from `session-run-store`: ● running (subtle pulse), ⏸ awaiting-permission (accent), ⧗ queued, ⚠ error, idle (none). Neutral/accent tokens only; reduced-motion safe. **Acceptance:** badges reflect live run state; update as state changes.
- **Complexity:** M · **Category:** frontend · **Depends on:** #1, #4
- **Files:** `src/components/cmd/CommandBarHistory.tsx`, `src/components/chat/ChatHistoryView.tsx`
  - **Landed:** New `SessionStatusBadge` (running = neutral dot with CSS `session-status-pulse`, stripped under `useReducedMotion` + a `prefers-reduced-motion` media query; awaiting = accent Pause; queued = muted Hourglass; error = destructive AlertTriangle; idle/none → null). Shared `HistoryRowLeadingIcon` swaps the default `MessageSquare` glyph for the badge when a conversation has a live run; used by both `CommandBarHistory` and `ChatHistoryView`. Badges are live (subscribe to `session-run-store`). Tests: per-status render + leading-icon swap.

### #10 — History inline permission card ✅
- **Description:** An awaiting-permission history row **expands in place** to show the request — tool label (`formatToolLabel`) + `Diff`/`Content` preview (`normalizeToolCallContent`) — with tiered Allow / Deny (allow-once/session/always). Resolves without opening the full session. Reuse the visual language of `PermissionCard` / `ToolCallPermissionCard`. **Acceptance:** approving/denying inline resolves the request for both ACP and direct-API tool calls.
- **Complexity:** L · **Category:** frontend · **Depends on:** #6, #9
- **Files:** `src/components/cmd/CommandBarHistory.tsx`, `src/components/chat/PermissionCard.tsx` / `ToolCallPermissionCard.tsx` (extract shared inline form)
  - **Landed:** Extracted the resolution logic into `src/lib/ai/permission-resolve.ts` (`resolveAcpPermission` — allow/session/always/deny, mirroring `PermissionCard`; `resolveDirectPermission` — forwards the tier to the pending `resolve`) and **refactored `PermissionCard` to use it**, so the two surfaces can't drift. New shared `TieredApprovalButtons` (Allow split-dropdown + Deny). New `InlineHistoryPermission` reads the conversation's pending request (ACP via `permission-store`, direct via `tool-permission-store` matched by `conversationId` from #6) and expands in place under the history row, resolving via the shared helpers. Wired into `CommandBarHistory` rows (each row wrapped so the inline card mounts below the clickable button; renders null when no pending request). Tests: helper resolution (allow/deny/session for ACP, tier forward for direct) + the inline card (renders/none, Allow resolves direct, Deny resolves ACP, ignores other conversations).
  - **Note:** the request only carries `toolInput` (a string), so the preview is the tool label + truncated args — the richer `Diff`/`Content` (`normalizeToolCallContent`) lives on `tool_call_update` events, not the permission request, so it's the same preview `PermissionCard` shows. `ToolCallPermissionCard`'s own button JSX was left as-is (its `resolved`-state/countdown dance is bespoke); the shared form is used by the inline card + `TieredApprovalButtons`.

### #11 — History row → foreground session (the switcher) ✅
- **Description:** Clicking a history row attaches the command bar to that session **live** (mid-stream if running) and sets it as the foreground conversation. **Acceptance:** clicking a running row shows its live stream; the previously-foreground running session moves to the orb set.
- **Complexity:** M · **Category:** frontend · **Depends on:** #4, #9
- **Files:** `src/components/cmd/FloatingCommandBar.tsx`, `src/components/cmd/CommandBarHistory.tsx`, `src/hooks/useSessionManager.ts`
  - **Satisfied by composition — no new code.** `FloatingCommandBar.handleSelectConversation` already calls `setActiveConversation(id)` + switches to chat view; #4 mirrors `activeConversationId → setForeground`; #3/#4 made streaming writes conversation-keyed, so the chat view renders the now-foreground conversation's **live** in-progress message, and the previously-foreground running session drops into `selectUnwatchedRunning` (the orb set, #12) automatically. Locked with a `useSessionManager` test (switching active conversation flips foreground and moves the prior running session into the unwatched set).

## Orb UI

### #12 — Orb "running and unwatched" set ✅
- **Description:** Derive the orb's set as running sessions whose `conversationId ≠ foregroundConversationId`; the orb counts them. Switching/closing the bar auto-adds the left session; selecting it removes it. **Acceptance:** with N running and 1 foregrounded, the orb shows N−1.
- **Complexity:** M · **Category:** frontend · **Depends on:** #4
- **Files:** `src/components/activity/AgentOrb.tsx`, `src/stores/session-run-store.ts` (selector)
  - **Landed:** `selectUnwatchedRunning(state)` already existed (running/awaiting sessions whose `conversationId ≠ foregroundConversationId`). `AgentOrb` now counts unwatched chat sessions alongside background agent tasks via scalar selectors (`.length` / `.some()` — primitive returns avoid array-identity re-render churn); the badge/active state is the union. Switching/closing the bar moves a session in/out of the set automatically (the foreground mirror from #4). Test: badge = tasks + unwatched (foreground excluded).

### #13 — Orb distinct pulse for needs-permission ✅
- **Description:** A distinct pulse/badge when ≥1 unwatched session awaits permission (vs merely running). CSS-only keyframe; `useReducedMotion` + `prefers-reduced-motion` guard. **Acceptance:** visual distinction between "running" and "needs you"; static under reduced motion.
- **Complexity:** S · **Category:** frontend · **Depends on:** #6, #12
- **Files:** `src/components/activity/AgentOrb.tsx`, `src/styles/globals.css`
  - **Landed:** Distinct `orb-pulsing-attention` keyframe (faster, more insistent accent ring) in `globals.css`, applied when an unwatched session is `awaiting_permission` (takes precedence over the ambient `orb-pulsing`). CSS-only; stripped under `useReducedMotion` + a `prefers-reduced-motion` media query. `data-needs-attention` + a "needs your approval" aria-label surface it. Tests: needs-you class present, reduced-motion strips it.

### #14 — AgentPanel: list unwatched sessions, click to foreground ✅
- **Description:** `AgentPanel` lists the unwatched running sessions (label, provider, status; needs-you first). Clicking one brings it into the bar (and removes it from the orb via #12). **Acceptance:** panel reflects the orb set; click foregrounds the session.
- **Complexity:** M · **Category:** frontend · **Depends on:** #11, #12
- **Files:** `src/components/activity/AgentPanel.tsx`
  - **Landed:** `AgentPanel` renders a **Sessions** section above the task list — the unwatched running/awaiting sessions (conversation title + status; **needs-you sorted first**), derived via `useMemo` over the raw store slices (NOT `useSessionRunStore(selectUnwatchedRunning)` directly, which returns a fresh array each render → infinite re-render). Clicking a row calls `onSelectSession`, which `AgentOrb` wires to `setActiveConversation` + close-popover — #4's foreground mirror then drops it out of the orb set. Empty state now keys on tasks AND sessions both empty. Tests: lists N−1 (foreground excluded, needs-you first), click foregrounds.

## Notifications

### #15 — Notifications for backgrounded permission/completion ✅
- **Description:** When a **backgrounded** session hits a permission request, or completes, fire a desktop notification (`tauri-plugin-notification`, gated on `notifyAgentCompletion` for completion / `notifyPermissionRequest` for permission) **plus** the orb badge/pulse. Clicking the notification focuses the window and foregrounds that session. **Acceptance:** backgrounded permission/completion notifies; foreground does not double-notify; click selects the session.
- **Complexity:** M · **Category:** frontend · **Depends on:** #6, #8, #12
- **Files:** `src/hooks/useSessionManager.ts`, `src/lib/notifications.ts`
  - **Landed:** `notifyBackgroundSession(kind, title, body, conversationId)` in `notifications.ts` — gated on `notifyPermissionRequest` / `notifyAgentCompletion`, sends with `extra: { conversationId }`. `useSessionManager` adds a run-state diff subscription (`subscribe` gives prev+next): a non-foreground session that **becomes** `awaiting_permission` notifies (permission); one that goes active→terminal (idle/cleared/error) notifies (completion). The foreground session never notifies (no double-notify — its card/stream is visible). A second effect registers the plugin's `onAction` handler → reads `extra.conversationId` → `setActiveConversation` + `getCurrentWindow().setFocus()` (defensive; plugin/window may be absent in tests). The orb badge/pulse part is already done by #12/#13. Tests: background permission/completion notify, foreground doesn't, queued→running doesn't.

## Integration tests

### #16 — Cross-cutting integration tests ✅
- **Description:** Beyond each task's unit tests, add integration coverage for: session-survives-close (#4), concurrency + queue auto-start (#5), ACP registry isolation / no cross-wiring (#2), concurrent direct-API streams (#3), permission routing + foreground-aware timeout (#6/#7), orb running-and-unwatched set (#12), and inline history approval (#10). **Acceptance:** full `pnpm test` + `pnpm test:e2e` green; no coverage regression on changed files; `pnpm test:perf` within budget.
- **Complexity:** L · **Category:** frontend · **Depends on:** all
- **Files:** `src/**/__tests__/`, `e2e/tests/`
  - **Landed:** Each scenario carries its own focused unit/integration test (added per task above). Added `src/hooks/__tests__/session-multitasking.integration.test.ts` — a single cross-cutting flow through the always-mounted `useSessionManager` + `session-run-store` + queue primitives that asserts the engine pieces **compose**: two concurrent runs (#3) → orb unwatched set excludes the foreground (#12) → a 3rd send queues at the cap (#5) → background permission notifies + the foreground does not (#15) → a completion frees a slot and auto-starts the queued send (#5) → switching foreground moves a session in/out of the orb set (#11). **Gates (all green):** `pnpm typecheck`; `pnpm test` 5610; `pnpm test:perf` 45 at the CI `PERF_BUDGET_MULTIPLIER=1.5`; `pnpm coverage:check` 0 regressions; `pnpm test:e2e` 160 (Playwright).

## Post-review hardening (high-effort code review)

After the feature landed it was run through a high-effort code review; the
findings were fixed in four commits on `feat/cmd-bar-session-multitasking`.
Concurrency findings here matter because the feature's whole point is concurrent
sessions — several issues that read as "edge cases" are reachable in normal
single-session use too (#1, #2).

- **#1 phantom `running` (`108fa336`):** the ACP send captured `conversationId`
  *before* `addMessage`, which creates+activates the conversation for a brand-new
  chat — so a first send stranded its run as `running` on a `null` id (the
  listener/cleanup `runIdle` no-ops on null). Capture moved after `addMessage`;
  redundant `runConvId` dropped.
- **#2 Copilot cross-contamination (`108fa336`):** `useCopilotChat` threaded the
  owning `conversationId` through every `handleToolCall` + stream write and the
  segment-index lookups, so a mid-stream view switch can't land segments on the
  wrong conversation.
- **#5 spawn-race + workspace-change (`108fa336`):** `ensureAcpAgent` retry now
  forwards `role`; the workspace-change respawn decides turn-active from
  per-conversation run-state (`getAllAcpAgentEntries()`) instead of the global
  `isLoading`.
- **#4 per-conversation tool-permission map (`505bb626`):** `tool-permission-store`'s
  single `pending` slot became a `Record<conversationId, …>` — two concurrent
  direct-API/Copilot turns each await their own decision; the second no longer
  clobbers (and strands) the first.
- **#6/#7/#8/#9 dedup (`505bb626`):** `ToolCallPermissionCard` resolves through the
  shared `resolveDirectPermission` + `TieredApprovalButtons`; one
  `selectConversationTitle` / `DEFAULT_CONVERSATION_TITLE` (fixes `'Chat'` vs
  `'New Chat'`); one `formatToolArgsPreview`.
- **#3 per-conversation ACP cleanup (`b3cfc910`):** the single `cleanupRef`
  (which let one conversation's send overwrite another's cleanup — leaking the
  first's listeners and running the wrong cleanup on completion) became a
  per-conversation map keyed to the agent registry; adds an unmount teardown.
- **#13 targeted cancel (`b3cfc910`):** `acpCancelChat(targetConversationId?)`
  cancels a specific conversation and clears its run even in the cold-spawn window.
- **perf (`a76b15c3`):** single-pass `selectUnwatchedRunning` in `AgentOrb`; one
  per-row store subscription in `HistoryRowLeadingIcon`; `useForegroundLoading`
  reuses `isActiveStatus`.

**#12 (single run-state owner):** already satisfied — `src/lib/ai/session-run.ts`
is the single owner of transition logic; call sites legitimately signal their
own conversation's transitions.

**`isLoading` vestigial:** confirmed no UI reads `chat-store.isLoading` (all use
`useForegroundLoading`); left as a harmless dead write — removing it touches ~28
files for zero behavioral change, deliberately not bundled here.

**#11 queue-drain view-yank — DEFERRED → issue #468.** When the queue drains, the
start-thunk calls `setActiveConversation(targetConv)`, yanking the view to the
dequeued conversation. That activation is load-bearing (the send pipeline reads
the *active* conversation for project paths / sandbox scope / system prompt /
`addMessage`), so the proper fix is decoupling the pipeline from active-conversation
— a sizeable, higher-risk refactor tracked separately. Trigger is rare (4+
concurrent live sessions) and there's no data-correctness impact.

**Gates after hardening (all green):** `pnpm typecheck`; `pnpm test` 5619 (334
files); `pnpm test:perf` cmd-bar within budget at `PERF_BUDGET_MULTIPLIER=1.5`.
