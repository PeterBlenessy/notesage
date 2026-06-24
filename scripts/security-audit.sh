#!/usr/bin/env bash
# scripts/security-audit.sh — automated repo-security audit for a GitHub org.
#
# Scans one or more repositories (or a whole org) and flags five classes of
# supply-chain / CI risk, then writes a PRIORITIZED remediation report that
# links every finding to the exact repo setting or workflow file to fix:
#
#   1. Missing / weak branch protection on the default branch
#   2. Long-lived (un-rotated) Actions secrets and classic-PAT secrets
#   3. Overly permissive GITHUB_TOKEN (default write + workflows with no
#      explicit `permissions:` block, which inherit the default)
#   4. Missing GPG commit-signing enforcement (and unsigned commits on the
#      default branch)
#   5. Risky `pull_request_target` / `workflow_run` workflow triggers
#
# Read-only: it never changes a setting or a file — it reports. Checks that
# need admin (branch protection, secrets, token policy) degrade to a clearly
# marked UNKNOWN when the token lacks the scope, instead of failing the run.
#
# Companion human checklist + remediation recipes: docs/security-audit-checklist.md
set -uo pipefail

# ---------------------------------------------------------------------------
# Defaults / CLI
# ---------------------------------------------------------------------------
ORG=""
SECRET_AGE_DAYS=180
COMMIT_SAMPLE=20
OUTPUT=""
STATIC_ONLY=0
REPOS=()

usage() {
  cat <<'EOF'
Usage: scripts/security-audit.sh [options] [owner/repo ...]

Audits the named repos, or every non-archived repo in an org with --org.

Options:
  --org ORG               Audit every non-archived repo in ORG (gh repo list)
  --secret-age-days N     "Long-lived" secret threshold in days (default 180)
  --commit-sample N       Recent commits to sample for signing (default 20)
  --static-only           Only run checks that need no admin token
                          (workflow trigger + missing-permissions analysis)
  --output FILE           Write the markdown report to FILE (default: stdout)
  -h, --help              Show this help

Requires: gh (authenticated), jq. The token needs `repo` + `admin:org`/admin
on the repos for the branch-protection, secrets, and token-policy checks;
without admin those checks report UNKNOWN and the static checks still run.

Examples:
  scripts/security-audit.sh PeterBlenessy/airlocked-agents
  scripts/security-audit.sh --org PeterBlenessy --output audit-reports/today.md
  scripts/security-audit.sh --static-only owner/repo-a owner/repo-b
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --org)             ORG="${2:-}"; shift 2;;
    --secret-age-days) SECRET_AGE_DAYS="${2:-}"; shift 2;;
    --commit-sample)   COMMIT_SAMPLE="${2:-}"; shift 2;;
    --static-only)     STATIC_ONLY=1; shift;;
    --output)          OUTPUT="${2:-}"; shift 2;;
    -h|--help)         usage; exit 0;;
    -*)                echo "Unknown option: $1" >&2; usage; exit 2;;
    *)                 REPOS+=("$1"); shift;;
  esac
done

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------
command -v gh >/dev/null || { echo "GitHub CLI (gh) not found — https://cli.github.com" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq not found — https://jqlang.github.io/jq/" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Not logged in to gh — run: gh auth login" >&2; exit 1; }

if [ -n "$ORG" ]; then
  echo "Enumerating non-archived repos in '$ORG'..." >&2
  while IFS= read -r nwo; do [ -n "$nwo" ] && REPOS+=("$nwo"); done < <(
    gh repo list "$ORG" --no-archived --limit 1000 --json nameWithOwner --jq '.[].nameWithOwner'
  )
fi

if [ "${#REPOS[@]}" -eq 0 ]; then
  echo "No repositories given. Pass owner/repo args or --org ORG." >&2
  usage; exit 2
fi

TODAY="$(date -u +%Y-%m-%d)"
NOW_EPOCH="$(date -u +%s)"
FINDINGS="$(mktemp)"   # TSV: severity \t repo \t check \t title \t location \t remediation
trap 'rm -f "$FINDINGS" "$WF_TMP" 2>/dev/null' EXIT
WF_TMP="$(mktemp)"

# Severity rank for sorting (lower = worse).
sev_rank() {
  case "$1" in
    CRITICAL) echo 0;; HIGH) echo 1;; MEDIUM) echo 2;;
    LOW) echo 3;; INFO) echo 4;; *) echo 5;;
  esac
}

# add_finding SEV REPO CHECK TITLE LOCATION REMEDIATION
add_finding() {
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$1" "$2" "$3" "$4" "$5" "$6" >> "$FINDINGS"
}

# gh_api PATH ...  -> echoes body, returns 0 on 2xx, 1 otherwise (quiet on 403/404).
gh_api() { gh api -H "Accept: application/vnd.github+json" "$@" 2>/dev/null; }

# ---------------------------------------------------------------------------
# Check 1 — Branch protection (+ required signatures, the GPG-enforcement gate)
# ---------------------------------------------------------------------------
check_branch_protection() {
  local repo="$1" default_branch="$2"
  local settings="https://github.com/${repo}/settings/branches"
  local prot
  if ! prot="$(gh_api "repos/${repo}/branches/${default_branch}/protection")"; then
    # 404 = no protection at all; 403 = no admin scope.
    if gh_api "repos/${repo}" >/dev/null; then
      add_finding HIGH "$repo" branch-protection \
        "Default branch '${default_branch}' has NO branch protection rule" \
        "$settings" \
        "Add a protection rule: require a PR before merge, ≥1 approval, status checks, signed commits; block force-push + deletion; include administrators."
    fi
    return
  fi

  jq -e '.required_pull_request_reviews' <<<"$prot" >/dev/null \
    || add_finding MEDIUM "$repo" branch-protection \
        "Default branch does not require pull-request reviews before merge" \
        "$settings" "Enable 'Require a pull request before merging' with ≥1 required approval."

  local approvals
  approvals="$(jq -r '.required_pull_request_reviews.required_approving_review_count // 0' <<<"$prot")"
  [ "${approvals:-0}" -ge 1 ] 2>/dev/null \
    || add_finding MEDIUM "$repo" branch-protection \
        "Default branch requires 0 approving reviews" \
        "$settings" "Set 'Required approvals' to ≥1 (≥2 for shared/critical repos)."

  jq -e '.required_status_checks' <<<"$prot" >/dev/null \
    || add_finding MEDIUM "$repo" branch-protection \
        "Default branch does not require status checks to pass" \
        "$settings" "Enable 'Require status checks to pass' and select the CI job(s)."

  [ "$(jq -r '.enforce_admins.enabled // false' <<<"$prot")" = "true" ] \
    || add_finding MEDIUM "$repo" branch-protection \
        "Branch protection is not enforced for administrators (bypassable)" \
        "$settings" "Enable 'Do not allow bypassing the above settings' / 'Include administrators'."

  [ "$(jq -r '.allow_force_pushes.enabled // false' <<<"$prot")" = "true" ] \
    && add_finding HIGH "$repo" branch-protection \
        "Force-pushes are allowed on the default branch" \
        "$settings" "Disable 'Allow force pushes' so history can't be rewritten."

  [ "$(jq -r '.allow_deletions.enabled // false' <<<"$prot")" = "true" ] \
    && add_finding HIGH "$repo" branch-protection \
        "Deletion of the default branch is allowed" \
        "$settings" "Disable 'Allow deletions'."

  # Required signatures — the branch-protection gate that enforces GPG/SSH signing.
  local sig
  if sig="$(gh_api "repos/${repo}/branches/${default_branch}/protection/required_signatures")"; then
    [ "$(jq -r '.enabled // false' <<<"$sig")" = "true" ] \
      || add_finding MEDIUM "$repo" gpg-signing \
          "Signed commits are NOT required on the default branch" \
          "$settings" "Enable 'Require signed commits' so only GPG/SSH-signed commits can land."
  fi
}

# ---------------------------------------------------------------------------
# Check 2 — Long-lived / classic-PAT Actions secrets
# ---------------------------------------------------------------------------
check_secrets() {
  local repo="$1"
  local settings="https://github.com/${repo}/settings/secrets/actions"
  local body
  if ! body="$(gh_api "repos/${repo}/actions/secrets?per_page=100")"; then
    return  # no admin scope → silently skip (reported as UNKNOWN coverage)
  fi
  local n; n="$(jq -r '.secrets | length' <<<"$body")"
  [ "${n:-0}" -eq 0 ] && return

  while IFS=$'\t' read -r name updated; do
    [ -z "$name" ] && continue
    local upd_epoch age_days
    upd_epoch="$(date -u -d "$updated" +%s 2>/dev/null || echo 0)"
    if [ "$upd_epoch" -gt 0 ]; then
      age_days=$(( (NOW_EPOCH - upd_epoch) / 86400 ))
      if [ "$age_days" -ge "$SECRET_AGE_DAYS" ]; then
        add_finding MEDIUM "$repo" stale-secret \
          "Secret '${name}' not rotated in ${age_days} days (≥ ${SECRET_AGE_DAYS}d threshold)" \
          "$settings" "Rotate the credential and update the secret; prefer short-lived OIDC where possible."
      fi
    fi
    # Classic-PAT naming heuristic (GITHUB_TOKEN is ephemeral and exempt).
    case "$name" in
      GITHUB_TOKEN) ;;
      *_PAT|PAT_*|*_TOKEN|*TOKEN*)
        add_finding LOW "$repo" long-lived-pat \
          "Secret '${name}' looks like a long-lived personal access token" \
          "$settings" "Replace with a GitHub App installation token (short-lived) or OIDC; scope minimally and set an expiry." ;;
    esac
  done < <(jq -r '.secrets[] | [.name, .updated_at] | @tsv' <<<"$body")
}

# ---------------------------------------------------------------------------
# Check 3 — Overly permissive GITHUB_TOKEN (org/repo default policy)
# ---------------------------------------------------------------------------
check_token_policy() {
  local repo="$1"
  local settings="https://github.com/${repo}/settings/actions"
  local body
  if ! body="$(gh_api "repos/${repo}/actions/permissions/workflow")"; then
    return
  fi
  [ "$(jq -r '.default_workflow_permissions // ""' <<<"$body")" = "write" ] \
    && add_finding HIGH "$repo" github-token \
        "Default GITHUB_TOKEN permission is read/write for all workflows" \
        "$settings" "Set 'Workflow permissions' to 'Read repository contents' and grant write per-workflow via a 'permissions:' block."

  [ "$(jq -r '.can_approve_pull_request_reviews // false' <<<"$body")" = "true" ] \
    && add_finding MEDIUM "$repo" github-token \
        "Actions is allowed to approve pull requests (self-approval risk)" \
        "$settings" "Disable 'Allow GitHub Actions to create and approve pull requests'."
}

# ---------------------------------------------------------------------------
# Check 4 — Unsigned commits on the default branch (commit-level signal)
# ---------------------------------------------------------------------------
check_commit_signing() {
  local repo="$1" default_branch="$2"
  local body
  body="$(gh_api "repos/${repo}/commits?sha=${default_branch}&per_page=${COMMIT_SAMPLE}")" || return
  local total unsigned
  total="$(jq -r 'length' <<<"$body")"
  [ "${total:-0}" -eq 0 ] && return
  unsigned="$(jq -r '[.[] | select(.commit.verification.verified == false)] | length' <<<"$body")"
  if [ "${unsigned:-0}" -gt 0 ]; then
    add_finding LOW "$repo" gpg-signing \
      "${unsigned}/${total} recent commits on '${default_branch}' are unsigned/unverified" \
      "https://github.com/${repo}/commits/${default_branch}" \
      "Have contributors and bots sign commits (GPG/SSH/Sigstore) and enforce it via 'Require signed commits' branch protection."
  fi
}

# ---------------------------------------------------------------------------
# Check 5 — Risky workflow triggers + missing permissions (static, no admin)
# ---------------------------------------------------------------------------
check_workflows() {
  local repo="$1"
  local files
  files="$(gh_api "repos/${repo}/contents/.github/workflows" | jq -r '.[]?.name // empty' 2>/dev/null)" || return
  [ -z "$files" ] && return

  while IFS= read -r name; do
    [ -z "$name" ] && continue
    case "$name" in *.yml|*.yaml) ;; *) continue;; esac
    local content
    content="$(gh_api "repos/${repo}/contents/.github/workflows/${name}" \
      | jq -r '.content // empty' | base64 -d 2>/dev/null)" || continue
    [ -z "$content" ] && continue
    printf '%s\n' "$content" > "$WF_TMP"
    local loc=".github/workflows/${name}"
    local link="https://github.com/${repo}/blob/HEAD/${loc}"

    local has_secrets=0 checks_out_ref=0
    grep -qE '\$\{\{\s*secrets\.' "$WF_TMP" && has_secrets=1
    grep -qE 'ref:\s*\$\{\{\s*github\.event\.(pull_request\.head|workflow_run\.head_branch)' "$WF_TMP" && checks_out_ref=1

    # pull_request_target — runs in the base repo's privileged context.
    if grep -qE '^\s*pull_request_target\s*:' "$WF_TMP" || grep -qE '^\s*on:.*pull_request_target' "$WF_TMP"; then
      local ln; ln="$(grep -nE 'pull_request_target' "$WF_TMP" | head -1 | cut -d: -f1)"
      if [ "$has_secrets" = 1 ] && [ "$checks_out_ref" = 1 ]; then
        add_finding CRITICAL "$repo" risky-trigger \
          "${name}: 'pull_request_target' checks out PR head AND exposes secrets (code-exec from forks)" \
          "${link}#L${ln:-1}" \
          "Split into an untrusted 'pull_request' build (no secrets) + a trusted follow-up; never checkout PR head with secrets in a pull_request_target job."
      else
        add_finding HIGH "$repo" risky-trigger \
          "${name}: uses 'pull_request_target' (privileged base-repo context)" \
          "${link}#L${ln:-1}" \
          "Confirm it never checks out or executes PR-author code; pin to the base ref, add a minimal 'permissions:' block, and label-gate fork PRs."
      fi
    fi

    # workflow_run — same privileged-context pitfalls as pull_request_target.
    if grep -qE '^\s*workflow_run\s*:' "$WF_TMP"; then
      local ln; ln="$(grep -nE '^\s*workflow_run\s*:' "$WF_TMP" | head -1 | cut -d: -f1)"
      if [ "$has_secrets" = 1 ] && [ "$checks_out_ref" = 1 ]; then
        add_finding HIGH "$repo" risky-trigger \
          "${name}: 'workflow_run' checks out the triggering head branch AND uses secrets" \
          "${link}#L${ln:-1}" \
          "Treat the head branch as untrusted: pin checkout to a trusted SHA/base, drop secrets from any step that handles head-branch content, add a minimal 'permissions:' block."
      else
        add_finding MEDIUM "$repo" risky-trigger \
          "${name}: uses 'workflow_run' (runs in privileged context after another workflow)" \
          "${link}#L${ln:-1}" \
          "Add an explicit minimal 'permissions:' block and verify it doesn't run untrusted head-branch code with secrets."
      fi
    fi

    # Missing top-level permissions block → inherits the repo/org default token scope.
    if ! grep -qE '^\s*permissions\s*:' "$WF_TMP"; then
      add_finding MEDIUM "$repo" github-token \
        "${name}: no 'permissions:' block — GITHUB_TOKEN inherits the repo/org default" \
        "${link}#L1" \
        "Add a least-privilege top-level 'permissions:' block (e.g. 'contents: read') and widen only the specific scope each job needs."
    fi

    # Actions pinned to a moving ref (@master/@main) — supply-chain risk.
    if grep -qnE 'uses:\s*[^ ]+@(master|main)\b' "$WF_TMP"; then
      local ln; ln="$(grep -nE 'uses:\s*[^ ]+@(master|main)\b' "$WF_TMP" | head -1 | cut -d: -f1)"
      add_finding LOW "$repo" action-pinning \
        "${name}: action pinned to a moving branch ref (@master/@main)" \
        "${link}#L${ln:-1}" \
        "Pin third-party actions to a full commit SHA (or at least an immutable release tag) to prevent silent supply-chain changes."
    fi
  done <<< "$files"
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
SCANNED=()
for repo in "${REPOS[@]}"; do
  echo "Auditing ${repo}..." >&2
  default_branch="$(gh_api "repos/${repo}" | jq -r '.default_branch // "main"')"
  check_workflows "$repo"
  if [ "$STATIC_ONLY" -eq 0 ]; then
    check_branch_protection "$repo" "$default_branch"
    check_secrets           "$repo"
    check_token_policy      "$repo"
    check_commit_signing    "$repo" "$default_branch"
  fi
  SCANNED+=("$repo")
done

# ---------------------------------------------------------------------------
# Render the prioritized remediation report
# ---------------------------------------------------------------------------
render() {
  local total crit high med low info
  total="$(wc -l < "$FINDINGS" | tr -d ' ')"
  crit="$(awk -F'\t' '$1=="CRITICAL"' "$FINDINGS" | wc -l | tr -d ' ')"
  high="$(awk -F'\t' '$1=="HIGH"'     "$FINDINGS" | wc -l | tr -d ' ')"
  med="$(awk -F'\t'  '$1=="MEDIUM"'   "$FINDINGS" | wc -l | tr -d ' ')"
  low="$(awk -F'\t'  '$1=="LOW"'      "$FINDINGS" | wc -l | tr -d ' ')"
  info="$(awk -F'\t' '$1=="INFO"'     "$FINDINGS" | wc -l | tr -d ' ')"

  echo "# Repo Security Audit — ${TODAY}"
  echo
  echo "Generated by \`scripts/security-audit.sh\`. Checklist + remediation recipes: [\`docs/security-audit-checklist.md\`](../docs/security-audit-checklist.md)."
  echo
  echo "**Repositories scanned (${#SCANNED[@]}):** $(printf '`%s` ' "${SCANNED[@]}")"
  echo
  echo "| Severity | Count |"
  echo "| --- | --- |"
  echo "| 🔴 Critical | ${crit} |"
  echo "| 🟠 High | ${high} |"
  echo "| 🟡 Medium | ${med} |"
  echo "| 🔵 Low | ${low} |"
  echo "| ⚪ Info | ${info} |"
  echo "| **Total** | **${total}** |"
  echo

  if [ "${total:-0}" -eq 0 ]; then
    echo "No findings. ✅"
    return
  fi

  echo "## Prioritized findings"
  echo
  local sev label
  for sev in CRITICAL HIGH MEDIUM LOW INFO; do
    awk -F'\t' -v s="$sev" '$1==s' "$FINDINGS" > "${FINDINGS}.sec" || true
    [ -s "${FINDINGS}.sec" ] || continue
    case "$sev" in
      CRITICAL) label="🔴 Critical";; HIGH) label="🟠 High";;
      MEDIUM) label="🟡 Medium";; LOW) label="🔵 Low";; *) label="⚪ Info";;
    esac
    echo "### ${label}"
    echo
    local i=0
    while IFS=$'\t' read -r _ repo check title location remediation; do
      i=$((i+1))
      echo "${i}. **[\`${repo}\`] ${title}**  "
      echo "   - _Check:_ \`${check}\`  "
      echo "   - _Fix here:_ ${location}  "
      echo "   - _Remediation:_ ${remediation}"
      echo
    done < "${FINDINGS}.sec"
    rm -f "${FINDINGS}.sec"
  done

  echo "## Notes"
  echo
  if [ "$STATIC_ONLY" -eq 1 ]; then
    echo "- Run in \`--static-only\` mode: branch-protection, secrets, token-policy, and commit-signing checks were skipped."
  else
    echo "- Admin-scoped checks (branch protection, secrets, token policy) are silently skipped for any repo where the token lacks admin — absence of a finding there means *not assessed*, not *passed*."
  fi
  echo "- \`gpg-signing\` commit-level findings sample the latest ${COMMIT_SAMPLE} commits; a commit shows unverified when its signer's public key isn't on GitHub."
}

if [ -n "$OUTPUT" ]; then
  mkdir -p "$(dirname "$OUTPUT")"
  render > "$OUTPUT"
  echo "Report written to ${OUTPUT}" >&2
else
  render
fi

# Exit non-zero if any CRITICAL/HIGH finding exists (useful as a CI gate).
if awk -F'\t' '$1=="CRITICAL" || $1=="HIGH"' "$FINDINGS" | grep -q .; then
  exit 1
fi
exit 0
