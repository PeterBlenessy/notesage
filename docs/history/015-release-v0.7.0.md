# Release v0.7.0

**Date:** 2026-02-18
**Previous version:** 0.6.2

## Changes

### Features
- Add AI web search with Anthropic and OpenAI provider-native search
  - Anthropic: server-side web search via `web_search_20250305` tool
  - OpenAI: web search via Responses API `web_search_preview` tool
  - Ollama: search toggle disabled with informative toast notification
- Search toggle in chat input footer (Globe icon) with per-provider state
- Citation display in chat messages with numbered "Sources" section and clickable URLs
- Citations open in system browser via Tauri opener plugin

### Improvements
- Migrate OpenAI from Chat Completions API to Responses API (`/v1/responses`)
- Upgrade OpenAI model from `gpt-4-turbo-preview` to `gpt-4o`
- Rewrite Anthropic streaming to use real SSE parsing instead of character-by-character emit
- Remove DuckDuckGo tool infrastructure (replaced by provider-native search)
- Remove `urlencoding` crate dependency (no longer needed)
- Clean up unused `HashMap` import in AI commands

### Docs
- Update architecture.md with web search data flow and provider details
- Update tauri-commands.md with `ai_chat_stream` command documentation
- Update future-phases.md with completed web search integration
- Add AI web search PRD and task breakdown

## Files Changed
- 16 files changed across 2 commits
