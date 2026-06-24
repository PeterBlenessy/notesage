# Repo Security Audit Checklist

A repeatable checklist for auditing the GitHub repositories in this org against
five classes of supply-chain / CI risk, plus the remediation recipe for each.

The checklist is **automated** by [`scripts/security-audit.sh`](../scripts/security-audit.sh),
which scans one or more repos (or a whole org) and writes a prioritized
remediation report that links every finding to the exact setting or workflow
file to fix. This document is the human reference behind that tool: what each
check means, why it matters, and how to fix a finding by hand.

```bash
# One repo
scripts/security-audit.sh PeterBlenessy/airlocked-agents

# Whole org, write a dated report
scripts/security-audit.sh --org PeterBlenessy --output audit-reports/$(date -u +%F)-org.md

# CI-safe subset (no admin token needed) — workflow trigger + token-scope analysis
scripts/security-audit.sh --static-only PeterBlenessy/airlocked-agents
```

This script is shipped in every repo in the org so each repo can audit itself
(and the `security-audit` CI workflow runs the admin-free static checks on every
PR). In `airlocked-agents` it's also wrapped as `make audit REPOS="…"` /
`make audit ORG=…`.

The script is **read-only**. It reports; it never flips a setting or edits a
file. It exits non-zero if any Critical/High finding exists, so it can gate CI.

---

## What gets checked

### 1. Branch protection on the default branch · `branch-protection`

The default branch should not be directly pushable, rewindable, or deletable.

- [ ] A protection rule exists on the default branch
- [ ] Require a pull request before merging, with **≥1** approving review
- [ ] Require status checks to pass before merging
- [ ] Enforce the rules for administrators (no bypass)
- [ ] Block force-pushes
- [ ] Block branch deletion
- [ ] Require signed commits (see check 4)

**Why:** without protection, anyone with write can push straight to `main`,
force-push over history, or delete the branch — and unreviewed code ships.

**Fix:** `Settings ▸ Branches ▸ Add branch ruleset` (or classic protection rule)
for the default branch. API: `PUT /repos/{owner}/{repo}/branches/{branch}/protection`.

### 2. Long-lived workflow secrets · `stale-secret` / `long-lived-pat`

Actions secrets that never rotate, and classic Personal Access Tokens stored as
secrets, are a standing liability — one leak is valid indefinitely.

- [ ] No Actions secret older than the rotation threshold (default **180 days**)
- [ ] No classic-PAT secrets (`*_PAT`, `*_TOKEN`) where a short-lived token would do

**Why:** a leaked long-lived PAT grants its full scope until someone notices and
revokes it. Short-lived tokens shrink the blast radius to minutes.

**Fix:** rotate the credential and update the secret in
`Settings ▸ Secrets and variables ▸ Actions`. Prefer a **GitHub App installation
token** or **OIDC** (`id-token: write` + a cloud trust policy) over a stored PAT.
For cross-workflow triggering (the usual reason a `WORKFLOW_PAT` exists), a
fine-grained App token scoped to this repo is the safer replacement.

### 3. Overly permissive `GITHUB_TOKEN` · `github-token`

- [ ] Repo/org default workflow permission is **read**, not read/write
- [ ] "Allow GitHub Actions to create and approve pull requests" is **off**
- [ ] Every workflow declares a least-privilege top-level `permissions:` block

**Why:** a workflow with no `permissions:` block inherits the repo/org default.
If that default is read/write, a compromised step (malicious dependency, action,
or injected input) gets a write-scoped token for free. An explicit
`permissions:` block caps the token regardless of the org default.

**Fix:** `Settings ▸ Actions ▸ General ▸ Workflow permissions` → "Read
repository contents and packages permissions". Then in each workflow:

```yaml
permissions:
  contents: read        # least privilege at the top
jobs:
  publish:
    permissions:
      contents: write    # widen only where actually needed
```

### 4. GPG / signed-commit enforcement · `gpg-signing`

- [ ] "Require signed commits" is enabled on the default branch
- [ ] Recent commits on the default branch are signed/verified (incl. bot commits)

**Why:** signed commits prove authorship and stop an attacker from forging
commits as a trusted contributor. Bots count: CI that commits (release cuts,
auto-fixes) should sign too, or they punch a hole in the policy.

**Fix:** enable `Require signed commits` in the branch ruleset. Contributors sign
with GPG/SSH (`git config commit.gpgsign true`). For bots, sign via a GitHub App
(commits made through the API are signed automatically) or import a signing key.

### 5. Risky `pull_request_target` / `workflow_run` triggers · `risky-trigger`

- [ ] No `pull_request_target` job checks out PR-author code **and** has secrets
- [ ] No `workflow_run` job checks out the triggering head branch **and** has secrets
- [ ] Such workflows declare a minimal `permissions:` block

**Why:** both triggers run in the **base repo's privileged context** with access
to secrets and a write-capable token. If the job then checks out and executes
code from a fork PR (or an attacker-influenced head branch), that's arbitrary
code execution with your secrets — the classic "pwn request."

**Fix:** keep the untrusted build on the plain `pull_request` trigger (no
secrets). If you must use `pull_request_target`/`workflow_run`, pin the checkout
to a trusted ref (base SHA), never run author-provided scripts in the privileged
job, drop secrets from any step touching head-branch content, label-gate fork
PRs, and add a minimal `permissions:` block.

### Bonus · `action-pinning`

- [ ] Third-party actions are pinned to a commit SHA (or at least an immutable
      release tag), never a moving `@master`/`@main`

**Why:** `uses: some/action@master` re-runs whatever is on that branch today — a
silent supply-chain entry point. Pin to a SHA so the code can't change under you.

---

## Severity model

| Severity | Meaning |
| --- | --- |
| 🔴 Critical | Directly exploitable for code-exec-with-secrets (e.g. `pull_request_target` checking out fork code with secrets) |
| 🟠 High | Strong exposure: unprotected default branch, default write token, `workflow_run` running head-branch code with secrets |
| 🟡 Medium | Missing guardrail that should exist: no required reviews/checks, no per-workflow `permissions:`, stale secret |
| 🔵 Low | Hygiene: unsigned commits, moving action refs, long-lived-PAT naming |

## Coverage honesty

Checks 1–4 need an admin-scoped token. When the token lacks admin on a repo,
the script **silently skips** those checks for it — a clean report there means
*not assessed*, not *passed*. The static checks (trigger + missing-permissions +
pinning analysis) need only read access and always run, which is why
`--static-only` is the right mode for untrusted CI.
