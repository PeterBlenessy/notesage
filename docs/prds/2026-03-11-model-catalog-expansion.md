# PRD: Local AI Model Catalog Expansion

**Date:** 2026-03-11 **Phase:** 11 **Status:** Draft

---

## Problem

Notesage's curated model catalog currently has 9 models from 4 organizations (Qwen, Microsoft, Google, Meta). While this covers the basics, it misses several important model families released in late 2025 and early 2026:

- **No reasoning-specialized models** beyond Phi-4 Mini Reasoning — missing DeepSeek-R1 distillations which are the strongest open reasoning models
- **No Mistral models** — Ministral 3 (Dec 2025) offers vision + tool calling in compact packages
- **No ultra-compact models** — nothing below 1.5B for users with 8GB RAM who want fast, basic AI
- **No models with verified tool calling support** — the catalog has no `supports_tool_calling` field, critical for the Local AI Tool Calling PRD
- **No thinking model detection metadata** — thinking tag formats vary by model family but aren't captured in the catalog
- **Stale recommendations** — Qwen3.5 small models (March 2026) significantly outperform the Qwen3 models currently listed

The model catalog is the user's first impression of local AI quality. A thin catalog makes local AI feel like a toy; a well-curated catalog makes it feel like a competitive alternative to cloud APIs.

---

## Goals

1. **Expand to 15-20 curated models** covering all major open-source families
2. **Add capability metadata** — `supports_tool_calling`, `supports_thinking`, `thinking_tags`, `supports_vision` fields
3. **Model categories** — organize models into General, Code, Reasoning, and Compact categories for UI grouping
4. **RAM-based recommendations** — improve model suggestions using system RAM detection (already implemented)
5. **Updated model sources** — prefer official GGUF releases (Qwen, Mistral, Google) over community quantizations where available
6. **Maintain catalog quality** — every model tested, correct download URLs, accurate RAM estimates

## Non-Goals

- **Custom model import UI** — users who want arbitrary GGUF models should use Ollama
- **Model benchmarks in UI** — no quality scores or leaderboard rankings shown
- **Auto-update catalog from remote** — catalog ships with app releases
- **Models > 14B** — keep within reasonable desktop RAM limits
- **Embedding models** — deferred to semantic search phase
- **Vision model inference** — catalog the models but inference support is deferred

---

## Model Catalog

### New Catalog Schema

Extend `model-catalog.json` with new capability fields:

```json
{
  "id": "qwen3-4b",
  "name": "Qwen3 4B",
  "filename": "Qwen3-4B-Q4_K_M.gguf",
  "size_bytes": 2500000000,
  "ram_required_bytes": 4000000000,
  "description": "Good all-around quality. Thinking mode, tool calling.",
  "huggingface_url": "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
  "source": "Qwen (official)",
  "author": "Qwen",
  "organization": "Alibaba",
  "license": "apache-2.0",
  "parameters": "4B",
  "architecture": "qwen3",
  "context_length": 32768,
  "quantization": "Q4_K_M",
  "hf_repo_id": "Qwen/Qwen3-4B-GGUF",

  "category": "general",
  "supports_fim": false,
  "supports_tool_calling": true,
  "supports_thinking": true,
  "thinking_tags": { "open": "<think>", "close": "</think>" },
  "supports_vision": false,
  "multilingual": true,
  "recommended_for": ["16gb"]
}
```

### New Fields

| Field | Type | Description |
|---|---|---|
| `category` | string | `"general"` \| `"code"` \| `"reasoning"` \| `"compact"` |
| `supports_tool_calling` | bool | Model supports native function calling via llama.cpp `--jinja` |
| `supports_thinking` | bool | Model has thinking/reasoning mode |
| `thinking_tags` | object | `{ "open": "<think>", "close": "</think>" }` — tags for thinking content extraction |
| `supports_vision` | bool | Model supports image input (future use) |
| `multilingual` | bool | Trained for multilingual use |
| `recommended_for` | string[] | RAM tiers: `"8gb"`, `"16gb"`, `"32gb"`, `"64gb"` |

### Proposed Full Catalog (18 models)

#### Compact (< 2B, for 8GB Macs)

| ID | Name | Params | Size | RAM | Category | Tool Calling | Thinking | Source |
|---|---|---|---|---|---|---|---|---|
| `qwen3-0.6b` | Qwen3 0.6B | 0.6B | ~400MB | 1GB | compact | Yes | Yes | Qwen (official) |
| `smollm2-1.7b` | SmolLM2 1.7B | 1.7B | ~1.0GB | 2GB | compact | Yes | No | HuggingFace (official) |
| `qwen3-1.7b` | Qwen3 1.7B | 1.7B | ~1.8GB | 2.5GB | compact | Yes | Yes | Qwen (official) |

#### General (2B-8B)

| ID | Name | Params | Size | RAM | Category | Tool Calling | Thinking | Source |
|---|---|---|---|---|---|---|---|---|
| `phi-4-mini` | Phi-4 Mini | 3.8B | ~2.5GB | 3.5GB | general | No | No | lmstudio-community |
| `gemma-3-4b` | Gemma 3 4B | 4B | ~2.5GB | 4GB | general | No | No | lmstudio-community |
| `qwen3-4b` | Qwen3 4B | 4B | ~2.5GB | 4GB | general | Yes | Yes | Qwen (official) |
| `ministral-3-3b` | Ministral 3 3B | 3B | ~2.0GB | 3GB | general | Yes | No | Mistral (official) |
| `qwen3-8b` | Qwen3 8B | 8B | ~5.0GB | 6.5GB | general | Yes | Yes | Qwen (official) |
| `llama-3.1-8b` | Llama 3.1 8B | 8B | ~4.9GB | 6.5GB | general | Yes | No | lmstudio-community |

#### Code (FIM-capable)

| ID | Name | Params | Size | RAM | Category | FIM | Source |
|---|---|---|---|---|---|---|---|
| `qwen2.5-coder-1.5b` | Qwen2.5 Coder 1.5B | 1.5B | ~1.6GB | 2.5GB | code | Yes | Qwen (official) |
| `qwen2.5-coder-3b` | Qwen2.5 Coder 3B | 3B | ~2.0GB | 3.5GB | code | Yes | Qwen (official) |
| `qwen2.5-coder-7b` | Qwen2.5 Coder 7B | 7B | ~4.7GB | 6.5GB | code | Yes | Qwen (official) |

#### Reasoning (chain-of-thought specialized)

| ID | Name | Params | Size | RAM | Category | Thinking | Source |
|---|---|---|---|---|---|---|---|
| `phi-4-mini-reasoning` | Phi-4 Mini Reasoning | 3.8B | ~2.5GB | 3.8GB | reasoning | Yes | lmstudio-community |
| `deepseek-r1-distill-1.5b` | DeepSeek R1 Distill 1.5B | 1.5B | ~1.1GB | 2GB | reasoning | Yes | unsloth |
| `deepseek-r1-distill-7b` | DeepSeek R1 Distill 7B | 7B | ~4.5GB | 6GB | reasoning | Yes | unsloth |
| `deepseek-r1-distill-14b` | DeepSeek R1 Distill 14B | 14B | ~8.5GB | 11GB | reasoning | Yes | unsloth |
| `qwen3-14b` | Qwen3 14B | 14B | ~8.5GB | 11GB | reasoning | Yes | Qwen (official) |

### Models Removed

| ID | Reason |
|---|---|
| (none removed) | All existing models retained; new ones added |

### RAM Recommendation Logic

```typescript
function getRecommendedModels(systemRamGB: number): string[] {
  if (systemRamGB <= 8) return ['qwen3-0.6b', 'qwen3-1.7b', 'qwen2.5-coder-1.5b'];
  if (systemRamGB <= 16) return ['qwen3-4b', 'qwen2.5-coder-3b', 'phi-4-mini'];
  if (systemRamGB <= 32) return ['qwen3-8b', 'qwen2.5-coder-7b', 'deepseek-r1-distill-7b'];
  return ['qwen3-14b', 'qwen2.5-coder-7b', 'deepseek-r1-distill-14b'];
}

function getDefaultModel(systemRamGB: number): string {
  if (systemRamGB <= 8) return 'qwen3-1.7b';
  if (systemRamGB <= 16) return 'qwen3-4b';
  if (systemRamGB <= 32) return 'qwen3-8b';
  return 'qwen3-14b';
}
```

---

## UI/UX

### Settings → Local AI (Updated)

Add category tabs and capability badges:

```
┌─────────────────────────────────────────────────────────┐
│  Local AI                                               │
│─────────────────────────────────────────────────────────│
│                                                         │
│  Status: ● Running (Qwen3 4B)                          │
│  Memory: 4.0 GB / 16 GB available                      │
│                                                         │
│  ── Models ─────────── [All] [General] [Code] [Reason] │
│                                                         │
│  Recommended for your Mac (16 GB):                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │  ★ Qwen3 4B            2.5 GB     ✓ Active     │    │
│  │    Good all-around. Thinking, tool calling.     │    │
│  │    [Tools] [Think]                              │    │
│  ├─────────────────────────────────────────────────┤    │
│  │  Qwen2.5 Coder 3B      2.0 GB     [Download]   │    │
│  │    Code completion with FIM support.            │    │
│  │    [FIM]                                        │    │
│  ├─────────────────────────────────────────────────┤    │
│  │  Phi-4 Mini             2.5 GB     [Download]   │    │
│  │    Microsoft. Strong reasoning.                 │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  All models:                                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Qwen3 0.6B             400 MB    [Download]    │    │
│  │  SmolLM2 1.7B           1.0 GB    [Download]    │    │
│  │  ...                                            │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Capability Badges

Small inline badges on model cards:

| Badge | Meaning | Color |
|---|---|---|
| `[Tools]` | Supports tool calling | neutral |
| `[Think]` | Supports thinking/reasoning | neutral |
| `[FIM]` | Fill-in-the-middle for code | neutral |
| `[Vision]` | Supports image input (future) | neutral (muted) |
| `[Multi]` | Multilingual | neutral |

Badges use the design system's neutral palette — no chromatic colors.

### Category Filter

Tab-style filter above model list:
- **All** — show everything
- **General** — chat, writing, editing
- **Code** — FIM-capable models
- **Reasoning** — thinking/chain-of-thought models

---

## Data Model

### Catalog Schema (Rust)

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct CatalogModel {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub size_bytes: u64,
    pub ram_required_bytes: u64,
    pub description: String,
    pub huggingface_url: String,
    pub source: String,
    pub author: String,
    pub organization: String,
    pub license: String,
    pub parameters: String,
    pub architecture: String,
    pub context_length: u32,
    pub quantization: String,
    pub hf_repo_id: String,

    // New fields
    pub category: Option<String>,             // "general" | "code" | "reasoning" | "compact"
    pub supports_fim: Option<bool>,           // default false
    pub supports_tool_calling: Option<bool>,  // default false
    pub supports_thinking: Option<bool>,      // default false
    pub thinking_tags: Option<ThinkingTags>,
    pub supports_vision: Option<bool>,        // default false
    pub multilingual: Option<bool>,           // default false
    pub recommended_for: Option<Vec<String>>, // RAM tiers
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThinkingTags {
    pub open: String,
    pub close: String,
}
```

### Thinking Tag Integration

The `thinking_tags` field integrates with the existing thinking model detection in `ai_streaming.rs`. Currently, the bundled llama-server path uses hardcoded tag scanning (`<think>`, `<reasoning>`, `<reflection>`). With catalog metadata:

```rust
// In local_bundled_chat_stream:
let model = get_active_catalog_model(model_id);
if let Some(tags) = &model.thinking_tags {
    // Use catalog-defined tags instead of hardcoded scanning
    parse_thinking_with_tags(&response_text, &tags.open, &tags.close);
} else if model.supports_thinking.unwrap_or(false) {
    // Fallback to generic <think> detection
    parse_thinking_generic(&response_text);
}
```

### Tool Calling Integration

The `supports_tool_calling` field determines whether the model gets structured tool schemas or text-based tool descriptions:

```rust
// In local_bundled_chat_stream:
let model = get_active_catalog_model(model_id);
if model.supports_tool_calling.unwrap_or(false) {
    // Pass tools as structured OpenAI-format tool definitions
    request_body["tools"] = tools_to_openai_format(&tools);
} else {
    // Inject tool descriptions as text in system message
    system_message += &format_tools_as_text(&tools);
}
```

---

## Quality Gates

### Functional

- [ ] All 18 models have correct download URLs (verified, not 404)
- [ ] All models download successfully and load in llama-server
- [ ] RAM requirements are accurate (within 500MB of actual)
- [ ] `supports_tool_calling` is correct for each model (tested with structured tool call)
- [ ] `supports_thinking` is correct (thinking content properly extracted)
- [ ] `thinking_tags` match actual model output format
- [ ] Category filter works in Settings UI
- [ ] RAM-based recommendations are correct for 8/16/32/64 GB
- [ ] Capability badges display correctly on model cards
- [ ] Existing models (from old catalog) continue to work without re-download
- [ ] Custom models (from `custom-models.json`) coexist with catalog models

### Performance

- [ ] Catalog loading is instant (embedded at compile time)
- [ ] Model list rendering is smooth with 18+ entries

### Design

- [ ] Model cards with badges follow design system
- [ ] Category tabs are clean and functional
- [ ] Recommended section is visually distinct
- [ ] All UI works in light and dark mode

---

## Dependencies

### No New Dependencies

- Catalog is a JSON file embedded via `include_str!` — no runtime fetching
- All models hosted on Hugging Face — existing download infrastructure reused

---

## Files Modified

- `src-tauri/model-catalog.json` — expanded catalog with new models and fields
- `src-tauri/src/commands/local_inference.rs` — parse new catalog fields, tool calling detection, thinking tag integration
- `src/components/settings/LocalAISettings.tsx` — category tabs, capability badges, updated recommendations
- `src/stores/local-ai-store.ts` — category filter state

---

## Out of Scope

- **Custom model import** — Ollama for arbitrary GGUF models
- **Model benchmarks** — no quality scores in UI
- **Auto-update catalog from remote** — ships with app
- **Models > 14B** — too large for most desktops
- **Embedding models** — separate phase
- **Vision inference** — catalog support only, no runtime processing
- **Qwen3.5 models** — monitor hallucination rates before adding to catalog
