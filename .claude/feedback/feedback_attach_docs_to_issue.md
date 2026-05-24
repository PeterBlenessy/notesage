---
name: feedback_attach_docs_to_issue
description: "When a GitHub issue references docs files, ensure they are committed to the repo AND posted as collapsible comments on the issue"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9e86da3b-e0ac-45c1-ae5d-6e0dc5cf2da3
aw_applies: yes
aw_applies_to: [aw-refine, aw-slice]
---

When a GitHub issue references docs files (PRDs, task breakdowns), two things must both be true:

1. **The files must be committed to the repo** at the path the issue references — create a `docs/<slug>` branch, commit, and open a PR (or commit to main for docs-only changes after asking). A file that exists only on disk is inaccessible to anyone else reading the issue.

2. **Post the full content as collapsible `<details>` comments on the issue** so readers don't need to check out the branch or wait for a merge to see the spec.

**Why:** The issue is the canonical reference point. Both the permanent path (via the repo) and the inline content (via comments) must be reachable. Inline `<details>` comments alone do NOT fix the problem — agents reading the issue will still try to `cat` the referenced file path and fail if it isn't committed. Always commit first. If the files aren't on main yet, add `hitl` to the issue immediately to block the AW pipeline until the PR lands.

**How to apply — commit first, then comment:**

```bash
# 1. Commit the docs
git checkout -b docs/<slug>
git add docs/prds/<file>.md docs/tasks/<file>.md
git commit -m "docs: add PRD and task breakdown for <feature>"
gh pr create ...

# 2. Post as collapsible comments on the issue
gh issue comment <number> --repo <owner/repo> --body "$(cat <<'COMMENT'
## 📋 PRD

<details>
<summary>Full PRD (docs/prds/YYYY-MM-DD-slug.md)</summary>

$(cat docs/prds/YYYY-MM-DD-slug.md)

</details>
COMMENT
)"
```

Post PRD and task breakdown as separate comments so each is independently collapsible.
