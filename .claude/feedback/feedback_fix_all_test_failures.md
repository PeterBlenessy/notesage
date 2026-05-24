---
name: feedback-fix-all-test-failures
description: "Never dismiss local test failures as \"pre-existing on main\" — CI uses the same suite and will fail. Fix every failure that surfaces locally, regardless of cause."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 074dd909-6197-4c37-88e9-ba032b9663c6
aw_applies: yes
aw_applies_to: [aw-tdd, aw-ci-repair]
---

# Always fix test failures you see locally

**Rule:** When `pnpm test` (or any local test command) reports failures, fix EVERY failure before declaring work done. Don't categorize failures as "pre-existing", "unrelated", "not caused by this PR" and move on — CI runs the same test suite and will fail the same way, and then it becomes a follow-up PR's problem.

**Why:** CI uses the same `pnpm test` command. There is no "main is allowed one failure" carve-out. A failure on the branch means a failure on CI means a blocked merge. The fact that the failure existed on main before my branch is irrelevant — it's still red, and shipping red CI is not an option.

This is a generalisation of the existing `[[feedback-fix-ci-always]]` rule (never dismiss CI failures as "not our problem"). The local-test version is just as load-bearing — the only difference is when the red signal arrives.

**How to apply:**
- After every `pnpm test`, every failing test gets fixed. No exceptions for "infra", "pre-existing", "unrelated to this change".
- If a failure looks genuinely outside the branch's scope (e.g. test file checks CI workflow YAML that an earlier alpha-cut broke), open a separate fixup commit ON THIS BRANCH to fix it — don't defer to "someone else's PR".
- Don't trust per-project memory entries that claim "X is a known pre-existing failure" without re-checking — those entries went stale the moment someone could have fixed them and didn't.

**Anti-pattern (what I did this session):** I let `src/lib/__tests__/real-e2e-ci.test.ts` fail through 14 commits of Classic-removal work because the prior memory note said it was pre-existing on main. CI would have failed regardless of the Classic-removal commits — I should have fixed it on the first run.

**Escape hatch — bounded retry.** Attempt up to 3 fixes. If after the third attempt the failure count has not strictly decreased, STOP and treat the failure as out-of-scope. Do NOT silently dismiss. Do NOT loosen the assertion, the tolerance, or the timeout to make red turn green — that is "moving the limits to pass tests", an explicit anti-pattern. Instead: post a diagnostic comment naming what you tried, the evidence the issue is environmental / third-party / outside the diff (e.g., "fails on main HEAD too with zero source changes", "correlates with CI runner image bump from X to Y", "web search shows community has reported this"), label the issue `needs-human`, and exit. The `macos-26` pin for issue #334 is the canonical example — a Safari 26.5 WKWebView regression on the `macos-15` runner image caused 9 e2e tests to time out; the right fix was a workflow pin, NOT touching the tests. Bounded retry is what separates "fix it" from "loop on it forever or sabotage it to pass". The latter is worse than the original failure.
