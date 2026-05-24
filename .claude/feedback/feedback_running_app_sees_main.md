---
name: Running app reads from main, not worktrees
description: When user is running pnpm tauri dev and testing live, sub-agent worktree changes are invisible to the app until merged to main.
type: feedback
originSessionId: c3b9ec0f-08ec-4fbf-973a-f341085e80ad
aw_applies: no
---
The user's running `pnpm tauri dev` watches `/Users/peter/Development/note-sage/src/...` (the main checkout). Sub-agent worktrees at `.claude/worktrees/agent-XX/src/...` are separate filesystem locations — Vite HMR never sees them.

**Why:** When I report a sub-agent's work as "done in the worktree" and pause for user approval before committing, the user often opens the app to test it — and sees no change. They reasonably wonder if something is broken (e.g. "should I rebuild Rust?"). The answer is: changes are real, but they're in the worktree, not where the running app looks.

**How to apply:**
- When proposing a commit on the user's behalf and the change is testable in the running app, say explicitly: "your running `pnpm tauri dev` won't see this until I merge — the changes are in the worktree branch right now."
- For frontend-only changes: after merge, Vite HMR picks it up in seconds. No Rust rebuild needed unless `src-tauri/` was touched (per CLAUDE.md "Backend (Rust/Tauri)" section).
- For Rust changes: the `pnpm tauri dev` cargo watch typically hot-reloads, but per CLAUDE.md a clean rebuild may be needed if Tauri command signatures changed.
- If the user wants to test before commit (legitimate request — `feedback_no_rush_commit.md`), suggest they peek at the worktree directly OR offer to merge first if reverting is cheap (single commit, no other commits behind it).

**Why save this:** The "test before commit" + "running app sees main only" combination produced a confusing exchange in the 2026-04-23 session — the user thought the editor mount wasn't working, when really it just hadn't been merged yet. The fix was to merge and let HMR catch up.
