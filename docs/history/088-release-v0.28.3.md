# Release v0.28.3

**Date:** 2026-04-03
**Previous version:** 0.28.2

## Changes

### Features
- Gemma 4 models (E4B, 26B MoE) added to curated model catalog
- Hugging Face model search with rich metadata: architecture, context length, capabilities from chat_template, license, base model, author
- Clickable author and capability filters with filter pills
- Hide/restore models from catalog (persisted, restore defaults link)
- Auto-start download when adding model from HF search
- Custom models inherit full metadata and capability badges

### Fixes
- Bump llama.cpp from b8261 to b8648 for Gemma 4 architecture support
- Fix model switch not restarting server (was silently keeping old model)
- Fix empty author in search results (use quantized_by / repo owner fallback)
- Fix "Unknown" quantization labels (show filename instead)
- Fix search dialog scroll overflow and card overlap

### Improvements
- Human-friendly labels: "context" not "ctx", "variants" not "quants"
- Model detail card with base model, architecture, context length, capabilities
- Tooltip width fixed at 220px, displayed on left side
- Dialog widened to max-w-lg for better search result display

## Files Changed
- 10 files changed across 3 commits
