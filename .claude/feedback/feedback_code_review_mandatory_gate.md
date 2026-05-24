---
name: Code review is a mandatory gate before ✅
description: Bugs visible on a careful code reread must be caught before marking a task done. Tests are necessary, not sufficient. Applies to every task.
type: feedback
originSessionId: e5c215b2-1927-4a03-adb4-ded445ecea6e
aw_applies: yes
aw_applies_to: [aw-review]
---
Code review is a mandatory gate before ✅. Tests are necessary, not sufficient.

**Why:** M1.2 of the UI refresh shipped five ✅ tasks (#20, #21, #23, #24, #27) that were functionally dead in production. Each had passing unit tests asserting the literal component behavior — "hook emits event", "class is applied", "`sendChatMessage` is called" — but the composition was broken: the bus had no production subscriber, the hook was never mounted, `AgentSwitchCard` was never rendered in the new shell, history was never wired in. The user had to test live to discover it. Additionally, AgentOrb's pulse was visibly dead due to a Tailwind transform / keyframe CSS conflict that any code reviewer would have flagged on sight. User directive: "you MUST be able to conclude from looking at the code" — if a bug is visible on a careful read, code review is the gate.

**How to apply:**

1. **Every task with UI wiring runs through `/review-code` with a wiring-audit prompt** before ✅ is stamped — specifically: "trace every exported hook/component/event to its real consumer; flag orphans; flag CSS conflicts like `transition-*` on the same property as a keyframe animation; flag tests that assert a weaker property than the requirement (e.g., 'class present' for a 'visibly pulses' requirement)".
2. **A passing test is not a ✅ trigger** — it's a prerequisite. ✅ requires: tests pass AND code review finds no wiring/cascade issues AND outcome-shaped criterion is observable.
3. **Static graph checks**: exported `useXxx` hooks in `src/hooks/` without a non-test call site → fail the test gate. Same for components with zero mount sites outside `__tests__/`. Add this as a grep check in the review skill.
4. **Do not call the user in for manual QA of correctness.** If correctness is ambiguous, escalate to code review first; manual QA is a last resort for visual feel only. User wants to monitor from mobile via git log, not be pinged for "please test ⌘K".
