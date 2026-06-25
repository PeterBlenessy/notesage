# Usage Telemetry — Metrics & Measurement Plan

This is the **internal measurement rationale**: what each usage metric teaches us,
the hypothesis it tests, and how we'd validate it / what decision it drives. It is
the design artifact we agree on *before* instrumenting.

- **User-facing disclosure** (what is/ isn't sent, consent): [`docs/telemetry.md`](telemetry.md). That page is the source of truth for privacy; this doc never widens it.
- **Type-enforced taxonomy** (the closed event list): `src/lib/telemetry.ts` (`TelemetryEventProps`). Adding a metric means adding a key there; the call site is then type-checked.
- **Crash reporting (Sentry)** is a separate stream and out of scope here — this doc is only the **usage** stream (Aptabase).

## Why we collect usage data

To decide **where to invest and what to prune** from evidence instead of intuition.
Notesage is a large app (editor, AI, viewers/exporters, workspace, OKF navigation);
most of it has never been usage-validated. The goal is a small, honest signal on
*which features are actually used and how the app is configured* — enough to rank
roadmap bets and catch features that cost a lot but are used by almost no one.

## What we can and cannot answer (the Aptabase ceiling)

Aptabase is **anonymous-aggregate**. Frame every metric accordingly.

**We CAN measure:**
- Event **counts and distributions** (which formats, which providers, which blocks).
- **Trends over time** (is a feature's usage growing after a release?).
- Aggregate **active-user counts** (DAU/WAU/MAU) via the SDK's per-period anonymous identifier.
- Splits by `os`, `channel`, and app `version`.

**We CANNOT measure:**
- **Per-user retention cohorts, funnels, or journeys** — there is no stable cross-session user id.
- **"% of users who did X"** — only event volume, not unique-user rates.
- **Correlating two events to the same person** across sessions.
- Anything PII (see `telemetry.md` "What is NEVER sent").

**Consequence for hypotheses:** state them as *distributions, rates-relative-to-sessions, or trends* — never "X% of users." A single power user can inflate a low-frequency event, so for rare events read the **trend and relative share**, not the absolute count.

## Measurement principles

1. **Closed low-cardinality enums, no PII** — every prop is a fixed enum; no free text, no paths, no content.
2. **Two event shapes.** Use `feature_used { feature }` for simple "is this surface used?" signals (one cheap event type, many enum values). Add a **new structured event** only when a breakdown *dimension* matters (e.g. `export_performed { format, template }`).
3. **Frequency/cost discipline.** Aptabase is metered by event *volume*. Instrument **deliberate actions** (insert a block, run an export, change a setting) — never per-keystroke or per-bold. Noisy hot paths are both expensive and uninterpretable.
4. **Deliberate-intent call sites.** Fire from user-initiated handlers, not from migration/rehydration/programmatic writes (which would manufacture phantom events).

## How to read the data

- **Aptabase dashboard has a Dev/Release environment toggle.** Release/alpha builds report to **Release**; debug builds to **Dev**. Check the toggle before concluding "no data." (This caused a false "telemetry is broken" scare on v0.48.0-alpha.3.)
- Events flush every **60 s** in release builds (2 s in debug), plus on quit and crash — so on the correct env view, >1–2 min of nothing is a real failure, not latency.
- Telemetry defaults **on for alpha builds, off for stable** (keyed on the build via `buildIsAlpha()`); most live data comes from the alpha cohort.

---

## Metric catalog

Status: **Shipped** (live since v0.48.0-alpha.3) · **Proposed** (agreed for next pass) · **Candidate** (pending decision).

### `app_launched { version, os, channel }` — Shipped
- **Learn:** install activity (DAU/WAU/MAU), OS mix, alpha-vs-stable split, how quickly users move to a new version.
- **Hypothesis:** macOS ≫ other OSes (mac-first product); the alpha cohort is small but the most active; version adoption lags by days because alphas are often installed manually.
- **Validate / decision:** Aptabase active-users + the `os`/`channel`/`version` breakdowns. Negligible non-mac → defer cross-platform work. Slow version adoption → invest in updater nudges. Channel split tells us whether the alpha cohort is large enough to trust as a release gate.

### `document_opened { format }` — Shipped
- **Learn:** whether Notesage is used beyond markdown — the viewers/exporters are a large surface that may or may not pay off.
- **Hypothesis:** `md` dominates; `pdf`/`epub`/`code` form a meaningful minority that justifies the viewer investment; `pptx`/`docx` are a long tail.
- **Validate / decision:** format distribution. A near-zero format is a deprioritize candidate for viewer polish; a surprisingly high one (e.g. `code`) argues for deeper code-editing features.

### `ai_chat_sent { path, provider_kind }` — Shipped
- **Learn:** whether AI is actually used, and through which path/provider — the core differentiator.
- **Hypothesis:** cloud (`anthropic`/`openai`) dominates volume; `local_bundled` + `agent_managed` are smaller but strategically important (the privacy/offline story); `copilot_lsp` niche.
- **Validate / decision:** counts by `path` + `provider_kind` over time. Local paths ≈ 0 → the heavy local-AI investment isn't landing; revisit onboarding. `agent_managed` growing → prioritize ACP robustness.

### `ai_action_used { action }` — Shipped
- **Learn:** which bubble-menu AI actions earn their place.
- **Hypothesis:** `improve` ≫ `summarize` > `expand`.
- **Validate / decision:** distribution; a near-unused action is a prune candidate or a discoverability problem (decide which by comparing to overall AI usage).

### `export_performed { format, template }` — Shipped
- **Learn:** which export formats and templates matter.
- **Hypothesis:** `pdf` dominant; `clean` template the common choice; `pptx`/`docx` a long tail; `custom` templates rare.
- **Validate / decision:** invest export polish where the volume is; hide or drop unused templates. (Aligns with the WYSIWYG-exports direction — usage confirms which presets to keep.)

### `connection_added { provider_kind }` — Shipped
- **Learn:** which providers people actually connect (setup intent, independent of how much they then chat).
- **Hypothesis:** `anthropic` first, then `openai`, then `local`/`local_bundled`.
- **Validate / decision:** provider priority for features and defaults; which provider to suggest first in the Add-Connection flow.

### `skill_invoked` / `mcp_tool_called { source }` — Shipped
- **Learn:** adoption of the Skills + MCP platform (advanced, high-effort surfaces), and whether usage is `user`- or `project`-scoped.
- **Hypothesis:** low absolute adoption (power-user features); `user`-scope ≫ `project`-scope.
- **Validate / decision:** if adoption is near-zero across the base over several releases, the platform is niche → cap further investment or fix discoverability before building more.

### `feature_used { feature }` — Shipped (`focus_mode`, `cmd_bar_pin`, `recording`)
- **Learn:** adoption of individual surfaces, cheaply, on one event type.
- **Hypothesis:** `cmd_bar_pin` moderate; `focus_mode` niche-but-loved; `recording` rare.
- **Validate / decision:** per-feature counts/trends. Low usage + high maintenance cost → reconsider; healthy usage → safe to build on.

---

### `block_inserted { kind }` — Proposed
`kind` ∈ `drawing` · `chart` · `mermaid` · `callout` · `code_block` · `image` · `link_preview` (rich blocks only — markdown basics like tables/lists/HR stay uninstrumented for now). Fires on deliberate insert (slash command + toolbar), **not** on document parse/paste-load.
- **Learn:** whether the "rich content blocks" investment (a large build) is actually used, and which blocks.
- **Hypothesis:** `code_block` + `callout` are common; `image` moderate; `drawing`/`chart`/`mermaid`/`link_preview` are rare-but-valued by a few users.
- **Validate / decision:** `kind` distribution and trend, weighed against build/maintenance effort. A rich block with near-zero inserts after a few releases of being discoverable → maintenance-only / deprioritize. A surprisingly used one → deepen it. **Caveat:** counts are inserts, not unique users; read share + trend, not absolutes.

### `setting_changed { setting, value }` — Proposed
Both closed enums. Captures *which* setting a user changes **and** what they pick — but only for **bounded values**; settings with unbounded/PII values (paths, widths, margins, numeric caps) are excluded, and booleans report `on`/`off`. Fired from the settings panels' `onChange` handlers (user intent), never from rehydration/migration.

Tracked settings → value vocabulary:

| Area | `setting` | `value` |
| --- | --- | --- |
| Appearance | `theme` / `accent` / `quiet_preset` / `title_bar` | theme `light`/`dark`/`system`; accent `default`/`orange`/`blue`/`system`; preset `relaxed`/`default`/`aggressive`/`custom`; `title_bar` `on`/`off` |
| Editor | `inline_completions` (the completions-provider control) / `external_change_review` / `print_layout` | `on`/`off` |
| AI / Advanced | `tool_calling` / `cross_project` / `require_all_tool_confirmations` / `agent_mode_picker` / `release_channel` | channel `stable`/`alpha`; rest `on`/`off` |
| Privacy | `telemetry_usage` / `telemetry_crash` | `on`/`off` (turning usage *off* is itself not sent — `track` no-ops once usage is off) |
| System | `log_level` | `error`/`warn`/`info`/`debug` |

> Dropped from the original proposal because they have no settings control to fire from: `typewriter` (no UI), `search_provider` (hardcoded `duckduckgo`, not configurable), `sidebar_pinned` (a programmatic `⌘⇧L` toggle, not a settings panel). Add them later if they gain a control.

- **Learn:** which defaults users override and to what — i.e. are our defaults right, and does each setting earn its complexity.
- **Hypotheses:**
  - Most settings are rarely changed → **defaults carry the experience**; getting defaults right matters more than the settings UI.
  - `theme` → `dark` is the most common override; `accent` stays `default` for the majority.
  - Few users disable `tool_calling` or enable `cross_project`; telemetry is rarely toggled off on alpha.
- **Validate / decision:**
  - **High** change-volume on a setting → the default is likely wrong, or the setting is important → revisit the default / surface the control.
  - **Near-zero** change-volume + UI complexity → candidate to move behind Advanced or remove.
  - `value` distribution on `theme`/`accent`/`release_channel` → the popular choice; consider promoting it to the default.
  - **Honest limit:** anonymous-aggregate can't give "% of users who changed X." We read change-event **volume relative to active sessions** + value distributions — enough to rank settings and spot wrong defaults, not to compute per-user rates.

---

### `completion_accepted { provider_kind }` — Candidate
- **Learn:** whether inline completions (a major, costly subsystem) are actually accepted, and via which provider.
- **Hypothesis:** acceptance concentrates in a couple of providers; local FIM acceptance is low.
- **Validate / decision:** accept counts by provider, read against `ai_chat_sent` to see whether completions or chat is the primary AI surface. Low acceptance → rethink completion trigger heuristics / UX.

### `feature_used` additions — Candidate (`agent_addressed`, `comment_delegated`, `web_search`, `research_saved`)
- **Learn:** depth of the agentic + research workflows beyond a single chat send.
- **Hypothesis:** `web_search` is common *within* chats; `comment_delegated` + `research_saved` are niche.
- **Validate / decision:** whether the agent/research investment is used enough to keep deepening, or should be held at maintenance.

---

## Adding a new metric

1. Decide the shape: extend `feature_used`'s `FeatureName` enum (simple usage signal) **or** add a new key to `TelemetryEventProps` with closed-enum props (needs a breakdown dimension).
2. Add it to this catalog with **what we learn / hypothesis / validation** — no metric ships without a reason to read it.
3. Add the row to the user-facing list in [`docs/telemetry.md`](telemetry.md) (the privacy contract).
4. Wire the call site at a deliberate-intent handler; keep props to the typed enums only (the PII test in `telemetry.test.ts` enforces "nothing appended").

## Status summary

| Event | Status |
| --- | --- |
| `app_launched`, `document_opened`, `ai_chat_sent`, `ai_action_used`, `export_performed`, `connection_added`, `skill_invoked`, `mcp_tool_called`, `feature_used` | Shipped (v0.48.0-alpha.3) |
| `block_inserted`, `setting_changed` | Proposed |
| `completion_accepted`, `feature_used`: `agent_addressed`/`comment_delegated`/`web_search`/`research_saved` | Candidate (pending decision) |
