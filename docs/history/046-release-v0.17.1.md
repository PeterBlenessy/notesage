# Release v0.17.1

**Date:** 2026-03-02
**Previous version:** 0.17.0

## Changes

### Features
- Chat message deletion — circular X button on hover (top-left for user, top-right for assistant)
- Configurable chat history limit for Direct API connections (Unlimited, 10, 20, 50, 100)
- Project awareness — file tree and root path injected into AI system message
- File awareness — active file path and content preview in AI system message
- Chat provider selector reflects project-level AI provider override

### Fixes
- Fix false "File modified externally" toasts from in-app saves
- Fix resizable panel handle layout shift on hover (1px → 2px expansion removed)
- Fix sidebar drag-and-drop: disable Tauri native DnD, use counter-based hover tracking
- Fix sidebar UX: iCloud sync for blank projects, folder indentation, context menus

### Improvements
- AI errors shown inline as assistant messages with warning icon and provider attribution
- Parse provider JSON error bodies into user-friendly messages
- Increase Ollama HTTP timeout to 5 minutes for model loading
- AI provider configuration v2: OpenAI-compatible providers, Ollama expanded capabilities
- Redesign routing model selector with config icon
- Provider-agnostic inline completion popover text
- Refactor sidebar: extract shared utilities, replace window.prompt with dialog
- Skip node_modules, .git, dist, and other heavy directories in file tree context

## Files Changed
- 15+ files changed across 13 commits
