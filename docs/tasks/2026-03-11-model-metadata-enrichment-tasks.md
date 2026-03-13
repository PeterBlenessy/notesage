# Tasks: Model Metadata Enrichment

**PRD:** `docs/prds/2026-03-11-model-metadata-enrichment.md`

**Total: 9 tasks — 2S, 4M, 3L — ALL DONE ✓**

**Suggested order:** Tasks 1-2 in parallel (backend data enrichment), then 3-4 (backend parsers/fetchers), then 5 (merge command), then 6-7 (frontend), then 8-9 (runtime + post-download).

**Risks:**

- GGUF header parsing complexity — some quantizers may use non-standard value types or deeply nested keys. Start with the well-documented types and handle unknowns gracefully.
- HF API rate limits — unauthenticated requests may get throttled. Cache-first strategy mitigates this.
- Not all GGUF files populate `general.author`/`general.license` — catalog fallback is essential.

---

### #1 — Enrich `model-catalog.json` with metadata fields ✅ DONE

**Description:** Add `author`, `organization`, `license`, `parameters`, `architecture`, `context_length`, `quantization`, and `hf_repo_id` to all 9 entries in `model-catalog.json`. Values can be looked up from each model's HF repo page. Update `CatalogEntry` and `LocalModelInfo` Rust structs with matching optional fields. Update the `LocalModelInfo` TypeScript interface in `tauri.ts`.

**Acceptance criteria:**

- [x] All 9 models have the new fields populated

- [x] `CatalogEntry` / `LocalModelInfo` structs compile with new `Option<>` fields

- [x] `list_local_models` returns the new fields (existing behavior unchanged)

- [x] TypeScript interface matches Rust struct

**Complexity:** M **Category:** both **Dependencies:** None **Files:**

- `src-tauri/model-catalog.json`
- `src-tauri/src/commands/local_inference.rs` (structs)
- `src/lib/tauri.ts` (interface)

---

### #2 — Add Whisper model metadata defaults ✅ DONE

**Description:** Replace the hardcoded `KNOWN_MODELS: &[(&str, u64)]` in `transcription.rs` with a richer struct that includes `author`, `license`, `parameters`, `hf_repo_id`, and `languages_count`. Return these new fields from `list_whisper_models`. Update `ModelInfo` TypeScript interface. Remove `MODEL_DETAILS` from `TranscriptionSettings.tsx` (now served from backend).

**Acceptance criteria:**

- [x] `list_whisper_models` returns `author: "OpenAI"`, `license: "MIT"`, `parameters: "244M"` etc. for each model

- [x] Frontend `MODEL_DETAILS` map eliminated — all display data comes from the backend

- [x] Existing UI still renders correctly with the new data source

**Complexity:** M **Category:** both **Dependencies:** None **Files:**

- `src-tauri/src/commands/transcription.rs` (struct + catalog)
- `src/lib/tauri.ts` (ModelInfo interface)
- `src/components/settings/TranscriptionSettings.tsx` (remove `MODEL_DETAILS`, use backend fields)
- `src/stores/recording-store.ts` (ModelInfo interface)

---

### #3 — Implement GGUF header parser ✅ DONE

**Description:** Write a minimal GGUF binary header parser in a new file `src-tauri/src/commands/gguf_parser.rs`. Parse magic number, version, metadata KV pairs. Support value types: uint8, int8, uint16, int16, uint32, int32, float32, uint64, int64, float64, bool, string, array. Extract display-relevant keys (`general.*`, `{arch}.*`). Return a `GgufMetadata` struct. Cache parsed results to `~/.notesage/cache/model-metadata/gguf/{model_id}.json` with mtime check.

**Acceptance criteria:**

- [x] Can parse GGUF v2 and v3 headers

- [x] Extracts `general.name`, `general.author`, `general.organization`, `general.license`, `general.size_label`, `general.quantized_by`, `general.file_type`, `general.description`, `general.languages`, `general.base_model.0.name`, `{arch}.context_length`, `{arch}.block_count`, `{arch}.embedding_length`

- [x] Gracefully handles missing keys (returns `None`)

- [x] Stops reading after metadata section (doesn't touch tensor data)

- [x] Cache file written and read back correctly

- [x] Mtime-based invalidation works

**Complexity:** L **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/src/commands/gguf_parser.rs` (new)
- `src-tauri/src/commands/mod.rs` (add module)

---

### #4 — Implement HF API metadata fetcher ✅ DONE

**Description:** Add `fetch_hf_metadata` Tauri command. HTTP GET to `https://huggingface.co/api/models/{repo_id}`, extract relevant fields (`author`, `cardData.license`, `cardData.base_model`, `gguf.total`, `gguf.architecture`, `gguf.context_length`, `downloads`, `lastModified`). Cache response to `~/.notesage/cache/model-metadata/hf/{repo_id}.json` with 24h TTL. Include a helper to derive `repo_id` from a `huggingface_url`.

**Acceptance criteria:**

- [x] Fetches and parses HF API response correctly

- [x] `repo_id` derived from URLs like `https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/file.gguf`

- [x] Cached responses returned without network call when TTL is fresh

- [x] Network failures return cached data (if available) or empty metadata (not an error)

- [x] Rate limit (429) handled gracefully

- [x] Works for both LLM repos and `ggerganov/whisper.cpp`

**Complexity:** M **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/src/commands/model_metadata.rs` (new — houses HF fetcher, merge logic, and Tauri commands)
- `src-tauri/src/commands/mod.rs` (add module)

---

### #5 — Implement metadata merge command ✅ DONE

**Description:** Add `get_model_metadata` Tauri command in `model_metadata.rs`. For a given model ID and type (`llm` | `whisper`), merge metadata from: catalog defaults → HF API cache → GGUF header cache → runtime cache. Return a unified `ModelMetadata` struct. Add `get_runtime_model_metadata` command that queries the running llama-server's `/v1/models` endpoint and caches the result.

**Acceptance criteria:**

- [x] `get_model_metadata` returns merged data with later sources overriding earlier

- [x] For a not-yet-downloaded LLM: returns catalog + HF API data

- [x] For a downloaded LLM: returns catalog + HF + GGUF data

- [x] For a running LLM: returns catalog + HF + GGUF + runtime data

- [x] For Whisper models: returns catalog + HF data (no GGUF parsing)

- [x] `_sources` field tracks which sources contributed

- [x] Runtime metadata fetched from `http://localhost:{port}/v1/models`

- [x] All commands registered in `lib.rs` `generate_handler![]`

**Complexity:** M **Category:** backend **Dependencies:** #1, #2, #3, #4 **Files:**

- `src-tauri/src/commands/model_metadata.rs`
- `src-tauri/src/lib.rs` (register commands)

---

### #6 — Build `ModelMetadataTooltip` component ✅ DONE

**Description:** Create a shared React component that wraps a model card and shows a rich tooltip on hover. Uses shadcn/ui `Tooltip`. Fetches metadata via the `get_model_metadata` Tauri command. Displays: name, author/organization, parameters, architecture, context length, quantization, license, HF link. Handles loading (subtle "Loading..." text) and graceful degradation (show whatever fields are available).

**Acceptance criteria:**

- [x] Tooltip renders with structured layout matching PRD wireframes

- [x] HF link opens in default browser via Tauri shell

- [x] Loading state shows "Loading..." not a spinner

- [x] Missing fields are omitted (not shown as "N/A")

- [x] Works in both light and dark mode

- [x] Monochrome styling per design system

- [x] Tooltip width \~280px, doesn't overflow

**Complexity:** L **Category:** frontend **Dependencies:** #5 **Files:**

- `src/components/settings/ModelMetadataTooltip.tsx` (new)

---

### #7 — Integrate tooltips into settings panels ✅ DONE

**Description:** Wrap model card rows in `LocalAISettings.tsx` and `TranscriptionSettings.tsx` with `ModelMetadataTooltip`. Add `useModelMetadata` hook that batch-fetches metadata for all visible models when the settings panel mounts. Pass pre-fetched metadata to tooltips to avoid per-hover network calls.

**Acceptance criteria:**

- [x] Every Local AI model card shows tooltip on hover

- [x] Every Whisper model card shows tooltip on hover

- [x] Metadata fetched once when settings tab opens (not per-hover)

- [x] No visual changes to model cards themselves

- [x] Tooltip position: `side="right"` for Local AI, `side="top"` for Whisper

- [x] Existing action buttons (download, delete, use) still work — tooltip doesn't interfere

**Complexity:** L **Category:** frontend **Dependencies:** #6 **Files:**

- `src/components/settings/LocalAISettings.tsx`
- `src/components/settings/TranscriptionSettings.tsx`
- `src/hooks/useModelMetadata.ts` (new)

---

### #8 — Wire up runtime metadata on model load ✅ DONE

**Description:** In the `useLocalAI` hook, after the server reports healthy, call `get_runtime_model_metadata` to fetch live stats from `/v1/models`. Cache the result. When the tooltip is shown for the active model, runtime data (authoritative parameter count, context length) overrides other sources.

**Acceptance criteria:**

- [x] Runtime metadata fetched automatically when server becomes healthy

- [x] Tooltip for active/running model shows runtime-sourced parameter count and context length

- [x] `_sources` includes `"runtime"` when live data is available

- [x] No extra network calls if server is not running

**Complexity:** S **Category:** frontend **Dependencies:** #5, #7 **Files:**

- `src/hooks/useLocalAI.ts`
- `src/hooks/useModelMetadata.ts`

---

### #9 — Auto-parse GGUF after model download ✅ DONE

**Description:** After a successful model download in `local_inference.rs`, automatically trigger GGUF header parsing and cache the result. This ensures metadata is ready before the user next hovers over the model card. Also trigger parsing for existing downloaded models on first `get_model_metadata` call (lazy backfill).

**Acceptance criteria:**

- [x] Newly downloaded models have GGUF metadata cached immediately

- [x] Previously downloaded models get parsed on first metadata request

- [x] Custom models get GGUF metadata after download

- [x] Parse errors don't block the download flow (log warning, continue)

**Complexity:** S **Category:** backend **Dependencies:** #3, #5 **Files:**

- `src-tauri/src/commands/local_inference.rs` (post-download hook)
- `src-tauri/src/commands/model_metadata.rs` (lazy backfill)