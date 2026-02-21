# Release v0.13.0

**Date:** 2026-02-21
**Previous version:** 0.12.2

## Changes

### Features
- Multi-provider AI connection system with subscription-based auth, API keys, and local providers
- ACP (Agent Client Protocol) integration — full client implementation in Rust backend
- Three ACP agent adapters: Claude Code (`claude-agent-acp`), OpenAI Codex (`codex-acp`), GitHub Copilot (`copilot --acp`)
- Per-use-case provider routing: separate providers for interactive (chat + inline actions), agent tasks, and inline completion
- Smart auto-assignment: first connection fills all compatible use case slots
- Agent activity panel: collapsible per-message log showing tool call steps during ACP sessions
- Background task agent hook (`useAgentTaskOperations`) for delegated multi-step work
- Permission-store for tracking ACP tool call approvals (read-only auto-approved, write tools tracked)
- Connection settings UI: provider cards, Add Connection popover with capability guidance, Advanced Routing section
- Agent connection flow: check binary availability, spawn agent, authenticate via subscription
- One-time migration from v1 ai-store preserves existing API key configurations

### Improvements
- Clean up provider labels: removed redundant auth method suffixes since grouping conveys this
- Capability badge tooltips explaining what Interactive, Agent Tasks, and Inline Completion mean
- Connection status indicators (green/red/grey dots) in routing dropdowns
- Provider picker grouped into Subscription vs API Key sections with free tier indicators
- Fixed incorrect Copilot install hint (was referencing wrong package)
- Removed opinionated "Recommended" badge from provider picker

### Docs
- Updated architecture.md with ACP data flow, new stores, and new files
- Updated product-description.md: Phase 6 moved from roadmap to current features
- Updated CLAUDE.md version reference
- Fixed mangled formatting in AI Provider Architecture v2 task list
- Added Agent Install Wizard PRD and task breakdown for future work

## Files Changed
- 32 files changed across 29 commits
