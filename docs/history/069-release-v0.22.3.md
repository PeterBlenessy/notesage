# Release v0.22.3

**Date:** 2026-03-17
**Previous version:** 0.22.2

## Changes

### Fixes
- Fix dark mode spinner visibility in settings dialogs
- Fix Local AI icon rendering in connection cards
- Fix transcription settings styling inconsistencies
- Fix task list markdown round-trip losing checkbox state
- Fix table serialization dropping cell content
- Fix toolbar icons missing in certain states

### Improvements
- Auto-detect FIM support for custom GGUF models by parsing tokenizer token IDs from file headers
- Smart Ollama model fallback: query available models when default `llama3.2` isn't pulled
- Update Whisper model pre-download sizes to exact byte values from HuggingFace

### Docs
- Update hardcoded values audit and codebase analysis research docs to reflect implementation status
- Mark all hardcoded values cleanup tasks as complete

## Files Changed
- 19 files changed across 6 commits
