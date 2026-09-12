---
name: state-the-interaction-model-before-building-a-control
description: "Name tap → outcome → where the user ends up, in one line, before building a control — a request naming the trigger rarely names the destination"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-refine, aw-slice]
---

For a new control, write the interaction model back in one line BEFORE coding:
what the tap does, where the user ends up, what the control then shows.

**Why:** a request for "the option to start playback from the list" was built
as a control that opened the item and started playback there. What was meant
was playback running while the user stayed in the list, the control becoming
Pause with a progress ring. A full rework followed. The request named the
trigger, not the destination, and the gap was filled with the cheapest reading.

**How to apply:** state "tap → X starts, the user stays on Y, the control shows
Z" and build only once that line stands. Do the same wherever "open it" versus
"do it in place" is ambiguous.
