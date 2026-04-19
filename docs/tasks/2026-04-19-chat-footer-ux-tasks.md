# Chat Footer — Capability Source-of-Truth Fix

|  |  |
| --- | --- |
| **Date** | 2026-04-19 |
| **Status** | Not started |
| **Related** | [ACP protocol compliance PRD](../prds/2026-04-14-acp-protocol-compliance.md) (capability probe) |
| **Total** | 1 task (S) |

## Background

The ACP footer (`AcpSessionControls`) has three widgets: mode picker, dynamic config-option pickers (thinking effort etc.), and usage indicator. Each widget reads its data from `sessionInfo` — a module-level snapshot of the *live* session's response. That's the wrong source of truth for "what options are available."

Capabilities — the set of modes and config options an agent supports — are **already** discovered at connection-registration time via `probeAcpCapabilities()` (`src/lib/ai/acp-agent-state.ts:392`) and persisted on the `Connection` record as `acpCapabilities.availableModes` and `acpCapabilities.configOptions`. Re-probed if stale (>24h).

But the footer ignores that and waits for a live `session/new` response before rendering anything. Until the user sends a message (which is what triggers session creation in most flows), the footer shows stale data from the previous agent.

## Observed behavior (2026-04-19)

User switched between all four ACP agents and documented:

- **Claude → Gemini:** picker keeps "Read Only" (Claude's value) until message sent. On send, flips to "Full Access" (Gemini's YOLO is its default).
- **Claude → Codex:** picker keeps "Read Only". On send, **the mode picker disappears entirely** and the Reasoning Effort picker appears. Wildly unexpected.
- **Codex → Copilot:** picker shows nothing. On send, Copilot's 3 modes appear.
- **Claude (4 modes) → Copilot (3 modes):** picker shows 4 stale options until send, then updates to 3.

## Root cause

Two connected bugs:

1. **Wrong data source for "what's available."** Available modes/config options should come from `connection.acpCapabilities`, not from the live `sessionInfo`. The capability probe already answered this question at connection-add time; the footer should just display it.

2. **Stale `sessionInfo` across agent switch.** `ensureAcpAgent` stops the old agent when the connection changes (line ~255 of `acp-agent-state.ts`), but does not call `clearSessionInfo()`. The previous agent's modes and `currentModeId` linger in the module-level state until a new `setSessionModes(...)` fires — which is not until session/new completes on the new agent. Needs an explicit clear on connection change.

## Division of responsibility after fix

| Data | Source | Lifecycle |
| --- | --- | --- |
| **Available** modes and config options | `connection.acpCapabilities` | Set at connection add (probe), refreshed ≥24h later |
| **Currently selected** value (highlight) | `sessionInfo.modes?.currentModeId` / `sessionInfo.configOptions[n].currentValue` — with fallback to `connection.acpDefaults.*` and then first available | Live; cleared on agent switch |
| Usage counters | `sessionInfo.usage` | Live |

## Acceptance criteria (outcome-shaped)

- Switching agents in the chat footer **instantly** updates the mode picker options and config-option pickers to reflect the new agent's capabilities. No wait for a message to be sent.
- Codex's mode picker appears on switch (its capabilities were captured at probe time, regardless of whether Codex reports modes via legacy `modes` field or via `configOptions[category=mode]`).
- Copilot's 3 modes show immediately on switch from Claude, not 4 stale ones.
- Reasoning Effort picker appears immediately for agents that support it, hidden for those that don't.
- No regression: mode picker + config pickers continue to work correctly after a message is sent (i.e. highlight correctly reflects whatever mode/value is actually live on the agent-side session).
- `sessionInfo` is cleared when `ensureAcpAgent` respawns for a connection change, so stale highlights never bleed across.

## Files

- `src/components/chat/AcpSessionControls.tsx` — read available from `connection.acpCapabilities`, current selected from `sessionInfo` with fallback
- `src/components/chat/ChatFooter.tsx` — pass `effectiveConnection` prop into `AcpSessionControls`
- `src/lib/ai/acp-agent-state.ts` — `ensureAcpAgent` calls `clearSessionInfo()` on connection-change respawn
- `src/components/chat/__tests__/AcpSessionControls.test.tsx` (new) — component tests feeding different connections to assert picker output
- `src/lib/__tests__/acp-agent-state.test.ts` — add test that ensureAcpAgent clears sessionInfo on connection change

## Complexity: S (~45 min focused work)

## Non-goals

- Changing the mode-click behavior when no session exists (still shows "send a message first" toast). User flow: they see available options, pick one after first send. Future enhancement could queue the intent and apply on session creation, but not in scope for this fix.
- Re-probing capabilities on agent switch. The probe already runs at registration and auto-refreshes. Re-probe-on-switch would add latency for no benefit.
