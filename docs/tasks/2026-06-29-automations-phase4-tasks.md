# Automations — Phase 4 Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-06-29 |
| **Status** | Not started |
| **PRD** | [automations](../prds/2026-06-28-automations.md) |
| **Phase** | Phase 4 — branching · visual canvas · launchd (the optional / "may never ship" phase) |
| **Total** | 12 tasks across 3 independent tracks: A (4), B (4), C (4) — 2S, 7M, 3L |
| **Suggested order** | **Track A first** (cheapest, highest value) → then **C** or **B** by demand. Tracks are independent — pick à la carte. |

Phases 1–3 (all three trigger classes) shipped on `feat/automations` (PR #505). Phase 4 is the PRD's explicitly-deferred batch of **three unrelated, optional features**. They share almost nothing — implement (or skip) each on its own. **None is required for a complete, shippable Automations feature.**

### Risks / open questions (read before starting any track)

- **Tracks B and C arguably deserve their own PRDs.** The visual canvas is a whole authoring surface (new heavy dep, big UI, its own design review); the launchd daemon is a macOS-only system-integration feature (a bundled LaunchAgent, real-device testing, an OS-visible Login Item). Either could be lifted out into a dedicated PRD rather than ridden in under "Phase 4." Decide that before committing to B or C.
- **Track A's expression evaluator is the one genuinely-risky bit** — it must be a hand-written safe parser with **no `eval`/`Function`/template-literal evaluation** (same bar as the template renderer). Adversarial tests are mandatory.
- **Track C is best-effort by nature** (per the research): a LaunchAgent runs only while logged in and **coalesces missed-while-asleep fires into one wake-time run** — never guaranteed wall-clock. The UX copy must say so. It also becomes a visible **Login Items & Extensions** entry. macOS-only; needs **real-device** verification (can't be fully unit-tested).
- **Track B dep call:** `@xyflow/react` (React Flow, MIT) is the standard node-graph lib but heavy (~weight + its own CSS). Weigh it against a minimal hand-rolled SVG/flex graph per the project's dep-selection principles before adding it.
- **No regressions:** all three build on the linear Phase-1/2/3 executor + form. Track A changes the executor (run-skipping) — keep every existing executor/overlap/guardrail test green.

---

## Track A — Mid-pipeline conditional branching

*Per-step `if` (a step is skipped when false) — keeps the linear model + the existing executor. Highest value, lowest cost. Do this one first.*

### A1 — Safe condition expression evaluator ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** —

- New `src/lib/automations/condition-expr.ts`: `evaluateCondition(expr: string, ctx: RunContext): boolean`. A tiny **hand-written** parser for `<path> <op> <value>` plus bare truthiness — `op ∈ ==, !=, contains, matches` (regex), values are string/number/boolean/quoted-string literals. Paths resolve via the existing template `deepGet` (reuse, don't duplicate). NO `eval`/`Function`/`new RegExp`-on-unbounded-input-without-guard.
- Examples: `steps.classify.json.urgent == true`, `steps.review.output contains "TODO"`, `{{trigger.file}}` (truthy), `steps.x.json.count != 0`.
- **Acceptance:** unit tests for each operator, missing/empty path → false, malformed expr → false (never throw), and **adversarial no-eval tests** (`process.env`, `constructor`, `${...}`, `"; …` all inert — pure data comparison only).

**Files:** `src/lib/automations/condition-expr.ts` (new), `src/lib/automations/__tests__/condition-expr.test.ts` (new)

### A2 — `if?` on AutomationStep (model + round-trip) ⏳

**Category:** both · **Complexity:** S · **Depends on:** —

- Add optional `if?: String`/`if?: string` to every `AutomationStep` variant (Rust enum in `commands/automations.rs` + TS union in `types.ts`); serialize round-trips it (`serialize.ts`/test). `serde(rename = "if")` is a Rust keyword — alias the field (`r#if` or `#[serde(rename = "if")] cond`).
- **Acceptance:** a step with `if: "steps.x.output contains 'urgent'"` parses + round-trips (Rust `cargo test` + TS serialize test).

**Files:** `src-tauri/src/commands/automations.rs`, `src/lib/automations/types.ts`, `src/lib/automations/serialize.ts` (+ tests)

### A3 — Executor honors `step.if` ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #A1, #A2

- In `executor.ts` `runAutomation`, before running a step: if `step.if` is set and `evaluateCondition(step.if, ctx)` is false, **record a `skipped` step result and continue** to the next step (do NOT fail the run). The skipped step contributes no `steps.<id>.output` (downstream refs resolve empty).
- **Acceptance:** executor tests — a false-`if` step is skipped while later steps still run; a true-`if` step runs; no `if` = always runs (unchanged behavior). All existing executor tests stay green.

**Files:** `src/lib/automations/executor.ts`, `src/lib/automations/__tests__/executor.test.ts`

### A4 — StepEditor "only run if" field ⏳

**Category:** frontend · **Complexity:** S · **Depends on:** #A2

- Add an optional **"Only run this step if…"** input to each step in `StepEditor` (with the variable picker), bound to `step.if`. Show a one-line hint of the DSL (`steps.x.output contains "…"`).
- **Acceptance:** building a step with a condition produces YAML with `if:` that round-trips; empty field omits `if`. Design-system compliant (Phase-1/2 review lessons).

**Files:** `src/components/settings/v2/automations/StepEditor.tsx`

---

## Track B — Visual-canvas builder

*A node-graph authoring surface as an alternate to the form. Highest cost, UI-heavy — consider a dedicated PRD.*

### B1 — Canvas scaffold + dep decision ⏳

**Category:** frontend · **Complexity:** L · **Depends on:** —

- Decide the dep: `@xyflow/react` (React Flow, MIT — standard, heavy) vs a minimal hand-rolled SVG/flex graph. Document the call per the dep-selection principles. If adopting, add it + its CSS, isolated so it loads only with the canvas.
- Build a read-only `AutomationCanvas` that renders an `Automation` as nodes (trigger node + one node per step, wired top-to-bottom) — **layout derived from step order**, NOT stored (no x/y in the YAML, per research; a sidecar only if free-form positioning is ever needed).
- **Acceptance:** an existing automation renders as a correct linear node graph in both light/dark; no YAML changes.

**Files:** `src/components/settings/v2/automations/AutomationCanvas.tsx` (new), `package.json` (if dep added)

### B2 — Editable nodes (add / remove / reorder / edit) ⏳

**Category:** frontend · **Complexity:** L · **Depends on:** #B1

- Make the canvas editable: click a node → edit its fields (reuse the `StepEditor`/`TriggerEditor` field bodies in a side panel or popover), add/remove step nodes, reorder by drag — all mutating the same `Automation` draft the form uses (single source of truth).
- **Acceptance:** building the Daily-Digest / Inbox-Triage automation entirely on the canvas produces the same YAML as the form; round-trips.

**Files:** `src/components/settings/v2/automations/AutomationCanvas.tsx`, `AutomationForm.tsx`

### B3 — Form ⇄ canvas toggle ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #B2

- A toggle in the `AutomationForm` dialog to switch between the form view (Phase 1) and the canvas view, both editing the same draft. Persist the user's preferred view (settings).
- **Acceptance:** toggling mid-edit preserves the draft; both views stay in sync; Save serializes identically from either.

**Files:** `src/components/settings/v2/automations/AutomationForm.tsx`, `src/stores/settings-store.ts`

### B4 — Canvas tests + design review ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #B3

- Component tests (render an automation → expected nodes/edges; edit → model updates; round-trip). Run `/review-ui` on the canvas surface — **mandatory** (palette, focus states, light/dark, reduced-motion, keyboard reachability of nodes).
- **Acceptance:** tests green; design review findings addressed; full suite + typecheck green.

**Files:** `src/components/settings/v2/automations/__tests__/AutomationCanvas.test.tsx` (new)

---

## Track C — launchd "fire while fully quit" daemon (macOS-only)

*The deferred upgrade to the Phase-1 tray-resident firing model — true firing after a full ⌘Q. Most platform-specific; best-effort by nature.*

### C1 — Schedule → LaunchAgent plist generation (Rust, pure) ⏳

**Category:** backend · **Complexity:** M · **Depends on:** —

- In Rust, derive a `StartCalendarInterval` plist from the enabled scheduled automations: convert each cron to the structured launchd dict (`Minute`/`Hour`/`Day`/`Weekday`/`Month`; an **array of dicts** for multi-time crons; omitted field = wildcard). NOT cron — launchd has no cron. Pure function, unit-tested with edge cases (daily, weekly multi-day, hourly, ranges).
- **Acceptance:** `cargo test` covers cron→calendar-dict conversion for the common shapes; an unconvertible cron (sub-minute / complex) is reported, not silently dropped.

**Files:** `src-tauri/src/commands/automations.rs` (or a new `launch_agent.rs`)

### C2 — Register/unregister LaunchAgent + hidden `--background` launch ⏳

**Category:** backend · **Complexity:** L · **Depends on:** #C1

- Register the agent via **`SMAppService`** (macOS 13+; evaluate the `smappservice-rs` crate) with the bundled plist at `…/Contents/Library/LaunchAgents/`; regenerate + re-register when schedules change; clean unregister. Add a `--background` launch mode: the app starts hidden, the existing tray-resident runner fires the due jobs (Phase 1), then quits or returns to tray.
- **Acceptance:** register → the agent appears in `launchctl`/Login Items; unregister removes it; `--background` launch runs due jobs without showing a window. (Lifecycle unit-tested where possible; firing verified on a real Mac — see C4.)

**Files:** `src-tauri/src/commands/automations.rs` (or `launch_agent.rs`), `src-tauri/src/lib.rs` (`--background` mode + plist resource), `src-tauri/Cargo.toml` (+ `smappservice-rs` if adopted)

### C3 — Settings opt-in + honest UX ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #C2

- A Settings → Automations toggle: **"Run scheduled automations even when Notesage is quit."** On → register the agent; off → unregister. Copy must state it's **best-effort / wake-coalesced** (missed-while-asleep fires coalesce to one wake-time run; never exact wall-clock) and that it appears in **System Settings → Login Items & Extensions**. Re-register when the schedule set changes.
- **Acceptance:** toggling registers/unregisters; the copy is honest about the guarantees; opt-out / uninstall leaves no orphaned agent.

**Files:** `src/components/settings/v2/AutomationsSettings.tsx`, `src/lib/tauri.ts`, `src/stores/settings-store.ts`

### C4 — Lifecycle tests + real-device verification ⏳

**Category:** both · **Complexity:** M · **Depends on:** #C3

- Rust unit tests for plist generation (C1) + the register/unregister state machine. A documented **manual macOS test plan**: quit the app fully → confirm a due automation fires on schedule (or coalesced on wake) → confirm the Login Items entry → opt out → confirm the agent is gone. (launchd firing can't be unit-tested.)
- **Acceptance:** automated tests green; the manual plan documented in the PR; verified on a real Mac before merge.

**Files:** `src-tauri/src/commands/automations.rs` (#[cfg(test)]), the PR description (test plan)

---

### Recommendation

**Track A is the only one I'd reach for by default** — it's small, high-value, fully testable, and finishes the pipeline's expressiveness. **Track C** is worth it only if "fire while fully quit" is a real user ask (it's a meaningful chunk of macOS-specific work for a best-effort guarantee). **Track B** is the largest and most optional — the form builder already covers authoring; a canvas is polish. Spin B and/or C into their own PRDs if pursued. After A, all the *engine* capability the PRD envisioned (minus the canvas/daemon polish) is shipped.
