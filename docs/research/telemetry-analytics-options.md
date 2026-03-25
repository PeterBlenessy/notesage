# Free Telemetry & Analytics Options for Notesage

**Date:** 2026-03-25 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | — | Not yet planned |

Notesage currently has no usage telemetry or crash reporting. Understanding which features are used, where users hit errors, and how the app performs would inform roadmap decisions and improve reliability — without compromising the privacy-first principles that define the product.

---

## Executive Summary

Six options were evaluated, ranging from a purpose-built Tauri plugin to enterprise observability platforms. The key trade-off is simplicity vs. depth, with privacy as a hard constraint.

**Aptabase** is the strongest fit. It's the only analytics platform with a first-party Tauri v2 plugin (`tauri-plugin-aptabase`), is open source (AGPL-3.0), privacy-first by design (no cookies, no PII, GDPR-compliant), and offers both a free cloud tier (20K events/month) and a free self-hosted option. Integration is \~10 lines of Rust + a JS import.

**PostHog** is the most powerful option with a generous free tier (1M events/month), an official Rust SDK, and full product analytics (funnels, cohorts, feature flags, session replay). However, it has no Tauri plugin — integration requires manual HTTP calls or the Rust SDK, and the platform is heavier to self-host (requires ClickHouse + Kafka + Redis + PostgreSQL).

**OpenTelemetry + SigNoz/Grafana** is the most flexible option for detailed performance tracing and error diagnostics, but it's infrastructure-heavy and designed for backend observability rather than product analytics. Overkill for "which features do users click" questions.

**Countly** is a mature platform with desktop support and a free self-hosted Community Edition, but requires significant infrastructure (MongoDB 6+, 4 vCPU, 8 GB RAM) and is AGPL-licensed.

**Google Analytics / Firebase** offers unlimited free events but sends data to Google's ad infrastructure — a dealbreaker for a privacy-first app. **Datadog** is enterprise infrastructure monitoring priced per host — wrong tool entirely.

**Recommendation:** Start with **Aptabase** (cloud free tier) for basic feature usage tracking. If deeper product analytics are needed later, evaluate PostHog. Keep telemetry opt-in with a clear toggle in Settings.

---

## 1. Aptabase

Purpose-built, privacy-first analytics for desktop and mobile apps.

| Attribute | Details |
| --- | --- |
| **Type** | Product analytics (events + properties) |
| **License** | AGPL-3.0 (server), MIT (SDKs) |
| **Tauri support** | First-party plugin: `tauri-plugin-aptabase` (Tauri v2 compatible) |
| **Cloud free tier** | 20K events/month, no credit card required |
| **Self-hosted** | Free, Docker-based, you maintain it |
| **Privacy** | No cookies, no PII, no cross-app tracking. GDPR/CCPA compliant by design |
| **Data residency** | EU or US cloud regions, or self-hosted anywhere |
| **GitHub** | [aptabase/aptabase](https://github.com/aptabase/aptabase) — 5K+ stars |

**Integration complexity: Very low**

Rust (`lib.rs`):

```rust
use tauri_plugin_aptabase::EventTracker;

tauri::Builder::default()
    .plugin(tauri_plugin_aptabase::Builder::new("A-YOUR-APP-KEY").build())
    // ...
```

Frontend (TypeScript):

```typescript
import { trackEvent } from "@aptabase/tauri";

trackEvent("file_opened", { format: "markdown" });
trackEvent("ai_chat_sent", { provider: "anthropic" });
```

**Strengths:**

- Lowest integration effort — Tauri plugin handles batching, offline queuing, and retry
- Privacy-first design aligns with Notesage's principles
- Dashboard is simple and focused (daily/monthly active users, event counts, properties)
- Build mode separation (debug events excluded from production analytics)
- Panic hook logging for crash reporting

**Weaknesses:**

- 20K events/month is tight if tracking many event types per user
- No funnels, cohorts, or advanced product analytics
- Smaller community than PostHog
- Self-hosted requires maintenance (Docker + PostgreSQL)

---

## 2. PostHog

Full product analytics platform with a generous free tier.

| Attribute | Details |
| --- | --- |
| **Type** | Full product analytics (events, funnels, cohorts, feature flags, session replay) |
| **License** | MIT (PostHog itself), proprietary enterprise features |
| **Tauri support** | No plugin — use Rust SDK (`posthog-rs`) or JS SDK |
| **Cloud free tier** | 1M events/month, 5K session replays, 1M feature flag requests |
| **Self-hosted** | Free, but requires ClickHouse + Kafka + Redis + PostgreSQL |
| **Privacy** | Configurable — can disable PII collection, supports EU hosting |
| **GitHub** | [PostHog/posthog](https://github.com/PostHog/posthog) — 25K+ stars |

**Integration complexity: Medium**

Rust (via `posthog-rs`):

```rust
use posthog_rs::{Client, Event};

let client = Client::new("phc_YOUR_KEY");
let mut event = Event::new("ai_chat_sent", "user_anonymous_id");
event.insert_prop("provider", "anthropic")?;
client.capture(event).await?;
```

Frontend (via JS SDK):

```typescript
import posthog from 'posthog-js';
posthog.init('phc_YOUR_KEY', { api_host: 'https://app.posthog.com' });
posthog.capture('file_opened', { format: 'markdown' });
```

**Strengths:**

- 1M events/month free — 50x more than Aptabase
- Full product analytics: funnels, retention, cohort analysis
- Feature flags and A/B testing built in
- Official Rust SDK with async support
- Session replay (web-based, may not apply to Tauri WebView)
- Very active development and community

**Weaknesses:**

- No Tauri plugin — must wire up Rust SDK manually and handle batching/offline yourself
- Self-hosting is heavy (ClickHouse cluster for production)
- More data collected by default — requires careful configuration to stay privacy-first
- Overkill for simple "what features are used" analytics

---

## 3. OpenTelemetry + SigNoz

Observability framework for traces, metrics, and logs — backed by a free self-hosted dashboard.

| Attribute | Details |
| --- | --- |
| **Type** | Observability (traces, metrics, logs) — not product analytics |
| **License** | Apache-2.0 (OpenTelemetry), MIT/Apache-2.0 (SigNoz) |
| **Tauri support** | No plugin — use `opentelemetry` Rust SDK |
| **Cloud free tier** | SigNoz cloud: 30-day trial. Uptrace: free tier with limited retention |
| **Self-hosted** | Free (SigNoz: Docker, requires ClickHouse) |
| **Privacy** | Full control — you define what's collected |
| **GitHub** | [open-telemetry/opentelemetry-rust](https://github.com/open-telemetry/opentelemetry-rust) — 2K+ stars |

**Integration complexity: High**

Requires `opentelemetry`, `opentelemetry-sdk`, `opentelemetry-otlp`, and `tracing-opentelemetry` crates. Must configure an OTLP exporter pointing to a SigNoz/Grafana/Jaeger instance.

**Strengths:**

- Industry standard for observability
- Deep performance tracing (spans, traces, latency histograms)
- Integrates with Rust `tracing` crate (already used in Notesage for logging)
- Full control over data pipeline
- Vendor-neutral — can switch backends (SigNoz, Grafana, Jaeger, Datadog)

**Weaknesses:**

- Designed for backend/service observability, not product analytics
- No built-in "daily active users" or "feature usage" dashboards
- Significant infrastructure overhead for self-hosting
- Integration is complex — many crates, configuration, and exporter setup
- Wrong tool for the job if the goal is "which features do users use"

---

## 4. Countly

Mature analytics platform with mobile/desktop focus.

| Attribute | Details |
| --- | --- |
| **Type** | Product analytics + engagement (push notifications, surveys) |
| **License** | AGPL-3.0 (Community Edition) |
| **Tauri support** | No plugin — would need custom HTTP integration or JS SDK |
| **Cloud free tier** | Countly Lite: free self-hosted. Cloud: paid only |
| **Self-hosted** | Free Community Edition, Docker-based |
| **Privacy** | Self-hosted = full data ownership |
| **Requirements** | 4 vCPU, 8 GB RAM, MongoDB 6+ |
| **GitHub** | [Countly/countly-server](https://github.com/Countly/countly-server) — 5K+ stars |

**Strengths:**

- Designed for mobile/desktop apps (not just web)
- Mature platform (10+ years)
- Crash reporting, user profiles, engagement tools
- Free Community Edition

**Weaknesses:**

- Heavy infrastructure requirements (4 vCPU, 8 GB RAM, MongoDB)
- No Tauri plugin — custom integration needed
- AGPL license for server may conflict with some deployment models
- Overkill for initial telemetry needs

---

## 5. Google Analytics / Firebase Analytics

Google's free analytics platform, usable from desktop apps via the Measurement Protocol.

| Attribute | Details |
| --- | --- |
| **Type** | Product analytics (events, audiences, funnels, attribution) |
| **License** | Proprietary (free service) |
| **Tauri support** | No plugin — use GA4 Measurement Protocol (raw HTTP POST) or Firebase JS SDK |
| **Cloud free tier** | Unlimited events, up to 500 distinct event types. Always free — no paid tier for Analytics |
| **Self-hosted** | Not available — Google-hosted only |
| **Privacy** | Data used by Google for ad targeting and ML products. Users can be identified cross-platform. Not GDPR-friendly without significant configuration |
| **Data residency** | Google Cloud (US/EU), no self-hosting option |
| **Docs** | [Measurement Protocol (GA4)](https://developers.google.com/analytics/devguides/collection/protocol/ga4) |

**Integration via Measurement Protocol:**

```rust
// HTTP POST to Google Analytics from Rust backend
let body = serde_json::json!({
    "client_id": anonymous_device_id,
    "events": [{
        "name": "file_opened",
        "params": { "format": "markdown" }
    }]
});
reqwest::Client::new()
    .post(format!(
        "https://www.google-analytics.com/mp/collect?measurement_id={}&api_secret={}",
        measurement_id, api_secret
    ))
    .json(&body)
    .send()
    .await?;
```

**Strengths:**

- Completely free with unlimited events — no tier limits
- Mature platform with funnels, audiences, retention analysis
- Measurement Protocol works from any HTTP client (Rust, TypeScript)
- Real-time event dashboard
- Firebase Analytics is the same backend with mobile SDKs

**Weaknesses:**

- **Privacy conflict**: Google uses analytics data for ad targeting and cross-platform user profiling. Directly contradicts Notesage's privacy-first positioning.
- No Tauri plugin — must implement HTTP calls, batching, offline queuing manually
- Firebase JS SDK has known `unauthorized-domain` auth errors in Tauri's WKWebView
- No self-hosting option — data lives on Google's servers
- Google may deprecate or change the Measurement Protocol (they've done it before: Universal Analytics → GA4 migration)
- Terms of Service require a privacy policy disclosing Google Analytics usage

**Verdict:** Free and unlimited, but the privacy trade-off is a dealbreaker for a privacy-first app. Users who choose Notesage for local-first, cloud-optional AI would not expect their usage data sent to Google's ad infrastructure.

---

## 6. Datadog

Enterprise observability platform for infrastructure, APM, and logs.

| Attribute | Details |
| --- | --- |
| **Type** | Infrastructure monitoring, APM, log management, RUM |
| **License** | Proprietary |
| **Tauri support** | No plugin — Rust tracing integration via `tracing-datadog` or HTTP API |
| **Cloud free tier** | 5 hosts, 1-day metric retention, limited to infrastructure metrics |
| **Self-hosted** | Not available — Datadog-hosted only |
| **Pricing** | $15-27/host/month (Pro/Enterprise). APM, logs, RUM charged separately by volume |
| **Privacy** | Cloud-only — data on Datadog's servers (US/EU regions) |
| **Website** | [datadoghq.com/pricing](https://www.datadoghq.com/pricing/) |

**Strengths:**

- Industry-leading APM and infrastructure monitoring
- Real User Monitoring (RUM) product for frontend performance
- Official Rust integration via tracing ecosystem
- Excellent dashboards and alerting

**Weaknesses:**

- **Wrong tool for the job**: Designed for server infrastructure and microservices, not desktop app product analytics. No "daily active users" or "feature usage" concepts.
- **Expensive**: Per-host pricing model doesn't map to desktop apps. RUM is $1.50/1000 sessions. Custom metrics incur overages.
- **No free product analytics tier**: The free tier covers infrastructure metrics only (5 hosts, 1-day retention)
- No self-hosting — cloud only
- No Tauri plugin
- Billing complexity: modular pricing with separate charges for each product (APM, logs, RUM, security)

**Verdict:** Enterprise infrastructure monitoring, not product analytics. Would cost money for minimal insight into desktop app usage. Not a fit for Notesage.

---

## Comparison

| Criterion | Aptabase | PostHog | OpenTelemetry + SigNoz | Countly | Google/Firebase | Datadog |
| --- | --- | --- | --- | --- | --- | --- |
| **Tauri v2 plugin** | Yes (first-party) | No | No | No | No | No |
| **Integration effort** | \~10 lines | \~30 lines + SDK setup | \~100 lines + infra | \~50 lines + SDK | \~30 lines (HTTP) | \~50 lines + SDK |
| **Free cloud events** | 20K/month | 1M/month | Varies by backend | Paid only | Unlimited | Infra only (no events) |
| **Free self-hosted** | Yes | Yes (heavy) | Yes (heavy) | Yes (heavy) | No | No |
| **Privacy by default** | Yes | Configurable | Full control | Self-hosted = yes | No (ad ecosystem) | Cloud-only |
| **Product analytics** | Basic (events, DAU) | Full (funnels, cohorts) | No (observability) | Full | Full (funnels, audiences) | No (infra monitoring) |
| **Crash reporting** | Panic hook | Error tracking add-on | Traces/logs | Built-in | Crashlytics (mobile) | Error tracking (paid) |
| **Offline support** | Built into plugin | Manual | Manual | Manual | Manual | Manual |
| **Best for** | Simple feature tracking | Deep product analytics | Performance debugging | Engagement analytics | Free unlimited (if privacy ok) | Server infrastructure |

---

## Recommendation

**Phase 1: Aptabase (cloud free tier)**

Start with Aptabase — it's the path of least resistance:

1. Add `tauri-plugin-aptabase` to Cargo.toml and `@aptabase/tauri` to package.json
2. Initialize in `lib.rs` with an app key
3. Add `trackEvent()` calls for key user actions (file open, AI chat, export, connection added)
4. Add an opt-in/opt-out toggle in Settings (default: off, respecting privacy-first principles)
5. 20K events/month is sufficient for early-stage usage tracking with a small user base

**Phase 2 (if needed): Evaluate PostHog**

If Notesage grows beyond 20K events/month or needs funnels/cohorts/feature flags:

- PostHog's 1M free events and Rust SDK make it a natural upgrade
- Can run alongside or replace Aptabase
- Self-hosting is viable but requires more infrastructure

**What to track (suggested initial events):**

- `app_launched` — daily active users
- `file_opened` — format (md, epub, pdf, docx)
- `ai_chat_sent` — provider type (anthropic, openai, ollama, local)
- `ai_action_used` — action (improve, summarize, expand)
- `export_pdf` — template used
- `connection_added` — provider type
- `error_occurred` — error category (not the message — no PII)

---

## Open Questions

- Should telemetry be opt-in (default off) or opt-out (default on with clear disclosure)? Given Notesage's privacy-first positioning, opt-in is safer.
- Is 20K events/month enough? Depends on user count and event granularity. With \~100 DAU tracking \~5 events each, that's \~15K/month — fits the free tier.
- Do we need crash reporting separately? Aptabase's panic hook covers Rust panics. Frontend errors would need a separate mechanism (or PostHog's error tracking).
- Should we track any performance metrics (editor load time, AI response latency)? Aptabase supports numeric properties, but OpenTelemetry would be better for detailed performance analysis.