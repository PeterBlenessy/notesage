---
name: drive-interactive-repros-with-the-projects-own-harness
description: "When the project has a driver for the app, drive the scenario yourself — don't ask the operator to click around while you watch logs"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-tdd]
---

When investigating an interactive problem and the project has a harness that
drives the application, drive the scenario. Do not ask the operator to click
around while the agent watches logs.

**Why:** a human in the loop makes every measurement one action per round trip,
and produces conflicting evidence — the wrong window focused, a different
notion of "warm", a click that did not match the assumption. Driving the same
flow directly gives reproducible numbers that can be re-run identically before
and after a fix.

**How to apply:** look for an E2E or automation setup in the repo and stand up
the same driver the tests use, then script the exact scenario and compare
before/after in one harness. For mobile, see the simulator section of
`CLAUDE.md`.
