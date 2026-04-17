# Release v0.35.0

**Date:** 2026-04-17
**Previous version:** 0.34.0

## Changes

### Features
- Agent system simplification: removed 7 bundled prompt-only agents, replaced with 5 bundled custom prompts (Academic Tone, Creative Rewrite, Proofread, Marketing Copy, Technical Edit) in the BubbleMenu
- `@agent-name` pass-through for ACP/Copilot connections — provider handles native subagent delegation instead of Notesage intercepting
- Expanded agent discovery: project-level `.claude/agents/` and `.gemini/agents/` directories now scanned
- Global provider agent directories (`~/.claude/agents/`, `~/.codex/agents/`, `~/.gemini/agents/`, `~/.copilot/agents/`) scanned unconditionally, not gated on active connections
- Explorer folders now included in agent discovery (previously only projects were scanned)
- Source badges in `@` autocomplete menu showing agent origin (claude, github, gemini, copilot, project, global)
- ACP agent slash commands now appear in the `/` command menu (eager session listener for `available_commands_update`)

### Improvements
- Simplified chat footer: removed agent picker and tools popover
- ACP system prompt no longer injects `<role-instructions>` block — ACP agents manage their own subagent system
- Default active agent changed from `general-assistant` to none (generic writing assistant fallback)
- One-time cleanup of previously extracted bundled agents from `~/.notesage/agents/` on upgrade
- Removed persona migration code (legacy from v0.20)
- Added `.copilot` source attribution for GitHub Copilot home folder agents
- Fixed global Copilot paths from `~/.github/` (incorrect) to `~/.copilot/`

### Documentation
- Updated ai-workflows.md, ai-providers.md, architecture.md for agent simplification
- ACP audit updated with v0.34.0 implementation status

## Files Changed
- 35 files changed across 2 commits
- Deleted `bundled-agents/` directory (8 files)
- Key files: agents.rs, ChatPanel.tsx, useSkillOperations.ts, skill-store.ts, ai-store.ts, AgentCommandMenu.tsx, useAIContext.ts
