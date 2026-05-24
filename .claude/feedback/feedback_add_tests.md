---
name: Always add unit tests for bug fixes
description: When verifying bug fixes with test cases, add them as proper vitest tests in the project instead of running ad-hoc scripts
type: feedback
aw_applies: yes
aw_applies_to: [aw-tdd]
---

When writing test cases to verify a bug fix, always add them as proper vitest tests in `src/lib/__tests__/` (or the appropriate `__tests__/` directory) rather than only running them as ad-hoc Node scripts. Export the function under test if needed.

**Why:** Ad-hoc test scripts are throwaway — they don't protect against regressions. The user expects verification tests to become part of the test suite.

**How to apply:** After fixing a bug, create a `.test.ts` file with the test cases, run them with `pnpm vitest run <file>`, and include the test file in the commit.
