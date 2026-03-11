# PRD: Dynamic Model Metadata Enrichment

## Problem

Users see minimal information about AI models in Settings — just a name, file size, and a one-line description. They can't see the model's author, license, parameter count, architecture, context window, or quantization level without leaving the app. This makes it hard to make informed decisions about which model to download or use, especially for Local AI models where 9 options exist with varying trade-offs.

Whisper models show even less — no attribution to OpenAI, no license info, no link to the source. All display metadata is hardcoded in the frontend, making it brittle and requiring code changes to update.

## Goals

1. **Rich hover tooltips** on model cards in both Local AI and Whisper settings, showing author/organization, license, parameter count, architecture, context window, quantization, and a link to the HF source page.
2. **Three-tier data strategy** — no single point of failure:
   - **Pre-download:** Metadata from Hugging Face API (or enriched catalog) so users see details before committing to a download.
   - **Post-download:** Authoritative metadata parsed from the GGUF/GGML file header on disk.
   - **Runtime (LLM only):** Live stats from the llama-server `/v1/models` endpoint when the model is loaded.
3. **Eliminate hardcoded display metadata** — `MODEL_DETAILS` in `TranscriptionSettings.tsx` and inline descriptions in `model-catalog.json` should be supplemented (not replaced) by dynamically fetched data.
4. **Metadata caching** — fetched HF API data and parsed GGUF headers cached to disk so tooltips are instant after first fetch.
5. **Custom model support** — user-added custom models also get metadata via GGUF parsing and HF API (when URL is a HF link).

## Non-Goals

- **Model recommendation engine** — no AI-powered "pick the best model for you" wizard.
- **Model comparison view** — side-by-side comparison table is out of scope.
- **Auto-updating catalog from HF** — the curated catalog remains manually maintained; this PRD only adds metadata enrichment.
- **Whisper model selection expansion** — no new Whisper model sizes or variants.
- **Model benchmarks or quality scores** — no performance metrics beyond what HF/GGUF provides.

## User Stories

1. **As a user browsing Local AI models**, I want to hover over a model card and see its author, license, parameter count, architecture, and context window, so I can decide which model to download without searching the web.
2. **As a user with a downloaded model**, I want to see verified metadata from the actual GGUF file (not just the catalog), so I know exactly what I have on disk.
3. **As a user browsing Whisper models**, I want to see that these are OpenAI models under MIT license with a link to the HF source, so I understand the provenance.
4. **As a user who added a custom model**, I want to see its metadata extracted from the GGUF header after download, so I get the same rich information as catalog models.
5. **As a user on a slow connection**, I want metadata to be cached locally so tooltips appear instantly after the first load.

## Technical Approach

### Data Sources & Priority

For each model, metadata is merged from multiple sources with later sources overriding earlier ones:

```
Catalog defaults (compile-time) → HF API cache → GGUF header cache → Runtime API
```

#### Source 1: Enriched Catalog (compile-time)

Add new optional fields to `model-catalog.json` entries. These serve as fallback defaults when the network is unavailable and no GGUF has been downloaded:

```json
{
  "id": "qwen3-4b",
  "name": "Qwen3 4B",
  "author": "Qwen",
  "organization": "Alibaba",
  "license": "apache-2.0",
  "parameters": "4B",
  "architecture": "qwen3",
  "context_length": 32768,
  "quantization": "Q4_K_M",
  "hf_repo_id": "Qwen/Qwen3-4B-GGUF",
  ...existing fields...
}
```

A maintenance script (or manual process) can populate these from the HF API. They are static fallbacks, not the primary data source.

#### Source 2: Hugging Face API (pre-download, cached)

`GET https://huggingface.co/api/models/{repo_id}` returns:

| HF Field | Maps to | Notes |
| --- | --- | --- |
| `author` | `author` | Repo owner (may be quantizer, not original author) |
| `cardData.license` | `license` | SPDX identifier |
| `cardData.base_model` | `base_model` | Original model repo |
| `gguf.total` | `parameters` | Total parameter count (integer) |
| `gguf.architecture` | `architecture` | e.g. "qwen2", "llama" |
| `gguf.context_length` | `context_length` | Training context window |
| `lastModified` | `last_modified` | ISO 8601 timestamp |
| `downloads` | `downloads` | Download count (popularity signal) |

**Rate limits:** HF API is unauthenticated, rate-limited. Fetch lazily (on settings panel open), cache aggressively (24h TTL).

**Repo ID derivation:** Extract from existing `huggingface_url` field:

- `https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf` → `Qwen/Qwen3-4B-GGUF`

#### Source 3: GGUF File Header Parsing (post-download)

Parse the GGUF binary header from downloaded model files. Only reads the first few KB — no need to load the full model.

Key fields to extract:

| GGUF Key | Maps to |
| --- | --- |
| `general.name` | `name` |
| `general.author` | `author` |
| `general.organization` | `organization` |
| `general.license` | `license` |
| `general.size_label` | `parameters` |
| `general.quantized_by` | `quantized_by` |
| `general.file_type` | `quantization` (enum → string mapping) |
| `general.description` | `description` |
| `general.languages` | `languages` |
| `general.base_model.0.name` | `base_model` |
| `{arch}.context_length` | `context_length` |
| `{arch}.block_count` | `block_count` |
| `{arch}.embedding_length` | `embedding_length` |

**Caveat:** Not all quantizers populate all fields. Community quants (lmstudio-community, bartowski) tend to be thorough; official quants sometimes sparse. The catalog fallback handles gaps.

**GGML (Whisper):** GGML is an older format with less structured metadata. For Whisper models, only basic info is available from the file itself. HF API and catalog defaults are the primary sources.

#### Source 4: llama-server `/v1/models` (runtime, LLM only)

When llama-server is running with a loaded model:

| API Field | Maps to |
| --- | --- |
| `data[0].meta.n_params` | `parameters` (authoritative) |
| `data[0].meta.n_ctx_train` | `context_length` (authoritative) |
| `data[0].meta.n_embd` | `embedding_length` |
| `data[0].meta.n_vocab` | `vocab_size` |
| `data[0].meta.size` | `file_size` (actual) |

This is the most authoritative source but only available when the model is loaded and running.

### Caching Strategy

Metadata is cached to `~/.notesage/cache/model-metadata/`:

```
~/.notesage/cache/model-metadata/
├── hf/
│   ├── Qwen--Qwen3-4B-GGUF.json       # HF API response (24h TTL)
│   └── ggerganov--whisper.cpp.json     # Whisper HF API response
├── gguf/
│   ├── qwen3-4b.json                   # Parsed GGUF header (no TTL — re-parsed on model change)
│   └── qwen2.5-coder-1.5b.json
└── runtime/
    └── active-model.json               # Last runtime API response (refreshed on model load)
```

- **HF cache:** 24-hour TTL. Refreshed lazily when settings panel opens.
- **GGUF cache:** No expiry. Re-parsed only when model file changes (mtime check).
- **Runtime cache:** Refreshed each time a model is loaded. Persists for tooltip display when server is stopped.

### Merged Metadata Type

```typescript
interface ModelMetadata {
  // Identity
  author?: string;           // Model creator (e.g., "Qwen", "OpenAI")
  organization?: string;     // Parent organization (e.g., "Alibaba", "Microsoft")
  license?: string;          // SPDX identifier (e.g., "apache-2.0", "MIT")
  base_model?: string;       // Original model if this is a quantization
  quantized_by?: string;     // Who quantized it (e.g., "lmstudio-community")

  // Technical
  parameters?: string;       // "4B", "1550M" — human-readable
  parameters_raw?: number;   // 4000000000 — for sorting/comparison
  architecture?: string;     // "qwen2", "llama", "phi3"
  context_length?: number;   // Training context window in tokens
  quantization?: string;     // "Q4_K_M", "Q8_0"
  embedding_length?: number; // Embedding dimension
  vocab_size?: number;       // Vocabulary size
  block_count?: number;      // Transformer layers
  languages?: string[];      // ISO 639 codes

  // Provenance
  hf_repo_id?: string;       // "Qwen/Qwen3-4B-GGUF"
  hf_repo_url?: string;      // Full URL to HF model page
  last_modified?: string;    // ISO 8601
  downloads?: number;        // HF download count

  // Source tracking
  _sources?: string[];       // ["catalog", "hf_api", "gguf_header", "runtime"]
}
```

### New Tauri Commands

#### `get_model_metadata`

Returns merged metadata for a model, checking cache first, then fetching as needed.

```rust
#[tauri::command]
async fn get_model_metadata(
    model_id: String,
    model_type: String,  // "llm" | "whisper"
) -> Result<ModelMetadata, String>
```

Merges: catalog defaults → HF cache (if fresh) → GGUF cache (if downloaded) → runtime cache (if available).

#### `fetch_hf_metadata`

Fetches model metadata from Hugging Face API and caches it.

```rust
#[tauri::command]
async fn fetch_hf_metadata(
    repo_id: String,
) -> Result<HfModelMetadata, String>
```

#### `parse_gguf_metadata`

Parses GGUF file header and caches the result.

```rust
#[tauri::command]
async fn parse_gguf_metadata(
    file_path: String,
) -> Result<GgufMetadata, String>
```

#### `get_runtime_model_metadata`

Queries the running llama-server's `/v1/models` endpoint.

```rust
#[tauri::command]
async fn get_runtime_model_metadata(
    port: u16,
) -> Result<RuntimeModelMetadata, String>
```

### GGUF Parser (Rust)

Implement a minimal GGUF header parser in Rust. The format is well-documented:

1. Read magic number (`GGUF` = `0x46475547`)
2. Read version (uint32)
3. Read tensor count (uint64) and metadata KV count (uint64)
4. For each KV pair: read key (string), value type (uint32), value (typed)
5. Stop after metadata — don't read tensor data

Only need to read the first few KB of the file. No external crate required — the format is simple enough for a \~200-line parser.

For GGML (Whisper models): the format is simpler but has no structured KV metadata. Only magic number and basic tensor info. Metadata for Whisper comes from catalog and HF API, not file parsing.

### Frontend Changes

#### Tooltip Component

A shared `ModelMetadataTooltip` component used by both `LocalAISettings` and `TranscriptionSettings`:

```tsx
<ModelMetadataTooltip modelId="qwen3-4b" modelType="llm">
  <div className="...existing model card...">
    ...
  </div>
</ModelMetadataTooltip>
```

The tooltip fetches metadata lazily (on hover or settings panel mount) via the `get_model_metadata` Tauri command and displays it in a structured layout.

#### Tooltip Content Layout

```
┌──────────────────────────────────────┐
│  Qwen3 4B                           │
│  by Qwen · Alibaba                  │
│                                      │
│  Parameters    4B                    │
│  Architecture  qwen3                 │
│  Context       32,768 tokens         │
│  Quantization  Q4_K_M               │
│  License       Apache 2.0            │
│                                      │
│  ↗ View on Hugging Face              │
│  Sources: catalog, gguf              │
└──────────────────────────────────────┘
```

For Whisper:

```
┌──────────────────────────────────────┐
│  Whisper Small                       │
│  by OpenAI                           │
│                                      │
│  Parameters    244M                  │
│  Languages     99 supported          │
│  Format        GGML (whisper.cpp)    │
│  License       MIT                   │
│                                      │
│  ↗ View on Hugging Face              │
└──────────────────────────────────────┘
```

#### Hook: `useModelMetadata`

```typescript
function useModelMetadata(modelId: string, modelType: 'llm' | 'whisper') {
  // Fetches metadata on mount, caches in a local Map
  // Returns { metadata: ModelMetadata | null, loading: boolean }
}
```

Batch-fetches all models when settings panel opens (single pass, not per-hover).

## UI/UX

- **Trigger:** Hover over the model card row (entire row is the tooltip trigger area).
- **Delay:** 300ms (matches existing `TooltipProvider` delay).
- **Position:** Side `"right"` for Local AI (cards are left-aligned), side `"top"` for Whisper (cards span full width).
- **Style:** Standard shadcn/ui `TooltipContent` with slightly wider max-width (\~280px). Monochrome, consistent with design system.
- **Loading state:** Show a subtle skeleton or "Loading..." if metadata hasn't been fetched yet. No spinner.
- **Error state:** If HF API fails, show whatever is available from catalog/GGUF. Never show an error tooltip — graceful degradation.
- **HF link:** Small external link icon, opens in default browser. Uses `general.repo_url` from GGUF if available, otherwise constructed from `hf_repo_id`.

## Data Model

### New fields on `model-catalog.json` entries

```json
{
  "author": "string (optional)",
  "organization": "string (optional)",
  "license": "string (optional)",
  "parameters": "string (optional, e.g. '4B')",
  "architecture": "string (optional)",
  "context_length": "number (optional)",
  "quantization": "string (optional)",
  "hf_repo_id": "string (optional)"
}
```

### Extended Rust structs

- `ModelMetadata` — merged metadata result (new struct)
- `HfModelMetadata` — raw HF API response fields (new struct)
- `GgufMetadata` — parsed GGUF header fields (new struct)
- `RuntimeModelMetadata` — llama-server `/v1/models` response fields (new struct)

### Extended TypeScript interfaces

- `ModelMetadata` — mirrors Rust `ModelMetadata`
- Existing `LocalModelInfo` and `ModelInfo` (Whisper) unchanged — metadata is fetched separately, not embedded in the model list response.

### No new Zustand stores

Metadata is ephemeral (fetched when settings panel is open, cached on disk by the backend). A simple React hook with local state is sufficient.

## Dependencies

- **No new crates** — GGUF parsing is simple enough to implement inline (\~200 lines). HTTP for HF API uses existing `reqwest`.
- **No new npm packages** — uses existing shadcn/ui `Tooltip` component.

## Implementation Steps

### Step 1: Enriched catalog defaults

Add `author`, `organization`, `license`, `parameters`, `architecture`, `context_length`, `quantization`, `hf_repo_id` to `model-catalog.json` for all 9 models. Add similar hardcoded defaults for the 5 Whisper models in the Rust backend.

### Step 2: GGUF header parser

Implement `parse_gguf_header()` in Rust — reads GGUF magic, version, metadata KV pairs. Extract display-relevant fields. Cache result to `~/.notesage/cache/model-metadata/gguf/`.

### Step 3: HF API client

Implement `fetch_hf_metadata()` — HTTP GET to HF API, extract relevant fields, cache to disk with 24h TTL. Handle rate limits gracefully (return cached or empty).

### Step 4: Metadata merge + Tauri commands

Implement `get_model_metadata` command that merges catalog → HF → GGUF → runtime. Add `get_runtime_model_metadata` for live llama-server stats.

### Step 5: Frontend tooltip

Build `ModelMetadataTooltip` component. Add `useModelMetadata` hook. Integrate into `LocalAISettings.tsx` and `TranscriptionSettings.tsx`.

### Step 6: Runtime metadata

Wire up `/v1/models` fetch on model load in `useLocalAI` hook. Cache result. Show authoritative parameter count and context length in tooltip when available.

## Quality Gates

### Functional

- [x] Local AI model cards show metadata tooltip on hover with author, license, parameters, architecture, context length, quantization

- [x] Whisper model cards show metadata tooltip on hover with author (OpenAI), license (MIT), parameter count, format

- [x] Tooltip shows HF link that opens in browser

- [x] Pre-download models show metadata from catalog defaults (or HF API if fetched)

- [x] Downloaded models show metadata from GGUF header (overriding catalog)

- [x] Running model shows runtime parameter count from `/v1/models`

- [x] Custom models get GGUF metadata after download

- [x] HF API failures degrade gracefully to catalog defaults

- [x] Metadata is cached — second open of settings panel shows tooltips instantly

- [x] No UI changes to model cards themselves — tooltips are additive

### Design

- [x] Tooltips follow design system (monochrome, no chromatic colors)

- [x] Tooltip content is well-structured with clear visual hierarchy

- [x] Loading state is subtle (no spinner, skeleton or "Loading...")

- [x] Tooltips work in both light and dark mode

- [x] Tooltip width is appropriate (\~280px), doesn't overflow

## Out of Scope

- **Editing metadata** — tooltips are read-only
- **Model search/filter by metadata** — no search by architecture, license, etc.
- **Automatic catalog updates from HF** — catalog remains manually curated
- **GGML metadata parsing for Whisper** — GGML format lacks structured KV metadata; Whisper info comes from catalog and HF API
- **HF authentication** — all requests are unauthenticated (public repos only)
- **Model version tracking or update notifications** — detecting newer versions on HF
- **Embedding metadata in model download progress** — metadata is fetched separately from downloads