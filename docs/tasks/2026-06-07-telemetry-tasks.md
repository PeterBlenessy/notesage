# Telemetry: Usage & Quality — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-06-07 |
| **Status** | Complete |
| **PRD** | [2026-06-07-telemetry](../prds/2026-06-07-telemetry.md) |
| **Research** | [telemetry-usage-and-quality](../research/2026-06-07-telemetry-usage-and-quality.md) |
| **Total** | 14 tasks: 2S, 11M, 1L |
| **Suggested order** | Backend (#1–#5) → State + lib (#6–#8) → Instrumentation (#9) → UI (#10–#11) → Tests + docs (#12–#14) |

## Decisions (resolved 2026-06-07)

- **Sentry gating → consent file + live disable.** The frontend writes consent to a Rust-readable file (#3); Sentry initializes at startup only when crash consent is enabled, AND the crash toggle takes effect **immediately at runtime** by dropping the `ClientInitGuard` / disabling the `Hub` on disable and re-initializing on enable. The "applies on restart" shortcut is rejected — the PRD's "stops immediately" gate applies to crashes too.
- **Telemetry in release (CI) builds only.** Keys/DSN come from GitHub Actions secrets (#2); local/dev builds are always telemetry-off (no keys → graceful no-op). Keeps dev activity out of the data.
- **Full taxonomy now.** All 9 events instrumented in the first pass (#9), accepting the larger multi-file diff.
- **Both streams ship together.** Usage (Aptabase) + quality (Sentry) land in one batch rather than phased.

## Residual risks / notes

- **#9 is high blast radius** — it edits ~9 hooks/components. Keep each call site a one-liner through the `track()` helper; no logic, no PII in props. Larger review surface now accepted (full-taxonomy decision).
- **Live-disable correctness (#4)** — dropping/re-creating the Sentry client mid-session must be race-safe; verify a toggle-off truly stops egress and toggle-on resumes, with no panic-hook double-install.
- **Aptabase init is unconditional, gating is at the call site.** `@aptabase/tauri` only emits on explicit `trackEvent`, so the plugin registers always (when a key is present) and the frontend helper (#7) is the gate.
- **Graceful no-key degrade.** Missing app key / DSN (every local build) must compile and run with telemetry simply off, never crash (`option_env!`).

---

## #1 — Add telemetry dependencies ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | both |
| **Dependencies** | — |
| **Files** | `src-tauri/Cargo.toml`, `package.json` |

Add Rust crates `sentry`, `tauri-plugin-sentry` (v0.5), `tauri-plugin-aptabase`; add npm deps `@aptabase/tauri` and (transitive) `@sentry/browser`. Verify versions resolve and the project still builds (`cargo build`, `pnpm install`, `pnpm typecheck`). No wiring yet.

## #2 — Build-time key/DSN injection + CI secrets ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | both |
| **Dependencies** | #1 |
| **Files** | `.env.example`, `src-tauri/build.rs` or `lib.rs` (`env!`/`option_env!`), `.github/workflows/*.yml`, `docs/` |

Provide the Aptabase app key and Sentry DSN at build time via env vars (`option_env!` so a missing value compiles to `None` → telemetry off, never a crash). Document the required GitHub Actions secrets for release builds and add `.env.example` entries. Acceptance: a build with no secrets produces a working app with telemetry disabled; a build with secrets wires them through.

## #3 — Rust telemetry consent state (read at startup, write on change) ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #1 |
| **Files** | `src-tauri/src/commands/telemetry.rs` (new), `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `commands/constants.rs` |

Persist consent (`usage: bool`, `crash: bool`) to a small JSON file in the app config dir (pattern: sync-settings disk file). Add a `telemetry_apply_consent(usage, crash)` command the frontend calls on change. Read the file synchronously at startup so #4 can gate Sentry init. Default when the file is absent: both `false` (Rust can't know the channel — the frontend writes the channel-derived effective values on first run via #6). Unit-test the read/write round-trip.

## #4 — Initialize Sentry (gated, scrubbed, release-tagged) ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #2, #3 |
| **Files** | `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `commands/telemetry.rs` |

If the crash DSN is present AND startup consent (#3) has crash enabled, init the Sentry Rust SDK (`release` = app version, `send_default_pii: false`, `before_send` strips `server_name` + incidental path-bearing fields) and register `tauri-plugin-sentry`; add `sentry:default` to capabilities. **Implement runtime live-disable** (per the locked decision): toggling crash off drops the client guard / disables the Hub so egress stops immediately; toggling on re-initializes without double-installing the panic hook. Acceptance: a forced panic surfaces in Sentry tagged with the version when enabled; toggling off mid-session stops new events; nothing initializes when DSN absent.

## #5 — Register Aptabase plugin ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | #2 |
| **Files** | `src-tauri/src/lib.rs` |

Register `tauri-plugin-aptabase` with the app key (skip registration cleanly if the key is absent). Unconditional — no Rust gating (call-site gating in #7). Verify the app launches with the plugin present and emits nothing until `trackEvent` is called.

## #6 — settings-store: tri-state telemetry fields + effective selectors ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #3 |
| **Files** | `src/stores/settings-store.ts` |

Add `telemetryUsageEnabled: boolean | null`, `telemetryCrashEnabled: boolean | null`, `telemetryNoticeSeen: boolean`, `telemetryInstallId: string` (generate a random UUID on first run), with setters + a "reset analytics ID" action. Add selectors for effective values: `flag ?? (releaseChannel === 'alpha')`. On any change to the effective values, call `telemetry_apply_consent` (#3) so Rust stays in sync. Persist `Full`.

## #7 — `src/lib/telemetry.ts` typed `track()` helper ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #5, #6 |
| **Files** | `src/lib/telemetry.ts` (new) |

Typed `TelemetryEvent` union + per-event prop types (enforce low-cardinality enums, no free text). `track(event, props)` wraps `@aptabase/tauri`'s `trackEvent`, **no-ops when the effective usage flag is off**. Export the event constants. Unit-tested in #12.

## #8 — Crash capture: ErrorBoundary + global handlers ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #4, #6 |
| **Files** | `src/components/ErrorBoundary.tsx`, `src/main.tsx` (or `App.tsx`) |

Report caught React errors from `ErrorBoundary` to Sentry before rendering the fallback; add `window.onerror` / `unhandledrejection` handlers for uncaught frontend errors. All gated on the effective crash flag. Verify a thrown render error and an unhandled rejection both reach Sentry with merged Rust/JS breadcrumbs when enabled, and nothing when disabled.

## #9 — Instrument the event taxonomy (call sites) ✅

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #7 |
| **Files** | `useAppLifecycle.ts` (`app_launched`), `Editor.tsx`/`useFileOperations.ts` (`document_opened`), `useDirectApiChat.ts`/`useAIOperations.ts` (`ai_chat_sent`), bubble-menu AI actions (`ai_action_used`), `useExportOperations.ts` (`export_performed`), `connections-store.ts` (`connection_added`), `useSkillOperations.ts` (`skill_invoked`), MCP call path (`mcp_tool_called`), feature surfaces (`feature_used`) |

Add one `track()` call per taxonomy event at the right site, passing only the low-cardinality props from the PRD table. **High blast radius** — keep each call a single line, no branching/logic in the call site, no PII in props (provider *kind*, not name/url; format, not path). Spot-check each event fires once per action.

## #10 — SystemSettings: "Telemetry" controls group ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #6 |
| **Files** | `src/components/settings/v2/SystemSettings.tsx` |

Add a "Telemetry" `SettingsGroup` directly below the Release channel row: two `switch` rows (**Usage analytics**, **Crash reports**) bound to the effective values + setters; a muted line restating the channel default and that the toggle overrides it; a "Reset analytics ID" button; a "what we collect" link. Match design system (neutral palette, light/dark + soft contrast). Toggling persists and (for usage) takes effect immediately.

## #11 — Channel-selection disclosure + first-run notice ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #6, #10 |
| **Files** | `src/components/settings/v2/SystemSettings.tsx`, `src/hooks/useAppLifecycle.ts`, `src/lib/notifications.ts` |

Inline note under the Release channel selector when Alpha is active (the "what's shared on alpha" copy from the PRD). On a stable → alpha switch via the existing `setReleaseChannel` handler, fire a one-time confirming toast and set `telemetryNoticeSeen`. On app start, if channel is alpha and `!telemetryNoticeSeen`, show the same notice once (non-blocking `sonner` toast with an "Open settings" action). No notice on stable.

## #12 — Frontend unit tests ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #6, #7 |
| **Files** | `src/stores/__tests__/settings-store.test.ts`, `src/lib/__tests__/telemetry.test.ts` (new) |

Cover: effective-value computation (alpha→on, stable→off, explicit override wins, channel switch flips when `null`), `track()` no-op gating when usage off, install-ID generation + reset, and that changing effective values triggers `telemetry_apply_consent`. Use the existing tauri-mock for the command.

## #13 — Backend tests + PII/capability regression guards ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | both |
| **Dependencies** | #3, #4 |
| **Files** | `src-tauri/src/commands/telemetry.rs` (tests), `src/lib/__tests__/tauri-capability-surface.test.ts`, `tauri.conf.json` |

Rust tests for consent read/write + `before_send` scrubbing (asserts `server_name` cleared, no path-bearing fields leak). Confirm `tauri-capability-surface.test.ts` still passes (only `sentry:default` added; no `fs:allow-*`, `http:default` unchanged). Verify no `tauri.conf.json` CSP `connect-src` rule blocks the backend egress endpoints. Add a guard/assertion that the usage `track()` payload contains only allow-listed props.

## #14 — Documentation: "what we collect" + architecture ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #9, #10, #11 |
| **Files** | `docs/architecture.md`, `README.md` / privacy doc, target of the "what we collect" link |

Write the user-facing "what we collect / what we never send" page the Settings link points to. Update `docs/architecture.md` (new `telemetry.rs` command, settings-store fields, the consent-file mechanism, and a short Telemetry section under Security Model). State the channel-based default and the opt-out clearly.
