# Release v0.19.2

**Date:** 2026-03-12
**Previous version:** 0.19.1

## Changes

### Features
- Expand local AI model catalog from 9 to 18 curated models across 4 categories (general, code, reasoning, compact)
- Add 9 new models: Qwen3 0.6B/8B/14B, SmolLM2 1.7B, Ministral 3 3B, DeepSeek R1 Distill 1.5B/7B/14B
- Add capability metadata to all models: category, tool calling, thinking tags, vision, multilingual, RAM recommendations
- Add category filter tabs (All, General, Code, Reasoning, Downloaded) in Settings > Local AI
- Add sort dropdown (Name, Size, RAM) for model list
- Add capability badges (Tools, Think, FIM, Vision, Multi) on model cards
- Add RAM-tier recommendations with star icon on default recommended model
- Unify command palette with prefix-based mode switching (`#` tags, `@` mentions, `>` commands, `?` research)
- Add @mention support with inline badges, autocomplete, and cross-file search (Cmd+2)
- Add inline date badges with `//` trigger and calendar picker

### Improvements
- Integrate catalog thinking tags into streaming/non-streaming inference paths, replacing hardcoded tag scanner for catalog models
- Expose tool calling capability metadata to frontend for future routing decisions
- Update keyboard shortcuts dialog with @mentions and #tags labels

### Fixes
- Fix highlight colors to adapt to light/dark mode changes

## Files Changed
- 9 commits, key files: `model-catalog.json`, `local_inference.rs`, `LocalAISettings.tsx`, `tauri.ts`, `local-ai-store.ts`, `ai-providers.md`
