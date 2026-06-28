# Automation Definition Formats — Prior Art & Schema Recommendation

**Date:** 2026-06-28 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [automations](../prds/2026-06-28-automations.md) | In Progress |
| Tasks (Phase 1) | [phase-1](../tasks/2026-06-28-automations-tasks.md) | Complete |
| Tasks (Phase 2) | [phase-2](../tasks/2026-06-29-automations-phase2-tasks.md) | Not started |

Survey of how established automation tools (Home Assistant, GitHub Actions, n8n, Zapier, Make, Node-RED, Apple Shortcuts/Automator/launchd, Tasker, Raycast/Alfred) model **trigger → condition → action** and pass data between steps — to validate or refine the YAML schema in the Automations PRD.

---

## Executive Summary

**There is no standardized, portable interchange format for personal/desktop automations** — nothing analogous to iCal/`.ics` for calendars. The "automation standards" that exist (BPMN, SARIF, AutomationML/IEC 62714, XPDL/WfMC) all serve adjacent enterprise/industrial domains and none describes trigger→action personal automation. Every consumer tool ships a proprietary format. **Conclusion: inventing our own YAML format is the correct call** — there is no target to conform to. The closest *spiritual* precedent for "human-editable + portable + git-friendly" is **Home Assistant automations YAML** (`trigger:` / `condition:` / `action:`), with **GitHub Actions** (`on:` / `steps:` / `${{ }}`) as the second reference point.

**Our draft schema is already well-aligned with the field.** Three things it gets right by convention: (1) **`{{ }}` interpolation** is the universal idiom — n8n, Make, Huginn, IFTTT, and HA's Jinja2 all use double-braces (only GitHub uses `${{ }}`); (2) **name-based step references** (`{{steps.<id>.output}}`) match n8n's reorder-safe by-name model and reject Make's brittle positional `{{1.field}}`; (3) storing **no canvas/layout coordinates** in the file avoids the diff-noise that plagues every node-graph tool's JSON (n8n/Make/Node-RED all embed `position`/`designer` x/y).

**Four concrete refinements emerged**, all small, none structural:

1. **Rename `filter:` → `condition:`** — adopt the universal *trigger / condition / action* vocabulary (HA, Tasker, IFTTT). It reads better, leaves room for `and`/`or` later, and "condition" is what every user expects.
2. **Add a `mode:` concurrency key** (HA's `single` / `restart` / `queued` / `parallel` + `max:`) — this is the cleanest, most legible answer to our singleton task-agent overlap problem, far friendlier than GitHub's dynamic `concurrency.group` for non-engineers. Default `single`.
3. **Keep cron as the canonical stored schedule** (GitHub precedent, compact, the `cron` crate parses it) with the friendly recurrence picker on top — but document that HA/launchd both prove a *structured* calendar dict is the more YAML-native form, available later as sugar.
4. **Standardize the inter-step payload envelope** (n8n-style `{ output, ... }`) so the variable picker has one predictable shape and future structured/JSON step outputs slot in cleanly.

Plus one **macOS-native finding that sharpens Phase 4** (the deferred "fire while fully quit" daemon): the only native path is a **LaunchAgent registered via `SMAppService`** (macOS 13+, Rust crate `smappservice-rs` exists). It runs **only while the user is logged in**, **coalesces missed-while-asleep fires into a single wake-time run**, and now shows up in **System Settings → Login Items & Extensions**. So a future daemon is *best-effort, wake-coalesced — never guaranteed wall-clock firing*. This independently validates the PRD's "catch-up = surface the missed runs, never auto-fire" decision.

---

## 1. Home Assistant — the closest YAML prior art

| Attribute | Details |
| --- | --- |
| **Keys** | plural `triggers:` / `conditions:` / `actions:`; each item typed by `trigger:`/`condition:`/`action:` |
| **Schedule** | **structured, not cron** — `time` (`at: "15:00:00"`) or `time_pattern` (`hours: "/5"`) |
| **Templating** | Jinja2 `{{ }}`; trigger payload as `trigger.*` |
| **Action→action** | `variables:` + `response_variable:` (the one chaining mechanism) |
| **Concurrency** | `mode: single \| restart \| queued \| parallel` + `max:` + `max_exceeded:` |

```yaml
automation:
  - alias: "Office lights on motion"
    mode: queued
    max: 25
    triggers:
      - trigger: time_pattern
        hours: "/5"            # every 5h — structured, NOT cron
        id: tick
      - trigger: state
        entity_id: device_tracker.paulus
        to: "home"
    conditions:
      - or:
          - condition: numeric_state
            entity_id: sun.sun
            attribute: elevation
            below: 4
          - "{{ is_state('input_boolean.guest', 'on') }}"   # bare template condition
    actions:
      - action: calendar.get_events
        target: { entity_id: calendar.school }
        response_variable: agenda          # capture output…
      - action: notify.notify
        data:
          message: "{{ trigger.to_state.state }} — {{ agenda }}"   # …read downstream
```

`mode:` (overlap policy) and `response_variable` (action chaining) are the two ideas worth lifting. **HA-specific** — no other tool adopts its YAML.

## 2. GitHub Actions — the step/output/expression reference

| Attribute | Details |
| --- | --- |
| **Keys** | `on:` / `jobs:` / `steps:` — no "trigger"/"condition" keyword |
| **Schedule** | **cron string** `'30 5 * * 1-5'` (5-field) |
| **File filter** | `paths:` / `paths-ignore:` globs (`*`, `**`, `!`) on `push`/`pull_request` |
| **Templating** | `${{ }}`; contexts `github.*`, `env.*`, `steps.<id>.outputs.*`, `needs.<job>.outputs.*` |
| **Conditions** | per-step/job `if:` expressions (no condition block) |
| **Concurrency** | `concurrency.group` + `cancel-in-progress` |

```yaml
on:
  schedule: [{ cron: '0 8 * * *' }]
  push: { paths: ['src/**', '**.md'] }
  workflow_dispatch:
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  build:
    steps:
      - id: check
        run: echo "status=ok" >> "$GITHUB_OUTPUT"     # declare output
      - if: steps.check.outputs.status == 'ok'         # per-step condition
        run: echo "${{ steps.check.outputs.status }}"  # read by step id
```

The `steps.<id>.outputs.*` model is the canonical "reference a prior step by stable id" pattern — directly endorses our `{{steps.<id>.output}}`. We take its **cron** and its **glob `paths:`** (for Phase 2 file filters); we skip `${{ }}` (minority syntax) and the DAG/`needs` machinery (we're linear).

## 3. n8n — the most git-friendly node-graph (best to steal from)

JSON: a `nodes` array + a `connections` object keyed **by node name**. Inter-node data is an **array of items** each wrapped `{ "json": {...} }`. References (all inside `{{ }}`): `{{ $json.email }}` (current item), `{{ $('Set Node').item.json.email }}` (named prior node). **Triggers are just nodes** with a trigger `type` (Schedule Trigger carries cron in its params). Portable single-file JSON — but every node embeds a `position: [x,y]` that creates diff noise.

**Lift:** name-based `{{ }}` references + a predictable item-array payload envelope. **Reject:** embedded canvas coordinates.

## 4. Make.com — the positional anti-pattern

Blueprint JSON: a `flow` array of modules with numeric `id`s; mapping uses `{{1.email}}` (module #1's field). Exportable, but **numeric ids shift on insert and break references** → brittle for hand-editing/git. Confirms our choice of stable string step ids over positions.

## 5. Zapier — great UX, zero portability

One trigger + N linear action steps. Data maps via colored **"pills"** (a sample record captured per step; pills resolve to internal Node IDs). **No text reference syntax, no export** — fully cloud-proprietary. The **anti-pattern for a git-tracked schema**, but the **pill UX is the idea to steal**: a pill is just a pretty rendering of an underlying `{{steps.x.field}}` string, so a GUI drag and a hand-typed token serialize identically. That **dual-surface parity (text = source of truth, pill = view)** is the single best authoring idea in the survey — exactly what our form-builder + "insert variable" picker should implement.

## 6. Node-RED — message-mutation paradigm (different model)

Nodes don't reference each other; they pass and mutate a `msg` object down `wires` (`msg.payload`). `flows.json` is portable (a YAML option exists via `node-red-contrib-flow-manager`), but same x/y/z canvas-coordinate noise. Not a fit for our reference-based linear model, but reinforces "keep layout out of the file."

## 7. Huginn & IFTTT (brief)

- **Huginn** — agents emit/consume JSON Events; *all* config is **Liquid `{{ }}`** interpolated over the received event. The cleanest "templating *is* the data-mapping layer" model — no special expression dialect.
- **IFTTT** — strict 1-trigger→1-action; trigger emits named **"ingredients"** (`{{EntryTitle}}`) dropped into action fields. Proprietary, no export. Minimal.

## 8. Apple macOS native — model & scheduling primitives

| Mechanism | Trigger model | Format | Portable? |
| --- | --- | --- | --- |
| **Shortcuts + Automations** | rich catalog: time-of-day, *file/folder changes*, app launch/quit, Wi-Fi, Focus… | signed/encrypted plist (`WFWorkflowActions`) | **No** — must be re-signed via `shortcuts` CLI |
| **Automator** | Folder Action (file-added), Calendar Alarm (schedule) | `.workflow` bundle (plist) | inspectable, not interchange; **Calendar Alarm scheduling is effectively deprecated** (doesn't migrate to new Macs) |
| **AppleScript/JXA** | `on adding folder items to` folder-watch handler | source/`.scpt` | per-folder, permission-gated |
| **launchd** | `StartCalendarInterval` (structured dict), `StartInterval` (seconds), `WatchPaths`/`QueueDirectories` (file events) | LaunchAgent/Daemon plist | the real OS substrate |

launchd schedule is a **structured dict, not cron** (`Minute`/`Hour`/`Weekday`…, omitted = wildcard, array-of-dicts for multiple times). **`WatchPaths` is non-recursive and directory-one-level only** — our `notify`-crate recursive watcher is strictly better, so we keep our own for the in-app case.

**Phase-4 "fire while quit" reality (important):**
- Only native path = a **LaunchAgent** (runs *only while logged in*; a LaunchDaemon runs without login but as root with no user/GUI context — wrong for a per-user notes app).
- **Missed-while-asleep fires coalesce into one wake-time run**, never the exact wall-clock time — launchd scheduling is *best-effort, wake-coalesced*.
- Modern registration = **`SMAppService`** (macOS 13+; deprecates manual `launchctl load`), Rust crate **`smappservice-rs`** exists. Registered agents appear in **System Settings → Login Items & Extensions** — design consent UX around that visibility.

This independently validates the PRD's tray-resident-first decision and "surface missed runs, don't auto-fire" catch-up.

## 9. Tasker (Android) — vocabulary worth borrowing

**Profile = Context(s) → Task(s).** Two context kinds: **State** (true for a *duration*, has Enter + Exit tasks — e.g. "while on Wi-Fi X") vs **Event** (instantaneous — "file received"; max one per profile). Contexts AND-combine. The **event-vs-state distinction maps cleanly onto our roadmap**: time-of-day / file-added are *events*; "while in project X / Focus on" would be *states* with enter/exit hooks (a future trigger class).

## 10. Raycast / Alfred — reinforce "no standard"

Alfred = plist-bundle workflows; Raycast = TypeScript/React extensions. They don't interoperate. Two popular launchers, two incompatible formats — more evidence there's nothing to conform to.

---

## Comparison

| Dimension | Notesage (draft) | Home Assistant | GitHub Actions | n8n | Make | Zapier | launchd |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Format** | YAML file | YAML | YAML | JSON | JSON | cloud only | plist |
| **Portable/git** | ✅ | ✅ | ✅ | ⚠ (coords) | ⚠ (ids+coords) | ❌ | ⚠ |
| **Top keys** | `trigger`/`filter`/`steps` | `triggers`/`conditions`/`actions` | `on`/`jobs`/`steps` | `nodes`/`connections` | `flow` | — | — |
| **Schedule** | cron | structured | cron | cron (node) | cron (module) | UI | structured dict |
| **Templating** | `{{ }}` | `{{ }}` (Jinja) | `${{ }}` | `{{ $json }}` | `{{1.x}}` | pills | — |
| **Step refs** | by id `steps.<id>` | `response_variable` | `steps.<id>.outputs` | by **name** | by **number** | Node ID | — |
| **Conditions** | trigger filter | `conditions` block | per-step `if` | per-node | per-module filter | filter step | — |
| **Concurrency** | (unspecified) | `mode:` | `concurrency.group` | queue settings | — | — | — |

## Recommendation

Our schema is sound. Apply these refinements to the **PRD Data Model** (the PRD is still Draft, so update it in place):

**R1 — `filter:` → `condition:`.** Adopt the universal *trigger / condition / action* vocabulary. Keep `trigger:` singular (we allow one trigger) and `steps:` (GitHub precedent; also avoids colliding with Notesage's existing "Actions" dashboard). Structure the condition to allow future `and`/`or` nesting (HA-style) without a breaking change.

**R2 — keep `{{ }}` + name-based step refs; standardize the output envelope.** Validated as the dominant idiom. Keep `{{trigger.*}}`, `{{steps.<id>.output}}`, `{{today}}`, `{{now}}`. Define the per-step result as a small envelope (`{ output: string, json?: unknown }`) so a future structured/JSON step output (e.g. an agent returning JSON) is addressable as `{{steps.<id>.json.field}}` without redesign. Reject positional refs.

**R3 — add `mode:` concurrency (NEW).** Borrow HA's named modes for the singleton-task-agent overlap: `single` (default — drop a fire while a run is active), `restart`, `queued` (+ `max:`). Far more legible than GitHub's group-key for a notes-app audience, and it gives the PRD a precise answer to "what happens when two automations fire at once / a run is still going." Pairs with the existing debounce + circuit-breaker guardrails.

**R4 — keep cron canonical, structured later.** Cron string stays the stored/canonical schedule (compact, one field, `cron` crate parses it, GitHub-familiar) behind the friendly recurrence picker. Note in the PRD that a structured calendar form (HA/launchd-style) is the more YAML-native option and can be accepted as alternative sugar in a later phase.

**R5 — no layout in the file (confirm).** We use a form builder, not a canvas, and store linear `steps:` — so we natively avoid the `position`/`designer` diff-noise. Keep it that way; if a visual canvas ever lands (Phase 4), put coordinates in a separate sidecar, never in the automation YAML.

**R6 — authoring: dual-surface parity (confirm task #10).** Implement the "insert variable" picker as Zapier-style pills that render the underlying `{{steps.x.output}}` string — hand-edited YAML and GUI-inserted tokens must serialize identically. This is the standout UX idea from the survey.

### Illustrative refined schema (Daily Digest)

```yaml
# ~/.notesage/automations/morning-digest.yaml
name: Morning Digest
enabled: true
mode: single                 # R3: single | restart | queued (+ max)
trigger:                     # singular — one trigger
  type: schedule
  cron: "0 8 * * *"          # R4: canonical cron
  catchUp: true
condition:                   # R1: was `filter`
  weekdays: [1,2,3,4,5]
steps:
  - id: summary
    type: agent
    prompt: "Summarize my notes edited since yesterday."
  - id: write
    type: document
    op: append
    path: "Daily/{{today}}.md"
    content: "## {{today}}\n\n{{steps.summary.output}}\n"   # R2: name-based ref
  - id: ping
    type: notify
    title: "Daily digest ready"
    body: "Written to Daily/{{today}}.md"
```

### Future-phase notes (record, don't act now)

- **Event-vs-state triggers** (Tasker) — a future *state* trigger class ("while in project X / Focus on") with enter/exit hooks; out of scope for Phases 1–3.
- **Phase 4 daemon** — if "fire while fully quit" is ever built: `SMAppService` LaunchAgent (`smappservice-rs`), documented as best-effort/wake-coalesced, surfaced in Login Items. Our recursive watcher beats launchd `WatchPaths`, so even then keep the in-app watcher for file events.

## Open Questions

- **`mode:` default** — `single` (HA's default, safest against pile-ups) vs `queued` (no dropped fires, but can back up behind a long agent run). Recommend `single` default, `queued` opt-in. Confirm with the user.
- **Condition richness in v1** — ship just the trigger-level `condition:` with simple keys (weekday, glob in Phase 2), or wire `and`/`or` nesting from the start? Recommend simple keys in v1, nesting later (non-breaking).
- **Structured schedule sugar** — worth accepting a structured calendar form alongside cron in v1, or defer entirely? Recommend defer; cron + picker covers v1.
