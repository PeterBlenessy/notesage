---
name: Release notes must match shipped state
description: Every release (including patches) needs a docs/history/release-vX.Y.Z.md reconciled to what actually shipped. Drafted-too-early notes ship false statements to users via the in-app changelog dialog.
type: feedback
originSessionId: 0199f13c-9269-40e1-ae22-927b740ae013
aw_applies: no
---
The draft `docs/history/<NNN>-release-vX.Y.Z.md` exists per release, but features evolve during live-testing. Reconcile the draft to the actually-shipped state BEFORE tagging — otherwise `public/changelog.json` (built from those files) and the same-name GitHub Release asset embed stale claims, and `useChangelog.ts` shows them in the in-app dialog.

**Patches need their own file** — a `release-vX.Y.Z.md` per tag, not just X.Y.0. The changelog generator parses by filename, so a missing v0.39.1 file means no v0.39.1 entry in the dialog.

**Why:** v0.39.0 shipped a release-notes draft from early Phase 1 design (`doc-head breadcrumb`, `Tab bar replaced by a compact breadcrumb above the document`, word count duplicated in status tray) — claims rolled back during live-test feedback rounds but never updated in the history file. v0.39.1 had no history file at all, so the in-app dialog showed nothing for the security patch users had just installed. User had to flag both.

**How to apply:**
- Before pushing a release tag: re-read `docs/history/<release>.md` and confirm every claim matches the merged tip-of-main, not the PRD or early design copy.
- Patch releases get their own concise `release-vX.Y.Z.md` file. Security patches especially — users want to know what they got.
- When asked to remove false statements, just remove them. Don't add a new story (the user explicitly said: "you are too detailed... do not add a whole new story").
