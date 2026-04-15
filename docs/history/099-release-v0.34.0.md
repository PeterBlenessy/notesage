# Release v0.34.0

**Date:** 2026-04-15
**Previous version:** 0.33.0

## Changes

### Features

- **ACP thinking segments**: Agent reasoning output (`agent_thought_chunk`) displayed as collapsible thinking blocks in chat messages
- **ACP session titles**: Agent-generated conversation titles (`session_info_update`) automatically applied to chat history
- **ACP session modes**: Permission-level mode picker (Shield icon) in chat footer — Read Only / Agent / Full Access / Plan mapped from agent-specific mode IDs across Claude Code, Codex, Gemini CLI, and Copilot CLI
- **ACP dynamic config options**: Agent-reported config options (thinking effort, etc.) rendered as dropdowns in chat footer with Brain icon
- **ACP capability probing**: Lightweight spawn-session-read-stop cycle at connection registration discovers agent capabilities for the config dialog
- **ACP connection defaults**: Default mode and thinking effort configurable per connection in settings, applied automatically to new sessions
- **ACP eager session creation**: Session created when chat panel opens (before first message), so mode picker and config options are immediately available
- **ACP session restoration**: `acpSessionId` stored per conversation; reopening existing chats attempts `session/load` to preserve agent-side history
- **ACP mode-sandbox conflict dialog**: Selecting Full Access mode with active sandbox restrictions shows a confirmation dialog (keep restrictions / remove permanently / cancel)
- **ACP usage tracking**: Live token count as circular progress icon in chat footer with cost tooltip on hover
- **ACP plan display**: Agent execution plans rendered as collapsible PlanSegment cards with status icons and priority dots
- **ACP rich tool call updates**: Status mapping, file locations as clickable links, label updates from `tool_call_update` events
- **ACP agent slash commands**: Agent commands appear in `/` menu alongside Notesage skills, distinguished by Terminal icon
- **ACP model selection**: Post-session `set_model` replaces hardcoded CLI arg injection

### Fixes

- Fix conversation history leak across "Start fresh" boundaries (ACP session history block now respects segment boundaries)
- Fix provider logo hidden on all previous messages during streaming (only hides on actively streaming message)
- Fix mode/config dropdown duplication (filter config options with `category: "mode"`)
- Fix config option values using `value` field per ACP schema (was using `id` which was undefined)
- Fix chat footer layout: chips wrap naturally, action buttons stay last with `ml-auto`
- Fix cancel contract compliance: Cancel handler now drains permission waiters before sending CancelNotification
- Fix capability guards: `session/load` only attempted when agent advertises `loadSession` capability
- Fix HTML nesting: AlertDialogDescription uses `asChild` to avoid `<p>` inside `<p>`

### Improvements

- Graceful handling of unknown `SessionUpdate` types (logged at debug level instead of silently dropped)
- Thinking effort migrated from hardcoded Codex `reasoningEffort` to dynamic ACP config options
- Old Codex thinking effort slider removed from connection config (replaced by dynamic ACP controls)
- Three new Tauri commands: `acp_session_set_mode`, `acp_session_set_config_option`, `acp_session_set_model`
- `SessionResult` extended with `modes` and `config_options`, `SpawnResult` with `capabilities`
- `AcpDiscoveredCapabilities` and `AcpDefaults` types on Connection for persistent config
- Bump 1KB parse budget 34→38ms for PlanSegment type overhead

## Files Changed

- 19 commits, ~40 files changed across frontend (TypeScript/React) and backend (Rust)
- New components: `AcpSessionControls.tsx`, `PlanSegmentView.tsx`
- New types: `PlanSegment`, `PlanEntry`, `AcpDiscoveredCapabilities`, `AcpDefaults`, `AcpUsageInfo`, `AcpAgentCommand`
- New tests: 38 new unit tests (2658→2696)
- Updated docs: PRD, task breakdown, ai-providers.md, ai-workflows.md, performance-baseline.md
