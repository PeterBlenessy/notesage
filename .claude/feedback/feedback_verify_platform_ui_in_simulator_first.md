---
name: exercise-platform-ui-in-a-simulator-before-shipping
description: "Run mobile UI changes in the simulator and drive the whole round trip — open it, use it, leave it — before cutting a build; stopping at 'it rendered' is how broken builds ship"
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

**Drive the WHOLE round trip, not the first screen of it.** Open the surface,
use it for the thing it exists for, and leave it again. "It rendered" is not
"it works", and neither is "one tap did something".

**Why that sharpening exists:** one screen took three builds, each failing one
layer deeper than the previous verification had reached. The first build
rendered a list whose rows did not open — the list had been seen, no row had
been tapped. The second opened its rows but trapped the user: the back button
put them straight back on the screen, so the only way out was to quit. Every
gate was green all three times — type checks, thousands of unit tests, the full
CI matrix, a clean compile — because none of them can press a button. Each
round of verification stopped exactly one step before the next defect.

**How to apply:** build for the simulator, install, and drive the path the
change affects, end to end:

- **Open** the surface the way a user reaches it, not by deep link.
- **Use** it for its purpose — if it is a list of things to read, read one; if
  it takes input, submit some. The reason the surface exists is the step most
  likely to be skipped and most likely to be broken.
- **Leave** it. Back, dismiss, swipe — whatever exits. A surface with no way
  out is worse than one that never opened, because it looks finished.

State which of those three were actually driven when reporting. "Verified on
the simulator" without saying what was pressed is the claim that let all three
builds ship.

See the simulator section of `CLAUDE.md` for how to send taps, swipes and text
programmatically, and for the build-freshness check — a simulator build can
report success while leaving the previous app in place.
