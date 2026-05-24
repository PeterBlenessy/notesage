---
name: Audits and reviews must be thorough — paper-pass is not a pass
description: When reviewing code or auditing a fix, the bar is whether the request has actually been satisfied. Paper-pass via "tests green + code looks right" is not enough; the review must compare the actual implementation against the actual asks (body + comments + reality).
type: feedback
originSessionId: 74f153e5-da3e-44b1-8a5b-8f88983357c3
aw_applies: yes
aw_applies_to: [aw-review]
---
When the user asks me to review code, audit a fix, or verify that an issue is resolved, I must be thorough — not perform a paper-pass. "Tests green + code matches issue body" is the floor, not the ceiling.

**Why:** I claimed PRs #85 (issue #62) and #86 (issue #38) had fixed their issues. The user then sent eight screenshots showing the running app and demonstrated:
- #86 only touched `src/components/cmd/modes/` (which IS the right scope — chat-footer pickers are state-selectors, not setting-pickers, and don't need the same treatment). But within that scope, the prominence claim was visually flat — `strokeWidth: 1.5 → 2.5` on a 12px icon is barely perceptible. The tests asserted presence/absence of the Check icon but said nothing about the "more prominent" acceptance criterion. Tests were testing the wrong thing and passing.
- #62 implemented criterion 4 verbatim ("project-root row does NOT render rename"). The user had commented THREE times asking for project-root rename to be supported, and `aw-feedback` had explicitly promised to flip criterion 4 — but `aw-refine` re-ran without updating the body. The implementation faithfully matched a stale body. Plus two visual bugs no test would catch: `.claude`/`.notesage` system folders renameable, long names truncated in the rename input.

The user's note: "I think saying 'running the actual app' is not enough cause you cannot fully run the app, and these mistakes MUST be detectable by reviewing the code and by running tests. But if the tests are testing the wrong thing and pass they are useless. So we are back on review. You must remember this!"

**How to apply:**
- **Read comments alongside the body.** When a user comments on an issue, the comments may carry intent the body never picked up — especially after `aw-feedback` resets and `aw-refine` re-runs. Don't trust the body alone; cross-check with the comment thread for any scope changes the user requested.
- **Evaluate what the tests are actually testing, not just whether they pass.** If an acceptance criterion uses qualitative language ("more prominent", "consistent across themes", "sufficient contrast"), call out that the tests do NOT verify it directly and that visual or contrast-audit verification is required separately. Don't accept "tests pass" as evidence the qualitative criterion was met.
- **For "all X" or "across all" claims, grep the codebase.** Universal claims demand universal proof. Enumerate every file/component matching the pattern and confirm each is covered (or call out which were intentionally skipped and why).
- **Identify gaps as gaps, not as "soft" notes.** If something the user asked for wasn't done, that's a failure to ship the request — say so, don't soften it as "worth a 30-second eyeball pass." The user is the bar, not me.
- **When the audit finds real problems, recommend a real plan to close them.** Don't just enumerate — propose concrete remediation that closes the gap between request and reality.
