# Release v0.18.0

**Date:** 2026-03-06
**Previous version:** 0.17.6

## Changes

### Features
- Skills & Agents Platform (Phase 7, Step A) — extensible AI capability system based on the open Agent Skills standard
- Skill discovery from connected providers' filesystem paths (~/.claude/skills/, ~/.codex/skills/, ~/.gemini/skills/, ~/.agents/skills/)
- Notesage skill hierarchy: project .notesage/skills/ overrides global ~/.notesage/skills/, which overrides external provider skills
- Agent instruction files: .notesage/agents.md and ~/.notesage/agents.md injected into AI context, with discovery of existing AGENTS.md/CLAUDE.md/GEMINI.md
- Script execution runtime with path traversal protection, interpreter resolution (bash/python/node/tsx), timeout enforcement, and permission tiers
- Built-in create-skill and create-agent meta-skills shipped with the app, extracted to ~/.notesage/bundled-skills/ at startup
- Skills browser in Settings > Skills & Agents with source groups, enable/disable toggles, override detection, and rescan
- Agent instructions section with priority ordering, source badges, and merged context preview
- Skill slash commands in chat input (/skill-name) with autocomplete dropdown and skill body expansion
- Status bar indicator showing active agent instruction files with popover details
- New Skill wizard: multi-step dialog (describe → name → scope → review → create)
- New Agent Instructions wizard: multi-step dialog with append/replace for existing files
- Skill context injection into AI prompts — all skills for direct API, Notesage-only for ACP (avoids duplicating what agents discover independently)
- Skill script permission model: per-execution, per-session (non-persisted), always (persisted)

## Files Changed
- 28 files changed across 6 commits
- New backend: src-tauri/src/commands/skills.rs (950+ lines with 30 tests)
- New stores: src/stores/skill-store.ts (25 tests)
- New UI: SkillsSettings.tsx, NewSkillWizard.tsx, NewAgentWizard.tsx, SkillCommandMenu.tsx
- New bundled skills: bundled-skills/create-skill/, bundled-skills/create-agent/
- Modified: useAIOperations.ts, useSkillOperations.ts, ChatInput.tsx, ChatPanel.tsx, StatusBar.tsx, SettingsDialog.tsx, permission-store.ts
