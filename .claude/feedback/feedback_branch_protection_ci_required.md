---
name: feedback-branch-protection-ci-required
description: main branch has protection rules — CI must pass before any PR can merge; never try to merge without waiting for checks
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 60383eef-539e-476c-81d2-258545915fb7
aw_applies: yes
aw_applies_to: [aw-tdd, aw-iterate]
---

Never attempt to merge a PR directly without CI passing first. The `main` branch has protection rules requiring all CI checks to pass (Frontend Tests, Playwright E2E, Rust Backend, Real Tauri E2E).

**Why:** The repo uses GitHub branch protection. Even docs-only PRs go through the full test suite before merge is allowed.

**How to apply:** After opening a PR, enable `--auto` merge and wait for CI. Don't try `gh pr merge` without `--auto` unless you've already confirmed all checks are green. Don't assume a docs-only change skips CI.
