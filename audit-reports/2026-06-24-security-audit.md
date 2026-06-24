# Repo Security Audit — 2026-06-24

Generated for `PeterBlenessy/notesage` against the checks in
[`scripts/security-audit.sh`](../scripts/security-audit.sh). Checklist +
remediation recipes: [`docs/security-audit-checklist.md`](../docs/security-audit-checklist.md).

> Methodology note: compiled from the GitHub API (branch state) and static
> analysis of `.github/workflows/` + `git log` signing state. Admin-scoped
> checks (secret age, default-token policy, branch-protection sub-config) are
> marked **Not assessed** — re-run authenticated as an admin to fill them in:
> `scripts/security-audit.sh PeterBlenessy/notesage`

**Repositories scanned (1):** `PeterBlenessy/notesage`

| Severity | Count |
| --- | --- |
| 🔴 Critical | 0 |
| 🟠 High | 1 |
| 🟡 Medium | 4 |
| 🔵 Low | 2 |
| ⚪ Info | 0 |
| **Total** | **7** |

## Prioritized findings

### 🟠 High

1. **`aw-ci-repair.yml`: `workflow_run` checks out the triggering head branch AND uses secrets**  
   - _Check:_ `risky-trigger`  
   - _Fix here:_ https://github.com/PeterBlenessy/notesage/blob/HEAD/.github/workflows/aw-ci-repair.yml#L4  
   - _Remediation:_ The job triggers on `workflow_run` of "Tests" (a privileged context with secret access), checks out `${{ github.event.workflow_run.head_branch }}` — an attacker-influenceable `claude/*` branch — with `fetch-depth: 0`, then hands `secrets.WORKFLOW_PAT` + `secrets.CLAUDE_CODE_OAUTH_TOKEN` to `claude-code-action`. Treat the head branch as untrusted: don't run head-branch-derived scripts in the privileged job, keep secrets out of any step that processes head-branch content, and add an explicit minimal `permissions:` block (this workflow has none — see Medium #1). The skill's own hard constraints (≤2 files, no force-push, one-attempt) reduce but don't eliminate the trigger-level exposure.

### 🟡 Medium

1. **`aw-ci-repair.yml`: no `permissions:` block — GITHUB_TOKEN inherits the repo/org default**  
   - _Check:_ `github-token`  
   - _Fix here:_ https://github.com/PeterBlenessy/notesage/blob/HEAD/.github/workflows/aw-ci-repair.yml#L1  
   - _Remediation:_ Add a least-privilege top-level `permissions:` block (e.g. `contents: read`). Doubly important because it runs in the privileged `workflow_run` context (High #1).

2. **`test.yml`: no `permissions:` block — GITHUB_TOKEN inherits the repo/org default**  
   - _Check:_ `github-token`  
   - _Fix here:_ https://github.com/PeterBlenessy/notesage/blob/HEAD/.github/workflows/test.yml#L1  
   - _Remediation:_ Add `permissions: { contents: read }` at the top — this is a pure test job and needs nothing more.

3. **`test-perf-e2e.yml`: no `permissions:` block — GITHUB_TOKEN inherits the repo/org default**  
   - _Check:_ `github-token`  
   - _Fix here:_ https://github.com/PeterBlenessy/notesage/blob/HEAD/.github/workflows/test-perf-e2e.yml#L1  
   - _Remediation:_ Add a `contents: read` top-level `permissions:` block.

4. **`smoke-agent-install.yml`: no `permissions:` block — GITHUB_TOKEN inherits the repo/org default**  
   - _Check:_ `github-token`  
   - _Fix here:_ https://github.com/PeterBlenessy/notesage/blob/HEAD/.github/workflows/smoke-agent-install.yml#L1  
   - _Remediation:_ Add a `contents: read` top-level `permissions:` block.

### 🔵 Low

1. **Secret `WORKFLOW_PAT` looks like a long-lived personal access token**  
   - _Check:_ `long-lived-pat`  
   - _Fix here:_ https://github.com/PeterBlenessy/notesage/settings/secrets/actions  
   - _Remediation:_ `WORKFLOW_PAT` is referenced across ~10 AW workflows (`aw-tdd.yml`, `aw-pipeline.yml`, `aw-merge.yml`, `aw-iterate.yml`, `aw-rebase.yml`, `aw-retrospect.yml`, `aw-ci-repair.yml`, `aw-alpha-cut.yml`, `aw-alpha-prep.yml`, `aw-review.yml`) to trigger downstream workflows that `GITHUB_TOKEN` can't. Replace with a fine-grained **GitHub App installation token** (short-lived, repo-scoped) and set an expiry; confirm rotation age with an admin-token run.

2. **Bot release commits on `main` are unsigned**  
   - _Check:_ `gpg-signing`  
   - _Fix here:_ https://github.com/PeterBlenessy/notesage/commits/main  
   - _Remediation:_ Human commits/merges are signed, but the auto-cut `chore: release …` commits land unsigned. Commit bot releases via a GitHub App (API commits are signed automatically) and enable "Require signed commits" on the `main` ruleset.

## Clean / not-flagged

- **Branch protection** — `main` reports `protected: true`. The detailed sub-config (required reviews/checks, enforce-admins, force-push, required-signatures) needs an admin token and was **not assessed** in this run.
- **Workflows** — the other ~16 AW + release workflows each declare scoped `permissions:` blocks (least privilege), and none pin actions to a moving `@master`/`@main` ref.

## Not assessed (need an admin-scoped token)

- **Branch-protection sub-config** for `main`.
- **Secret rotation age** — any Actions secret older than 180 days (incl. `WORKFLOW_PAT`).
- **Default `GITHUB_TOKEN` policy** — `default_workflow_permissions` (read vs write) and "Actions can approve PRs".

## Notes

- Admin-scoped checks are skipped without admin on the repo — absence of a finding there means *not assessed*, not *passed*.
- `gpg-signing` findings sample the latest commits; a commit shows unverified when its signer's public key isn't on GitHub.
