# PRD: Automations — Scheduled & Event-Triggered Tasks

|  |  |
| --- | --- |
| **Date** | 2026-06-28 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Notes can act on their own — run an agent, script, or file change on a schedule or in response to an event, unattended |
| **Tasks** | [Phase 1](../tasks/2026-06-28-automations-tasks.md) (done) · [Phase 2](../tasks/2026-06-29-automations-phase2-tasks.md) |
| **Research** | [automation-formats](../research/automation-formats.md) — prior-art schema survey |
| **Phase** | New roadmap initiative — realizes "Workflows & Automation" from `docs/features/ai-workflows.md` |

---

## Problem

Notesage today is **reactive** — every AI action, skill run, agent task, and document edit is something the user initiates in the moment. There is no way to say "every morning, summarize yesterday's notes into a daily note," "when I drop a file in `Inbox/`, have an agent file it," or "when I save this doc, review it for missing tags." The machinery to *do* each of those things already exists (background agent tasks, skill-script execution, document I/O, notifications) — what's missing is a **trigger → action** layer that fires them without a human present.

The roadmap has long listed this as *"Workflows & Automation: user-defined YAML workflows as skills"* (`docs/features/ai-workflows.md`, `docs/product-description.md` "Beyond — Ideas"). This PRD realizes it as a first-class **Automations** engine.

**Why now:** the building blocks matured. `useAgentTaskOperations.startTask` already runs agents headlessly and auto-approves their tool calls (sandbox is the enforcement layer); `execute_skill_script` already sandboxes and content-pins scripts; the filesystem watcher already emits structured change events; `activity-store` already models background tasks with a `kind` discriminator. An automation engine is now mostly *composition* of existing surfaces plus one genuinely new piece — a scheduler.

## Goals / Non-Goals

### Goals

1. **Author an automation without writing code** — a guided form builder (Settings → Automations) that produces a portable YAML definition; pick a trigger, add steps, configure each.
2. **Three trigger classes** (phased): scheduled (cron/recurring), file/workspace events, and workflow/app events (agent-done, doc-saved, transcription-done).
3. **Multi-step linear pipelines** with data flowing between steps and from the trigger, via template tokens (`{{trigger.file}}`, `{{steps.<id>.output}}`, `{{today}}`).
4. **Safe unattended execution** — no automation runs unreviewed code or mutates files without a one-time arm-time approval; per-automation guardrails (caps, debounce) and a global circuit-breaker prevent runaway cost/volume.
5. **Full observability** — every run is visible live (AgentOrb) and durably logged (per-automation Runs history); failures notify.
6. **North-star use case shipping in Phase 1** — "Daily Digest" works end-to-end (scheduled → agent summarize → create daily note → notify).

### Non-Goals

- **True fire-while-fully-quit** via a `launchd` daemon / second binary. The firing model is **tray-resident** (autostart + close-to-tray + in-process timer). A daemon is explicitly deferred (Phase 4, may never ship).
- **Mid-pipeline conditional branching** (`if step1.urgent then …`). v1 is linear steps + a single trigger-level condition. Branching is Phase 4.
- **Visual node-graph (n8n/Zapier-canvas) builder.** v1 authoring is a form builder. Canvas is Phase 4.
- **Cross-platform scheduling.** macOS-primary, consistent with the app. Windows/Linux timer wiring is best-effort/later.
- **Sharing/marketplace of automations.** Files are portable + git-trackable, but a discovery/marketplace surface is out of scope.

## User Stories

- As a knowledge worker, I want a **daily digest** of my recent notes written to a dated note every morning, so that I start the day with a summary without lifting a finger.
- As someone with a messy capture habit, I want files dropped in `Inbox/` to be **auto-triaged** by an agent (classified, renamed, filed), so that my inbox stays clean.
- As a careful writer, I want an agent to **review a document when I save it** (suggest tags, flag TODOs), so that quality checks happen continuously.
- As a privacy- and cost-conscious user, I want to **review and arm** any automation that runs scripts or writes files before it can fire unattended, and to know it **re-prompts if it changes**, so that a synced or AI-authored automation can never silently run code on a timer.
- As a power user, I want automations stored as **plain YAML files** I can edit, diff, and have an agent write for me, so that they're portable and transparent.
- As anyone running automations, I want to **see what ran while I was away** (and what failed and why), so that I trust the system.

## Technical Approach

### Domain model & naming

The core entity is an **Automation**: a single **trigger** bound to a **linear pipeline** of **steps**, plus metadata (enabled, scope, guardrails, arm state). "Automation" was chosen specifically because it collides with nothing in Notesage's existing vocabulary (`Task`, `Action`, `Skill`, `Agent`, `Goal`, and the AW `Workflow` are all taken).

### Storage — YAML files, two scopes (mirrors skills/MCP)

Source of truth is one YAML file per automation:

- **Global:** `~/.notesage/automations/<slug>.yaml`
- **Per-project:** `<project>/.notesage/automations/<slug>.yaml`

Loaded and merged by scope exactly like the skill/MCP registries (`global ∪ selectedProjects`). Portable, git-trackable, hand-editable, and AI-authorable (an agent can write one via `write_file`). A new Rust module `commands/automations.rs` owns discovery/parse/validate (YAML via the existing `serde_yaml`/comrak-frontmatter stack); a Zustand `automation-store` mirrors the parsed registry for the UI (the *files* are authoritative, the store is a cache + UI overrides, same partialize pattern as `skill-store`).

### Scheduler — new Rust `tokio` timer (the only genuinely new infra)

No cron/scheduler infrastructure exists today (confirmed: no cron crate, no scheduler plugin). The scheduler is a single `tokio` task spawned in `lib.rs` setup, managed via an `AutomationSchedulerState`:

- Holds the set of scheduled automations + their next-due times (cron parsed via the `cron` crate — new dependency).
- Ticks on a coarse interval (e.g. every 30s) — granularity is "minute," not "second" (sufficient for this feature; avoids a tight loop).
- On due, emits an `automation-due` Tauri event `{ automationId, scheduledFor }`. **The Rust side never executes pipeline steps** — the action layer (agent tasks, skill exec, doc I/O) lives in TS hooks, so a small **always-mounted** App-root hook (`useAutomationRunner`, alongside `useSessionManager`/`useNetworkDomainApprovals` — see MEMORY "always-mounted listeners") listens for `automation-due` and runs the pipeline. The webview is always alive while the app is resident (window shown OR hidden-to-tray), so this is robust.

Event-trigger evaluation (Phase 2/3) follows the same shape: Rust forwards `file-changed-batch` / `file-renamed` (already emitted) and the new workflow events to the runner hook, which matches them against each automation's trigger + condition.

### Firing model — tray-resident

The app has **no headless mode**: the process survives window-*close* only when **close-to-tray** is on, and does not run when fully quit. So firing = **autostart-at-login (`tauri-plugin-autostart`, already wired) + close-to-tray (`tray.rs`, already wired) + the in-process timer**. Enabling Automations prompts to turn both on (they make scheduled firing reliable). Documented honestly in-UI: "Automations run while Notesage is open or in the menu bar."

**Catch-up (the ⌘Q gap):** the scheduler persists each scheduled automation's `lastFiredAt`. On launch, it computes occurrences that came due during the downtime. It does **not** auto-run them — it surfaces a **missed-runs chooser** (notification + a panel in Settings → Automations) listing each missed automation; the user picks **Run all / Run selected / Skip**. A per-automation `catchUp: true|false` toggle suppresses the prompt for automations where a miss is irrelevant.

### Pipeline executor

`useAutomationRunner` executes steps top-to-bottom, maintaining a **run context** `{ trigger, steps: { <id>: { output, json? } }, today, now }`. Before each step, string fields are rendered through a small mustache-style template (`{{trigger.file}}`, `{{steps.summary.output}}`, `{{today}}`, `{{now}}`) — a new `src/lib/automations/template.ts`. The `{{ }}` idiom and name-based `{{steps.<id>.output}}` references were validated against prior art (see Research) — they match Home Assistant / n8n conventions; the `json?` envelope field future-proofs structured step outputs (`{{steps.<id>.json.field}}`). Step dispatch:

| Step type | Reuses | Notes |
| --- | --- | --- |
| `agent` | `useAgentTaskOperations.startTask(prompt, callbacks, { type:'workflow', projectRoot })` | Already headless + auto-approves tool calls; `onComplete` output → `steps.<id>.output`. Respects `aiLock` + routing `agent_tasks` slot. |
| `skill` | `execute_skill_script` (via `useSkillOperations.executeScript`) | Content-pinned (SHA-256), Seatbelt-sandboxed. stdout → `steps.<id>.output`. **Requires arm-time approval.** |
| `document` | `write_file` / `create_file` (+ `mark_self_write` first) | Create or append. Path + content are templated. **Requires arm-time approval.** Self-write tag prevents loop retrigger. |
| `notify` | `tauri-plugin-notification` (`notify()` in `src/lib/notifications.ts`) | Templated title/body. Honors notification settings. |

A run is recorded as an `activity-store` task with the new `kind: 'automation'`, and appended to the automation's durable Runs history.

### Concurrency — `mode:` (overlap policy)

What happens when an automation is triggered while one of its own runs is still active (or while the singleton task agent — `TASK_AGENT_KEY` — is busy with another automation)? We adopt Home Assistant's named-mode model (validated in Research as the most legible option for a non-engineer audience, vs GitHub Actions' dynamic group key):

- **`single`** (default) — drop the new fire if a run of this automation is already active; log it. Safest against pile-ups.
- **`restart`** — cancel the in-flight run and start over with the new trigger.
- **`queued`** — serialize: the new run waits for the prior to finish (bounded by `guardrails.maxRunsPerDay` and a small internal queue cap).

`mode` is enforced by `useAutomationRunner`. Because background agent tasks share a single agent instance, cross-automation contention also serializes through the runner's queue regardless of per-automation `mode` (two `parallel`-wanting agent automations still can't run their agent steps simultaneously — a known constraint, documented, not a v1 blocker).

### Safety

- **Approve-to-arm.** An automation containing a `skill` or `document` step starts **disarmed**. Arming opens a review dialog summarizing the script (with its pinned SHA-256) and the write scope; on confirm we store a `ScopedApproval`-style record (reusing `permission-store` `skillScriptAlways` content-pin machinery) keyed to the automation + script hash + write paths. If the YAML or the referenced script changes, the hash mismatches → the automation **auto-disarms** and re-prompts. Unattended runs of unreviewed code are structurally impossible.
- **Guardrails (per-automation, with defaults).** `maxRunsPerDay`, `debounceMs` (event triggers), `maxStepsPerRun`. A **global circuit-breaker** auto-pauses any automation exceeding a fire-rate threshold (e.g. >30 fires/hr) and notifies.
- **Fail-safe network.** Unattended agent steps that hit an unknown domain get **auto-denied** (reusing the domain-approval 30s timeout = deny) and the block is surfaced in the run log — never auto-allowed while the user is away. Pre-authorizing domains stays a per-connection allowlist concern. Note: an unattended `agent` step **does inherit the connection's already-persisted `domainAlwaysAllowed` allowlist** (same capability an interactive agent has) — it just can't approve *new* egress unattended.
- **Write-path containment (SEC-1).** A `document` step's path is template-rendered at run time (tokens can include agent output), so the arm review — which pins the unrendered template — can't vouch for the final path. The runner resolves every write through the Rust `resolve_automation_write_path(base, relPath)` command, which **rejects absolute paths and `..` traversal**, so a rendered path can't escape the automation's scope. `save_automation` is likewise confined to `.notesage/automations/`.
- **Deterministic agent scope (SEC-3).** A `document` step and an `agent` step both run against `base` = the automation's project root, or `~/Notesage` for a global automation — never the transient command-bar selection, and never `/tmp` (which would skip the per-tool path filter).
- **Loop prevention.** Every `document` write calls `mark_self_write` first, so a file-event automation cannot retrigger itself (or another) via its own output.
- **Scope & lock.** Each automation carries a project scope that drives the agent sandbox writable paths; `aiLock` on a scoped project is enforced at the agent step (raises `ProjectLockViolation`, run fails cleanly).
- **Kill switches.** A master `settings.automationsEnabled` toggle, plus per-automation `enabled`.

### Observability

- **Live:** runs surface in the `AgentOrb` / `AgentPanel` via `activity-store` `kind: 'automation'` (the panel already discriminates by `kind`).
- **Durable:** each automation keeps a **Runs history** (last N runs: status, per-step log, output, errors, duration) shown in its detail view in Settings → Automations.
- **Failures** fire a desktop notification (gated by a new `notifyAutomationFailure` setting, default on).

## UI/UX

A new **Settings → Automations** panel (Settings v2 shell, `src/components/settings/v2/`):

- **List view** — rows of automations (icon by trigger type, name, scope badge global/project, enabled `switch`, armed/disarmed state, last-run status dot). Empty state explains the concept + a "New automation" CTA. Header note: "Automations run while Notesage is open or in the menu bar."
- **Form builder** (create/edit) — guided, writes YAML underneath:
  - **Trigger** — picker (⏰ Schedule / 📁 File event / 🔗 Workflow event), then trigger-specific fields (cron via a friendly recurrence picker; glob + change-kind for file events; event-type for workflow events) + an optional **Condition** row.
  - **Steps** — an ordered list; "+ Add step" menu (🤖 Agent · ▶️ Skill · 📄 Document · 🔔 Notify); each step is a form with an **"Insert variable ▾"** picker for tokens (Zapier-style "pills" that render the underlying `{{steps.<id>.output}}` string, so hand-edited YAML and GUI insertion serialize identically — see Research). Drag to reorder.
  - **Settings** — overlap `mode` (single / restart / queued), guardrails (max runs/day, debounce, max steps), `catch up missed` toggle, project scope.
  - Footer: **Save**, **Run now**, and (if it contains script/write steps) **Review & arm**.
- **Arm dialog** — `alert-dialog` listing the script(s) with pinned hash + write scope; **Review & arm** / **Cancel**.
- **Missed-runs chooser** — on launch, an `alert-dialog` (and a notification) listing missed scheduled runs with **Run all / Run selected / Skip**.
- **Runs history** — within an automation's detail: a list of recent runs (timestamp, ✓/✗, duration, "view log" → per-step output/errors).

All components use shadcn/ui primitives (`switch`, `select`, `dialog`, `alert-dialog`, `popover`, `command` for the variable picker, `scroll-area`), strictly-neutral palette with accent only on primary affordances, full light/dark + reduced-motion compliance per `docs/design-system.md`. Every `Tooltip` wrapped in `TooltipProvider`.

## Data Model

The schema below was validated against prior art (Home Assistant, GitHub Actions, n8n, Make, Zapier) — see the [research doc](../research/automation-formats.md). Net: there is no portable automation standard to conform to, our `{{ }}` + name-based-step-ref design matches the field, and the refinements folded in are `filter:`→`condition:` (R1), a step-output envelope (R2), an `mode:` overlap key (R3), and cron-as-canonical (R4).

### YAML schema (illustrative — Daily Digest)

```yaml
# ~/.notesage/automations/morning-digest.yaml
name: Morning Digest
enabled: true
scope: global            # or a project root path
mode: single             # overlap policy: single (default) | restart | queued
trigger:                 # singular — exactly one trigger
  type: schedule         # schedule | file | workflow
  cron: "0 8 * * *"      # canonical schedule (friendly picker on top); structured form is later sugar
  catchUp: true
condition:               # R1: was `filter` — trigger-level gate
  weekdays: [1, 2, 3, 4, 5]   # glob / frontmatter added in Phase 2
guardrails:
  maxRunsPerDay: 1
  debounceMs: 0
  maxStepsPerRun: 15
steps:
  - id: summary
    type: agent
    prompt: "Summarize my notes edited since yesterday."
  - id: write
    type: document
    op: append           # create | append
    path: "Daily/{{today}}.md"
    content: "## {{today}}\n\n{{steps.summary.output}}\n"
  - id: ping
    type: notify
    title: "Daily digest ready"
    body: "Written to Daily/{{today}}.md"
```

### TypeScript (`src/lib/automations/types.ts`)

```ts
type TriggerType = 'schedule' | 'file' | 'workflow';
type StepType = 'agent' | 'skill' | 'document' | 'notify';
type RunMode = 'single' | 'restart' | 'queued';   // R3: overlap policy (HA-style)

interface Automation {
  id: string;            // slug (filename)
  name: string;
  enabled: boolean;
  armed: boolean;        // false until reviewed if it has skill/document steps
  scope: 'global' | string; // project root path
  mode: RunMode;         // R3: overlap policy; default 'single'
  trigger: Trigger;
  condition?: Condition; // R1: was `filter` — trigger-level gate
  guardrails: Guardrails;
  steps: AutomationStep[];
  sourcePath: string;    // absolute path to the YAML
}

interface Trigger {
  type: TriggerType;
  cron?: string;                              // schedule
  catchUp?: boolean;                          // schedule
  event?: 'file-created' | 'file-modified' | 'file-deleted' | 'file-renamed'  // file
        | 'agent-task-complete' | 'document-saved' | 'transcription-done';     // workflow
  path?: string;                              // file: watched root (defaults to scope)
}

interface Condition { glob?: string; weekdays?: number[]; frontmatter?: Record<string,string>; } // R1
interface Guardrails { maxRunsPerDay: number; debounceMs: number; maxStepsPerRun: number; }

type AutomationStep =
  | { id: string; type: 'agent'; prompt: string }
  | { id: string; type: 'skill'; skill: string; script: string; args?: string[] }
  | { id: string; type: 'document'; op: 'create' | 'append'; path: string; content: string }
  | { id: string; type: 'notify'; title: string; body: string };

// R2: per-step result envelope. `output` is the text used by `{{steps.<id>.output}}`;
// `json` holds a structured result (agent/skill returning JSON) → `{{steps.<id>.json.x}}`.
interface StepResult { output: string; json?: unknown; error?: string }

interface AutomationRun {
  runId: string; automationId: string;
  startedAt: number; completedAt?: number;
  status: 'running' | 'done' | 'error' | 'skipped';
  trigger: { type: TriggerType; file?: string };
  steps: { id: string; type: StepType; result?: StepResult }[];
}
```

### `activity-store` extension

```ts
type AgentTaskKind = 'agent' | 'transcription' | 'recording' | 'automation'; // + 'automation'
```

### Tauri commands (`commands/automations.rs`)

| Command | Signature | Purpose |
| --- | --- | --- |
| `list_automations` | `(scopes: Vec<String>) -> Result<Vec<AutomationFile>, String>` | Discover + parse YAML across global + project scopes |
| `save_automation` | `(path: String, yaml: String) -> Result<(), String>` | Write a YAML definition (form builder serializes to this) |
| `delete_automation` | `(path: String) -> Result<(), String>` | Remove a definition |
| `validate_automation` | `(yaml: String) -> Result<AutomationValidation, String>` | Schema + cron validity, referenced-skill existence, hash computation |
| `hash_automation_scripts` | `(automation: Automation) -> Result<Vec<ScriptHash>, String>` | Content-pin hashes for the arm dialog (reuses `hash_skill_script`) |

### Scheduler state (`AutomationSchedulerState`)

```rust
struct AutomationSchedulerState {
    scheduled: Mutex<Vec<ScheduledEntry>>,   // { id, cron, next_due, last_fired_at }
    enabled: AtomicBool,                     // master toggle
}
// Spawned in lib.rs setup; ticks ~30s; emits `automation-due` { automationId, scheduledFor }.
// On startup computes missed occurrences -> emits `automations-missed` { entries[] }.
```

### New settings (`settings-store`)

`automationsEnabled` (master, default off), `notifyAutomationFailure` (default on).

## Dependencies

- **New crate:** `cron` (or `saffron`) for cron expression parsing/next-time computation in Rust. ~lightweight, no system deps.
- **Reused, no new deps:** `tauri-plugin-autostart`, `tauri-plugin-notification`, `notify` (watcher), `serde_yaml`, the ACP/agent stack, `keyring` (via existing approvals).
- **Prerequisite (Phase 3 only):** new event-emission points for `agent-task-complete`, `document-saved`, `transcription-done` + a thin internal event bus (none exists today).

## Quality Gates

### Functional

- [ ] A scheduled automation fires at its cron time while the app is open or hidden-to-tray.
- [ ] Daily Digest (schedule → agent → document append → notify) runs end-to-end and produces `Daily/<date>.md`.
- [ ] Template tokens (`{{trigger.*}}`, `{{steps.<id>.output}}`, `{{today}}`, `{{now}}`) resolve correctly across all step types.
- [ ] On launch after a quit gap, missed scheduled runs are **surfaced (not auto-run)**; Run all / Run selected / Skip each behave correctly; `catchUp:false` suppresses the prompt.
- [ ] An automation with a script/document step is **disarmed** until reviewed; editing the YAML or the script **auto-disarms** and re-prompts.
- [ ] Guardrails enforce: max runs/day, event debounce, max steps/run; the global circuit-breaker auto-pauses a runaway automation and notifies.
- [ ] Overlap `mode:` is honored — `single` drops a fire while a run is active, `queued` serializes, `restart` cancels the in-flight run.
- [ ] An unattended agent step hitting an unknown domain is auto-denied and the block appears in the run log.
- [ ] A file-event automation that writes a file does **not** retrigger itself (self-write suppression).
- [ ] `aiLock` on a scoped project blocks a mismatched agent step with a clear failed-run reason.
- [ ] Runs appear live in the AgentOrb (`kind:'automation'`) and durably in the per-automation Runs history; failures notify.
- [ ] Master toggle off ⇒ nothing fires; per-automation disable ⇒ that one doesn't fire.
- [ ] YAML round-trips: form builder → YAML → reparse → identical model.

### Testing & Design

- [ ] Unit tests: template renderer, cron next-due + missed-occurrence computation, pipeline executor (step dispatch, context threading, error short-circuit), guardrail/circuit-breaker logic, arm-state hashing/invalidation, loop-prevention. Rust tests for `commands/automations.rs` parse/validate.
- [ ] `pnpm typecheck`, `pnpm test`, `cargo test`, `pnpm test:perf` all green; no coverage regressions in changed files.
- [ ] Settings → Automations panel and all dialogs look native alongside Linear/Things in **both** light and dark mode (+ soft contrast, reduced motion); shadcn-first; every Tooltip inside a TooltipProvider; strictly-neutral palette with accent only on primary affordances.

## Out of Scope

Deferred to later phases or future PRDs:

- **Phase 4 / future:** mid-pipeline conditional branching; visual node-graph builder; a `launchd` daemon for true fire-while-fully-quit; cross-platform (Windows/Linux) scheduling; automation sharing/marketplace; per-MCP-server writable scope for skill steps.
- **Phasing recap** (north star = Daily Digest):
  - **Phase 1** ✅ *(implemented on `feat/automations`, 13 tasks)* — Scheduled foundation + Daily Digest end-to-end (entity + YAML loader, tokio timer + catch-up, tray-resident wiring, linear executor + tokens, steps: agent/document/notify, form builder, approve-to-arm, guardrails, orb + Runs history).
  - **Phase 2** ✅ *(implemented on `feat/automations`)* — File/workspace event triggers (watcher subscription, trigger conditions/glob, debounce, loop-prevention, the **skill/script** step type) → **Inbox Triage** archetype.
  - **Phase 3** — Workflow/app event triggers (new emission points + internal event bus) → **On-save Check** archetype.
  - **Phase 4** — branching, canvas builder, optional launchd firing.
