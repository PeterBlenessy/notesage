---
name: trace-reachability-before-splitting-a-large-file
description: "Before acting on a split-large-file task, check each branch is actually rendered — deleting dead code beats tidying it into more files"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-triage, aw-tdd]
---

When a "split this large file" task lands, do not blindly split. First trace
whether each component or branch is actually reachable.

**Why:** a 1,146-line file was slated for splitting into eleven components. The
entire variant those components lived in was DEAD — a prop hardcoded `as const`
at the only call site since an earlier removal. Splitting would have tidied
dead code into more files. Deleting it took the file to 469 lines and surfaced
two affordances that had been invisible to users because only the dead branch
rendered them.

**How to apply:** grep every call site of the component and of any
`variant`/mode prop; a prop fixed to a constant at all call sites means the
other branches are dead. Check history for removals that left scaffolding. For
each dead branch, identify affordances it uniquely rendered and re-home them
rather than losing them.
