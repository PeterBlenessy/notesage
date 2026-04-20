# Release v0.38.1

**Date:** 2026-04-20
**Previous version:** 0.38.0

Completion of the project-data-isolation PRD that shipped partially in
v0.38.0. All remaining Track 3 correctness tasks plus the red-team
verification pass and a full documentation sweep. No breaking changes.

## Changes

### Features (Track 3 completion from PRD)

- **Scope-aware active-tab auto-attach (#23)** — `useChatContext`
  and the "Currently editing" fallback in `useAIContext` now gate on
  `isUriInScope` (reused from #16). Out-of-scope tabs show an
  explicit-attach chip ("Add {filename} to chat") next to the input
  so users can opt in. 13 new tests.

- **Segment boundary as stable message id (#28)** —
  `ConversationSegment.startMessageId` (stable id) replaces
  `startMessageIndex` (numeric position). New `sliceThreadBySegment`
  helper walks the active-leaf thread and finds the LCA when the
  boundary is in a sibling subtree — branches now get the correct
  context-isolation slice. Zustand persist migration v4 → v5. 12 new
  tests including a red-team branching attack.

- **File-tree system-prompt injection scope (#27)** — the injected
  workspace file tree now filters by `selectedProjectPaths` + notes
  root. Caps: 200 files, 4 directory levels (exported constants).
  Closes the per-chat filename enumeration leak from unselected
  projects.

- **Clean ACP turn cancellation on workspace respawn (#29)** — the
  workspace-change effect now cancels in-flight turns
  (`acp_session_cancel`), denies pending permission requests, and
  fires a context-reset toast before calling `stopAcpAgent`. No more
  stale permission prompts tied to dead agents.

- **Attachment path activity log (#30)** — `attachedFilePaths` are
  now logged as `kind: 'attachment'` activities on the user message
  at send time and render as a `AttachmentFileStrip` above the
  user-typed text with a Paperclip icon. Full path on hover. Image
  byte attachments remain as thumbnails (unchanged).

### Documentation

- **Red-team pass (#32)** — `docs/audits/2026-04-20-red-team.md`
  walks every leak from the 2026-04-18 audit (24 total), traces each
  fix commit, locates the regression-lock test, and marks the result.
  Verdict: no Critical or High finding remains reproducible. Also
  documents three regressions found DURING verification (R1 basename
  bug, R2 Claude keychain, R3 user-message connectionId) — proof the
  red-team TDD discipline catches real issues.

- **Feature + architecture docs (#33)** — `workspace.md` now
  documents `aiLock`, the full chat-project isolation surface, and
  cross-project mode. `ai-workflows.md` covers resend/edit dialog,
  scoped approvals, activity badges, segment boundary by message id,
  and attachment logging. `ai-providers.md` has a new "Filesystem &
  Network Sandboxing" section documenting the `$HOME`-deny +
  Bucket B/C allow-list model, plus a new "Re-authentication"
  section. `architecture.md` gains a Project Isolation Enforcement
  Points table. PRD status flipped to "Shipped in v0.38.0" with every
  quality gate ticked. Task file status flipped to "✅ Complete".

## Files Changed

27 files changed, 1,984 insertions, 91 deletions across 7 commits.

## Quality Gates

| Gate | Status |
| --- | --- |
| Unit tests | 3106 / 3106 pass |
| TypeScript typecheck | clean |
| Performance benchmarks (24 cases) | within budget |
| Rust sandbox tests (28) | pass |
| Red-team attack tests | present + green for every Critical / High leak |
| Red-team walkthrough | complete — no Critical / High reproducible |

## No Breaking Changes

All isolation gates remain opt-out via settings:
- `crossProjectMode` — expose all workspace folders to the agent
- `completionsOnOutOfScope` — restore legacy inline-completion behavior
- `requireAllToolConfirmations` — disable auto-allow globally

Default behavior is now more restrictive than v0.37.0 by design;
escape hatches exist for every new gate.
