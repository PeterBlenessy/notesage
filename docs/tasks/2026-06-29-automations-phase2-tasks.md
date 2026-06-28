# Automations — Phase 2 Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-06-29 |
| **Status** | Not started |
| **PRD** | [automations](../prds/2026-06-28-automations.md) |
| **Phase** | Phase 2 — File/workspace event triggers + skill/script step |
| **North star** | **Inbox Triage** — a file dropped in `Inbox/` → agent classifies it → a skill/script files it → notify |
| **Total** | 12 tasks: 2S, 8M, 2L |
| **Suggested order** | Backend (#1) → Types (#2) → Triggers (#3–#7) → Skill step (#8–#9) → UI (#10–#11) → Tests (#12) |

Phase 1 (scheduled trigger + Daily Digest) shipped on `feat/automations` (PR #505). Phase 2 adds the **second trigger class** (file/workspace events) and the **`skill` step type**, reusing the Phase-1 executor / arm / guardrail / form surfaces. **Phase 3 (workflow-event triggers) and Phase 4 (branching/canvas/launchd) are out of scope here.**

### Risks / open questions

- **Glob matcher dep:** `picomatch` is already present (transitive). Promote it to a **direct** dependency (MIT, the de-facto matcher) rather than relying on a transitive — passes the dep-selection principles. Minimal-matcher fallback only if we want zero new direct deps.
- **Frontmatter condition cost:** evaluating `condition.frontmatter` means reading the changed file on every matching event. Gate it behind the glob match (cheap) first, and only read when frontmatter keys are actually specified; rely on the debounce (#5) to bound reads.
- **Loop prevention is the sharp edge.** A `document` step writing into a watched dir must not retrigger a file-event automation. The watcher already drops self-writes from `file-changed-batch` (5s TTL, `mark_self_write`), and the runner self-write-tags every write — but the TTL window + an automation that writes *then* an event arrives late is a real edge. #6 adds a per-automation re-entrancy guard as belt-and-braces with a test. **High blast radius — get the test right.**
- **Skill step under the sandbox:** `execute_skill_script` is content-pinned + Seatbelt-scoped to the skill dir + working dir; its network is NOT yet proxied (documented Phase-1 follow-up). An unattended skill step inherits that. Note it; don't widen it here.
- **Always-mounted:** the new watcher-event subscription lives in `useAutomationRunner` (already App-root mounted) — do NOT add a second mount point (MEMORY "always-mounted listeners").
- **`skill` step requires approve-to-arm** (it runs code) — extend the Phase-1 arm content-pin to cover the script SHA (#9), same machinery as the direct-API skill-script approval.

---

## #1 — Rust: add `skill` step variant + validation ⏳

**Category:** backend · **Complexity:** S · **Depends on:** —

- Extend the `AutomationStep` enum in `commands/automations.rs` with a `Skill { id, skill, script, args? }` variant (internally-tagged `type: skill`). Add it to `AutomationStep::id()`.
- `validate_automation_struct`: a skill step needs non-empty `skill` + `script`. Keep the unique-id + non-empty-id checks.
- Confirm `save_automation` confinement + `resolve_automation_write_path` are unaffected (skill steps don't write via the document path).
- **Acceptance:** a YAML with a `skill` step parses + validates; missing `skill`/`script` errors; `cargo test` adds a `parses_skill_step` case. Clean rebuild may be needed (enum change).

**Files:** `src-tauri/src/commands/automations.rs`

---

## #2 — TS: `skill` step type + file-event shapes ⏳

**Category:** frontend · **Complexity:** S · **Depends on:** #1

- Add `{ type: 'skill'; id; skill; script; args?: string[] }` to the `AutomationStep` union and `'skill'` to `StepType` in `src/lib/automations/types.ts` (mirror the Rust enum).
- `FileEventName` already exists; confirm the runner's trigger payload type covers `{ type:'file', file, event }`.
- **Acceptance:** typecheck green; the serializer (`serialize.ts`) round-trips a skill step (extend `serialize.test.ts`).

**Files:** `src/lib/automations/types.ts`, `src/lib/automations/serialize.ts`

---

## #3 — File-event trigger matching in the runner ⏳

**Category:** frontend · **Complexity:** L · **Depends on:** #2, #4, #5, #6

- In `useAutomationRunner`'s App-root effect, additionally `listen` for `file-changed-batch` (`{path, kind}[]`) and `file-renamed` (`{old_path, new_path, is_directory}`) — learn the exact shapes from `src/hooks/useFileWatcher.ts`.
- Map `kind` → event name (`create→file-created`, `modify→file-modified`, `delete→file-deleted`; rename → `file-renamed`). For each changed path, find enabled automations with `trigger.type==='file'` whose `event` matches and whose **condition matches** (#4) and which pass **debounce** (#5) and the **loop guard** (#6), then `requestRunRef.current(automation, { type:'file', file: path, event })`.
- Respect scope: only consider a file-event automation when the changed path is under its scope/`trigger.path`.
- **Acceptance:** dropping a matching file fires the automation once with `{{trigger.file}}` populated; a non-matching path/event does nothing. Covered by #12 tests (the matching logic should be a pure, exported helper to keep it testable outside React).

**Files:** `src/hooks/useAutomationRunner.ts`, `src/lib/automations/file-match.ts` (new — pure matcher)

---

## #4 — Condition evaluation (glob + frontmatter) ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #2

- `src/lib/automations/file-match.ts`: `matchesCondition(automation, file, readFrontmatter)` — returns whether a changed `file` satisfies `condition`. `glob` via **picomatch** (promote to a direct dep); path matched relative to the automation scope. `frontmatter` keys checked only when present, reading the file lazily (injected reader so it's testable). No condition ⇒ matches.
- Also reused by the trigger-level filter generally (weekday already handled for schedule).
- **Acceptance:** unit tests: glob match/non-match (`Inbox/*.md`, `**/*.md`), frontmatter key match, empty condition = match, glob is scope-relative.

**Files:** `src/lib/automations/file-match.ts`, `package.json` (picomatch direct dep)

---

## #5 — Debounce on event triggers ⏳

**Category:** frontend · **Complexity:** S · **Depends on:** #2

- Wire `guardrails.debounceMs` (already in the type, unused) in `GuardrailTracker` (or a small companion): suppress an event-triggered fire for an automation if it fired within `debounceMs`. Default debounce for file triggers (e.g. 60s) when unset; schedule triggers ignore debounce.
- **Acceptance:** two events within the window fire once; after the window, fire again. Unit-tested in `executor.test.ts` (extend GuardrailTracker).

**Files:** `src/lib/automations/executor.ts`, `src/hooks/useAutomationRunner.ts`

---

## #6 — Loop-prevention re-entrancy guard ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #3

- Belt-and-braces beyond the watcher's self-write suppression: when an automation run writes a path (the `document` step), record `(sourcePath → recently-written paths)` with a short TTL; the file-event matcher (#3) ignores an event for a path this automation just wrote. Prevents a file-event automation whose write lands in its own watched dir from self-triggering even if the watcher TTL lapses.
- **Acceptance:** a file-event automation that writes into its watched glob does NOT re-fire from its own write (test in #12); an *unrelated* external change to the same dir still fires.

**Files:** `src/lib/automations/file-match.ts` (or a small `loop-guard.ts`), `src/hooks/useAutomationRunner.ts`

---

## #7 — Ensure the automation's watched path is watched ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #2

- The watcher watches open projects/folders, but a file-event automation may target a path not currently watched (e.g. a global `~/Notesage/Inbox`). Add an effect (in `useAutomationDiscovery` or the runner) that, for each enabled `trigger.type==='file'` automation, calls `watch_directory(trigger.path ?? scope)` if not already covered. Avoid duplicate watches (the command is idempotent per path).
- **Acceptance:** a global Inbox-Triage automation receives events for `~/Notesage/Inbox` without the user opening it as a project.

**Files:** `src/hooks/useAutomationDiscovery.ts` (or `useAutomationRunner.ts`), `src/lib/tauri.ts` (watch wrapper already exists)

---

## #8 — Executor: run `skill` steps ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #1, #2

- Add a `runSkill(skill, script, args)` dep to `ExecutorDeps` and handle the `skill` case in `executeStep` (returns stdout as `StepResult.output`, surfaces stderr/exit-code errors). In the runner, implement `runSkill` via `useSkillOperations.executeScript` (resolves the skill path from `skill-store.getSkillByName`, passes the content-pin hash) — content-pinned + Seatbelt-sandboxed, no extra approval prompt because arming already pinned it (#9).
- Templated `args` render through the run context (`{{trigger.file}}`, `{{steps.*}}`).
- **Acceptance:** a skill step runs the script with rendered args and threads stdout into the context; a non-zero exit / missing skill fails the run cleanly. Tested in #12 (mocked executeScript).

**Files:** `src/lib/automations/executor.ts`, `src/hooks/useAutomationRunner.ts`

---

## #9 — Arm machinery covers skill steps ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #1, #2, #8

- `arm.ts`: `armableSteps` includes `skill`; `writeScope` lists each skill step's `skill/script`; `computeAutomationHash` already covers `steps` (so editing a skill step re-arms). Additionally pin the **script body SHA** (reuse `tauriApi.hashSkillScript`) into the arm record so a *rewritten skill script* (unchanged automation YAML) also disarms — mirror the direct-API skill content-pin (SEC pattern). The `ArmDialog` shows the script path + that it runs code.
- **Acceptance:** arming a skill automation pins both the definition hash and the script SHA; editing the YAML OR the script body disarms it. Tested in #12.

**Files:** `src/lib/automations/arm.ts`, `src/components/settings/v2/automations/ArmDialog.tsx`, `src/stores/permission-store.ts` (extend `AutomationArmRecord` with optional script hashes)

---

## #10 — TriggerEditor: File-event trigger ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #2

- Extend `TriggerEditor` (schedule-only today) with a trigger-type switch (Schedule / File event). For File: an event-kind select (created / modified / deleted / renamed), a watched-path input (defaults to scope), and a glob field (→ `condition.glob`, e.g. `Inbox/*.md`). The panel's trigger-type icon already maps file→`FileText`.
- **Acceptance:** building a file-event automation in the form produces valid YAML (`trigger.type: file`, `event`, `condition.glob`) that round-trips; the form's existing schedule path is unchanged.

**Files:** `src/components/settings/v2/automations/TriggerEditor.tsx`, `src/components/settings/v2/automations/AutomationForm.tsx`

---

## #11 — StepEditor: "Run skill" step ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #2, #8, #9

- Add a "Run skill" entry to the add-step menu and a step form: a skill picker (from `skill-store.getActiveSkills`), a script picker (the skill's scripts), and a templated args field with the variable picker. Design-system compliant (shadcn Select, focus states, etc. — apply the Phase-1 review lessons up front).
- **Acceptance:** can build an Inbox-Triage automation (file trigger → agent classify → skill move → notify) end-to-end in the form; "Save, arm & run" arms (definition + script SHA) and runs.

**Files:** `src/components/settings/v2/automations/StepEditor.tsx`, `src/components/settings/v2/automations/AutomationForm.tsx`

---

## #12 — Tests: matching, glob, debounce, loop, skill, arm ⏳

**Category:** frontend · **Complexity:** M · **Depends on:** #3–#9

- Vitest: file-event matcher (event + scope + condition), glob match/non-match, frontmatter condition, debounce window, **loop-prevention re-entrancy** (own write doesn't re-fire; external change does), skill-step execution (mocked `executeScript`, rendered args, error path), arm hash includes skill + script-SHA disarm-on-rewrite. Rust: `parses_skill_step`.
- Run `pnpm typecheck` + `pnpm test` + `cargo test` green; no coverage regressions.
- **Acceptance:** full suite green; the Inbox-Triage flow has an end-to-end-ish executor test (file event → agent → skill → notify, all mocked).

**Files:** `src/lib/automations/__tests__/file-match.test.ts` (new), `src/lib/automations/__tests__/executor.test.ts`, `src/lib/automations/__tests__/arm.test.ts`, `src-tauri/src/commands/automations.rs` (#[cfg(test)])
