# Telemetry for Usage & Quality — Free Options for Notesage

**Date:** 2026-06-07 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [2026-06-07-telemetry.md](../prds/2026-06-07-telemetry.md) | Drafted |

Notesage ships frequent alpha releases but has no signal beyond the maintainer's manual testing — no view into which features are used, where the app crashes, or how it performs in the wild. This document evaluates **free** telemetry options that respect Notesage's privacy-first positioning, covering both halves of the question: **usage** (product analytics) and **quality** (crash/error reporting). It updates and extends the prior analytics-only survey in [`telemetry-analytics-options.md`](telemetry-analytics-options.md) (2026-03-25), which should be read as the deeper reference on the pure-analytics platforms (PostHog self-hosting footprint, Countly, GA4, Datadog).

---

## Executive Summary

"Understand usage and quality" is really two jobs, and the cleanest free setup uses **one tool for each**:

1. **Usage analytics → Aptabase.** It remains the only platform with a first-party Tauri v2 plugin (`tauri-plugin-aptabase`), is privacy-first by design (no cookies, no PII, no cross-app tracking), and its free cloud tier (20,000 events/month, no overage charges) is comfortable for an alpha-stage user base. Integration is ~10 lines. Unchanged from the prior research and still the recommendation for the "which features get used" question.

2. **Quality / crashes → Sentry via `tauri-plugin-sentry`.** This is the major addition since the last review. The plugin (`timfish/sentry-tauri`, Tauri v2, v0.5) captures **Rust panics, frontend JavaScript errors, and native minidump crashes** in one merged timeline — backend and frontend breadcrumbs share context. Sentry's free Developer plan gives 5,000 errors/month with 30-day retention. Crucially, the plugin is **DSN-based**, so the *same code* can point at a free self-hosted **GlitchTip** instance (Sentry-protocol compatible, runs on a 2 GB VPS) if 5K errors/month is ever exceeded or you want full data ownership — a zero-code-change escape hatch.

**A key Notesage-specific insight:** prefer **backend-originated** telemetry. The 2026-04-19 capability hardening locked `http:default` to the GitHub release endpoint only and granted no `fs:allow-*`. Tauri capabilities govern the *JS* HTTP plugin, not Rust `reqwest` — so anything sent from the Rust side (Aptabase plugin, Sentry Rust SDK, PostHog Rust SDK) ships without widening the frontend's network surface. `tauri-plugin-sentry` is purpose-built for exactly this: it routes frontend errors *through Rust via `invoke`* rather than letting the WebView phone home directly. And Notesage already has the perfect on-ramp — `src/lib/logger.ts` batches `[perf:*]` entries and flushes them to the Rust backend over IPC. Telemetry events can ride that same batch-to-backend pipeline, keeping all egress in Rust.

**If you'd rather run one tool instead of two: PostHog** does both analytics and error tracking with a very generous free tier (1M events/month, events anonymous by default). The trade-offs are no Tauri plugin (wire up the Rust SDK + reverse proxy yourself) and a heavier mental model. Good "graduation" target if Notesage outgrows the two-tool setup; overkill to start.

**Consent (channel-based):** Given the privacy-first brand, the default is tied to the **release channel** — **alpha defaults on, stable defaults off (opt-in)** — exposed as a Settings > Privacy toggle that the user can flip either way. The channel only sets the toggle's initial value; the toggle itself is the single opt-out mechanism (no separate env/kill-switch concept). An honest one-time first-run notice on alpha keeps this on the right side of VS Code's much-criticized opt-out default. Obsidian's "collect nothing" stance is the bar Notesage is implicitly measured against, so transparency and an honest default matter more here than for a typical app.

**Recommended path:** Aptabase (usage) + Sentry free tier or self-hosted GlitchTip (quality), channel-gated (alpha on, stable opt-in), both sending from the Rust backend.

---

## Part 1 — Quality: Crash & Error Reporting

This is the half the prior doc treated only in passing, and it's the higher-value half for "frequent alphas with no signal." A single unhandled panic or a white-screen React error that you never hear about is worse than not knowing your feature-usage split.

### 1.1 Sentry via `tauri-plugin-sentry` (recommended for quality)

| Attribute | Details |
| --- | --- |
| **Type** | Error & crash reporting (Rust panics, JS errors, native minidumps), light performance tracing |
| **Plugin** | [`timfish/sentry-tauri`](https://github.com/timfish/sentry-tauri) — `tauri-plugin-sentry` v0.5, Tauri v2 |
| **License** | Open source, permissive (verify MIT/Apache-2.0 on the repo); Sentry server itself is BSL, self-hostable |
| **Free cloud tier** | Sentry Developer plan: **5,000 errors/month**, 10K perf units, 30-day retention, 1 dashboard user |
| **Self-hosted** | Yes — point the DSN at self-hosted Sentry or GlitchTip (see §1.2) |
| **Privacy** | You control `beforeSend`; can scrub PII, file paths, message contents before egress |
| **Egress origin** | Rust backend (frontend events routed through Rust via `invoke`) — no new JS network permission |

**How it works.** The plugin injects and initializes `@sentry/browser` in every WebView, then intercepts browser events/breadcrumbs via `beforeSend`/`beforeBreadcrumb` and forwards them to the **Rust** Sentry SDK through the Tauri `invoke` bridge. The result is a single event timeline where a frontend React error is enriched with Rust, OS, and device context, and you can see what the Rust backend was doing at the moment of a crash. Optional `sentry-rust-minidump` integration captures **native crashes** (e.g. a segfault in llama-server's process tree or a WebView crash) from a separate crash-reporter process — the cases a panic hook alone cannot catch.

**Setup (sketch):**

```toml
# src-tauri/Cargo.toml
sentry = "0.34"
tauri-plugin-sentry = "0.5"
```

```rust
// src-tauri/src/lib.rs
let client = sentry::init(("https://YOUR_DSN@o0.ingest.sentry.io/0", sentry::ClientOptions {
    release: sentry::release_name!(),
    // strip anything sensitive before it leaves the machine
    before_send: Some(std::sync::Arc::new(|mut event| {
        event.server_name = None;            // no hostname
        Some(event)
    })),
    ..Default::default()
}));

tauri::Builder::default()
    .plugin(tauri_plugin_sentry::init(&client))
    // ...
```

```jsonc
// src-tauri/capabilities/default.json — add:
"sentry:default"
```

**Strengths**

- The only option that captures **all three** failure classes (Rust panic, JS error, native crash) with shared context.
- DSN-based → swap cloud ↔ self-hosted GlitchTip with no code change.
- Frontend errors egress through Rust — fits Notesage's locked-down capability surface.
- Release tracking maps crashes to alpha versions (`0.46.0-alpha.x`), which is exactly the "frequent alpha" use case.
- `beforeSend` gives a single, auditable scrub point for privacy.

**Weaknesses**

- Free tier is **5K errors/month** — fine for crashes, but if you log noisy non-fatal errors it fills fast. Mitigate with sampling and by reserving Sentry for genuine errors.
- Community plugin (not tauri-apps core), though widely used and the de-facto standard for Tauri + Sentry.
- Pulls in the `sentry` Rust SDK and `@sentry/browser` (bundle/binary size cost).

### 1.2 GlitchTip (free self-hosted, Sentry-compatible)

| Attribute | Details |
| --- | --- |
| **Type** | Open-source error tracking (Sentry SDK protocol compatible) + uptime + basic perf |
| **License** | Open source (MIT) |
| **Cost** | **Free to self-host**; hosted plans from $15/mo |
| **Footprint** | Django web app + Celery worker + PostgreSQL + Redis — comfortable on a 2 GB VPS; scales to a few million events/month on one node |
| **Client code** | **Uses the same Sentry SDKs** — change only the DSN; `tauri-plugin-sentry` works unchanged |
| **Latest** | GlitchTip 6 (Feb 2026): improved stack traces, performance work |

GlitchTip is the "free forever" answer for the quality half. Because it speaks the Sentry protocol, the exact `tauri-plugin-sentry` integration from §1.1 points at it by swapping the DSN — no second integration to build or maintain. It's a fraction of Sentry's self-host footprint (4 containers vs ~40). Pick this if you want zero per-month limits and full data ownership and are willing to run a small VPS; pick Sentry cloud free tier if you'd rather not run infrastructure yet. The decision is reversible at any time.

### 1.3 Aptabase panic hook (minimal, no extra tool)

Aptabase (see Part 2) ships a Rust **panic hook** that reports panics as analytics events — see [Aptabase's "Catching panics on Tauri apps"](https://aptabase.com/blog/catching-panics-on-tauri-apps). This covers Rust panics only (not frontend React errors or native minidumps) and gives you a panic *count* rather than Sentry's grouped, deduplicated, stack-traced issues. It's a reasonable **stop-gap** if you adopt Aptabase first and want *some* crash signal before standing up Sentry/GlitchTip — but it is not a substitute for a real error tracker once you care about diagnosing crashes.

---

## Part 2 — Usage: Product Analytics

Largely unchanged from the prior research; summarized here with 2026 verification. See [`telemetry-analytics-options.md`](telemetry-analytics-options.md) for the full six-way comparison (Countly, GA4, Datadog, OpenTelemetry/SigNoz).

### 2.1 Aptabase (recommended for usage)

| Attribute | Details |
| --- | --- |
| **Plugin** | [`aptabase/tauri-plugin-aptabase`](https://github.com/aptabase/tauri-plugin-aptabase) — first-party, Tauri v2, on crates.io |
| **License** | AGPL-3.0 (server), MIT (SDKs) |
| **Free cloud tier** | **20,000 events/month**, no credit card, **no overage fees** (analytics pauses until next month if exceeded; email warning near the cap) |
| **Self-hosted** | Free, Docker + PostgreSQL |
| **Privacy** | No cookies, no PII, no cross-app tracking; GDPR/CCPA by design; EU or US data residency |
| **Egress origin** | Rust backend plugin — handles batching, offline queue, retry |

Still the lowest-effort, best-privacy-fit option for "which features get used." The plugin owns batching/offline/retry, so you call `trackEvent("export_pdf", { template })` and forget about it. Limits: basic analytics only (event counts, DAU/MAU, properties) — no funnels/cohorts. 20K/month math: ~100 DAU × ~5 events × 30 days ≈ 15K, so the free tier fits an alpha audience. Plugin is actively maintained and Tauri-v2-compatible.

```rust
// src-tauri/src/lib.rs
.plugin(tauri_plugin_aptabase::Builder::new("A-EU-XXXXXXXX").build())
```
```typescript
import { trackEvent } from "@aptabase/tauri";
trackEvent("ai_chat_sent", { provider: "anthropic", path: "direct" });
```

### 2.2 PostHog (one-tool alternative: analytics + errors)

| Attribute | Details |
| --- | --- |
| **Type** | Full product analytics (funnels, cohorts, retention, feature flags, session replay) **+ error tracking** |
| **Tauri** | No plugin — Rust SDK (`posthog-rs`) and/or `posthog-js`; reverse proxy recommended for reliability |
| **Free tier** | **1,000,000 events/month**, 5K session replays, 1M feature-flag requests; events **anonymous by default** (and anonymous events are cheaper if you ever pay) |
| **Self-hosted** | Free but heavy (ClickHouse + Kafka + Redis + PostgreSQL) |
| **License** | MIT (core) |

PostHog is the strongest *single* tool if you want usage **and** quality in one dashboard, and 1M free events dwarfs Aptabase's 20K. The cost is integration effort (no Tauri plugin; wire the Rust SDK, give backend events a `distinct_id` that matches the frontend's) and a reverse proxy for production reliability/ad-blocker resilience. **Feature flags** are a notable bonus for an alpha workflow — gate risky features and watch their adoption. Recommended as the **graduation target** if the two-tool setup ever feels limiting, not the starting point.

---

## Comparison

| Criterion | Aptabase | Sentry (`tauri-plugin-sentry`) | GlitchTip | PostHog |
| --- | --- | --- | --- | --- |
| **Primary job** | Usage analytics | Crash/error quality | Crash/error quality | Usage **+** errors |
| **Tauri v2 plugin** | Yes (first-party) | Yes (community, de-facto) | via Sentry plugin (same DSN) | No |
| **Free limit** | 20K events/mo | 5K errors/mo (cloud) | Unlimited (self-host) | 1M events/mo |
| **Self-host free** | Yes (light) | Yes (heavy) | **Yes (light, 2 GB VPS)** | Yes (heavy) |
| **Captures Rust panics** | Yes (count only) | Yes (grouped + stack) | Yes (grouped + stack) | Manual |
| **Captures JS/React errors** | No | Yes (merged context) | Yes (merged context) | Yes (manual/auto) |
| **Captures native crashes** | No | Yes (minidump) | Yes (minidump) | No |
| **Egress from Rust backend** | Yes | Yes (frontend via invoke) | Yes | Yes (Rust SDK) |
| **Privacy default** | PII-free by design | `beforeSend` scrub | `beforeSend` scrub + own server | anonymous by default |
| **Integration effort** | ~10 lines | ~20 lines | ~20 lines (+VPS) | ~30 lines (+proxy) |

---

## Part 3 — Consent & Opt-In UX

How comparable apps handle it, and what fits Notesage:

| App | Posture | Reception |
| --- | --- | --- |
| **Obsidian** | Collects **nothing** | The privacy gold standard; sets user expectations Notesage is judged against |
| **VS Code** | **Opt-out** (on by default, in-product notice) | Persistently criticized; "some data leaks before you can disable it" |
| **Claude Code** | **Opt-in**, prompts redacted/scrubbed by default | Accepted as privacy-respecting |
| **Firefox** | Opt-out for aggregate, opt-in for detailed | Mixed, but transparent |

**Recommendation for Notesage — channel-based default (decided 2026-06-07):**

The naive "opt-in, default off everywhere" posture has a fatal flaw for this use case: opt-in telemetry gets **<5% participation**, so on an alpha-only product it would yield almost no data — defeating the purpose. The decision is to tie the default to the **release channel**, treating alpha users as testers in an explicit value exchange (bleeding-edge features ↔ usage/crash signal), while keeping stable conservative:

| Channel | Usage analytics | Crash reports | Opt out via |
| --- | --- | --- | --- |
| **Alpha** | Default **ON** | Default **ON** (PII-scrubbed) | The Settings > Privacy toggle |
| **Stable** | Opt-in (default **OFF**) | Opt-in (default **OFF**) | The Settings > Privacy toggle (already off) |

Design rules:

1. **Default-on, but never no-opt-out.** A hard "cannot disable" stance is what draws backlash (not default-on itself) — and it's illusory for an open-source app anyway, since a privacy-conscious user can build from source without it. Keeping a visible toggle costs ~nothing in data (almost nobody flips a default-on switch) and avoids the "they removed my choice" reaction. So alpha is **default-on with the toggle present**, not locked. The toggle is the *single* opt-out mechanism — the channel only sets its initial value; there is deliberately no separate env/`DO_NOT_TRACK` kill switch (redundant for a desktop app at this scale, and the in-app toggle already covers the need).
2. **Honest first-run notice** (alpha): a one-time non-blocking banner/toast — "Alpha builds share anonymous usage and crash reports to stabilize fast-moving features. This is on by default; turn it off in Settings > Privacy. No document content, file contents, or AI prompts are ever sent." Transparency is what converts "sneaky" into "fair."
3. **Settings > Privacy toggles** (the natural home — the Approvals panel already lives there): two independent switches — **Usage analytics** and **Crash reports** — so a user can keep crash reports (helps fix *their* bugs) without usage tracking, or neither.
4. **Persist in `settings-store`** as `telemetryUsageEnabled` / `telemetryCrashEnabled`. **Defaults are computed from the build channel** (alpha → `true`, stable → `false`) on first run, then user-overridable and persisted. Gate every `trackEvent` / SDK init on the flag; if a stream is off, don't initialize that SDK at all.
5. **Channel detection** is compile-time/version-string based — Tauri exposes the version (`0.46.0-alpha.x`); a `cfg`/build flag or a parse of the pre-release suffix decides the default. (See "Timing" caveat below.)
6. **Anonymous random install ID** — a UUID generated locally, never tied to identity, used only for DAU/retention. No account, no email, no IP storage where avoidable (Aptabase already drops PII; for Sentry set `send_default_pii: false`). Offer a "reset analytics ID" button.
7. **PII risk is asymmetric.** Mandatory-by-default is most defensible for the **anonymous usage stream** (Aptabase, no-PII by design). **Crash reports are riskier** — stack traces/breadcrumbs can incidentally carry file paths containing usernames — so they require solid `beforeSend` scrubbing and the disclosed honest claim before shipping default-on. GDPR applies (maintainer is EU-based); "legitimate interest" is the lawful basis, which is why the in-app toggle (a means to object) and the honest first-run notice are not optional.

**Timing caveat:** there is **no stable channel today** — Notesage ships alpha-only (`0.46.0-alpha.12`). So "always on for alpha, off for stable" currently means **on for everyone**. The stable-opt-in half is forward-looking and activates when a stable channel is actually cut; this is an argument *for* keeping the alpha toggle from day one, since every current user is on the default-on side.

This posture lets Notesage make the same honest claim as Claude Code (and stay clearly on the privacy-respecting side of the VS Code line) while actually collecting usable data during the alpha phase.

---

## Part 4 — What to Track

Keep the taxonomy small, stable, and PII-free. Properties are low-cardinality enums, never free text, paths, or content.

**Usage (Aptabase / PostHog):**

| Event | Properties | Answers |
| --- | --- | --- |
| `app_launched` | `version`, `os` | DAU/MAU, version adoption across alphas |
| `document_opened` | `format` (md/epub/pdf/docx/pptx/code) | Which viewers matter |
| `ai_chat_sent` | `path` (direct/acp/copilot-lsp/local-bundled), `provider_kind` | Which AI paths are actually used |
| `ai_action_used` | `action` (improve/summarize/expand) | Bubble-menu value |
| `export_performed` | `format` (pdf/docx/pptx/html), `template` | Export feature value |
| `connection_added` | `provider_kind` | Provider mix (no keys, no URLs) |
| `skill_invoked` / `mcp_tool_called` | `source` (bundled/user/project) | Skills/MCP adoption |
| `feature_used` | `feature` (focus_mode, cmd_bar_pin, recording, etc.) | Quiet Composer surface adoption |

**Quality (Sentry / GlitchTip):**

- Unhandled Rust panics (automatic via panic hook / SDK).
- Unhandled frontend exceptions + React error-boundary catches (`ErrorBoundary.tsx` is the natural capture point — report there before showing the fallback).
- Native crashes via minidump (llama-server / WebView).
- Tag every event with `release = app version` so crashes attribute to the alpha that introduced them.
- **Optionally** treat existing `[perf:*]` metrics (startup, doc-switch, save) as numeric properties or Sentry performance spans — the `logger.ts` batch pipeline already collects them; this turns "quality" into both *crashes* and *performance regressions across alphas*.

**Never send:** document content, file names/paths, AI prompts or completions, API keys, project names, search queries, or anything user-authored. Scrub in `beforeSend` (Sentry) and rely on Aptabase's no-PII design.

---

## Recommendation

**Phase 1 — Quality first (highest value for frequent alphas).** Add `tauri-plugin-sentry` pointed at the **Sentry free Developer plan** (5K errors/mo). Capture Rust panics, wire `ErrorBoundary.tsx` to report frontend errors, tag with release version. This immediately replaces "I only hear about crashes if someone tells me" with grouped, stack-traced, per-alpha issues. Gate on `telemetryCrashEnabled`, scrub PII in `beforeSend`.

**Phase 2 — Usage.** Add `tauri-plugin-aptabase` (cloud free tier, 20K/mo) with the small event taxonomy above. Gate on `telemetryUsageEnabled`. Reuse the `logger.ts` batch-to-backend mechanism so all egress originates in Rust.

**Phase 3 — Consent UX (channel-based).** Compute the default from the release channel — alpha **on**, stable **off** — with two independent Settings > Privacy toggles (usage / crashes) as the single opt-out. Show an honest one-time first-run notice on alpha. Ship this *with* Phase 1/2, not after, and ensure crash-report PII scrubbing is in place before crash reporting goes default-on.

**Phase 4 — Scale/own the data (only if needed).** If 5K errors/mo is tight or you want full ownership, stand up **GlitchTip** on a 2 GB VPS and swap the Sentry DSN (no code change). If usage outgrows 20K events/mo or you need funnels/cohorts/feature-flags, evaluate **PostHog** (1M free) as a consolidation that can absorb both jobs.

This keeps everything free, privacy-respecting, backend-originated (no widening of the hardened capability surface), and reversible at each step.

---

## Open Questions

- **Sentry vs. GlitchTip from day one?** Cloud free tier is zero-ops but caps at 5K errors/mo and stores data on Sentry's servers; GlitchTip is free-forever and self-owned but needs a VPS. Recommend starting on Sentry cloud and keeping GlitchTip as the documented fallback (same DSN swap).
- **One tool (PostHog) or two (Aptabase + Sentry)?** Two tools give a better Tauri-native experience and a clearer privacy story now; one tool is simpler to operate later. Defaulting to two for the alpha phase.
- **Should `[perf:*]` metrics feed telemetry?** The pipeline exists in `logger.ts`. Sending aggregate startup/doc-switch timings would catch performance regressions across alphas — valuable, but adds event volume against the 20K Aptabase cap. Decide during PRD.
- **Install-ID strategy** — random UUID per install vs. per-launch ephemeral. Per-install enables retention/DAU but is a (weak) identifier; per-launch is more private but loses retention. Lean per-install with a clear "reset analytics ID" button in Settings.
- **Capability/CSP check** — confirm the Rust-side `reqwest` egress for the chosen endpoints isn't caught by any CSP `connect-src` restriction; backend egress should be clean, but verify against `tauri.conf.json` before implementation.
