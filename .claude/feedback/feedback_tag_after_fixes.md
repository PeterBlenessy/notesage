---
name: Don't tag until user says ready
description: Never auto-tag a release — always wait for explicit user confirmation that all fixes are done first
type: feedback
aw_applies: no
---

Don't rush to tag a release. The user wants to make all fixes and improvements before tagging. Always ask "Ready to tag?" and wait for explicit confirmation. Don't tag immediately after the release commit — the user may want to add more changes first.

**Why:** User wants to improve the version before releasing, not ship immediately after version bump.
**How to apply:** After the release commit, list remaining work and ask. Only tag when the user explicitly says to tag.
