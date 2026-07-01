---
name: always-fix-ci-failures
description: "Fix any CI failures encountered, whether pre-existing or new — never dismiss them as \"not our problem\""
metadata: 
  node_type: memory
  type: feedback
  aw_applies: "yes"
  aw_applies_to: 
    - aw-ci-repair
    - aw-iterate
  originSessionId: 074dd909-6197-4c37-88e9-ba032b9663c6
---

Always fix CI failures when we see them, regardless of whether they're pre-existing or caused by our changes. Don't dismiss failures as "pre-existing" — if CI is red, fix it before moving on.

**Why:** Broken CI blocks releases and erodes trust in the pipeline. Every conversation should leave CI greener than it found it.

**How to apply:** After any push, monitor the workflow. If it fails, investigate and fix immediately — don't just report the failure and wait.

**Escape hatch — bounded retry.** Attempt up to 3 fixes. If after the third attempt CI is still red and the failure pattern hasn't narrowed, STOP and treat the failure as environmental. Do NOT silently dismiss. Do NOT bypass branch protection. Do NOT push `--no-verify` to mask hook failures. Instead: investigate whether the failure is in our test suite, the third-party stack, or the CI runner itself (image bumps, network flake, upstream outage). Post a diagnostic comment with the evidence, file a tracking issue if the cause is platform/environmental, propose a workaround at the workflow level (runner pin, retry layer, allow-failures), and label `needs-human` if you can't ship the workaround yourself. The `macos-26` pin from PR #333 is the canonical example — Safari 26.5 broke our WKWebView tests; the fix was a `runs-on:` pin, NOT touching the failing tests.
