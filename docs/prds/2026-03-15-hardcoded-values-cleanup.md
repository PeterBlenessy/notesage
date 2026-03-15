# Hardcoded Values Cleanup

**Date:** 2026-03-15 **Status:** Implemented **Research:** [docs/research/hardcoded-values-audit.md](../research/hardcoded-values-audit.md)

## Prior Work

Several issues from the original audit have already been resolved by completed PRDs:

| Issue | Resolved by | How |
| --- | --- | --- |
| Thinking tags for catalog models | [Model Catalog Expansion](2026-03-11-model-catalog-expansion.md) | `thinking_tags` field in `model-catalog.json` with per-model `{ open, close }` |
| FIM support hardcoded in catalog | [Model Catalog Expansion](2026-03-11-model-catalog-expansion.md) | `supports_fim` boolean field per model |
| Model catalog missing context_length, architecture | [Model Catalog Expansion](2026-03-11-model-catalog-expansion.md) | Added `context_length`, `architecture`, `category`, capability fields |
| GGUF header parsing for metadata | [Model Metadata Enrichment](2026-03-11-model-metadata-enrichment.md) | `gguf_parser.rs` reads context length, architecture, etc. from downloaded files |
| No runtime metadata from llama-server | [Model Metadata Enrichment](2026-03-11-model-metadata-enrichment.md) | Fetches from `/v1/models` for authoritative parameter count and context window |

**What remains** are the duplication and consolidation issues that neither PRD addressed — scattered default values, duplicated constants, and magic numbers across the Rust backend.

## Problem

The Rust backend has hardcoded values duplicated across files, making updates error-prone:

- **Default model names** appear in **9 locations** across 3 files — updating a model version (e.g., Anthropic's dated slug) requires touching every one
- **Thinking tag fallback arrays** are copy-pasted identically in two functions within `local_inference.rs` — the catalog expansion solved this for *known* models, but custom/unknown models still hit a duplicated 7-tag hardcoded array
- **Anthropic API version** `"2023-06-01"` is hardcoded in **4 HTTP calls** across 2 files
- **macOS fallback binary paths** (`/opt/homebrew/bin`, `/usr/local/bin`) are duplicated in `acp.rs` and `copilot_lsp.rs` — `shell_path.rs` handles primary PATH resolution, but the fallback literals are still scattered
- **Magic numbers** (repeat_penalty, FIM temperature, web search tool IDs, MCP protocol version) are scattered inline without names

This is a code health initiative — no user-facing behavior changes, just consolidation and one dynamic improvement (thinking tag detection from `/props` for custom models).

## Goals

1. **Single source of truth** for all provider default model names — one change updates everywhere
2. **Zero duplication** of thinking tag fallback arrays — shared constant, plus dynamic detection from llama-server `/props` chat_template for custom/unknown models
3. **Named constants** for all API versions, tool identifiers, and tuning parameters
4. **Shared fallback paths** for macOS binary resolution — one array, not scattered literals

## Non-Goals

- Model catalog restructuring — already done in [Model Catalog Expansion](2026-03-11-model-catalog-expansion.md)
- GGUF metadata parsing — already done in [Model Metadata Enrichment](2026-03-11-model-metadata-enrichment.md)
- Whisper model file sizes (stable values, low churn)
- Cross-platform binary paths (Windows/Linux — future work when those platforms are targeted)
- Changing any default values or tuning parameters — this is purely consolidation
- Adding user-configurable settings for any of these values

## User Stories

As a **maintainer**, I want default model names in one place, so that bumping Anthropic's model slug is a one-line change instead of a 9-line hunt.

As a **maintainer**, I want thinking tag detection to use the loaded model's chat template, so that new custom reasoning models work without code changes.

As a **contributor**, I want magic numbers to have names, so that I understand what `0.1`, `1.1`, and `5` mean when reading AI command code.

## Technical Approach

### A. Shared Constants Module

Create `src-tauri/src/commands/constants.rs` to hold all consolidated values:

```rust
// -- Default models --
pub const DEFAULT_MODEL_ANTHROPIC: &str = "claude-sonnet-4-5-20250929";
pub const DEFAULT_MODEL_OPENAI: &str = "gpt-4o";
pub const DEFAULT_MODEL_OLLAMA: &str = "llama3.2";

// -- API versions --
pub const ANTHROPIC_API_VERSION: &str = "2023-06-01";
pub const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

// -- Thinking/reasoning fallback tags (custom/unknown models only) --
// Catalog models use their `thinking_tags` metadata instead (see model-catalog-expansion PRD).
// This fallback is used when no catalog entry exists and /props detection yields nothing.
pub const FALLBACK_THINKING_TAGS: &[(&str, &str)] = &[
    ("<think>", "</think>"),
    ("<summary>", "</summary>"),
    ("<discussion>", "</discussion>"),
    ("<reflection>", "</reflection>"),
    ("<reasoning>", "</reasoning>"),
    ("<scratchpad>", "</scratchpad>"),
    ("<internal_thoughts>", "</internal_thoughts>"),
];

// -- macOS fallback binary paths --
// Primary resolution uses shell_path.rs (spawns login shell for PATH).
// These are last-resort fallbacks when PATH lookup fails.
pub const MACOS_FALLBACK_BIN_PATHS: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
];
pub const MACOS_FALLBACK_NODE_MODULE_PATHS: &[&str] = &[
    "/opt/homebrew/lib/node_modules/.bin",
    "/usr/local/lib/node_modules/.bin",
];

// -- AI tuning parameters --
pub const FIM_TEMPERATURE: f64 = 0.1;
pub const CHAT_TEMPERATURE_FIM_FALLBACK: f64 = 0.2;
pub const REPEAT_PENALTY: f64 = 1.1;

// -- Web search --
pub const ANTHROPIC_WEB_SEARCH_TOOL: &str = "web_search_20250305";
pub const ANTHROPIC_WEB_SEARCH_MAX_USES: u32 = 5;
pub const OPENAI_WEB_SEARCH_TOOL: &str = "web_search_preview";
```

**Frontend mirror:** Update `src/lib/ai/connections.ts` `DEFAULT_MODELS` to import from a shared `src/lib/ai/constants.ts` (single source, though Rust and TS can't share a file — keep them adjacent and documented).

### B. Dynamic Thinking Tag Detection for Custom Models

The [Model Catalog Expansion](2026-03-11-model-catalog-expansion.md) solved thinking tags for the 18 curated catalog models. But custom models added via `custom-models.json` still fall through to the hardcoded 7-tag array. The [Model Metadata Enrichment](2026-03-11-model-metadata-enrichment.md) fetches from `/v1/models` but doesn't parse the chat template for thinking tags.

After llama-server loads a model, call `GET /props` to retrieve the `chat_template`. Parse it for thinking tag patterns using the same strategy as Ollama's `InferTags`:

1. Scan the Jinja2 template for thinking-related blocks (e.g., `{% if thinking %}`, `{%- if message.role == "thinking" %}`)
2. Extract the delimiter tags surrounding those blocks
3. If template parsing yields tags → use those (highest confidence)
4. If model is in the catalog with `thinking_tags` metadata → use catalog tags (already implemented)
5. If model is in the catalog with `supports_thinking: true` but no tags → use `<think>...</think>` (already implemented)
6. If model is unknown/custom and template parsing yielded nothing → fall back to `constants::FALLBACK_THINKING_TAGS`

```rust
/// Detect thinking tags from llama-server's /props chat_template.
/// Returns None if no thinking pattern is found in the template.
async fn detect_thinking_tags_from_template(port: u16) -> Option<(String, String)> {
    let resp = reqwest::get(format!("http://127.0.0.1:{}/props", port))
        .await.ok()?;
    let props: serde_json::Value = resp.json().await.ok()?;
    let template = props.get("chat_template")?.as_str()?;
    parse_thinking_tags_from_jinja(template)
}
```

This complements the existing infrastructure: catalog metadata (from catalog expansion) &gt; `/props` detection (this PRD) &gt; `FALLBACK_THINKING_TAGS` constant (this PRD).

### C. Replace All Inline Occurrences

| File | Change |
| --- | --- |
| `ai.rs` (lines 227, 286, 357, 415, 503, 558) | Replace string literals with `constants::DEFAULT_MODEL_*` |
| `ai_streaming.rs` (lines 204, 415, 593) | Same |
| `ai.rs` (lines 119, 252, 329) | Replace `"2023-06-01"` with `constants::ANTHROPIC_API_VERSION` |
| `ai_streaming.rs` (line 256) | Same |
| `ai_streaming.rs` (lines 247, 249, 473) | Replace web search literals with `constants::ANTHROPIC_WEB_SEARCH_*` / `OPENAI_WEB_SEARCH_TOOL` |
| `local_inference.rs` (lines 1168-1176, 1384-1391) | Replace inline arrays with `constants::FALLBACK_THINKING_TAGS` |
| `local_inference.rs` (lines 1125, 1331, 1453, 1487, 1489) | Replace `1.1` / `0.1` with `constants::REPEAT_PENALTY` / `FIM_TEMPERATURE` |
| `ai.rs` (lines 691, 749) | Replace `0.2` with `constants::CHAT_TEMPERATURE_FIM_FALLBACK` |
| `acp.rs` (lines 584, 586, 623, 667, 668) | Replace path literals with `constants::MACOS_FALLBACK_*` iteration |
| `copilot_lsp.rs` (lines 533, 534) | Same |
| `mcp.rs` (line 335) | Replace `"2024-11-05"` with `constants::MCP_PROTOCOL_VERSION` |
| `connections.ts` (lines 220-222) | Import from `constants.ts` |

### D. Frontend Constants

Create `src/lib/ai/constants.ts`:

```typescript
// Must match src-tauri/src/commands/constants.rs
export const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-4o',
  ollama: 'llama3.2',
} as const;
```

Update `connections.ts` to import from this file.

## Data Model

No new data models. No store changes. No new Tauri commands (the `/props` call is internal to `local_inference.rs`).

The only new types:

```rust
// In constants.rs — simple type alias for clarity
pub type ThinkingTagPair = (&'static str, &'static str);
```

## Dependencies

None. All changes use existing crates and APIs. The `/props` endpoint is already served by the bundled llama-server.

## Quality Gates

### Functional

- [x] All 9 default model references in `ai.rs` and `ai_streaming.rs` use constants — `grep` for raw model name strings returns only `constants.rs`

- [x] Both thinking tag fallback arrays in `local_inference.rs` replaced with `FALLBACK_THINKING_TAGS` reference

- [x] All 4 Anthropic API version headers use `ANTHROPIC_API_VERSION` constant

- [x] All macOS fallback paths in `acp.rs` and `copilot_lsp.rs` use shared constant arrays

- [x] `connections.ts` `DEFAULT_MODELS` imports from `constants.ts`

- [x] Dynamic thinking tag detection calls `/props` after model load and uses detected tags for custom models

- [x] Fallback to `FALLBACK_THINKING_TAGS` works when `/props` is unavailable or template has no thinking pattern

- [x] Catalog models still use their `thinking_tags` metadata (no regression from catalog expansion)

- [x] `pnpm tauri dev` compiles without errors

- [x] Existing AI chat, streaming, inline completions, and ACP all work unchanged

- [x] Local AI thinking model output still shows collapsible thinking section

- [x] Web search toggle still works for Anthropic and OpenAI

### Code Health

- [x] No raw string `"claude-sonnet"`, `"gpt-4o"`, or `"llama3.2"` outside `constants.rs` / `constants.ts`

- [x] No raw `"2023-06-01"` outside `constants.rs`

- [x] No raw `/opt/homebrew` outside `constants.rs`

- [x] No duplicate thinking tag arrays — single `FALLBACK_THINKING_TAGS` constant

- [x] `constants.rs` is the only file with AI tuning parameters (`repeat_penalty`, `temperature` for FIM)

## Out of Scope

- **Updating default model versions** (e.g., bumping to a newer Anthropic model) — that's a separate decision; this PRD just makes it easy
- **Verifying the Anthropic API version is current** — consolidate first, update version in a follow-up if needed
- **Model catalog restructuring** — already complete ([Model Catalog Expansion](2026-03-11-model-catalog-expansion.md))
- **GGUF header parsing** — already complete ([Model Metadata Enrichment](2026-03-11-model-metadata-enrichment.md))
- **Cross-platform binary paths** — Windows/Linux fallback paths deferred until those platforms ship
- **User-configurable repeat_penalty / temperature** — current values work well; configurability adds complexity without clear demand
- **Ollama model list query** for smart default — nice improvement but changes behavior, not just consolidation