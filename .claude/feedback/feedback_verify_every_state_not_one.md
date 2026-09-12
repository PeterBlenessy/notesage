---
name: verify-every-state-not-the-one-just-changed
description: "A toggle touching two layouts needs both layouts in both states, on data seeded with every format — not one screen"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-tdd, aw-review]
---

When a change touches a setting that applies across views, verify every
combination, on data that contains every case — not the one screen just
changed.

**Why:** a build shipped with thumbnails on opposite sides for two row kinds,
one kind stuck at a fixed size, and a density toggle that did nothing in one of
the two layouts. One screen had been checked and the rest assumed to follow.
The operator called the testing sloppy, and was right.

**How to apply:** seed the test data with every format the surface can hold,
then capture each view × each density. Read the captures against EACH OTHER
rather than against the one just edited — the defects were all disagreements
between surfaces, invisible when looking at one.
