# Release v0.28.1

**Date:** 2026-04-02
**Previous version:** 0.28.0

## Changes

### Features
- Chronological chat message segments — assistant messages render text, thinking, tool calls, and tool results as an interleaved chronological stream matching Claude Code, Cursor, and Cline UX
- Per-verb tool call grouping — consecutive tool calls with the same verb (Reading, Searching, Fetching) collapse into dark-background sections with expand/collapse
- Descriptive tool labels — show file basenames, commands, search queries instead of generic verbs (e.g. "Reading config.ts" not "Reading file")
- Conversation export renders segments chronologically (Markdown and JSON)

### Fixes
- ACP session resilience — agents are never auto-killed while working; 5-minute unresponsive timer shows banner (Wait/Retry/Cancel) instead of killing
- ACP retry uses `session/load` for context restoration, continues in same branch (no dead branches)
- ACP prompt timeout increased from 5 minutes to 30 minutes for long research tasks
- Fix crash when ACP rawInput is an object (TypeError: raw.match is not a function)
- Fix `[object Object]` showing in tool call hover tooltips
- Fix "Fetching Fetch", "undefined", "{}" appearing as tool labels
- Fix spinners never stopping in tool call group headers
- Fix false "Project changed" prompt on app refresh (Zustand rehydration race)
- Strip `<quick-replies>` tags from segment text rendering
- Fix ACP connection drops and hangs with Claude Code agent

### Improvements
- Smart tool call group collapse — groups with no useful child details auto-collapse
- Thinking segments auto-expand while streaming, collapse on completion
- Tool result segments collapsible with smart summaries (line count, size)
- `acp-agent-exited` Tauri event for instant process death detection
- `acp_is_agent_alive` command for liveness checking
- `AgentStatusBanner` component for unresponsive/exited agent UI
- `agent-status-store` for banner state management
- `resetAssistantMessage` store action for retry flow

## Files Changed
- 37 files changed across 24 commits
