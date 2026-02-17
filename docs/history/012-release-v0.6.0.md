# Release v0.6.0

**Date:** 2026-02-17
**Previous version:** 0.5.2

## Changes

### Features
- Add project goals system with template-based creation (OKR, Simple Checklist, SMART Goals, Milestone Tracker)
- Add YAML frontmatter support to the editor (parse, preserve, and edit frontmatter on markdown files)
- Add frontmatter indicator and expandable editor UI for viewing/editing frontmatter fields
- Add goal template picker dialog for adding goals to existing projects via context menu
- Add project template picker to New Project dialog (Default, Research, Writing, Blank)
- Add goals discovery hook that scans project files for `type: goal` frontmatter
- Inject goals content into AI chat system prompt for project-aware conversations
- Add multi-select project selector in chat footer for choosing which projects provide AI context
- Add goals badge showing count of discovered goal files in chat footer
- Dynamic chat placeholder when project has goals ("Ask about your project goals...")

### Fixes
- Fix Anthropic API system message handling — system messages now correctly passed as top-level `system` parameter (both streaming and non-streaming)
- Fix chat footer overflow when panel is narrow (flex-wrap)
- Remove redundant CTX badge from chat footer

### Improvements
- Rename `.note-sage` metadata directory to `.notesage` with auto-migration for existing projects
- Add vitest for unit testing with frontmatter round-trip tests
- Add `yaml` dependency for frontmatter parsing

### Docs
- Add project goals PRD and task breakdown
- Mark all 14 project goals tasks and quality gates as complete

## Files Changed
- 28 files changed across 8 commits
