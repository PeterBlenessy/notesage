# Tasks: Model Catalog Expansion

**PRD:** `docs/prds/2026-03-11-model-catalog-expansion.md`

**Total: 8 tasks — 3S, 3M, 2L**

**Suggested order:** Task 1 (schema) → Tasks 2-3 in parallel (catalog data + backend parsing) → Task 4 (thinking tag integration) → Task 5 (store + filter state) → Task 6 (UI category tabs + badges) → Task 7 (RAM recommendations) → Task 8 (verification)

**Risks:**

- Download URL accuracy — all 9 new model URLs must be verified against HF repos before merging. A 404 at runtime is a terrible first impression.
- Thinking tag correctness — `thinking_tags` must match actual model output. DeepSeek R1 distillations use `<think>` but this varies by quantizer.
- Backwards compatibility — existing users with downloaded models from the old catalog must not need to re-download. Filenames and IDs for the 9 existing models must not change.

---

### #1 — Extend catalog schema with new capability fields ✅

**Status:** Done

**Description:** Add new fields to `CatalogEntry` and `LocalModelInfo` Rust structs: `category` (String), `supports_tool_calling` (bool), `supports_thinking` (bool), `thinking_tags` (Option), `supports_vision` (bool), `multilingual` (bool), `recommended_for` (Vec). Add matching `ThinkingTags` struct with `open`/`close` fields. Update the TypeScript `LocalModelInfo` interface in `tauri.ts` with the same fields. All new fields must use `#[serde(default)]` or `Option<>` for backwards compatibility with existing `custom-models.json` files.

**Acceptance criteria:**

- [x] `CatalogEntry` and `LocalModelInfo` compile with all new fields

- [x] Existing catalog JSON still deserializes (new fields default to `None`/`false`)

- [x] `list_local_models` returns new fields to frontend

- [x] TypeScript interface matches Rust struct

- [x] Custom models without new fields still load

**Complexity:** S **Category:** both **Dependencies:** None **Files:**

- `src-tauri/src/commands/local_inference.rs` (structs)
- `src/lib/tauri.ts` (interface)

---

### #2 — Expand model-catalog.json to 18 models with capability metadata ✅

**Status:** Done

**Description:** Update `model-catalog.json` with 9 new models and add capability metadata to all 18 entries. New models to add: `qwen3-0.6b`, `smollm2-1.7b`, `qwen3-8b`, `ministral-3-3b`, `deepseek-r1-distill-1.5b`, `deepseek-r1-distill-7b`, `deepseek-r1-distill-14b`, `qwen3-14b`. Every entry must include the new fields: `category`, `supports_tool_calling`, `supports_thinking`, `thinking_tags` (where applicable), `supports_vision`, `multilingual`, `recommended_for`. Existing 9 models retain their `id` and `filename` (no re-download required). Follow the exact model specs from the PRD tables.

**Acceptance criteria:**

- [x] Catalog has exactly 18 entries

- [x] All entries have `category` set to `"compact"`, `"general"`, `"code"`, or `"reasoning"`

- [x] Existing 9 models have unchanged `id`, `filename`, and `huggingface_url`

- [x] `thinking_tags` set for Qwen3, DeepSeek R1, and Phi-4 Mini Reasoning models

- [x] `supports_tool_calling: true` for Qwen3 and Ministral models

- [x] `supports_fim: true` only for Qwen2.5 Coder models

- [x] `recommended_for` arrays match PRD RAM recommendation logic

- [x] JSON is valid and parses without error

**Complexity:** L **Category:** backend **Dependencies:** #1 **Files:**

- `src-tauri/model-catalog.json`

---

### #3 — Integrate thinking tags from catalog into local inference streaming ✅

**Status:** Done

**Description:** In `local_inference.rs` (or `ai_streaming.rs`), when streaming from the bundled llama-server, check the active model's `thinking_tags` from the catalog before falling back to hardcoded tag scanning. If `thinking_tags` is set, use those exact tags for parsing. If `supports_thinking` is true but no tags defined, fall back to generic `<think>` detection. If `supports_thinking` is false, skip thinking tag parsing entirely. This replaces the current hardcoded 7-tag-pair scanner for catalog models (custom models still use the hardcoded scanner as fallback).

**Acceptance criteria:**

- [x] Catalog models with `thinking_tags` use those tags for parsing

- [x] Catalog models with `supports_thinking: false` skip tag parsing

- [x] Custom models without catalog metadata still use hardcoded scanner

- [x] Thinking content correctly extracted for Qwen3, DeepSeek R1, and Phi-4 Reasoning

- [x] No regression for existing thinking model behavior

**Complexity:** M **Category:** backend **Dependencies:** #1, #2 **Files:**

- `src-tauri/src/commands/local_inference.rs` (streaming logic)

---

### #4 — Expose tool calling capability for routing decisions ✅

**Status:** Done

**Description:** When the frontend needs to decide whether to pass structured tool schemas or text-based tool descriptions to the local model, it should check `supports_tool_calling` from the model info. Add a helper in `tauri.ts` or the local AI store that exposes the active model's tool calling capability. This is a data plumbing task — the actual tool calling format switching will be implemented in the Local AI Tool Calling PRD.

**Acceptance criteria:**

- [x] `LocalModelInfo.supports_tool_calling` is available in the frontend

- [x] Active model's tool calling capability queryable from store or hook

- [x] No behavioral change yet (just metadata exposure)

**Complexity:** S **Category:** frontend **Dependencies:** #1 **Files:**

- `src/stores/local-ai-store.ts` (computed getter or selector)

---

### #5 — Add category filter state to local-ai-store ✅

**Status:** Done (extended with sort and "Downloaded" filter)

**Description:** Add a `categoryFilter` field to `local-ai-store` with values `'all' | 'general' | 'code' | 'reasoning' | 'compact' | 'downloaded'`. Default to `'all'`. Add a `setCategoryFilter` action. Add a `filteredModels` computed value (or a `getFilteredModels` selector) that filters `models` by category. The filter state should NOT be persisted (resets to 'all' on app restart).

**Acceptance criteria:**

- [x] `categoryFilter` defaults to `'all'`

- [x] `setCategoryFilter` updates the filter

- [x] Filtered models correctly excludes non-matching categories

- [x] `'all'` shows everything

- [x] Filter state resets on app restart (not persisted)

**Complexity:** S **Category:** frontend **Dependencies:** #1 **Files:**

- `src/stores/local-ai-store.ts`

---

### #6 — Add category tabs and capability badges to LocalAISettings UI ✅

**Status:** Done (extended with sort dropdown and "Downloaded" tab)

**Description:** Update `LocalAISettings.tsx` with: (1) Category filter tabs above the model list — "All", "General", "Code", "Reasoning", "Downloaded". Style as tab-style buttons matching design system. (2) Sort dropdown (Name, Size, RAM) on the right side of the filter row. (3) Inline capability badges on each model card — `[Tools]`, `[Think]`, `[FIM]`, `[Vision]`, `[Multi]` — using neutral monochrome styling (small, muted, pill-shaped). Badges only shown when the capability is `true`. Use the `categoryFilter` from the store for filtering. Maintain existing model card layout (name, description, size, download/delete/activate buttons).

**Acceptance criteria:**

- [x] Category tabs render above model list

- [x] Clicking a tab filters the model list

- [x] Active tab has distinct styling

- [x] Sort dropdown with Name/Size/RAM options

- [x] "Downloaded" filter tab shows only downloaded models

- [x] Capability badges render inline on model cards

- [x] Badges follow design system (neutral, no chromatic colors)

- [x] All 18 models display correctly

- [x] Existing action buttons (download, delete, use) still work

- [x] Works in both light and dark mode

- [x] ModelMetadataTooltip still works on hover

**Complexity:** L **Category:** frontend **Dependencies:** #2, #5 **Files:**

- `src/components/settings/LocalAISettings.tsx`

---

### #7 — Update RAM-based recommendations with new models ✅

**Status:** Done

**Description:** Update the "Recommended for your Mac" section in `LocalAISettings.tsx` to use the `recommended_for` field from model metadata instead of the current hardcoded logic. Group models by RAM tier (8GB, 16GB, 32GB, 64GB) and show the appropriate recommendations based on system RAM detection (already implemented via `get_system_memory`). Show a star icon next to the default recommended model for each tier.

**Acceptance criteria:**

- [x] Recommendations use `recommended_for` from catalog metadata

- [x] 8GB Mac sees compact/small models recommended

- [x] 16GB Mac sees Qwen3 4B, Qwen2.5 Coder 3B, Phi-4 Mini recommended

- [x] 32GB+ Mac sees Qwen3 8B, Qwen2.5 Coder 7B, DeepSeek R1 7B recommended

- [x] 64GB+ Mac sees Qwen3 14B, DeepSeek R1 14B recommended

- [x] Recommended section visually distinct from full model list

**Complexity:** M **Category:** frontend **Dependencies:** #2, #6 **Files:**

- `src/components/settings/LocalAISettings.tsx`

---

### #8 — Verify all download URLs and model capabilities ✅

**Status:** Done

**Description:** Manual verification task. For each of the 18 models: (1) Verify the `huggingface_url` returns 200 (not 404 or redirect to error). (2) For new models, download and test loading in llama-server. (3) Verify `supports_thinking` models actually produce thinking output. (4) Verify `thinking_tags` match actual output format. (5) Verify `supports_tool_calling` models accept structured tool schemas via `--jinja`. (6) Verify RAM estimates are within 500MB of actual usage.

**Acceptance criteria:**

- [x] All 18 URLs verified (HEAD request returns 200)

- [x] All 9 new models load in llama-server without error

- [x] Thinking content extracted correctly for all `supports_thinking: true` models

- [x] Tool calling works for all `supports_tool_calling: true` models

- [x] RAM estimates accurate within 500MB

- [x] Existing models from old catalog work without re-download

**Complexity:** M **Category:** both **Dependencies:** #1, #2, #3 **Files:**

- `src-tauri/model-catalog.json` (corrections if needed)