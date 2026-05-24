---
name: Red-team TDD for security refactors
description: Drive security/isolation work from failing attack tests — write the attack, confirm it succeeds (leak is real), flip the assertion, land the fix, keep the test as a regression lock
type: feedback
originSessionId: b15f47f2-e328-49ce-8c07-319397f56739
aw_applies: yes
aw_applies_to: [aw-tdd]
---
When doing a security refactor (isolation, sandboxing, permission scoping, credential handling, any "must never happen" invariant), drive the work from **attack tests**, not from feature tests.

**The loop:**

1. **Red (attack).** Write a test that performs the leak's repro steps and asserts the *current insecure behavior* — the attack succeeds today. Test passes. This proves the leak is real and reproducible.
2. **Flip.** Change the assertion to require the attack *must fail*. Test now fails.
3. **Green (fix).** Implement the scope narrowing / enforcement. Test passes.
4. **Regression lock.** Test stays in the suite forever. Any future change that re-opens the leak trips it.

**Two rules this enforces:**

- **Negative tests, not just positive.** "X cannot happen when out of scope" is the invariant. "X works when in scope" is a useful companion, never a substitute.
- **Real enforcement, not mocks, wherever practical.** Kernel-level tests for OS sandbox claims (Seatbelt on macOS — real agent subprocess, observe real denial output). Real filter/permission code for application-level claims. Mock-level tests are acceptable ONLY for wire-shape assertions ("Rust received these paths"), never for "the OS enforces this."

**Why:** Green unit tests against positive-case mocks routinely mask catastrophic security leaks. The v1/v2 project-isolation audit on 2026-04-18 found 22 leaks in code that had passing tests. Every Critical leak had test coverage — just not for the attack path. Attack-test TDD makes the test suite itself the proof of closure: if the red-team test is green, the leak is closed by construction.

**How to apply:**

- When an audit surfaces a leak, the corresponding task is "write attack test → flip → fix" as a single unit. Not "write fix" + "add test later."
- "Done" means every Critical/High leak in the audit has a landed attack test whose git blame shows it was the driver (written before or alongside the fix commit).
- For new security-sensitive code (new sandbox profiles, new permission types, new credential flows), write the attack test first for the invariant you're trying to preserve.
- Don't feature-flag the main security change — use opt-in escape hatches only for backward-compat ("cross-project mode" for users who explicitly want legacy behavior), not as a rollout mechanism.

**Companion pattern — cold-read re-audit.** After a security refactor completes, re-run the original audit's investigation against the now-fixed code as a separate dated document. Not a diff — a fresh investigation. If every documented leak fails to reproduce and no new ones surface, you have evidence for the security claim. This is the solo-engineer substitute for a second-engineer red-team pass.

**Origin:** Articulated during the 2026-04-18 project-isolation PRD planning session with Peter, after he asked "how do we make sure we don't miss anything?" on a commercial-critical data-separation refactor. He recognized the parallel to TDD immediately; captured the refinement here so future security work defaults to this discipline.
