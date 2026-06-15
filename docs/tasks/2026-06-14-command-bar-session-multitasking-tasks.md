# Tasks: Command-Bar Session Lifecycle & Concurrent Multitasking

|  |  |
| --- | --- |
| **Date** | 2026-06-14 |
| **Status** | In progress (#1, #2, #3, #4 done) |
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

### #5 — Concurrency cap + queue
- **Description:** Session manager enforces `≤ maxConcurrentSessions` (default 4) live runs; a send beyond the cap enters `queued` and auto-starts when a slot frees (FIFO). **Acceptance:** (cap+1)th send queues and starts on the next completion; verified for both paths.
- **Complexity:** M · **Category:** frontend · **Depends on:** #4, #8
- **Files:** `src/hooks/useSessionManager.ts`, `src/stores/session-run-store.ts`

## Permissions

### #6 — Permission request ownership (conversationId)
- **Description:** Add `conversationId` (+ a `foreground` flag) to every pending permission request in `permission-store` (ACP) and `tool-permission-store` (direct-API); populate it where requests are created. Selector: `pendingForConversation(id)`. **Acceptance:** a request is attributable to its session; foreground flag reflects whether that session is currently watched.
- **Complexity:** M · **Category:** frontend · **Depends on:** #1
- **Files:** `src/stores/permission-store.ts`, `src/stores/tool-permission-store.ts`, `src/hooks/useAcpSessionListeners.ts`, `src/hooks/useDirectApiChat.ts`

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

### #9 — History row status badges
- **Description:** Each `CommandBarHistory` / `ChatHistoryView` row shows a leading status indicator derived from `session-run-store`: ● running (subtle pulse), ⏸ awaiting-permission (accent), ⧗ queued, ⚠ error, idle (none). Neutral/accent tokens only; reduced-motion safe. **Acceptance:** badges reflect live run state; update as state changes.
- **Complexity:** M · **Category:** frontend · **Depends on:** #1, #4
- **Files:** `src/components/cmd/CommandBarHistory.tsx`, `src/components/chat/ChatHistoryView.tsx`

### #10 — History inline permission card
- **Description:** An awaiting-permission history row **expands in place** to show the request — tool label (`formatToolLabel`) + `Diff`/`Content` preview (`normalizeToolCallContent`) — with tiered Allow / Deny (allow-once/session/always). Resolves without opening the full session. Reuse the visual language of `PermissionCard` / `ToolCallPermissionCard`. **Acceptance:** approving/denying inline resolves the request for both ACP and direct-API tool calls.
- **Complexity:** L · **Category:** frontend · **Depends on:** #6, #9
- **Files:** `src/components/cmd/CommandBarHistory.tsx`, `src/components/chat/PermissionCard.tsx` / `ToolCallPermissionCard.tsx` (extract shared inline form)

### #11 — History row → foreground session (the switcher)
- **Description:** Clicking a history row attaches the command bar to that session **live** (mid-stream if running) and sets it as the foreground conversation. **Acceptance:** clicking a running row shows its live stream; the previously-foreground running session moves to the orb set.
- **Complexity:** M · **Category:** frontend · **Depends on:** #4, #9
- **Files:** `src/components/cmd/FloatingCommandBar.tsx`, `src/components/cmd/CommandBarHistory.tsx`, `src/hooks/useSessionManager.ts`

## Orb UI

### #12 — Orb "running and unwatched" set
- **Description:** Derive the orb's set as running sessions whose `conversationId ≠ foregroundConversationId`; the orb counts them. Switching/closing the bar auto-adds the left session; selecting it removes it. **Acceptance:** with N running and 1 foregrounded, the orb shows N−1.
- **Complexity:** M · **Category:** frontend · **Depends on:** #4
- **Files:** `src/components/activity/AgentOrb.tsx`, `src/stores/session-run-store.ts` (selector)

### #13 — Orb distinct pulse for needs-permission
- **Description:** A distinct pulse/badge when ≥1 unwatched session awaits permission (vs merely running). CSS-only keyframe; `useReducedMotion` + `prefers-reduced-motion` guard. **Acceptance:** visual distinction between "running" and "needs you"; static under reduced motion.
- **Complexity:** S · **Category:** frontend · **Depends on:** #6, #12
- **Files:** `src/components/activity/AgentOrb.tsx`, `src/styles/globals.css`

### #14 — AgentPanel: list unwatched sessions, click to foreground
- **Description:** `AgentPanel` lists the unwatched running sessions (label, provider, status; needs-you first). Clicking one brings it into the bar (and removes it from the orb via #12). **Acceptance:** panel reflects the orb set; click foregrounds the session.
- **Complexity:** M · **Category:** frontend · **Depends on:** #11, #12
- **Files:** `src/components/activity/AgentPanel.tsx`

## Notifications

### #15 — Notifications for backgrounded permission/completion
- **Description:** When a **backgrounded** session hits a permission request, or completes, fire a desktop notification (`tauri-plugin-notification`, gated on `notifyAgentCompletion` for completion / `notifyPermissionRequest` for permission) **plus** the orb badge/pulse. Clicking the notification focuses the window and foregrounds that session. **Acceptance:** backgrounded permission/completion notifies; foreground does not double-notify; click selects the session.
- **Complexity:** M · **Category:** frontend · **Depends on:** #6, #8, #12
- **Files:** `src/hooks/useSessionManager.ts`, `src/lib/notifications.ts`

## Integration tests

### #16 — Cross-cutting integration tests
- **Description:** Beyond each task's unit tests, add integration coverage for: session-survives-close (#4), concurrency + queue auto-start (#5), ACP registry isolation / no cross-wiring (#2), concurrent direct-API streams (#3), permission routing + foreground-aware timeout (#6/#7), orb running-and-unwatched set (#12), and inline history approval (#10). **Acceptance:** full `pnpm test` + `pnpm test:e2e` green; no coverage regression on changed files; `pnpm test:perf` within budget.
- **Complexity:** L · **Category:** frontend · **Depends on:** all
- **Files:** `src/**/__tests__/`, `e2e/tests/`
