# Release v0.28.2

**Date:** 2026-04-02
**Previous version:** 0.28.1

## Changes

### Features
- ACP skill discovery via system prompt — agents now receive full paths to Notesage skill SKILL.md files with instructions to read them, enabling ACP agents (Claude Code) to find and use Notesage skills
- Color tint system and moved Appearance to new General settings tab

### Fixes
- Dependabot: upgrade lodash/lodash-es to 4.18.x (Code Injection via `_.template`, Prototype Pollution via `_.unset`/`_.omit`)
- Dependabot: override nanoid to 5.1.7 (predictable output CVE)

## Files Changed
- 9 files changed across 4 commits
