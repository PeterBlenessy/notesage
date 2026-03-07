# Release v0.18.1

**Date:** 2026-03-07
**Previous version:** 0.18.0

## Changes

### Features
- Addressable agents: file-based agent system replacing legacy personas, discovered from `~/.notesage/agents/`, project `.notesage/agents/`, `.github/agents/`, and provider-specific directories (Phase 7 Step C)
- Agent picker dropdown in chat footer; `@agent-name` addressing in chat input for per-message agent scoping
- 7 bundled agents (General Assistant, Creative Writer, Technical Editor, Fact Checker, Academic Writer, Copywriter, Proofreader)
- One-time migration of custom personas to agent `.md` files on first launch
- Quick reply chips: AI responses can include `<quick-replies>` tags rendered as clickable follow-up prompts
- Skill & agent management: delete and move (global <-> project) for custom skills/agents, gated behind Settings > Advanced toggle
- Skill invocations displayed as collapsible indicators instead of raw expanded content
- Generic Ollama thinking/reasoning model support with runtime capability detection
- Auto-rescan: filesystem watcher triggers skill/agent re-discovery automatically

### Fixes
- Fix task list text overflow when window is narrow (flexbox min-width + overflow-wrap)
- Fix code review findings: typed API wrappers (`tauriApi.*`), component-based path matching in Rust, UI polish
- Fix UI design review issues: focus states, typography, accessibility
- Strip duplicate option lists when quick-replies tags are present
- Consolidate bundled skills/agents into standard `~/.notesage/` paths (remove legacy `bundled-skills/` and `bundled-agents/` directories)

### Improvements
- Rename Developer settings tab to Advanced
- Remove destructive red styling from skill/agent delete menu items
- Move quick-replies convention to bundled agents.md instruction file
- Update docs and PRDs to reflect current implementation status (all Step A & C quality gates checked)
- Document `copy_directory` Tauri command

## Files Changed
- 32+ files changed across 12 commits
