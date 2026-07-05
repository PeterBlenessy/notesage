# Tasks: Provider Usage Display (Phases 1 & 2)

|  |  |
| --- | --- |
| **Date** | 2026-07-05 |
| **Status** | Not started |
| **PRD** | [provider-usage-display](../prds/2026-07-05-provider-usage-display.md) |
| **Total** | 12 tasks: 4S, 6M, 2L |
| **Suggested order** | Backend (#1) → Types & state (#2–#7) → UI (#8–#10) → Docs & verify (#11–#12) |

**Risks / open questions:**

- `_meta["_claude/rateLimit"]` shape is non-contractual — the parser (#2) must survive arbitrary payloads; tests must include garbage input. If claude-code-acp changes the key or shape, the feature silently degrades (by design).
- `unstable_end_turn_token_usage` (#1) is an UNSTABLE upstream cargo feature; a future crate bump may change `Usage`'s shape. #1/#5 are a stretch pair — defer both without blocking the rest if friction appears.
- The per-model context-size constant map (#7) will drift as providers ship new models; unknown model ⇒ no indicator is the designed fallback, so drift degrades gracefully.
- `estimateTokens` is chars/4 — estimates can be off by ±30% for code-heavy content. The "≈" prefix and `estimated` confidence are load-bearing UI, not decoration.
- #8 changes when `UsageIndicator` renders (currently gated on ACP `sessionInfo.usage`) — regression-test that ACP behavior is unchanged.

---

## Task list

### Backend

**#1 — Emit `acp-turn-usage` event from prompt responses** *(stretch — defer with #5 if friction)*
- **Description:** Enable the `unstable_end_turn_token_usage` feature on both ACP crates. In the agent thread where the `session/prompt` response resolves, when `PromptResponse.usage` is `Some`, emit an `acp-turn-usage` Tauri event with payload `{ instanceId, sessionId, usage }` (camelCase keys). Usage extraction must be strictly best-effort: a missing/undeserializable field must never affect the prompt reply path (`acp_session_prompt` keeps returning `Result<(), String>`). Acceptance: `cargo check` green via pkg-config stubs; a unit test (or targeted review) confirms the reply path is untouched when `usage` is absent.
- **Complexity:** M · **Category:** backend · **Dependencies:** —
- **Files:** `src-tauri/Cargo.toml`, `src-tauri/src/commands/acp.rs`, `src-tauri/src/commands/acp_client.rs` (follow the `emit_session_update` pattern)

### Types & state

**#2 — Usage types + defensive `_meta` parser registry**
- **Description:** Create `src/lib/ai/usage.ts` with `UsageConfidence`, `ProviderRateLimitInfo`, `TurnUsage`, `ProviderUsageSnapshot` (shapes per PRD Data Model) and `parseUsageMeta(meta: unknown): ProviderRateLimitInfo | undefined` implemented as a keyed registry (`"_claude/rateLimit"` today; designed so `"_codex/rateLimits"` is a one-entry addition in Phase 3). Every field optional and type-validated; unknown keys and malformed values return `undefined` (or a partial with only valid fields), never throw. Acceptance: unit tests cover valid payload, partial payload, wrong types, non-object `_meta`, unknown keys.
- **Complexity:** M · **Category:** frontend · **Dependencies:** —
- **Files:** `src/lib/ai/usage.ts`, `src/lib/ai/__tests__/usage.test.ts`

**#3 — Extend `AcpUsageInfo` with rate-limit state**
- **Description:** Add `rateLimit?: ProviderRateLimitInfo` to `AcpUsageInfo` and thread it through `updateUsage`. Verify `clearSessionInfo` (connection switch / agent stop) clears it along with the rest of usage — extend the existing test.
- **Complexity:** S · **Category:** frontend · **Dependencies:** #2
- **Files:** `src/lib/ai/acp-agent-state.ts`, its test file

**#4 — Parse `_meta` in the `usage_update` listener**
- **Description:** In `useAcpSessionListeners.ts` (usage_update branch, ~line 297), call `parseUsageMeta(update._meta)` and pass the result into `updateUsage`. Acceptance: tests via `tauri-mock.ts` — a mocked `acp-session-update` event with `_meta["_claude/rateLimit"]` populates `sessionInfo.usage.rateLimit`; a malformed `_meta` leaves usage populated but `rateLimit` undefined; no `_meta` behaves exactly as today (regression).
- **Complexity:** M · **Category:** frontend · **Dependencies:** #2, #3
- **Files:** `src/hooks/useAcpSessionListeners.ts`, its test file

**#5 — Frontend listener for `acp-turn-usage`** *(stretch — pairs with #1)*
- **Description:** Subscribe to the `acp-turn-usage` event (alongside the existing ACP listeners), validate the payload against `TurnUsage`, store as `lastTurnUsage` on the session-info singleton and write through to the usage-store (#6). Acceptance: mocked event populates `lastTurnUsage`; malformed payload ignored.
- **Complexity:** S · **Category:** frontend · **Dependencies:** #1, #2, #3, #6
- **Files:** `src/hooks/useAcpSessionListeners.ts`, `src/lib/ai/acp-agent-state.ts`

**#6 — `usage-store` (non-persisted) with write-through**
- **Description:** New Zustand store `Record<connectionId, ProviderUsageSnapshot>`, **no persist middleware** (stale quota is worse than none). Setter `recordUsage(connectionId, partial)` merges and stamps `updatedAt`. Write through from the ACP listener path (#4) so the live singleton and per-connection snapshots stay in sync; `source: 'acp'`, `confidence: 'exact'`. Acceptance: store tests (merge, timestamps, no persistence key in localStorage).
- **Complexity:** M · **Category:** frontend · **Dependencies:** #2 (write-through wiring lands with #4)
- **Files:** `src/stores/usage-store.ts`, `src/stores/__tests__/usage-store.test.ts`

**#7 — Context-size resolver + estimation hook**
- **Description:** (a) `getContextSize(connection, modelId?)`: `local_bundled` → `useLocalAIStore.contextLength`; `anthropic`/`openai` → small per-model constant map; anything else → `undefined`. (b) `useEstimatedContextUsage(conversation, connection)`: computes used tokens via `estimateMessagesTokens` (`context-trim.ts`) over the active thread + system prompt, memoized on message count / active leaf — **never recomputed per keystroke or per stream chunk**. Returns `undefined` when size is unknown (no-denominator rule). Writes through to usage-store with `source: 'estimate'`, `confidence: 'estimated'`. Acceptance: unit tests for the resolver map and the memo behavior; `pnpm test:perf` green with no new `[perf:typing]` cost.
- **Complexity:** M · **Category:** frontend · **Dependencies:** #2, #6
- **Files:** `src/lib/ai/context-size.ts`, `src/hooks/useEstimatedContextUsage.ts`, tests

### UI

**#8 — Render the indicator for non-ACP connections (estimated display)**
- **Description:** `UsageIndicator` currently bails without ACP `sessionInfo.usage`. Add the estimated path: when no ACP usage exists but `useEstimatedContextUsage` returns a value, render the ring with an "≈" prefix in the tooltip label and an "Estimated locally" caption. Apply threshold ring coloring in both paths per the design-system mapping: `<75%` `muted-foreground`, `75–90%` `foreground`, `≥90%` `--color-destructive`. High blast radius: verify the ACP path is pixel/behavior-identical below 75% (regression tests for the existing "4.2K / 200K" tooltip and the null-bailout when neither source has data).
- **Complexity:** M · **Category:** frontend · **Dependencies:** #3, #6, #7
- **Files:** `src/components/chat/AcpSessionControls.tsx`, `src/components/cmd/CommandBarContext.tsx` (mount gating), tests

**#9 — Usage popover**
- **Description:** Promote the pill from tooltip-only to click-to-open shadcn `Popover` (tooltip keeps the one-line summary). Rows in order: context (ring + used/size + %), per-turn token breakdown (when present), cumulative cost, rate-limit rows (type, status, reset countdown from `resetsAt`), provenance footer ("Reported by agent" / "Estimated locally" + relative time). Threshold captions: "Context filling up" (75–90%), "Start a new session soon" (≥90%). Wrap in `TooltipProvider`; ring `aria-hidden` with values in accessible text; no animation beyond existing transitions; verify light/dark/soft-contrast. Follow the popover patterns already in the command bar.
- **Complexity:** L · **Category:** frontend · **Dependencies:** #4, #8 (consumes #5's data when present)
- **Files:** new `src/components/chat/UsagePopover.tsx`, `src/components/chat/AcpSessionControls.tsx`, tests

**#10 — Connection card: plan pill + usage detail (Phase 2)**
- **Description:** On `ConnectionCard`: (a) plan-ish pill when known (e.g. "Free account" from `connection.freeAccount`, styled like the existing `AUTH_BADGES` pills); (b) an Info affordance opening a detail view listing the latest `ProviderUsageSnapshot` — context, cost, rate-limit state, per-turn tokens — each row with provenance + `updatedAt` (Settings v2 `SettingsRow`/`SettingsGroup` patterns). Empty state: "No usage reported yet — data appears after chatting with this provider." No polling: data refreshes passively from the store; the existing heartbeat stays as-is. Acceptance: renders with a populated snapshot, with `freeAccount` only, and empty; no new intervals/timers introduced.
- **Complexity:** L · **Category:** frontend · **Dependencies:** #6
- **Files:** `src/components/settings/ConnectionCard.tsx`, new `src/components/settings/ConnectionUsageDetail.tsx`, tests

### Docs & verification

**#11 — Documentation updates**
- **Description:** Add `usage-store` to the store table in `docs/architecture.md`; document the usage indicator/popover and the `_meta` parser registry (incl. the no-secrets constraint and Phase 3 hook) in `docs/features/ai-providers.md`.
- **Complexity:** S · **Category:** frontend · **Dependencies:** #2–#10
- **Files:** `docs/architecture.md`, `docs/features/ai-providers.md`

**#12 — Quality-gate verification pass**
- **Description:** Run the PRD's gates end-to-end: `pnpm typecheck`, `pnpm test`, `pnpm test:perf`, `pnpm audit:contrast` (must be unchanged), `cargo check` via stubs if #1 landed; `/review-ui` on the popover and connection-card changes; verify threshold captions against mocked 76% / 91% snapshots; confirm no new polling (grep for new `setInterval`/timers).
- **Complexity:** S · **Category:** both · **Dependencies:** all
- **Files:** —
