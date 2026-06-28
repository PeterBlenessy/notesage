# Automations — Phase 1 Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-06-28 |
| **Status** | Phase 1 complete — all 13 tasks done on `feat/automations` |
| **PRD** | [automations](../prds/2026-06-28-automations.md) |
| **Research** | [automation-formats](../research/automation-formats.md) — schema reflects R1–R4 (condition / output envelope / `mode:` / cron) |
| **Phase** | Phase 1 — Scheduled foundation + Daily Digest north star |
| **Total** | 13 tasks: 1S, 8M, 4L |
| **Suggested order** | Backend (#1–#2) → State (#3–#5) → Runtime (#6–#8) → UI (#9–#12) → Tests (#13) |

Phase 1 ships the **Daily Digest** north star end-to-end: a scheduled automation that runs an agent step, appends to a dated note, and notifies — authored in a form builder, armed, guarded, and observable. **Phases 2–4 are out of scope here** (file-event triggers + skill/script step, workflow-event triggers, branching/canvas/launchd) and will get their own task files.

### Risks / open questions

- **Always-mounted runner (high blast radius):** `useAutomationRunner` MUST mount at the App root next to `useSessionManager` / `useNetworkDomainApprovals` — not inside the command bar (which unmounts when collapsed). See MEMORY "always-mounted listeners". Mis-mounting silently breaks unattended firing.
- **Arm scope in Phase 1:** with no `skill` step yet, approve-to-arm applies only to **`document` (file-write)** steps. The arm record pins the **automation-definition hash + write scope** (not a script-file hash — that arrives in Phase 2 with `execute_skill_script`). Confirm the arm dialog reads sensibly for a writes-only automation.
- **Scheduler precision:** minute-granularity via a ~30s tick is the design intent (avoids a tight loop). Sub-minute schedules are unsupported by design.
- **Vite HMR:** after frontend edits, check `/tmp/notesage-dev.log` for an `hmr update`; `touch` the file if missing (MEMORY "touch after edit").
- **Clean rebuild:** #1/#2 add `#[tauri::command]`s + `generate_handler!` entries → `cargo clean` rebuild may be needed (CLAUDE.md Backend note).

---

## #1 — `commands/automations.rs`: types + YAML CRUD + validation ✅

**Category:** backend · **Complexity:** L · **Depends on:** —

Create the Rust module backing automation definitions. Add the `cron` crate to `Cargo.toml`.

- Structs (serde, snake_case): `Automation` (incl. `mode: single|restart|queued` — R3), `Trigger`, `Condition` (R1 — was `filter`), `Guardrails`, `AutomationStep` (enum: `Agent`/`Document`/`Notify` — **defer `Skill` to Phase 2**). Mirror the YAML schema + TS interfaces in the PRD Data Model.
- Commands: `list_automations(scopes) -> Vec<AutomationFile>` (discover + parse YAML across `~/.notesage/automations/` and each `<project>/.notesage/automations/`, following the skill-discovery scan pattern in `skills.rs`); `save_automation(path, yaml)`; `delete_automation(path)`; `validate_automation(yaml) -> AutomationValidation` (schema + **cron validity** + `mode`/`condition` shape + step-shape checks).
- Register all four in `lib.rs` `generate_handler![]`.
- **Acceptance:** a Daily-Digest YAML (PRD example, incl. `mode:` + `condition:`) parses; an invalid cron / unknown step type / bad `mode` returns a typed validation error; `cargo test` covers parse + cron next-due edge cases.

**Files:** `src-tauri/src/commands/automations.rs` (new), `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

---

## #2 — Tokio scheduler + catch-up (`AutomationSchedulerState`) ✅

**Category:** backend · **Complexity:** L · **Depends on:** #1

Spawn a single scheduler `tokio` task in `lib.rs` setup.

- `AutomationSchedulerState { scheduled: Mutex<Vec<ScheduledEntry>>, enabled: AtomicBool }`; `ScheduledEntry { id, cron, next_due, last_fired_at }`.
- ~30s tick: for each due entry, emit `automation-due { automationId, scheduledFor }` and advance `next_due`; persist `last_fired_at` (small JSON sidecar in `~/.notesage/`, mirroring the `sync.rs` disk-file pattern).
- **Startup catch-up:** compute occurrences missed during downtime per entry and emit `automations-missed { entries: [...] }` (does **not** run them).
- Commands: `set_automations_enabled(bool)` (master toggle → `AtomicBool`), `reload_automation_schedule(scopes)` (rebuild the entry set after a save/delete/enable).
- **Acceptance:** `cargo test` covers next-due computation and missed-occurrence computation across a quit gap (incl. DST/coalesced); ticking emits `automation-due` at the right minute; disabled state suppresses all emits.

**Files:** `src-tauri/src/commands/automations.rs`, `src-tauri/src/lib.rs`

---

## #3 — TS types + `automation-store` ✅

**Category:** frontend · **Complexity:** M · **Depends on:** #1

- `src/lib/automations/types.ts` — `Automation` (with `mode: RunMode`), `Trigger`, `Condition`, `Guardrails`, `AutomationStep`, `StepResult` (the R2 `{ output, json? }` envelope), `AutomationRun` (per PRD).
- `src/stores/automation-store.ts` — Zustand store: load registry via `list_automations` across `global ∪ selectedProjects`; CRUD wrappers (`save`/`delete` → Tauri + `reload_automation_schedule`); merged selectors like `skill-store`/`mcp-store`; `enabled` + `armed` overrides. Files are authoritative; store is cache + overrides (partialize only overrides, mirror `skill-store`).
- Discovery hook `useAutomationDiscovery` mounted in `App.tsx` (gated on `startupReady`, alongside `useSkillDiscovery` — see MEMORY "startup hooks in App.tsx").
- **Acceptance:** store hydrates from disk; saving writes YAML and refreshes; project/global merge correct.

**Files:** `src/lib/automations/types.ts` (new), `src/stores/automation-store.ts` (new), `src/hooks/useAutomationDiscovery.ts` (new), `src/App.tsx`, `src/lib/tauri.ts`

---

## #4 — `activity-store` kind + Runs history ✅

**Category:** frontend · **Complexity:** M · **Depends on:** #3

- Extend `activity-store` `AgentTaskKind` with `'automation'` (live status in the AgentOrb/AgentPanel).
- Add a durable **Runs history** slice to `automation-store`: `AutomationRun[]` per automation (status, per-step output/error, duration), persisted + capped (e.g. last 20/automation), 7-day-ish TTL like activity-store.
- **Acceptance:** a recorded run appears both as an `activity-store` task (`kind:'automation'`) and in the automation's Runs history; history survives restart and is capped.

**Files:** `src/stores/activity-store.ts`, `src/stores/automation-store.ts`

---

## #5 — Settings: master toggle + failure notify + tray/autostart prompt ✅

**Category:** frontend · **Complexity:** S · **Depends on:** #3

- `settings-store`: `automationsEnabled` (default `false`), `notifyAutomationFailure` (default `true`).
- Enabling automations prompts to turn on **autostart** (`tauri-plugin-autostart`) + **close-to-tray** (so scheduled firing is reliable); `set_automations_enabled` wired to the master toggle.
- **Acceptance:** master off ⇒ scheduler emits nothing; enabling surfaces the autostart/tray prompt once.

**Files:** `src/stores/settings-store.ts`, `src/lib/tauri.ts`

---

## #6 — Template renderer (`{{…}}` tokens) ✅

**Category:** frontend · **Complexity:** M · **Depends on:** #3

- `src/lib/automations/template.ts` — render `{{trigger.*}}`, `{{steps.<id>.output}}`, `{{today}}`, `{{now}}` against a run context. Unknown tokens render empty + are collected as warnings. Date helpers (`today` = local `YYYY-MM-DD`).
- **Acceptance:** unit tests cover each token, nested `steps.<id>.output`, missing-token behavior, and escaping (no code execution — pure substitution).

**Files:** `src/lib/automations/template.ts` (new), `src/lib/automations/__tests__/template.test.ts` (new)

---

## #7 — Pipeline executor + `useAutomationRunner` (always-mounted) ✅

**Category:** frontend · **Complexity:** L · **Depends on:** #2, #3, #4, #5, #6

The runtime core. Mount `useAutomationRunner` at the **App root** (next to `useSessionManager`).

- Listen for `automation-due` and `automations-missed`; resolve the automation; check master + per-automation `enabled` + `armed`.
- **Overlap `mode` (R3):** before starting, apply the automation's `mode` — `single` drops the fire if a run is active (log it), `restart` cancels the in-flight run, `queued` serializes behind it. Because background agent tasks share a single agent instance, cross-automation agent contention also serializes through the runner queue regardless of `mode`.
- Execute steps top-to-bottom, threading a run context `{ trigger, steps: { <id>: StepResult }, today, now }` through the template renderer (R2 — `StepResult = { output, json? }`):
  - `agent` → `useAgentTaskOperations.startTask(prompt, { onComplete }, { type:'workflow', projectRoot: scope })`; `onComplete` output → `steps.<id>.output`. (Already headless + auto-approves tool calls; respects `aiLock` + `agent_tasks` routing.)
  - `document` → `mark_self_write(path)` then `create_file`/`write_file` (create or append); templated path + content. **Self-write tag = loop prevention.**
  - `notify` → `notify()` (`src/lib/notifications.ts`), templated, gated by settings.
- **Guardrails:** enforce `maxRunsPerDay`, `maxStepsPerRun`; global circuit-breaker auto-pauses an automation exceeding a fire-rate threshold; on any step error short-circuit the run, mark `error`, and fire a failure notification (if `notifyAutomationFailure`).
- Record an `activity-store` task + append an `AutomationRun` throughout.
- **Acceptance:** Daily Digest fires on `automation-due` and produces `Daily/<date>.md` + a notification; a failing step stops the run and notifies; guardrails block over-limit runs; `mode: single` drops an overlapping fire while a run is active.

**Files:** `src/hooks/useAutomationRunner.ts` (new), `src/lib/automations/executor.ts` (new), `src/App.tsx`

---

## #8 — Approve-to-arm ✅

**Category:** frontend · **Complexity:** M · **Depends on:** #3, #7

- An automation containing a `document` (write) step starts **disarmed**. Arming computes a definition hash (SHA-256 of the serialized automation) + records the write scope as a `ScopedApproval`-style entry in `permission-store` (reuse the `skillScriptAlways` content-pin machinery).
- The runner refuses to execute write steps when not armed (run recorded as `skipped` with reason).
- On any edit, the hash mismatches → **auto-disarm** + a re-prompt flag.
- **Acceptance:** editing an armed automation disarms it; a disarmed automation's write step is skipped, not executed; arm record persists across restart.

**Files:** `src/stores/permission-store.ts`, `src/stores/automation-store.ts`, `src/lib/automations/arm.ts` (new)

---

## #9 — Settings → Automations panel + list view ✅

**Category:** frontend · **Complexity:** M · **Depends on:** #3

- New Settings v2 panel (`src/components/settings/v2/`): list rows (trigger-type icon, name, scope badge global/project, `enabled` switch, armed/disarmed indicator, last-run status dot), empty state explaining the concept + "New automation" CTA, and the header note "Automations run while Notesage is open or in the menu bar."
- shadcn-first (`switch`, `scroll-area`, `badge`), strictly-neutral palette, accent only on primary affordances, light/dark + reduced-motion; every Tooltip inside a `TooltipProvider`.
- **Acceptance:** lists automations from both scopes; toggling enabled persists + reloads the schedule; matches design system in both themes.

**Files:** `src/components/settings/v2/AutomationsSettings.tsx` (new), `src/components/settings/v2/SettingsDialogV2.tsx` (nav entry)

---

## #10 — Form builder (create/edit) ✅

**Category:** frontend · **Complexity:** L · **Depends on:** #3, #6, #9

- Guided builder that serializes to YAML via `save_automation`:
  - **Trigger:** schedule picker (friendly recurrence → cron) + optional **condition** row (R1; Phase 1: weekday only; glob/frontmatter land in Phase 2).
  - **Steps:** ordered list, "+ Add step" menu (🤖 Agent · 📄 Document · 🔔 Notify), per-step form, drag-to-reorder, and an **"Insert variable ▾"** picker (shadcn `command`/`popover`) — render inserted tokens as Zapier-style **pills** that serialize to the underlying `{{steps.<id>.output}}` string, so hand-edited YAML and GUI insertion produce identical output (R6 dual-surface parity).
  - **Settings:** overlap `mode` (single / restart / queued — R3), guardrails (max runs/day, max steps/run), `catchUp` toggle, project scope.
  - Footer: **Save**, **Run now** (dispatch through the executor), **Review & arm** (when a write step is present).
- **Acceptance:** building Daily Digest in the form produces the PRD's example YAML; YAML round-trips (model → YAML → reparse → identical); Run-now executes immediately.

**Files:** `src/components/settings/v2/automations/AutomationForm.tsx` (new), `StepEditor.tsx` (new), `TriggerEditor.tsx` (new), `VariablePicker.tsx` (new)

---

## #11 — Arm dialog + missed-runs chooser ✅

**Category:** frontend · **Complexity:** M · **Depends on:** #7, #8, #9

- **Arm dialog** (`alert-dialog`): summarizes write scope (and, Phase 2, scripts + pinned hashes); **Review & arm** / **Cancel**.
- **Missed-runs chooser:** listens for `automations-missed`; an `alert-dialog` (+ desktop notification) listing missed scheduled runs with **Run all / Run selected / Skip**; honors per-automation `catchUp:false` (no prompt).
- **Acceptance:** arming flips state + persists; a quit-gap launch surfaces the chooser and each action behaves (selected runs dispatch through the executor; skip clears).

**Files:** `src/components/settings/v2/automations/ArmDialog.tsx` (new), `src/components/automations/MissedRunsDialog.tsx` (new), mounted at App root with the runner

---

## #12 — Runs history view + AgentOrb rendering ✅

**Category:** frontend · **Complexity:** M · **Depends on:** #4, #9

- Per-automation **Runs history** in the detail view: run list (timestamp, ✓/✗, duration) → "view log" expands per-step output/errors.
- `AgentPanel`/`AgentOrb` render `kind:'automation'` activity items distinctly (icon + status), reusing the existing `kind` discriminator switch.
- **Acceptance:** a completed run shows in both the orb (live) and the durable history (with per-step detail); a blocked-domain failure shows its reason in the log.

**Files:** `src/components/settings/v2/automations/RunsHistory.tsx` (new), `src/components/activity/AgentPanel.tsx`

---

## #13 — Tests: executor, guardrails, arm, catch-up ✅

**Category:** frontend · **Complexity:** M · **Depends on:** #7, #8

- Vitest: executor step dispatch + context threading (`StepResult` envelope) + error short-circuit; overlap `mode` (single drops / restart cancels / queued serializes); guardrail caps + circuit-breaker; arm hashing + auto-disarm-on-change; missed-run surfacing (no auto-fire); template integration. (Rust parse/cron/missed tests already live in #1/#2.)
- Run `pnpm typecheck` + `pnpm test` + `cargo test` green; no coverage regressions in changed files.
- **Acceptance:** full suite green; the Daily-Digest flow has at least one end-to-end-ish executor test (mocked `startTask`/`write_file`).

**Files:** `src/lib/automations/__tests__/executor.test.ts` (new), `src/stores/__tests__/automation-store.test.ts` (new), `src/lib/automations/__tests__/arm.test.ts` (new)
