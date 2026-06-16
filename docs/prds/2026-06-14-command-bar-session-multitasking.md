# PRD: Command-Bar Session Lifecycle & Concurrent Multitasking

|  |  |
| --- | --- |
| **Date** | 2026-06-14 |
| **Status** | ✅ Implemented (2026-06-16) — see `docs/tasks/2026-06-14-command-bar-session-multitasking-tasks.md`. Post-review hardening pass landed (review #1–#10, #12, #13, perf); #11 (queue-drain view-yank) deferred → issue #468. |
| **Priority** | High |
| **Impact** | Run several AI agents at once and walk away from each — sessions keep working in the background, the history list switches between them, and the orb pulls you back when one needs you. |
| **Tasks** | [command-bar-session-multitasking-tasks](../tasks/2026-06-14-command-bar-session-multitasking-tasks.md) |

## Problem

The command bar can only really do one thing at a time, and it forgets that thing the moment you look away:

1. **Closing the bar interrupts the run.** When the bar collapses (Esc, opening Settings, switching context), its expanded subtree unmounts and the streaming UI/listeners tear down — the in-flight agent run is orphaned from the UI. You can't start a long agent task and go do something else; you have to sit and watch it.
2. **You can't run two agents at once.** Agent work is slow. The whole point of starting a second session is to *not* watch the first — but there's no way to have agent A keep working while you compose and run agent B. The frontend pins ACP to a single live chat agent (`acpAgent`).
3. **A backgrounded run that needs permission is a dead end.** Tool-call permission requests render only inside the bar's chat stream and auto-deny after 30s. A run you've navigated away from would hit a permission prompt with nowhere to surface it, and silently auto-deny — losing the work.

The unifying insight (agreed with the user): **a session is the data; the command bar, the history list, and the orb are all just views of it.** Sessions should run independently of any view, and any view should be able to show — and act on — a session's live state.

## Goals / Non-Goals

**Goals**

1. **A session survives losing its view.** Collapsing/closing the bar or switching to another session never interrupts an in-flight run.
2. **Up to N concurrent live sessions** (default cap **4**, configurable 3–5), with further sessions **queued**. Direct-API and ACP both supported.
3. **The history list is the session switcher** — every conversation shows live status (running / awaiting-permission / idle), one click views any session live.
4. **Backgrounded sessions can be acted on without opening them** — a permission request surfaces inline in the history row (tool + diff/args + Allow/Deny) and via the orb + a desktop notification.
5. **The orb is the ambient home for unwatched work** — it reflects every running session you're *not* currently watching, and is the safety net that guarantees a backgrounded permission request reaches you.

**Non-Goals**

- Pausing/resuming a session mid-turn to "make room" for another (the user explicitly rejected this — concurrency, not time-slicing).
- A manual "delegate to orb" action (leaving a session *is* backgrounding it — see UI/UX).
- Unbounded concurrency (the cap + queue are deliberate; N local sessions contend on one llama-server).
- Multi-window / multi-document sessions (the session is still a chat conversation in `chat-store`).

## User Stories

- *As a user, I want to start an agent task and immediately start a second one, so that two agents work in parallel while I do something else.*
- *As a user, I want to close the command bar while an agent is mid-task and have it keep going, so that I'm not chained to watching the output.*
- *As a user, I want the history list to show which conversations have an agent actively working (and which are waiting on me), so that I can jump straight to the one that needs attention.*
- *As a user, I want to approve or deny a backgrounded agent's tool request right from the history list (seeing what it wants to do), so that I don't have to fully re-open the session.*
- *As a user, I want a notification + an orb pulse when a backgrounded agent needs permission or finishes, so that I can leave it running and trust I'll be pulled back.*
- *As a user, I want a sane limit on how many agents run at once, so that my Mac stays responsive.*

## Technical Approach

### Session = data; views = bar / history / orb

A "session" is a `chat-store` conversation plus its **run state** (idle / running / awaiting-permission / queued / error) and its bound agent/stream handle. Nothing about the run lives in a React subtree that unmounts with the bar. The command bar, `CommandBarHistory`, and the orb (`AgentOrb`/`AgentPanel`) all read the same session data and render a view of it.

**Decouple streaming from the bar's expanded subtree (Goal 1).** Today `FloatingCommandBar`'s expanded portion owns the chat hooks; collapsing unmounts them. Move session ownership (the streaming listeners, the per-session run state) **above** the expand/collapse boundary — into an always-mounted session manager (a hook/store mounted at `App.tsx` root alongside the other lifecycle hooks, per the project's "mount lifecycle hooks in App.tsx" rule). The bar becomes a pure view that attaches to the currently-selected session.

### ACP: singleton → per-session registry (Goal 2)

The hard center. The backend `acp_agent_spawn` already returns a distinct `instance_id` per call — it supports many agents. The cap is purely the **frontend singletons**. Critically, the codebase **already runs two concurrent ACP instances** and the pattern is proven:

- `acpAgent` (`src/lib/ai/acp-agent-state.ts`) — the main chat agent.
- `taskAgent` (`src/hooks/useAgentTaskOperations.ts`) — the background comment-delegation agent, with its own `instanceId` / `connectionId` / `projectRoot`, an in-flight spawn-promise guard, scope-respawn, and a liveness check (`acp_agent_exists`).

Generalize both into a **registry keyed by conversation id**:

```
agents: Map<conversationId, AcpAgentInstance>   // replaces the `acpAgent` / `taskAgent` singletons
```

Each entry keeps today's `AcpAgentState` shape (instanceId, connectionId, sandboxScopeKey, configKey, capabilities, chatSessionId). The spawn-promise guard, scope-respawn, and liveness check become **per-key**. `ensureAcpAgent(connection, cwd, …)` gains a `conversationId` and resolves the right registry entry. Session-update Tauri events already carry a session id; route each to the owning conversation.

**Direct-API** is already concurrent — `ai_chat_stream` is keyed by `stream_id` and the backend races each against its own cancel `Notify`. The session manager just needs to track one in-flight `stream_id` per running conversation instead of assuming one global stream.

**Concurrency cap + queue (Goal 2).** A session manager enforces `≤ maxConcurrent` live runs (default 4). A send beyond the cap enters a **queued** state and starts when a slot frees. The cap protects RAM/process/sandbox count and, for `local_bundled`, the single llama-server that serializes requests. The cap is a setting (`settings-store`, clamp 3–5).

### Permission requests for backgrounded sessions (Goals 4, 5)

`permission-store` already holds pending ACP tool-call requests and `tool-permission-store` the direct-API ones. Extend each pending request with its **owning conversation id** so any view can find "does session X have a pending request, and what is it." Rework the **auto-deny timeout**: a request whose session is **not foregrounded** gets a long/no auto-deny — the *notification* becomes the time-sensitive signal, not the request. (Foreground requests keep a timeout so the bar UX is unchanged.)

### Orb: "running and unwatched" (Goal 5)

Derive the orb's set as **running sessions whose conversation id ≠ the foregrounded conversation**. No manual delegate action and no new "delegated" flag — leaving a session (switching the bar to another conversation, or collapsing the bar) makes it unwatched, so it appears in the orb automatically; re-selecting it removes it. `activity-store` already tracks agent/transcription/recording tasks discriminated by `kind`; running chat sessions become a derived view over the session manager rather than a hand-maintained list.

## UI/UX

**History list = switcher (`CommandBarHistory` / `ChatHistoryView`).** Each row gets a leading **status indicator**:
- ● running (subtle pulse), ⏸ **awaiting permission** (accent, more prominent), idle (none), ⧗ queued, ⚠ error.
- Click a row → the bar shows that session **live** (mid-stream if running). This is the switcher; no separate UI.

**Inline permission card in the history row (Goal 4).** An awaiting-permission row **expands in place** to show the request — tool label (via `formatToolLabel`), and the `Diff`/`Content` preview already normalized by `normalizeToolCallContent` — with **Allow / Deny** (and the tiered allow-once/session/always menu). Modeled on the Claude cloud agent session list. Acting resolves it without opening the full session.

**Orb (`AgentOrb` / `AgentPanel`).** Counts + pulses for unwatched running sessions; a **distinct pulse/badge** when ≥1 needs permission (vs merely running). Clicking opens `AgentPanel` listing those sessions (label, provider, status, "needs you" first); clicking one brings it into the bar (and it leaves the orb). Honors `useReducedMotion` (CSS-only pulse, per the orb pattern).

**Notifications (Goal 4/7).** On a **backgrounded** session hitting a permission request, or completing: fire a desktop notification (`tauri-plugin-notification`, gated on the existing `notifyAgentCompletion` setting + a new `notifyPermissionRequest`) **and** the orb badge/pulse. In-bar indicator is optional/secondary. Clicking the notification focuses the window and selects that session.

**States:** queued (⧗ + "waiting for a free slot"), running, awaiting-permission, completed, error. Empty state unchanged. Reduced-motion: pulses become static.

## Data Model

```ts
// Session run state — lives in the session manager (store), not a React subtree.
type SessionRunStatus =
  | 'idle' | 'queued' | 'running' | 'awaiting_permission' | 'error';

interface SessionRun {
  conversationId: string;
  status: SessionRunStatus;
  path: 'direct' | 'acp' | 'copilot_lsp';
  streamId?: string;        // direct-API in-flight stream
  instanceId?: string;      // ACP agent process (registry key value)
  startedAt: number;
  pendingPermissionId?: string; // → permission-store / tool-permission-store entry
}

// acp-agent-state.ts — registry replaces the `acpAgent` singleton
type AcpAgentRegistry = Map<string /* conversationId */, AcpAgentState>;

// permission-store / tool-permission-store — add ownership + foreground-aware timeout
interface PendingPermission {
  /* …existing… */
  conversationId: string;
  foreground: boolean;      // drives auto-deny timeout (long/none when false)
}
```

- `settings-store`: `maxConcurrentSessions` (default 4, clamp 3–5); `notifyPermissionRequest` (bool).
- `chat-store`: conversations already a tree — no schema change beyond reading the derived run status; the session manager owns run state (non-persisted; an interrupted run is marked `error` on restart, mirroring `activity-store`).
- No new Tauri commands expected — `acp_agent_spawn`/`acp_agent_exists`/`ai_chat_stream`(`stream_id`)/`ai_chat_stream_cancel` already support multi-instance/multi-stream.

## Dependencies

- No new libraries. Builds on existing: `acp_agent_spawn` (multi-instance), `ai_chat_stream`/`ai_chat_stream_cancel` (per-`stream_id`), `permission-store` + `tool-permission-store`, `activity-store`, `tauri-plugin-notification`.
- Prerequisite/derisking: confirm ACP agents tolerate N concurrent processes under N Seatbelt sandboxes (each session keeps its own scope), and that `local_bundled` behaves acceptably under serialized concurrent requests (the cap mitigates).

## Quality Gates

**Functional**
- [x] Starting a send, then collapsing/closing the bar (Esc, Settings, switch), leaves the run going; reopening shows it mid-stream with no lost output.
- [x] Two+ sessions run concurrently (verified for direct-API and for ACP with two distinct conversations), up to the cap; the (cap+1)th send is queued and auto-starts when a slot frees.
- [x] ACP registry: each running conversation owns a distinct agent `instance_id`; switching/closing does not cross-wire session updates; the existing `acpAgent`/`taskAgent` behavior is subsumed without regression.
- [x] History rows show correct live status; clicking a running row attaches the bar to the live stream.
- [x] An awaiting-permission history row expands to the tool + diff/args and Allow/Deny resolves it correctly, for both ACP and direct-API tool calls.
- [x] A backgrounded permission request does NOT auto-deny on the old 30s timer; it surfaces in the orb + a desktop notification; a foreground request keeps its timeout.
- [x] Orb shows exactly the running-and-unwatched set (foreground session excluded); selecting a session removes it from the orb; distinct pulse when one needs permission.
- [x] Interrupted runs are marked `error` on app restart (no phantom "running").

**Design**
- [x] Status indicators + orb pulses use neutral/accent tokens per the strict-neutral palette; no chromatic except accent/destructive.
- [x] All pulses honor `prefers-reduced-motion` (CSS-only, `useReducedMotion`).
- [x] Inline permission card matches the existing `PermissionCard`/`ToolCallPermissionCard` visual language.
- [x] Every new `<Tooltip>` wrapped in `<TooltipProvider>`.

**Gates**: `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm test:perf`, `cargo test` (if backend touched) all green; no coverage regression on changed files.

**Known limitation (documented follow-up):** direct-API streams run **fully concurrently** (per-conversation `stream_id` + stream registry). The ACP **registry** isolates agents (distinct `instance_id` per conversation, no session-update cross-wiring) and run-state/queue/orb work for ACP conversations, but `useAcpLifecycle` still holds a **single foreground `cleanupRef`**, so two ACP *streams* can't render simultaneously yet — starting a second ACP send tears down the first's listeners. Backgrounded ACP run-state, notifications, and the cap still behave correctly; simultaneous ACP streaming is a follow-up (see tasks #2/#3/#4 notes).

## Out of Scope

- **Exact default concurrency cap** — proposing **4**; revisit after dogfooding (setting allows 3–5).
- **Queue UX depth** — v1 shows a simple ⧗ queued state; reordering/prioritizing the queue is deferred.
- **Optional explicit "send to orb" affordance** — deliberately omitted (auto-background on leave). Revisit only if the implicit rule feels too magic in practice.
- **Representation of a not-yet-started (queued) session in the orb** — v1 keeps queued sessions in the history list only; whether the orb should also count them is deferred.
- **Truly pausing/resuming a mid-turn ACP agent** — out of scope (concurrency replaces the need).
- **Per-session resource metering / adaptive cap** (e.g. auto-lowering the cap under memory pressure) — future.
