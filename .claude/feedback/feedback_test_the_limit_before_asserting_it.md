---
name: check-a-claimed-limit-with-one-command
description: "Before claiming something can't be done, isn't cached, or isn't installed — spend one command checking; it is a factual claim like any other"
type: feedback
aw_applies: "yes"
aw_applies_to: [all]
---

Before asserting that something is impossible, unavailable, uncached or
missing, run ONE command and check. Claiming a limit is a factual claim and
needs the same evidence as any other.

**Why:** three such claims were made in a single session and all three were
wrong — the operator corrected each. Reading a configuration flag and reasoning
from it replaced looking at the actual artefacts, which took one command.

**How to apply:** when about to write "X isn't possible / isn't there / can't
be cached", stop and check: list the directory, run the binary with `--help`,
grep the lockfile, open the file. Then state the finding, not the inference.
