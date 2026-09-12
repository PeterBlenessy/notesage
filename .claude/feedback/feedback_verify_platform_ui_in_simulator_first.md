---
name: exercise-platform-ui-in-a-simulator-before-shipping
description: "Run mobile UI changes in the simulator and drive the real user path before cutting a build — device time is the operator's only way to test"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-tdd, aw-review]
---

Before cutting a build carrying a mobile UI or capture change, run it in the
**simulator** and exercise the actual user path.

**Why:** six defects across consecutive builds were found on hardware by the
operator — menu rows that never fired, a blocked fetch, a stale thumbnail, a
broken hero image, a duplicated cover. Every one was reachable in a simulator,
and the harness was already documented and went unused. The operator's device
is their only way to test, so each bad build costs them a whole cycle.

**How to apply:** build for the simulator, install, and drive the path the
change affects. See the simulator section of `CLAUDE.md` for how to send taps,
swipes and text programmatically, and for the build-freshness check — a
simulator build can report success while leaving the previous app in place.
