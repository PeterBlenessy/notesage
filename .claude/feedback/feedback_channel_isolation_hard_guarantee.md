---
name: Stable users must never end up on alpha unintentionally
description: Channel isolation between Stable and Alpha release channels is a hard guarantee. Stable users must never receive alpha builds unless they explicitly opt in. Enforce at multiple layers.
type: feedback
originSessionId: e0a9c6e6-c7bb-4748-a54a-f7fbc33596a2
aw_applies: no
---
Stable users must NEVER end up on alpha (or beta, or any prerelease) unless they explicitly switched the channel themselves.

**Why:** A stable v0.43.0 user was auto-updated to v0.44.0-alpha.1 in the Notesage in-app updater because alpha.0 and alpha.1 were published with `isPrerelease: false` (workflow bug). GitHub's `releases/latest` then resolved to the latest alpha tag and the Tauri updater obediently offered it. The user did not pick alpha. This is a trust-breaking failure mode that the user named as "unthinkable" — not "annoying", "unthinkable".

**How to apply:** Defense in depth — server side AND client side, redundantly.

1. **Workflow (server-side):** `release.yml`'s `create-release` step MUST auto-detect tag suffixes `-alpha`, `-beta`, `-rc` and set `prerelease: true`. The hardcoded `prerelease: false` is a footgun; replace with conditional logic. Regression-lock this with a parse-the-yml test.

2. **In-app guard (client-side):** When `releaseChannel === "stable"`, the update offer code must REJECT any manifest whose version string contains `-alpha`/`-beta`/`-rc`. Don't trust the server flag alone — if a prerelease somehow leaks through GitHub's `releases/latest` resolution again, the app refuses to install it. This is the user-level guarantee.

3. **Rolling pointers MUST be flagged prerelease:** The `latest-alpha` rolling release (and any future `latest-beta` etc.) must be created with `prerelease: true` so GitHub's `releases/latest` resolver skips them. The alpha-channel feed URL is a direct asset URL (`releases/download/latest-alpha/...`) that works regardless of the prerelease flag.

4. **Tests for both:** Workflow regression-lock catches future drift in release.yml. Unit tests for the in-app guard catch future drift in `useAutoUpdate.ts`.

If a future contribution proposes "let's auto-upgrade stable users to alpha because alpha is more recent and shinier", reject. Channel choice is the user's, not the system's.
