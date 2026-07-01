---
name: Touch files after Edit if Vite HMR depends on them
description: Claude Code's Edit tool can write files in a way that preserves the original mtime, which makes Vite's file watcher miss the change and the running app keeps stale code
type: feedback
originSessionId: cb9d7fdd-6f0d-4b76-bfc0-a551c95a238b
aw_applies: no
---
After editing a file that Vite is watching (anything under `src/` for the Notesage `pnpm tauri dev` server), do a `touch <file>` if the running app's behaviour suggests the change didn't reach it.

**Why:** During Phase 1 implementation (2026-05-05), the Edit tool wrote `src/components/editor/Editor.tsx` with new logic but the file's mtime didn't update — `stat` showed the old timestamp 17 minutes after the edit. Vite's file watcher tracks mtime, so it never fired an HMR update, and the running app kept executing the previous version. The user took DevTools recordings against stale code, leading to a confusing diagnosis loop. Forcing a `touch` on the file made Vite emit `hmr update /src/components/editor/Editor.tsx` immediately.

**How to apply:**
- After making frontend code changes the user will live-test, check `tail -5 /tmp/notesage-dev.log` (or wherever the dev server logs) for an `hmr update` entry that mentions the edited file.
- If no HMR entry appears within a few seconds, run `touch <full_path>` to bump the mtime. Vite will pick it up on the next watcher poll.
- Do this proactively for files that are central to the test (e.g. `Editor.tsx`, hooks, stores) — don't wait for the user to report stale behaviour.
- Touch all related files when a single edit spans multiple modules; HMR sometimes only re-evaluates the explicitly-touched file.
- This isn't a workaround for fundamentally broken code — only use `touch` to overcome the watcher gap. If the running app is still broken after a confirmed HMR update, the bug is in the code, not in propagation.
