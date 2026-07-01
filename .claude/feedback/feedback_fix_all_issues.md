---
name: fix-all-noticed-issues-regardless-of-origin
description: "Don't dismiss issues as \"pre-existing\" — if the user notices it, it needs fixing"
metadata: 
  node_type: memory
  type: feedback
  aw_applies: "yes"
  aw_applies_to: 
    - aw-tdd
    - aw-review
  originSessionId: 074dd909-6197-4c37-88e9-ba032b9663c6
---

When the user reports a problem, fix it. Don't spend time arguing whether it's from current changes or pre-existing. It doesn't matter — bad UX is bad UX.

**Why:** The user cares about the product quality, not blame attribution. Explaining "this was always broken" feels dismissive and wastes time.

**How to apply:** Acknowledge the issue, add it to the work queue, and fix it. A brief "this isn't from our changes but it's a real issue, let's fix it" is fine — but don't repeat it or use it as a reason to deprioritize.

**Escape hatch — bounded retry.** Attempt up to 3 fixes. If after the third attempt the issue persists with no narrowing of the root cause, STOP. Do NOT silently dismiss. Do NOT paper over by hiding/disabling the affected UI surface to make the symptom disappear. Instead: post a diagnostic comment naming what you tried and the evidence you've gathered, label the issue `needs-human`, and exit. The line is between "fix it" and "loop on it forever or mask it". Masking is worse than the original issue.
