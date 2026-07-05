# PRD: Provider Usage Display (Phases 1 & 2)

|  |  |
| --- | --- |
| **Date** | 2026-07-05 |
| **Status** | Implemented |
| **Priority** | Medium |
| **Impact** | Every provider gets a context indicator, and users see rate-limit warnings and account state — without Notesage ever touching provider secrets |
| **Tasks** | [provider-usage-display-tasks](../tasks/2026-07-05-provider-usage-display-tasks.md) |
| **Phase** | Phase 1 (wire consumption + indicator) · Phase 2 (Settings surface) |

## Problem

The command bar's context indicator (`UsageIndicator` in `src/components/chat/AcpSessionControls.tsx`) is fed exclusively by ACP `usage_update` events. For direct-API (`api_key`), Ollama (`local`), local-bundled, and Copilot LSP connections it renders nothing — the icon simply disappears, which reads as a bug. Beyond context, Notesage captures no subscription-related information at all: no plan, no quota, no rate-limit state (the only signal is the loose `Connection.freeAccount` boolean).

Meanwhile, data is already arriving on the wire and being dropped: `claude-code-acp` forwards Claude Code's `rate_limit_event` payload inside `usage_update._meta["_claude/rateLimit"]`, and the Rust passthrough (`acp_client.rs` re-serializes the typed update; the pinned schema crate v0.13.6 models `_meta`) delivers it to the frontend event — where `useAcpSessionListeners.ts` reads only `used`/`size`/`cost` and discards the rest.

**Hard constraint (user decision):** Notesage must not read third-party credential files (`~/.claude/.credentials.json`, `~/.codex/auth.json`, browser cookies) or call private provider endpoints. Usage information comes only from what agents push over ACP/LSP, what Notesage's own connections return, and local estimation.

## Goals

1. The context indicator renders for **every** interactive connection type — exact values for ACP, estimated for direct-API/local (tagged as such).
2. Claude rate-limit state (status, type, reset time, utilization when present) is parsed from `_meta` and surfaced in a click-to-open usage popover.
3. Per-turn token breakdowns (`Usage`: input/output/thought/cached) are captured when the agent reports them.
4. Settings → Connections shows account-level usage/plan state per connection with explicit data provenance and freshness.
5. Zero reads of third-party secrets, zero background polling — all data is event-pushed or computed locally.

## Non-Goals

- Direct calls to provider usage endpoints (`chatgpt.com/backend-api`, `claude.ai` web API, `api.github.com/copilot_internal`, `cloudcode-pa.googleapis.com`) — explicitly rejected.
- Browser cookie import, PTY probing, or slash-command probing of agents.
- The codex-acp upstream PR forwarding `RateLimitSnapshot` into `_meta` (Phase 3, tracked separately — this PRD's parser is designed to accept it when it lands).
- Authoring the ACP rate-limits/quota RFD (Phase 4).
- Always-on Claude quota bars — blocked upstream (the Claude Code SDK only emits `rate_limit_event` near warning thresholds; anthropics/claude-code#50518 closed as not planned).
- Usage history persistence, spend analytics, or budget alerts.

## User Stories

- As a Claude Code subscriber, I want a visible warning with the reset time when I approach my 5-hour or weekly limit, so I can plan my work instead of hitting a wall mid-task.
- As a direct-API or local-model user, I want a context indicator even though my provider doesn't report one, so long conversations don't degrade or fail without warning.
- As any user, I want to click the usage pill and see the details (context, per-turn tokens, cost, rate-limit state), so the at-rest glance can go one level deeper on demand.
- As a user managing connections, I want plan/usage state on the connection card in Settings, so I can check account health in the same place I check connectivity.

## Technical Approach

### Phase 1 — consume what's already on the wire; estimate the rest

**1. Rate-limit `_meta` ingestion (frontend-only).**
Extend the `usage_update` branch in `src/hooks/useAcpSessionListeners.ts` (currently lines ~297–307) to read `update._meta?.["_claude/rateLimit"]`. The payload shape (from claude-code-acp and claude-code#50518) is `{ status, resetsAt, rateLimitType, utilization? }` — treat **every** field as optional and type-validate each one; `_meta` is non-contractual by ACP spec ("implementations MUST NOT make assumptions"), so unknown or malformed content is silently ignored. Store on the session-info singleton. Design the parser as a keyed registry (`_claude/rateLimit` today, `_codex/rateLimits` when the Phase 3 upstream PR lands) so adding a provider is one entry.

**2. Extend the usage state.**
`AcpUsageInfo` (`src/lib/ai/acp-agent-state.ts:185-189`) gains `rateLimit?: ProviderRateLimitInfo`. Cleared by the existing `clearSessionInfo` path (connection switch / agent stop) — no new lifecycle.

**3. Estimated context for non-ACP providers.**
A small derivation (in `AcpSessionControls` or a sibling hook) computes estimated context for the active conversation when no ACP usage exists: `estimateMessagesTokens` from `src/lib/ai/context-trim.ts` over the thread + system prompt, recomputed at message boundaries only (never per keystroke). Context size resolution: `local_bundled` → `useLocalAIStore.contextLength`; `anthropic`/`openai` → a small per-model constant map; `openai_compatible`/unknown → no size, and per the ACP RFD's own guidance, **no size ⇒ no indicator** (never invent a denominator). Estimated values carry `confidence: 'estimated'` and render with an "≈" prefix.

**4. Usage popover.**
Promote `UsageIndicator` from tooltip-only to a click-to-open shadcn `Popover` (pill unchanged at rest; tooltip keeps the one-line summary). Contents, in order: context row (ring + `used / size` + percent), per-turn token breakdown when available, cumulative cost, rate-limit rows (type, status, reset countdown), and a provenance footer ("Reported by agent" / "Estimated locally" + relative timestamp). Threshold behavior adopts the ACP RFD's recommended bands (75 / 90 / 95%) but expressed within the design system — see UI/UX.

**5. Per-turn token breakdown (stretch, Rust-touching).**
The ACP schema's per-turn `Usage` on `PromptResponse` is gated behind the `unstable_end_turn_token_usage` cargo feature (verified present at the pinned `agent-client-protocol-schema =0.13.6`), which Notesage does not enable; additionally `acp_session_prompt` (`src-tauri/src/commands/acp.rs:1967`) discards the prompt response (`Result<(), String>`). Work: enable the feature on both ACP crates in `Cargo.toml`, and emit a new `acp-turn-usage` Tauri event (payload `{ instanceId, sessionId, usage }`) from the agent thread when the response carries `usage`. Frontend stores it as `lastTurnUsage`. Parse defensively — the field is UNSTABLE upstream and may change shape; a deserialization surprise must never break prompting (usage extraction is strictly best-effort, isolated from the reply path). If the feature flag causes friction, this item ships in a follow-up without blocking the rest of Phase 1.

### Phase 2 — account-level surface in Settings

**6. `ProviderUsageSnapshot` + store.**
New `src/lib/ai/usage.ts` types and a non-persisted `usage-store` (Zustand) keyed by `connectionId`. Written through from the ACP listener (so the singleton and the per-connection snapshot stay in sync), plus existing signals: `freeAccount`, `acpCapabilities.agentVersion`. The store is the single source both UI layers read; the session singleton remains the live-session fast path.

**7. Connection card + detail view.**
`ConnectionCard` (`src/components/settings/ConnectionCard.tsx`) gains: a plan-ish pill when known (e.g. "Free account" from `freeAccount`), and an Info affordance opening a detail popover/section listing the latest snapshot — context, cost, rate-limit state, per-turn tokens — each row with provenance and `updatedAt`. Empty state: "No usage reported yet — data appears after chatting with this provider." Refresh is passive (live events) plus the existing heartbeat "Test connection"; **no new polling**.

## Data Model

```ts
// src/lib/ai/usage.ts
type UsageConfidence = 'exact' | 'estimated';

interface ProviderRateLimitInfo {
  status?: string;          // e.g. "allowed_warning"
  rateLimitType?: string;   // e.g. "five_hour", "seven_day"
  resetsAt?: number;        // unix seconds
  utilization?: number;     // 0-100, present only near thresholds (Claude)
  raw?: unknown;            // original _meta payload for the detail view
}

interface TurnUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
}

interface ProviderUsageSnapshot {
  connectionId: string;
  contextUsed?: number;
  contextSize?: number;
  cost?: { amount: number; currency: string };
  rateLimit?: ProviderRateLimitInfo;
  lastTurnUsage?: TurnUsage;
  confidence: UsageConfidence;
  source: 'acp' | 'estimate';
  updatedAt: number;
}
```

- `AcpUsageInfo` (existing) += `rateLimit?: ProviderRateLimitInfo`.
- New store: `usage-store` — `Record<connectionId, ProviderUsageSnapshot>`, **not persisted** (usage is live state; stale persisted quota is worse than none).
- Rust (stretch item 5 only): `acp-turn-usage` event; no new commands, no signature changes to existing commands.

## Dependencies

- No new npm or cargo dependencies. ACP crates stay at the pinned `0.14.0` / `=0.13.6`; item 5 adds the `unstable_end_turn_token_usage` feature flag only.
- Rate-limit info requires a claude-code-acp version that forwards `_meta["_claude/rateLimit"]` — absence degrades gracefully (field never populated, popover row hidden).
- Phase 3 (codex-acp `_meta` forwarding) is a consumer of this PRD's parser registry, not a prerequisite.

## UI/UX

- **Pill at rest:** unchanged (ring only). Tooltip keeps the `4.2K / 200K` summary. Click opens the popover; `Esc`/outside-click closes (Radix defaults). Wrap in `TooltipProvider` per the design-system mandate.
- **Threshold colors within the strict-neutral palette:** the ACP RFD suggests yellow/orange/red bands, but chromatic color outside `--color-accent-primary` / `--color-destructive` is forbidden. Mapping: `<75%` ring in `muted-foreground` (today's look); `75–90%` ring in `foreground` + caption "Context filling up"; `≥90%` ring in `--color-destructive` + caption "Start a new session soon". Rate-limit warning rows likewise use destructive only at/above warning status. No new chromatic tokens.
- **Estimated state:** "≈" prefix on numbers, caption "Estimated locally". Never render a ring without a known context size.
- **States:** no data → pill hidden (current behavior); popover always reachable from the StatusTray-adjacent surfaces is out of scope (see Out of Scope).
- **Motion/AT:** no pulsing or animation on threshold changes beyond existing transitions; respect `useReducedMotion`. Popover content readable by AT (rows are text, ring is decorative with `aria-hidden`, values in accessible labels). Both themes + soft contrast verified.
- **Settings detail (Phase 2):** follows Settings v2 `SettingsRow`/`SettingsGroup` patterns; provenance line in `text-xs text-muted-foreground`.

## Quality Gates

Functional:

- [ ] `usage_update` carrying `_meta["_claude/rateLimit"]` populates the popover's rate-limit row (unit test with mocked Tauri event via `tauri-mock.ts`)
- [ ] Malformed/unknown `_meta` (wrong types, extra keys, non-object) is ignored without error (test)
- [ ] Non-ACP connection with known context size shows an estimated indicator; unknown size shows none (tests for `local_bundled`, `anthropic`, `openai_compatible`)
- [ ] Estimation recomputes only at message boundaries — no decoration/typing-path regressions (`pnpm test:perf` green; no new `[perf:typing]` cost)
- [ ] Connection switch / agent stop clears rate-limit state along with usage (existing `clearSessionInfo` path, test extended)
- [ ] Phase 2 card + detail render snapshot with provenance; empty state correct; no polling introduced (no new intervals/timers)
- [ ] `pnpm typecheck`, `pnpm test` green; `cargo check` (stubs) green if item 5 lands
- [ ] Threshold captions match the 75/90 bands; values verified against a mocked 76% / 91% snapshot

Design:

- [ ] All colors from existing tokens; destructive is the only chromatic use; `pnpm audit:contrast` unchanged
- [ ] Popover looks at home next to existing command-bar popovers in light, dark, and soft-contrast modes
- [ ] `TooltipProvider` wraps all tooltip use; reduced-motion honored
- [ ] `/review-ui` pass on the popover and connection-card changes

## Out of Scope (deferred)

- **Phase 3:** upstream codex-acp PR forwarding `TokenCountEvent.rate_limits` → `usage_update._meta["_codex/rateLimits"]`, then a one-entry addition to this PRD's parser registry (plan type, credits, 5h/weekly windows for Codex).
- **Phase 4:** authoring the ACP rate-limits/quota RFD upstream.
- StatusTray "Provider" group — revisit once the usage-store exists (cheap to add then).
- Copilot LSP identity (`checkStatus` user) on the connection card — small, but bundled with Phase 3-era work.
- Usage history persistence, budget alerts, spend charts.
