# Automations — Phase 3 Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-06-29 |
| **Status** | Not started |
| **PRD** | [automations](../prds/2026-06-28-automations.md) |
| **Phase** | Phase 3 — Workflow/app-event triggers |
| **North star** | **On-save Check** — a document is saved → an agent reviews it (lint / suggest tags / flag TODOs) → notify |
| **Total** | 7 tasks: 2S, 5M |
| **Suggested order** | Bus (#1) → Runner (#2) → Emit points (#3–#5) → UI (#6) → Tests (#7) |

Phases 1 (scheduled) and 2 (file-event triggers + skill step) shipped on `feat/automations` (PR #505). Phase 3 adds the **third and final trigger class** — workflow/app events (`document-saved`, `agent-task-complete`, `transcription-done`) — reusing the Phase-1/2 executor / condition / debounce / loop-guard / form surfaces. The only genuinely new infrastructure is a small **frontend event bus** + the emission points that feed it. **Phase 4 (branching / visual canvas / launchd) remains out of scope.**

### Risks / open questions

- **Loop prevention is the sharp edge (again).** An automation's `document` step write → a `document-saved` emit → must NOT re-fire an on-save automation, or you get an infinite loop. The runner already `markAutomationWrite`s every write (Phase 2 loop-guard); the `document-saved` emit (#3) MUST call `wasAutomationWrite(path)` and skip. High blast radius — the test in #7 is mandatory.
- **Agent-task-complete self-trigger.** An automation's `agent` step uses `startTask({ trackInActivityStore: false })`, so it creates no `kind:'agent'` activity task — but the automation's OWN `kind:'automation'` activity task completing must ALSO not emit. Emit `agent-task-complete` ONLY for `kind:'agent'` tasks (#4) — guard explicitly, don't rely on the implicit path.
- **Emission points span subsystems** (`useFileOperations`, `activity-store`/`useAgentTaskOperations`, `useTranscriptionJob`) — each a tiny additive `emitWorkflowEvent` call, but flag the blast radius and keep each change minimal + guarded.
- **Auto-save noise.** `document-saved` fires on every save (auto-save is 1s-debounced upstream). The per-automation `debounceMs` (Phase 2, 60s default for event triggers) bounds re-fires; confirm it's applied to workflow triggers too.
- **Always-mounted.** The runner subscribes to the bus once at App root (it already mounts the watcher + scheduler listeners there). The bus is a plain module singleton — emit points import and call it directly (no React).
- **Fire-and-forget hardening.** Phase 2 had an intermittent unhandled-rejection in the event path; the workflow-event handler must use the same try/catch wrapping so a rejection can never surface as a suite error.

---

## #1 — Internal workflow event bus ⏳

**Category:** frontend · **Complexity:** S · **Depends on:** —

- Create `src/lib/automations/event-bus.ts` (mirror `src/lib/cmd-bar-events.ts`): a discriminated `WorkflowEvent` union —
  `{ event: 'document-saved'; file: string }` | `{ event: 'agent-task-complete'; taskId: string; label?: string; output?: string }` | `{ event: 'transcription-done'; transcriptPath?: string }` — plus `emitWorkflowEvent(e)` and `onWorkflowEvent(handler): () => void` (a `Set<Handler>` pub/sub; emit catches per-handler errors so one bad subscriber can't break the rest).
- `event` values reuse the existing `WorkflowEventName` in `types.ts`.
- **Acceptance:** unit-tested pub/sub — subscribe, emit, receive; unsubscribe stops delivery; a throwing handler doesn't stop others.

**Files:** `src/lib/automations/event-bus.ts` (new), `src/lib/automations/__tests__/event-bus.test.ts` (new)

---

## #2 — Runner: workflow-event matching ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #1

- In `useAutomationRunner`'s App-root effect, `onWorkflowEvent` and handle each event: find enabled automations with `trigger.type === 'workflow' && trigger.event === e.event`; build the trigger context (`{ type: 'workflow', event, file?, taskId?, output?, transcriptPath? }`); for `document-saved` apply `matchesCondition` (glob against `file`, reusing Phase-2 `file-match.ts`); apply the Phase-2 debounce; then `requestRunRef.current(...)`. Wrap the handler in the same try/catch hardening as the file-event path (never reject unhandled). Unsubscribe in cleanup.
- Extract a pure `workflowEventMatches(automation, event)` helper (in `file-match.ts` or a sibling) for testability.
- `{{trigger.file}}` / `{{trigger.output}}` already resolve via the template renderer.
- **Acceptance:** an emitted `document-saved` for a matching glob fires the automation once with `{{trigger.file}}` populated; a non-matching event/glob does nothing. Tested in #7 (pure matcher) + an integration-ish test.

**Files:** `src/hooks/useAutomationRunner.ts`, `src/lib/automations/file-match.ts`

---

## #3 — Emit `document-saved` (with loop suppression) ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #1

- In `src/hooks/useFileOperations.ts` `saveFile()`, after a successful write, call `emitWorkflowEvent({ event: 'document-saved', file })` — BUT first check `wasAutomationWrite(file)` (Phase-2 loop-guard) and **skip the emit** if the save was an automation's own `document` step. This is the primary loop-prevention point.
- **Acceptance:** a user/editor save emits the event; an automation's own write does NOT. Covered by #7's loop test (mock the emit, assert it isn't called for an automation write).

**Files:** `src/hooks/useFileOperations.ts`

---

## #4 — Emit `agent-task-complete` (kind:'agent' only) ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #1

- Emit `emitWorkflowEvent({ event: 'agent-task-complete', taskId, label, output })` when an agent task reaches `done` — at the single chokepoint in `activity-store.updateTaskStatus` (or `useAgentTaskOperations`'s completion path), gated on the task's `kind === 'agent'` (NEVER `'automation'`/`'transcription'`/`'recording'`). Pull `output` from the task's `finalOutput` when available.
- **Acceptance:** a normal agent/comment-delegated task completing emits once; an automation's own run (kind:'automation') does NOT emit — no self-trigger loop. Tested in #7.

**Files:** `src/stores/activity-store.ts` (or `src/hooks/useAgentTaskOperations.ts` — pick the single completion chokepoint)

---

## #5 — Emit `transcription-done` ⏳

**Category:** frontend · **Complexity:** S · **Depends on:** #1

- In `src/hooks/useTranscriptionJob.ts`, on a successful transcription completion, call `emitWorkflowEvent({ event: 'transcription-done', transcriptPath })`.
- **Acceptance:** finishing a transcription emits once with the transcript path; a failed/cancelled job does not.

**Files:** `src/hooks/useTranscriptionJob.ts`

---

## #6 — Form/UI: Workflow-event trigger ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** —

- Extend the trigger-type switch in `AutomationForm` (currently Schedule / File event) with a third **Workflow event** option, and an event-kind select (Document saved / Agent task done / Transcription done). For `document-saved`, show the optional glob field (→ `condition.glob`, e.g. `**/*.md`); agent/transcription events need no path. Keep the schedule + file paths unchanged.
- Design-system compliant (apply the Phase-1/2 review lessons: shadcn `Select`, focus states, neutral palette). The panel trigger-type icon already maps `workflow → Workflow` (lucide).
- **Acceptance:** building an On-save-Check automation (workflow trigger `document-saved`, glob `**/*.md`, agent step, notify) produces valid YAML that round-trips; existing schedule/file forms unaffected.

**Files:** `src/components/settings/v2/automations/AutomationForm.tsx` (+ `TriggerEditor.tsx` if the workflow fields live there)

---

## #7 — Tests: bus, matcher, loop, emit guards, On-save Check ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #2–#5

- Vitest: event-bus pub/sub (in #1); `workflowEventMatches` (event + condition/glob); **document-saved loop-prevention** (an automation's own write doesn't emit/fire; an external save does); emit-point guards (kind:'automation' agent task does NOT emit `agent-task-complete`); and an **On-save-Check** executor test (workflow `document-saved` → agent reviews `{{trigger.file}}` → notify, all mocked).
- Run `pnpm typecheck` + `pnpm test` + `cargo test` green; no coverage regressions. Confirm the full suite is stable across 2 runs (Phase 2's flake was here).
- **Acceptance:** full suite green; the loop-prevention and self-trigger-exclusion tests are present and passing.

**Files:** `src/lib/automations/__tests__/event-bus.test.ts`, `src/lib/automations/__tests__/workflow-trigger.test.ts` (new), `src/lib/automations/__tests__/executor.test.ts`

---

### Phase 3 completes the trigger trinity

After this, all three trigger classes from the PRD are shipped (scheduled · file · workflow). Remaining beyond Phase 3 (own PRDs/phases if ever pursued): **Phase 4** — mid-pipeline conditional branching, the visual-canvas builder, and the optional `launchd` true-fire-while-quit daemon.
