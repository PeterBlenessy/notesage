---
name: Promote alpha = tag from the alpha commit, not main HEAD
description: When user says "promote the latest alpha to stable", tag from the alpha's commit (or cherry-pick only the version bump on top of it), never from main HEAD. Main HEAD may contain post-alpha code that has not been live-tested.
type: feedback
originSessionId: e0a9c6e6-c7bb-4748-a54a-f7fbc33596a2
aw_applies: no
---
When the user says **"promote the latest alpha to stable"**, the release must be built from the same source the alpha tag points at — the binary the user has been live-testing. NOT from `main` HEAD.

**Why:** Commits land on `main` between alpha tags (PR merges, fixes, doc work, etc.). Those commits have never been exercised in an alpha and therefore have never been live-tested by the user. Including them in the "promotion" release defeats the entire purpose of the alpha → stable gate — it ships untested code under a "stable" label.

**How to apply:**
- "Promote alpha" → tag the new stable version on the **exact commit** the latest alpha tag points at, then put the version bump + history-file commit on top of that. The diff between alpha.N's binary and stable's binary should be ONLY the version string + the release notes file.
- Use `git rev-list -1 <alpha-tag>` to find the source commit. Branch from there, bump `package.json`, add the stable history file, tag.
- If `main` has post-alpha commits the user wants in the release, those should land in a **new alpha** first (alpha.N+1) so they get the same live-test gate, THEN the promotion happens.
- If the user explicitly says "include these post-alpha commits too" → do it, but call out which ones are not live-tested so the user can decide whether to ship anyway.

**Real incident — 2026-05-14, v0.44.0 promotion:**
User said "promote the current latest alpha to new minor" referring to v0.44.0-alpha.3. I tagged v0.44.0 from main HEAD, which contained three post-alpha commits (#208 markdown dialog, #210/#211 scroll guard, #212 multi-line table export) that had never shipped in any alpha. Those changes went live as "stable" without the alpha gate. The user caught it. Future stable releases must inherit from the alpha commit, not from main HEAD.
