# Hardcoded Values Audit

**Date:** 2026-03-10 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [hardcoded-values-cleanup](../prds/2026-03-15-hardcoded-values-cleanup.md) | Complete |
| Tasks | [hardcoded-values-cleanup-tasks](../tasks/2026-03-15-hardcoded-values-cleanup-tasks.md) | Complete (7/7) |
| Tasks | [hardcoded-values-remaining-tasks](../tasks/2026-03-17-hardcoded-values-remaining-tasks.md) | Complete (4/4) |

## Overview

Comprehensive audit of hardcoded values across the Notesage codebase that should be dynamic, configurable, or at minimum consolidated. Includes research on how other apps solve these problems and recommended fixes.

---

## 1. Thinking/Reasoning Tags — Local AI (HIGH PRIORITY) — DONE

> **Status:** Fully resolved. Deduplicated into `constants::FALLBACK_THINKING_TAGS`. Dynamic detection from `/props` chat_template implemented via `detect_thinking_tags_from_template()`. Catalog models use per-model `thinking_tags` metadata.

### Problem

`src-tauri/src/commands/local_inference.rs` has 7 hardcoded tag pairs **duplicated** in two places:

**Streaming parser (lines \~1030-1038):**

```rust
let thinking_tags: &[(&str, &str)] = &[
    ("<think>", "</think>"),
    ("<summary>", "</summary>"),
    ("<discussion>", "</discussion>"),
    ("<reflection>", "</reflection>"),
    ("<reasoning>", "</reasoning>"),
    ("<scratchpad>", "</scratchpad>"),
    ("<internal_thoughts>", "</internal_thoughts>"),
];
```

**Non-streaming stripper (lines \~1229-1237):** Identical array.

### Why This Is Bad

- New models may use different tags (e.g., `<analysis>`, `<contemplation>`, `<|think|>`)
- Adding a new tag pattern requires a code change and rebuild
- The 7 pairs are duplicated — maintenance risk
- Ollama already solved this dynamically

### How Other Apps Solve This

**Ollama** (`thinking/template.go` → `InferTags()`):

1. Checks model capabilities field for `"thinking"`
2. Scans the Jinja2 chat template for `{{.Thinking}}` and extracts surrounding delimiter tags
3. Falls back to model name/family heuristics
4. Has built-in parsers per model family for model-specific output formats

**LM Studio:**

- Auto-detects from GGUF metadata
- Supports `model.yaml` override files with `metadataOverrides` for capabilities

**Open WebUI:**

- Scans output stream for common patterns (`<think>`, `<reasoning>`, etc.)
- Similar to current Notesage approach but done at the UI layer

### Recommended Fix

**After llama-server loads a model, call** `GET /props` which returns:

```json
{
  "chat_template": "{% if ... %}",
  "default_generation_settings": { "n_ctx": 4096 }
}
```

Parse `chat_template` for thinking tag patterns (same strategy as Ollama's `InferTags`). Fall back to the current hardcoded list only if template parsing yields nothing.

**Immediate improvement:** At minimum, deduplicate the two identical arrays into a shared `const`.

### Contrast: Ollama Path (Already Good)

`ai_streaming.rs` uses runtime detection via `/api/show`:

1. Check for native `thinking` capability in model JSON
2. Extract tags from Go template if `.Thinking` field referenced
3. Fallback to hardcoded `<think>...</think>` for reasoning-named models

The only hardcoded part is the fallback at lines \~109-110, which is acceptable.

---

## 2. Model Catalog — Static at Compile Time (MEDIUM PRIORITY) — DONE

> **Status:** Fully resolved. Catalog expansion + metadata enrichment PRDs handled catalog models. GGUF-based FIM token detection for custom models added in [remaining Task 1](../tasks/2026-03-17-hardcoded-values-remaining-tasks.md) — parses `tokenizer.ggml.{prefix,suffix,middle}_token_id` from GGUF headers.

### Problem

`src-tauri/model-catalog.json` embeds 9 models with hardcoded:

- RAM requirements
- File sizes in bytes
- FIM (Fill-in-the-Middle) support flags
- Context lengths (implicit)
- HuggingFace URLs

All compiled into the binary via `include_str!("../../model-catalog.json")` at `local_inference.rs:98`.

### What GGUF Files Actually Contain

GGUF files have a rich key-value metadata header:

| Key | Type | Description |
| --- | --- | --- |
| `{arch}.context_length` | uint32 | Trained context window |
| `tokenizer.ggml.prefix_token_id` | uint32 | FIM prefix token |
| `tokenizer.ggml.suffix_token_id` | uint32 | FIM suffix token |
| `tokenizer.ggml.middle_token_id` | uint32 | FIM middle token |
| `tokenizer.chat_template` | string | Jinja2 template |
| `general.name` | string | Model display name |
| `general.architecture` | string | Architecture name |
| `general.file_type` | uint32 | Quantization type |

**FIM detection:** If all three FIM token IDs exist → model supports FIM. This is exactly how llama-server's `/infill` auto-detects FIM capability.

### How Other Apps Solve This

**llama.cpp:**

- Reads FIM tokens from GGUF header automatically
- `/infill` endpoint returns 501 if model lacks FIM tokens
- `/props` endpoint exposes `chat_template` and `n_ctx`

`@huggingface/gguf` **(npm package):**

- Parses GGUF metadata from files without full download (HTTP range requests)
- `const { metadata } = await gguf(url)` returns all key-value pairs
- Supports local files with `allowLocalFile: true`

**LM Studio:**

- Auto-populates model info from GGUF metadata
- Overridable via `model.yaml` files

### What llama-server Exposes via HTTP

`GET /props` **response:**

```json
{
  "assistant_name": "",
  "user_name": "",
  "default_generation_settings": {
    "n_ctx": 4096,
    "model": "model-name"
  },
  "total_slots": 1,
  "chat_template": "{% if ... %}"
}
```

**What's NOT in** `/props`**:** FIM token IDs, RAM requirements, architecture details, full GGUF metadata dump. There was a [feature request](https://github.com/ggml-org/llama.cpp/discussions/9341) for a `/metadata` endpoint but it hasn't been implemented.

### Recommended Fix

1. **After model download**, parse the GGUF file header in Rust to extract context length, FIM token presence, and chat template
2. **Cache this metadata** alongside the model file (e.g., `model-id.meta.json`)
3. **Keep** `model-catalog.json` for download URLs, descriptions, and RAM recommendations only
4. **Custom models** (`custom-models.json`) get auto-populated metadata on import
5. **After server loads**, call `GET /props` to confirm actual `n_ctx` (may differ from GGUF if user overrides `--ctx-size`)

**GGUF header parsing in Rust** is straightforward: magic number (4 bytes) → version (4 bytes) → tensor count (8 bytes) → KV count (8 bytes) → sequential key-value pairs with typed values. No external crate needed.

---

## 3. Default Model Names — Pinned & Duplicated (HIGH PRIORITY) — DONE

> **Status:** Fully resolved. All defaults centralized in `constants.rs` and `src/lib/ai/constants.ts`. All 9 references updated. Smart Ollama fallback added in [remaining Task 2](../tasks/2026-03-17-hardcoded-values-remaining-tasks.md) — queries `/api/tags` and picks first available model when default isn't pulled.

### Problem

Default models are hardcoded in **both** `ai.rs` and `ai_streaming.rs`:

| Provider | Default | Locations |
| --- | --- | --- |
| Anthropic | `claude-sonnet-4-5-20250929` | `ai.rs:227,286`, `ai_streaming.rs:204` |
| OpenAI | `gpt-4o` | `ai.rs:357,415`, `ai_streaming.rs:415` |
| Ollama | `llama3.2` | `ai.rs:503,558`, `ai_streaming.rs:593` |

Also in TypeScript: `src/lib/ai/connections.ts:220-222`:

```typescript
export const DEFAULT_MODELS: Partial<Record<ConnectionProvider, string>> = {
  anthropic: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-4o',
  ollama: 'llama3.2',
};
```

### Why This Is Bad

- Anthropic version will go stale (already happened: was `20250514`, now `20250929`)
- Duplicated across 3+ files — easy to miss one during updates
- Ollama default assumes `llama3.2` is pulled locally

### What APIs Offer

| Provider | API | Returns | Capabilities? |
| --- | --- | --- | --- |
| Anthropic | `GET /v1/models` | id, display_name, created_at | No |
| OpenAI | `GET /v1/models` | id, object, created, owned_by | No |
| Ollama | `GET /api/tags` | Locally pulled models with sizes | No |

Neither Anthropic nor OpenAI expose context window, tool support, or thinking capabilities via their model listing APIs. There's an [active community request](https://community.openai.com/t/expose-model-capabilities-in-the-v1-models-api-response/1314117) for OpenAI to add this.

### Recommended Fix

1. **Consolidate** all defaults into a single `constants.rs` file (or shared module)
2. **Frontend** should import from a single source of truth
3. **For Ollama**, query `/api/tags` and use first available model if default isn't pulled
4. **For Anthropic/OpenAI**, curated mapping is the only option — but keep it in one place

---

## 4. Anthropic API Version Header (MEDIUM PRIORITY) — DONE

> **Status:** Centralized into `constants::ANTHROPIC_API_VERSION`. Verified `2023-06-01` is the latest stable version per Anthropic's API docs — no update needed.

### Problem

`ai_streaming.rs:256`: `"anthropic-version": "2023-06-01"` — nearly 3 years old.

While Anthropic maintains backward compatibility, newer features (extended thinking, improved tool use, token counting) may require a newer API version.

### Recommended Fix

Move to a `const ANTHROPIC_API_VERSION: &str = "2023-06-01"` in a shared constants file. Review Anthropic's changelog for the latest stable version.

---

## 5. NPM/Binary Path Lookups — macOS-Only (HIGH for cross-platform) — DONE

> **Status:** Fully resolved. Both files now use dynamic PATH resolution via `shell_path.rs`. Hardcoded macOS paths moved to `constants::MACOS_FALLBACK_BIN_PATHS` as last-resort fallbacks only. Cross-platform paths deferred until Windows/Linux ship.

### Problem

`acp.rs:584-626` and `copilot_lsp.rs:687-717` hardcode macOS-specific paths:

```
/opt/homebrew/bin
/opt/homebrew/lib/node_modules/.bin
/usr/local/bin
/usr/local/lib/node_modules/.bin
```

**Duplicated** across two files. Completely breaks on Windows/Linux.

### How Other Apps Solve This

- Use `which` (Unix) / `where` (Windows) command
- Parse `PATH` environment variable
- Check `npm root -g` for global node_modules location
- Use `volta`, `fnm`, `nvm` detection for managed Node installs

### Recommended Fix

1. Extract into a shared `resolve_binary(name: &str)` utility
2. Use `which` crate or shell `which`/`where` command
3. Parse `PATH` env var as primary strategy
4. Keep hardcoded paths as last-resort fallbacks only
5. Add Windows paths (`%APPDATA%\npm`, `%ProgramFiles%\nodejs`)

---

## 6. Whisper Model File Sizes (LOW PRIORITY) — DONE

> **Status:** Updated hardcoded sizes to exact byte values from HuggingFace CDN `Content-Length` headers → [Task 3 in remaining tasks](../tasks/2026-03-17-hardcoded-values-remaining-tasks.md). Downloaded models already use `fs::metadata` for actual size.

### Problem

`transcription.rs:94-100` has hardcoded file sizes:

```rust
("tiny", 75_000_000),
("base", 142_000_000),
("small", 466_000_000),
("medium", 1_528_000_000),
("large-v3", 3_095_000_000),
```

These are approximate and could drift from actual HuggingFace file sizes.

### Recommended Fix

Query `Content-Length` header from HuggingFace during download (already making the HTTP request). Use hardcoded values only for pre-download size estimates in the UI.

---

## 7. Web Search Tool Identifiers (LOW but fragile) — DONE

> **Status:** Fully resolved. Centralized into `constants::ANTHROPIC_WEB_SEARCH_TOOL`, `constants::ANTHROPIC_WEB_SEARCH_MAX_USES`, and `constants::OPENAI_WEB_SEARCH_TOOL`.

### Problem

- `ai_streaming.rs:247`: `"web_search_20250305"` (Anthropic)
- `ai_streaming.rs:473`: `"web_search_preview"` (OpenAI)
- `ai_streaming.rs:249`: `"max_uses": 5` (Anthropic web search limit)

### Assessment

No dynamic alternative exists — providers don't expose tool catalogs via API. These are unlikely to change frequently, but should be easy to update (move to constants).

---

## 8. Other Hardcoded Values

### Acceptable — No Action Needed

| Value | Location | Reason |
| --- | --- | --- |
| HTTP timeout `300s` | `ai.rs`, `ai_streaming.rs` | Standard for AI streaming |
| Self-write TTL `5s` | `watcher.rs:21` | Well-documented, covers FSEvents + iCloud |
| Debounce `500ms` | `watcher.rs` | Internal implementation detail |
| FIM context `500` chars | `settings-store.ts` | Already configurable via UI slider |
| CSS color variables | `globals.css` | Centralized, dynamic via themes |
| Path construction | Various | Uses `dirs` crate, dynamic |
| Silence RMS threshold `0.005` | `transcription.rs` | Audio engineering constant |
| Script timeout `30s`/`300s` | `skills.rs` | Clamped range with sensible defaults |

### Could Improve (Low Priority)

| Value | Location | Fix |
| --- | --- | --- |
| Max restart attempts `3` | `useLocalAI.ts:149` | Move to settings-store |
| Health check interval `30s` | `useLocalAI.ts:143` | Move to settings-store |
| Chat flush interval `50ms` | `useAIOperations.ts:899` | Move to constants |
| `repeat_penalty: 1.1` | `local_inference.rs` | Move to model catalog metadata |
| FIM `temperature: 0.1-0.2` | `ai.rs`, `local_inference.rs` | Move to constants |
| Max web search uses `5` | `ai_streaming.rs:249` | Move to constants |
| MCP protocol version `"2024-11-05"` | `mcp.rs:467` | Move to constants |

---

## Priority Action Items — Status

### High Priority — ALL DONE

1. **~~Thinking tags~~** ~~→ Parse from llama-server~~ `/props` `chat_template` ~~dynamically; deduplicate shared constant as immediate fix~~ ✅
2. **~~Default model names~~** ~~→ Consolidate to single constants file, remove duplication between~~ `ai.rs` ~~and~~ `ai_streaming.rs` ✅
3. **~~NPM binary paths~~** ~~→ Use~~ `which`~~/~~`PATH` ~~instead of hardcoded macOS paths; extract shared utility~~ ✅

### Medium Priority — ALL DONE

4. **~~Model catalog FIM/context~~** ~~→ Read from GGUF file headers instead of static JSON~~ ✅ (catalog expansion + metadata enrichment PRDs + GGUF FIM token detection)
5. **~~Anthropic API version~~** ~~→ Move to shared constant~~ ✅ (centralized; `2023-06-01` confirmed as latest stable)
6. **~~Model metadata caching~~** ~~→ Parse GGUF headers on download, cache as~~ `.meta.json` ✅ (metadata enrichment PRD)

### Low Priority — ALL DONE

7. ~~Whisper model sizes → Updated to exact byte values from HuggingFace~~ ✅
8. ~~Web search tool names → Move to constants file~~ ✅
9. ~~Various magic numbers → Extract to named constants~~ ✅

---

## Research Sources

- [GGUF format documentation — Hugging Face](https://huggingface.co/docs/hub/en/gguf)
- [@huggingface/gguf npm package](https://huggingface.co/docs/huggingface.js/en/gguf/README)
- [GGUF specification — ggml-org](https://github.com/ggml-org/ggml/blob/master/docs/gguf.md)
- [llama-server README (GET /props docs)](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [llama-server /metadata endpoint request](https://github.com/ggml-org/llama.cpp/discussions/9341)
- [Ollama thinking model support](https://docs.ollama.com/capabilities/thinking)
- [Ollama InferTags source](https://deepwiki.com/ollama/ollama/5.5-sampling-and-token-generation)
- [LM Studio model.yaml docs](https://lmstudio.ai/docs/app/modelyaml)
- [Anthropic List Models API](https://docs.anthropic.com/en/api/models-list)
- [OpenAI List Models API](https://platform.openai.com/docs/api-reference/models/list)
- [OpenAI community request for capabilities API](https://community.openai.com/t/expose-model-capabilities-in-the-v1-models-api-response/1314117)