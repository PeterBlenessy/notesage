# Telemetry: Usage & Quality — PRD (Draft)

|  |  |
| --- | --- |
| **Date** | 2026-06-07 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Replaces "maintainer's manual testing" with real signal on which features are used and where the app crashes, so alpha releases can be steered by data |
| **Tasks** | — (not yet planned) |
| **Related** | Research: [telemetry-usage-and-quality](../research/2026-06-07-telemetry-usage-and-quality.md), [telemetry-analytics-options](../research/telemetry-analytics-options.md) |

## Problem

Notesage ships frequent alpha releases (`0.46.0-alpha.12` today, alpha-only channel) with a large and growing feature surface, but the only feedback signal is the maintainer's manual testing. There is no view into:

- **Usage** — which of the many features are actually used (which AI paths, which exporters, which Quiet Composer surfaces), and which are dead weight.
- **Quality** — when and where the app crashes in the wild: Rust panics, frontend React errors, native crashes in the llama-server / WebView process tree. Today a crash is only known if a user reports it.

Without this, roadmap and stabilization decisions are guesses. The research doc concluded that a **free, privacy-respecting, backend-originated** setup is achievable with off-the-shelf tooling, and that the consent model should be **channel-based** (alpha default-on, stable opt-in) so the alpha phase actually yields usable data instead of the <5% participation that default-off opt-in produces.

## Goals / Non-Goals

**Goals:**

1. Capture **anonymous usage events** (a small, fixed taxonomy — no PII) and view them as DAU/MAU + per-event counts/properties.
2. Capture **crashes and unhandled errors** across all three failure classes (Rust panic, frontend JS/React error, native crash) with stack traces grouped per release version.
3. **Channel-based consent**: default-on for alpha builds, default-off (opt-in) for stable, with two independent user toggles (usage / crashes) as the single opt-out mechanism — the channel only sets each toggle's initial value.
4. **All egress originates in the Rust backend** — no widening of the hardened frontend capability surface (`http:default` stays locked; no new `fs:allow-*`; no direct WebView phone-home).
5. **Zero leakage of user content** — never transmit document content, file paths/names, AI prompts/completions, API keys, project names, or search queries. A single auditable scrub point per stream.

**Non-Goals:**

- Funnels, cohorts, retention dashboards, A/B testing, feature flags, session replay (PostHog territory — deferred; see Out of Scope).
- Performance-regression telemetry from `[perf:*]` metrics (possible later via the same pipeline — deferred).
- Identifying individual users, accounts, login, or any cross-app/cross-device tracking.
- Server/infrastructure observability (OpenTelemetry/SigNoz — wrong tool, see research).
- A self-hosted backend at launch (use free cloud tiers; keep self-host as a documented, DSN-swap fallback).

## User Stories

- *As the maintainer,* I want to see which AI paths and exporters are actually used, so that I invest effort where users are and prune what they ignore.
- *As the maintainer,* I want grouped, stack-traced crash reports tagged with the exact alpha version, so that I can fix regressions without waiting for a user to describe a white screen.
- *As an alpha user,* I want to be told plainly that the alpha shares anonymous usage and crash data and how to turn it off, so that I'm not surprised and I trust the app.
- *As a privacy-conscious user,* I want a visible toggle so that I can opt out without leaving the alpha channel or building from source.
- *As a future stable user,* I want telemetry off by default and opt-in, so that the stable product matches Notesage's privacy-first positioning.

## Technical Approach

Two independent streams, both sending from Rust, both gated on settings flags.

### Stream A — Usage analytics (Aptabase)

- Add `tauri-plugin-aptabase` (first-party, Tauri v2) in `src-tauri/src/lib.rs`, initialized with the Aptabase app key. Free cloud tier: 20K events/month, no overage charges.
- Frontend calls a thin wrapper around `@aptabase/tauri`'s `trackEvent(name, props)`; the plugin owns batching, offline queue, and retry.
- Every call routes through a single frontend helper `track(event, props)` (new, `src/lib/telemetry.ts`) that **no-ops when the usage flag is off** and enforces the allowed event taxonomy at the type level.

### Stream B — Crash / error reporting (Sentry, DSN-swappable to GlitchTip)

- Add `sentry` (Rust SDK) + `tauri-plugin-sentry` (`timfish/sentry-tauri`, v0.5) in `lib.rs`. Free Sentry Developer plan: 5K errors/month, 30-day retention. DSN-based, so a later swap to self-hosted **GlitchTip** is a config change, not a code change.
- The plugin injects `@sentry/browser` into the WebView and routes frontend errors **through Rust via `invoke`** — backend and frontend share one event timeline. Add `sentry:default` to `capabilities/default.json`.
- Wire `src/components/ErrorBoundary.tsx` to report caught React errors before rendering the fallback.
- Rust panics captured automatically; optional `sentry-rust-minidump` for native crashes (llama-server / WebView) — flagged as a follow-up sub-task, not blocking.
- `release` set to the app version so issues attribute to the alpha that introduced them. `send_default_pii: false`. A `before_send` hook strips `server_name` and any incidental path-bearing fields.

### Channel detection & default computation

- A compile-time helper in Rust derives the channel from the version string (pre-release suffix `-alpha` → `Alpha`, else `Stable`), exposed to the frontend via an existing startup/health command or a new `get_release_channel` command.
- On first run, if the telemetry flags are unset, defaults are computed: **alpha → both on**, **stable → both off**. After first run the values are user-owned and persisted; channel changes never override an explicit user choice.
- The Settings toggle is the single opt-out — there is deliberately no separate env/`DO_NOT_TRACK` kill switch (redundant for a desktop app at this scale; the in-app toggle covers the need).

### Egress / capability notes

- Aptabase plugin and Sentry Rust SDK egress via Rust `reqwest`, which is **not** governed by Tauri's `http:default` capability (that governs the JS HTTP plugin). No capability widening needed beyond `sentry:default` (which is the invoke bridge, not network).
- Verify no `tauri.conf.json` CSP `connect-src` rule blocks the backend egress endpoints (open question / test).

## UI/UX

Per the design system (shadcn/ui first, neutral palette, no chromatic accent except where the system allows).

- **First-run notice (alpha only):** a non-blocking `sonner` toast or a small dismissible banner on first launch — *"Alpha builds share anonymous usage and crash reports to help stabilize fast-moving features. This is on by default — turn it off in Settings → Privacy. No document content, file contents, or AI prompts are ever sent."* Single "Open Privacy settings" action + dismiss. Shown once (a `telemetryNoticeSeen` flag).
- **Disclosure at channel selection:** whenever the user *opts into* the alpha channel (today: implicit, since alpha is the only channel; future: an explicit release-channel picker), the same disclosure must be presented at that decision point — choosing alpha *means* accepting default-on telemetry, so the value exchange has to be stated where the choice is made, not only at first run. When a channel picker is added, render an inline note beside it ("Alpha builds share anonymous usage + crash data by default — manage in Settings → Privacy") and re-surface the first-run notice if the user switches stable → alpha. Until a picker exists, the first-run notice carries this role.
- **Settings → Privacy** (`src/components/settings/v2/` Privacy panel — the Approvals panel already lives here; this is the natural home): a new "Telemetry" group with:
  - Two `switch` rows — **Usage analytics** and **Crash reports** — each with a one-line description.
  - A muted line stating the current channel and what the defaults are ("Alpha builds default to on; stable builds default to off").
  - A "Reset analytics ID" button (regenerates the anonymous install UUID).
  - A link to the privacy explanation of exactly what is and isn't collected.
- **States:** toggles reflect persisted values and persist across restart; flipping either immediately starts/stops that stream.

## Data Model

**Settings (`settings-store`, `Full` persistence):**

```typescript
interface TelemetrySettings {
  telemetryUsageEnabled: boolean;   // default computed from channel on first run
  telemetryCrashEnabled: boolean;   // default computed from channel on first run
  telemetryNoticeSeen: boolean;     // first-run notice shown
  telemetryInstallId: string;       // anonymous random UUID, resettable
}
```

**Frontend telemetry helper (`src/lib/telemetry.ts`):**

```typescript
type TelemetryEvent =
  | "app_launched"
  | "document_opened"
  | "ai_chat_sent"
  | "ai_action_used"
  | "export_performed"
  | "connection_added"
  | "skill_invoked"
  | "mcp_tool_called"
  | "feature_used";

// no-ops when usage flag off; enforces low-cardinality props
function track(event: TelemetryEvent, props?: Record<string, string>): void;
```

**Event taxonomy** (low-cardinality enum props only — no free text, paths, or content):

| Event | Properties |
| --- | --- |
| `app_launched` | `version`, `os`, `channel` |
| `document_opened` | `format` (md/epub/pdf/docx/pptx/code) |
| `ai_chat_sent` | `path` (direct/acp/copilot_lsp/local_bundled), `provider_kind` |
| `ai_action_used` | `action` (improve/summarize/expand) |
| `export_performed` | `format`, `template` |
| `connection_added` | `provider_kind` |
| `skill_invoked` / `mcp_tool_called` | `source` (bundled/user/project) |
| `feature_used` | `feature` (focus_mode/cmd_bar_pin/recording/…) |

**Rust:**

```rust
// new command (or fold into existing health/startup command)
#[tauri::command]
fn get_release_channel() -> String; // "alpha" | "stable"
```

## Dependencies

- `tauri-plugin-aptabase` (crates.io) + `@aptabase/tauri` (npm) — usage stream.
- `sentry` + `tauri-plugin-sentry` (crates.io) + transitively `@sentry/browser` — crash stream.
- Accounts: an Aptabase cloud project (app key) and a Sentry project (DSN) — both free tier. DSN/key supplied at build time (env/secret), not committed.
- Optional follow-up: `sentry-rust-minidump` for native crash capture.

## Quality Gates

**Functional:**

- [ ] With both flags off, **neither SDK initializes** and no network egress occurs (verified by inspecting that no telemetry endpoint is contacted).
- [ ] Alpha build: fresh install defaults both flags **on**; the first-run notice appears exactly once.
- [ ] Switching from stable → alpha (once a channel picker exists) presents the telemetry disclosure at the point of selection.
- [ ] Stable build (or simulated stable channel): fresh install defaults both flags **off**; no first-run notice.
- [ ] Toggling either switch in Settings → Privacy immediately stops/starts that stream and persists across restart.
- [ ] A forced Rust panic, a thrown frontend error caught by `ErrorBoundary`, both appear in Sentry tagged with the correct release version and a merged breadcrumb timeline.
- [ ] A representative `track()` call appears in Aptabase with expected properties; the call is a no-op when the flag is off.
- [ ] **No PII leaves the app:** an instrumented test / manual audit confirms no document content, file paths, prompts, keys, or project names appear in any payload; `before_send` strips `server_name`.
- [ ] Egress originates from Rust; the frontend `http:default` capability and `fs` permissions are unchanged (regression test `tauri-capability-surface.test.ts` still passes).

**Design:**

- [ ] First-run notice and Settings group match the design system (shadcn `switch`, neutral palette, both light/dark + soft contrast).
- [ ] Both toggles have clear labels + one-line descriptions; no dead/ambiguous controls.

**Testing:**

- [ ] Unit tests for default-computation-by-channel and the `track()` no-op gating.
- [ ] `pnpm typecheck`, `pnpm test`, `cargo test`, `pnpm test:e2e` pass.

## Out of Scope

- PostHog migration / advanced product analytics (funnels, cohorts, feature flags, session replay) — the documented graduation path if usage outgrows 20K events/month or richer analysis is needed.
- Self-hosted Aptabase or GlitchTip deployment — kept as a DSN/config-swap fallback, not built now.
- Native minidump crash capture (`sentry-rust-minidump`) — desirable follow-up sub-task; Rust panics + frontend errors ship first.
- Sending `[perf:*]` performance metrics as telemetry — possible later via the same `logger.ts` batch-to-backend pipeline.
- A stable release channel itself — this PRD assumes the channel detection but does not create the stable channel; until one exists, "alpha default-on" governs all users (hence the always-present toggle).
