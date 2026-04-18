# Release v0.36.0

**Date:** 2026-04-18
**Previous version:** 0.35.0

## Changes

### Features

**ACP session lifecycle (Batch C)**
- Chats now resume their agent-side session across app restarts and conversation switches — prefers `session/resume` (live takeover), falls back to `session/load` (replay), then `session/list` (sanity check), then `session/new` (fresh)
- Branching from the current leaf with a fork-capable agent calls `session/fork` — each branch gets isolated agent context going forward; historical branches continue to share the parent session (ACP has no primitive to rewind agent state)
- Conversation delete fires best-effort `session/close` for the shared session and any forked branches so agents can free resources
- Added four new Tauri commands: `acp_session_close`, `acp_session_list`, `acp_session_resume`, `acp_session_fork`
- Per-branch `acpSessionId` tracking via `Conversation.branchSessions` with a `getSessionIdForLeaf` resolver; existing conversations continue to work without migration

**ACP rich tool content (Batch B)**
- File diffs render inline in chat as collapsible unified diffs with +/- coloring (via `--color-diff-*` CSS variables) — "N additions, M deletions in filename.ext" summary, click-to-open path header, new-file and deleted-file badges
- Text content blocks from `tool_call_update` render as collapsible monospace output below the tool label
- Terminal content blocks render as a muted placeholder (full terminal support requires the `terminal/create` client capability — out of scope)
- Works in both the chat panel and the delegation activity panel

### Improvements
- Capability checks now tolerate both camelCase (per ACP schema) and snake_case payloads — this fix uncovered that *every* capability check was silently returning false, including the pre-existing `session/load` restoration path
- Eager session effect now gates on Zustand's `hasHydrated()` so async `tauri-storage` rehydration completes before the restoration chain runs
- Eager session effect now uses a module-level in-flight lock to prevent React strict-mode + hydration-driven effect re-fires from creating duplicate sessions (previously fired four times at startup)
- Conversation switches re-trigger the restoration chain so prompts route to the correct agent session (previously the agent kept the previous conversation's session ID)

### Developer Experience
- New `/retrospect-skills` command with feedback hooks in 6 producer skills — batch review accumulated skill feedback and propose SKILL.md improvements with per-change approval
- `/test` split into typed sub-skills (`/test-frontend`, `/test-rust`, `/test-e2e`, `/test-perf`, `/test-markdown-roundtrip`, `/test-coverage`) for focused test runs
- `/implement-tasks` tightened: unchecked PRD quality gates now block finalize — manual tests must be run, handed off with a concrete proposal, or explicitly marked out-of-scope

### Documentation
- New PRDs and task breakdowns for ACP rich tool content and ACP session lifecycle completeness
- Updated ACP audit matrix — features #14, #18–#20, #43–#45 moved to implemented
- Updated `docs/features/ai-providers.md`, `docs/features/ai-workflows.md`, `docs/tauri-commands.md` for the new capabilities
- Filed Batch C-bis follow-up in the audit: extend session lifecycle to `useAgentTaskOperations` (comment-delegated conversations)

## Files Changed

- 56 files changed across 5 commits (+4,018 / −721)

## Deferred

- Batch C-bis: session restoration in the popover/delegation chat (`useAgentTaskOperations`)
- Batch D: protocol cleanup (`user_message_chunk`, `resource_link`, `EnvVar` auth)
- MCP server passthrough (originally grouped in Batch C, moved to a later batch)
- Full terminal block support (requires `terminal/create` client capability)
