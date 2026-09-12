---
name: architect-decides-implementation-shape
description: "Once strategy is agreed, implementation-shape decisions belong to the agent — don't hand them back as questions"
type: feedback
aw_applies: "yes"
aw_applies_to: [all]
---

Once the operator has agreed a strategy, the SHAPE of the implementation is the
agent's to decide. Do not hand it back as a question.

**Why:** after agreeing that a surface would be rewritten natively, the agent
wrote the plan and then asked the operator — on a phone — to choose between
hosting it as an overlay over the existing web view or as a real view
controller, and where view state should live. Those were implementation
decisions the agreed strategy already determined, and the "overlay" option was
the smallest-diff instinct preserving the very arrangement being removed.
A recommendation that quietly contradicts an agreed structural change is
patching in disguise.

**How to apply:** after a strategy is settled, decide the shape, state the
decision and the one-line reason, and build. Ask only when two options differ
in a way the operator can judge and the agent cannot — cost they must pay, a
product behaviour they must live with, or a constraint outside the codebase.
If asking still seems necessary, explain WHY the agreed strategy does not
settle it.
