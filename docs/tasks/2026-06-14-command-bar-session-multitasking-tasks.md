# Tasks: Command-Bar Session Lifecycle & Concurrent Multitasking

|  |  |
| --- | --- |
| **Date** | 2026-06-14 |
| **Status** | In progress (#1 done) |
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

### #2 — ACP agent registry (singleton → per-conversation map)
- **Description:** Convert the module-level `acpAgent` singleton to a `Map<conversationId, AcpAgentState>`. Make the in-flight spawn-promise guard, scope-respawn, and liveness check (`acp_agent_exists`) **per-key**. Thread `conversationId` through `ensureAcpAgent` and the `useAcpLifecycle` / `useAcpSessionListeners` call paths; route inbound `acp-session-update` events to the owning conversation by session id. Generalize the proven `taskAgent` pattern (`useAgentTaskOperations`) into the same registry. **Acceptance:** two distinct conversations each spawn and keep a distinct `instance_id` with no cross-wiring of session updates; existing single-session + comment-delegation behavior unchanged. **High blast radius.**
- **Complexity:** L · **Category:** frontend · **Depends on:** #1
- **Files:** `src/lib/ai/acp-agent-state.ts`, `src/hooks/useAcpLifecycle.ts`, `src/hooks/useAcpSessionListeners.ts`, `src/hooks/useAgentTaskOperations.ts`

### #3 — Per-conversation direct-API stream tracking
- **Description:** Track the in-flight `stream_id` per running conversation so multiple direct-API streams run independently, each writing to its own conversation's messages/segments. Cancel targets the right `stream_id`. **Acceptance:** two direct-API conversations stream concurrently without segment cross-contamination (extends the existing `stream_id` suffixed-event isolation).
- **Complexity:** M · **Category:** frontend · **Depends on:** #1
- **Files:** `src/hooks/useDirectApiChat.ts`, `src/hooks/useAIOperations.ts`

### #4 — Always-mounted session manager (decouple streaming from the bar)
- **Description:** Move session ownership (streaming listeners + run-state writes) out of `FloatingCommandBar`'s expanded subtree into an always-mounted `useSessionManager` hook mounted at the `App.tsx` root (per the "mount lifecycle hooks in App.tsx" rule). The command bar becomes a pure view that attaches to the foreground conversation. **Acceptance:** starting a send then collapsing/closing the bar (Esc, Settings, switch) leaves the run going; reopening shows it mid-stream with no lost output.
- **Complexity:** L · **Category:** frontend · **Depends on:** #1, #2, #3 · **High blast radius.**
- **Files:** `src/hooks/useSessionManager.ts` (new), `src/App.tsx`, `src/components/cmd/FloatingCommandBar.tsx`, `src/hooks/useAIOperations.ts`

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
