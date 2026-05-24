---
name: Don't revert code after the user confirms it works
description: Never remove an uncommitted fix because I think it's unnecessary — if the user reports "works now" with that code hot-loaded, the code IS necessary. Evidence beats reasoning.
type: feedback
originSessionId: 7361e4c4-4328-4780-be05-b3d7abf15509
aw_applies: no
---
Don't remove an uncommitted code change because I think it's unnecessary when the user has just reported "works now" with that code in the running build.

**Why:** 2026-04-19, project-data-isolation work. I made two Rust changes to fix ACP agent auth (basename fix in `agent_config_entries` + Claude keychain re-allow). Only the basename fix was committed; the keychain addition was uncommitted. User's `pnpm tauri dev` hot-reloaded the uncommitted keychain change, Claude authenticated, user reported "seems to work now." I reasoned Claude's OAuth was file-based (in `.claude/`) and reverted the keychain change as unnecessary cleanup. User immediately hit "Authentication failed for Claude Code" again. The keychain was load-bearing.

**How to apply:** When the user's "works now" message arrives during active dev-server hot-reload, assume the currently-in-filesystem code (committed + uncommitted) is what made it work. If I think a piece is unnecessary, say so and ask ("do you want me to remove X and test again, or keep it?") — don't silently revert. Corollary: once a fix is validated by live user testing, commit it promptly so a future revert can't happen accidentally.
