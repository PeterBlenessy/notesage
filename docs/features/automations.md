# Automations

Scheduled and event-triggered task automation: a **trigger** bound to a linear pipeline of **steps**, stored as portable, hand-editable YAML under `~/.notesage/automations/` (global) and `<project>/.notesage/automations/` (per-project). Runs while Notesage is open or in the menu bar.

PRD: `docs/prds/2026-06-28-automations.md` · Builder-UX research: `docs/research/automation-builder-ux.md`

## Triggers

An automation fires on exactly one trigger; a `condition` gates whether the pipeline actually runs.

| Trigger | Fires when | Notes |
| --- | --- | --- |
| **Schedule** | A cron time is due | Local-time cron (`saffron`) via one `tokio` timer emitting `automation-due`; DST-aware. **Catch-up:** runs missed during a full quit are *surfaced for the user to pick*, never auto-fired. |
| **File** | A file in the watched folder is added / modified / deleted / renamed | Reuses the filesystem watcher; scope-relative glob (`picomatch`) + frontmatter conditions; per-automation debounce; loop-guarded so an automation's own writes can't re-trigger it. |
| **App event** | `document-saved` / `agent-task-complete` / `transcription-done` | Delivered via a small in-process event bus; the `document-saved` path is guarded so an automation's own writes don't re-fire it. |

## Steps

The pipeline is linear (top-to-bottom). Three step types:

| Step | Does |
| --- | --- |
| **Agent task** | Delegates a prompt to a headless agent (see [Agent step](#agent-step-provider--permissions) below). |
| **Create / append note** | Writes or appends a note (path resolved and containment-checked in Rust; never escapes scope). |
| **Notify** | Fires a desktop notification. |

> There is **no "run skill" step**. To run a skill, add an **agent** step and ask the agent to run it — the agent's own skill/tool machinery handles it. (This keeps a single, well-guarded execution path rather than a second one in the automation runtime.)

**Per-step `if` condition.** Every step has an optional `if` (a hand-written, **no-eval** expression: `==`, `!=`, `contains`, `matches`, or bare truthiness over the run context). A false `if` **skips** the step and the pipeline continues.

**Data passing.** Steps reference earlier results with `{{tokens}}` — `{{steps.<id>.output}}`, `{{steps.<id>.json.<field>}}`, `{{trigger.file}}`, `{{trigger.output}}`, `{{today}}`, `{{now}}`. In the builder these render as clickable **pills**; on disk they're the plain `{{…}}` string (a pill is only a rendering of the token).

## Agent step: provider & permissions

The single most-asked question about automations, documented here so the behaviour is explicit.

**Which provider runs it?** The agent step calls `useAgentTaskOperations.startTask({ type: 'workflow' })`, which resolves the connection from the **`agent_tasks` routing slot** (`getConnectionForUseCase('agent_tasks')`). So:

- It's set in **Settings → AI Providers → Advanced Routing → "Agent Tasks"** — *not* per-automation. Whatever connection + model that slot points to runs **every** automation agent step.
- If nothing is assigned, the step errors: *"No connection configured for agent tasks."*
- A project **`aiLock`** still applies — a locked project forces its provider.

**Permissions — runs don't stop to ask.** Automation agent steps run headless, so permission/tool requests are **auto-approved** by design (so an unattended run never stalls):

- ACP agents → `acp-permission-request` auto-approved (`useAgentTaskOperations.ts`).
- Copilot LSP → `copilot-tool-confirmation` auto-approved.
- Direct-API tool calling → `approvalMode: 'auto'`.

This holds **even if** "Require confirmation for all tool calls" is on globally — agent tasks bypass it. There is therefore **nothing to pre-approve for tool prompts**.

**What can still block a step** (silently *denied*, not prompted), and how to pre-clear it:

1. **File ops outside the automation's scope** — the path filter auto-denies reads/writes outside the selected project / `~/Notesage` base. → Keep the agent's targets inside the automation's scope.
2. **Network domains not on the connection's allowlist** — an unattended run can't show a domain prompt, so unknown domains fail safe. → Pre-add required domains in the connection's **Security → allowed domains**.
3. **A `document`/write step** needs the automation **armed** once (approve-to-arm) before it runs.

> Because agent steps auto-approve everything **within scope**, the real guardrails are the **project scope + Seatbelt sandbox + approve-to-arm**, not per-tool prompts. Scope an automation's project deliberately.

## Safety

- **Approve-to-arm** — an automation with a write step is content-pinned with SHA-256; editing it auto-disarms and re-prompts.
- **Guardrails** — per-day cap (survives restart), event debounce, and a fire-rate circuit breaker that auto-resumes after its window.
- **Loop prevention** — two layers (Rust `mark_self_write` + a frontend loop-guard) stop an automation's own writes from re-triggering it.
- **Sandbox** — agent steps run under the same Seatbelt FS/network sandbox as chat agents, bound to a deterministic scope (project root, or `~/Notesage` for a global automation — never `/tmp`).
- **Fail-safe domains** — unknown network domains are denied in an unattended run, surfaced in the run log.

## Firing model

**Tray-resident:** autostart-at-login + close-to-tray + the in-process timer. There is **no `launchd` daemon** — schedules fire only while Notesage runs (window or menu bar). Runs missed during a full quit are surfaced for the user to pick, never auto-fired.

## Builder (Settings → Automations)

Form-first, recipe-led (mirrors Zapier / Notion / Shortcuts conventions — see the builder-UX research):

- **Recipe-first entry** — "New automation" opens a starter gallery (Daily Digest / Inbox Triage / On-save Check / blank); picking one pre-fills the whole draft.
- **"When / Do this"** framing — the trigger as a plain-English "when", details in a grouped sub-card; a numbered step pipeline; **Advanced** (overlap mode + guardrails) collapsed by default.
- **Magic-variable pills** — insert data by clicking a friendly-named variable; edit a pill by clicking it (Remove / Replace). Never type `{{…}}`.
- Native **folder picker** for the watched folder; per-step conditions are removable.

## Observability

Unattended runs appear as a distinct **AgentOrb** activity card, plus a per-automation **runs history** (status, per-step log, output, errors). Failures fire a desktop notification.

## Status

Phases 1–3 (scheduled / file / app-event triggers) and Phase 4 Track A (per-step conditions) are shipped. Track B (visual-canvas builder) and Track C (`launchd` fire-while-quit) remain optional/deferred.

## Key files

| File | Purpose |
| --- | --- |
| `src-tauri/src/commands/automations.rs` | YAML CRUD + validation; `tokio` scheduler; catch-up; path containment |
| `src/lib/automations/executor.ts` | Pure step executor + overlap modes + guardrails |
| `src/lib/automations/condition-expr.ts` | Safe (no-eval) `if` evaluator |
| `src/lib/automations/{file-match,event-bus,loop-guard,template,arm}.ts` | Trigger matching, app-event bus, loop guard, tokens, approve-to-arm |
| `src/hooks/useAutomationRunner.ts` | Always-mounted runner (schedules, file/app events → executor) |
| `src/hooks/useAutomationDiscovery.ts` | Scan + watch the automations dirs |
| `src/stores/automation-store.ts` | On-disk cache + persisted runs history |
| `src/components/settings/v2/automations/*` | Builder (form, recipes, step editor, token-pill input, arm dialog, runs history) |
