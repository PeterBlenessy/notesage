# Tasks: Hardcoded Values — Remaining Items

**Source:** [docs/research/hardcoded-values-audit.md](../research/hardcoded-values-audit.md)
**Prior work:** [docs/tasks/2026-03-15-hardcoded-values-cleanup-tasks.md](2026-03-15-hardcoded-values-cleanup-tasks.md) (all 7 tasks complete)
**Total:** 4 tasks (3S, 1M) — **All complete**

## Context

The original hardcoded values cleanup (tasks #1–#7) centralized constants into `constants.rs` / `constants.ts` and added dynamic thinking tag detection. These remaining items are lower-priority improvements identified in the audit that weren't in scope for the original cleanup.

---

## Task 1: GGUF-based FIM detection for custom models — DONE

**Complexity:** M | **Category:** backend | **Dependencies:** none

**Description:**

Custom models added via `custom-models.json` currently have no way to indicate FIM support — only catalog models have the `supports_fim` flag. The GGUF parser (`gguf_parser.rs`) already reads headers on download, but doesn't check for FIM token IDs.

**What was done:**

1. Added `supports_fim: Option<bool>` field to `GgufMetadata` struct in `gguf_parser.rs`
2. After parsing architecture-specific keys, checks for all three FIM token keys (`tokenizer.ggml.prefix_token_id`, `suffix_token_id`, `middle_token_id`) — if all present, sets `supports_fim: Some(true)`
3. Added `supports_fim: Option<bool>` to `ModelMetadata` in `model_metadata.rs`
4. Surfaced GGUF FIM detection in the metadata merge pipeline (Source 3: GGUF header)

**Files:**

- `src-tauri/src/commands/gguf_parser.rs`
- `src-tauri/src/commands/model_metadata.rs`

---

## Task 2: Smart Ollama default model fallback — DONE

**Complexity:** S | **Category:** backend | **Dependencies:** none

**Description:**

The Ollama default model is `llama3.2` (in `constants.rs`), but if the user hasn't pulled that specific model, requests silently fail.

**What was done:**

1. Added `pub async fn resolve_ollama_model(base_url, requested)` in `ai.rs` that:
   - Returns the requested model if provided
   - Queries `GET {base_url}/api/tags` with a 5s timeout
   - Checks if `DEFAULT_MODEL_OLLAMA` is in the available models list (prefix match to handle `:latest` suffix)
   - Falls back to the first available model if default isn't pulled
   - Falls back to `DEFAULT_MODEL_OLLAMA` if `/api/tags` fails or returns empty
2. Replaced all three `.unwrap_or(constants::DEFAULT_MODEL_OLLAMA)` calls with `resolve_ollama_model()`:
   - `ai.rs`: `ollama_generate()` and `ollama_chat()`
   - `ai_streaming.rs`: `ollama_chat_stream()` (calls `super::ai::resolve_ollama_model`)

**Files:**

- `src-tauri/src/commands/ai.rs`
- `src-tauri/src/commands/ai_streaming.rs`

---

## Task 3: Whisper model sizes from Content-Length — DONE

**Complexity:** S | **Category:** backend | **Dependencies:** none

**Description:**

`transcription.rs` had approximate hardcoded file sizes for Whisper models that didn't match actual HuggingFace values.

**What was done:**

1. Retrieved exact file sizes via `Content-Length` headers from HuggingFace CDN (HEAD requests to `huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{size}.bin`)
2. Updated `KNOWN_MODELS` array with verified byte-exact sizes:
   - tiny: 77,691,713 (was 75,000,000)
   - base: 147,951,465 (was 142,000,000)
   - small: 487,601,967 (was 466,000,000)
   - medium: 1,533,763,059 (was 1,500,000,000)
   - large-v3: 3,095,033,483 (was 2,900,000,000)
3. Added comment noting the source and date of the values

**Files:**

- `src-tauri/src/commands/transcription.rs`

---

## Task 4: Update Anthropic API version — NO CHANGE NEEDED

**Complexity:** S | **Category:** backend | **Dependencies:** none

**Description:**

Investigated whether the Anthropic API version `2023-06-01` needs updating.

**Finding:**

Checked Anthropic's API versioning docs (platform.claude.com/docs/en/api/versioning). There are only two API versions:
- `2023-01-01`: Initial release
- `2023-06-01`: Current latest (incremental SSE, named events)

`2023-06-01` is already the latest stable version. No update needed. The constant in `constants.rs` is correct.
