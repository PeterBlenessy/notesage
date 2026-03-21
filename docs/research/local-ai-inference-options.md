# Local AI Inference Options for Desktop App Integration

**Date:** 2026-03-09 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [local-ai](../prds/2026-03-09-local-ai.md) | Complete |
| Tasks | [local-ai](../tasks/2026-03-09-local-ai.md) | Complete |

**Context:** Notesage is a Tauri v2 desktop app (Rust backend, TypeScript frontend) that currently uses Ollama for local AI. This research evaluates options for Phase 9 (Local AI) — embedding local inference directly into the app so users don't need to install separate software.

---

## Executive Summary

**For bundled desktop AI (no separate install required):**

1. **llama-server as Tauri sidecar** is the most practical near-term approach. Pre-built binaries for each architecture (\~5-10MB), OpenAI-compatible API, full GGUF model support, Metal/CUDA acceleration. Tauri's sidecar mechanism handles bundling and architecture selection automatically.

2. **llama-cpp-2 Rust crate** (direct library embedding) is the tightest integration — no subprocess, no HTTP overhead. Actively maintained (v0.1.138, updated weekly), supports Metal/CUDA/Vulkan via feature flags. Best for inline completions and embeddings where latency matters.

3. **Keep Ollama as an option** for users who already have it. It provides model management, auto-updates, and a broader ecosystem. The app should detect Ollama and offer it alongside the bundled engine.

**For embeddings/semantic search:** `fastembed` Rust crate (ONNX Runtime) is the best option — lightweight, fast, purpose-built for embeddings with no LLM overhead.

**For Apple Silicon optimization:** MLX via `mlx-rs` Rust bindings exists but is experimental. llama.cpp's Metal backend already delivers strong Apple Silicon performance. MLX only worth considering if the 20-80% throughput advantage (per benchmarks) justifies the platform-specific complexity.

---

## 1. Local Inference Engines — Detailed Comparison

### llama.cpp / llama-server

The foundation that most other tools build on.

| Attribute | Details |
| --- | --- |
| **Deployment** | Standalone binary (`llama-server`), C library (`libllama`), or via Rust bindings |
| **API** | OpenAI-compatible (`/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`), SSE streaming |
| **Acceleration** | Metal (Apple Silicon), CUDA, Vulkan, hipBLAS/ROCm, SYCL, CPU (AVX/AVX2/AVX-512) |
| **Model formats** | GGUF (primary), with on-device quantization support |
| **Bundling** | Yes — ship `llama-server` as Tauri sidecar (\~5-10MB per architecture) |
| **Streaming** | Yes — SSE for chat/completions |
| **Function calling** | Yes — OpenAI-compatible structured function calling with JSON schema |
| **Embeddings** | Yes — `/v1/embeddings` endpoint, multimodal embeddings supported |
| **License** | MIT |
| **Status** | Very active (ggml-org), de facto standard for local LLM inference |

**Rust integration options:**

| Crate | Approach | Maintenance | Notes |
| --- | --- | --- | --- |
| `llama-cpp-2` | Low-level bindings (close to raw C API) | Very active (v0.1.138, updated weekly) | MIT/Apache-2.0. Metal, CUDA, Vulkan via feature flags. |
| `llama_cpp` | High-level safe bindings | Active | Embeddings support. Async-friendly. |
| `llama_cpp_rs` | Mid-level bindings | Active |  |
| `llama-gguf` | Pure Rust GGUF implementation | Newer | Full GPU-resident inference on CUDA, Metal, DX12, Vulkan via Backend trait. |

**Tauri sidecar pattern:** Place pre-built `llama-server` binaries in `src-tauri/binaries/` with architecture suffixes:

- `llama-server-aarch64-apple-darwin` (Apple Silicon)
- `llama-server-x86_64-apple-darwin` (Intel Mac)
- Tauri auto-selects the correct binary at runtime

**Practical bundle sizes:**

- `llama-server` binary: \~5-10MB per architecture
- Models downloaded separately on first run (keeps installer small)
- A reference implementation bundled the Python/llama.cpp stack at \~40MB with the model (0.7GB) downloading separately

### Ollama (Current Integration)

Wrapper around llama.cpp with model management and ease-of-use layer.

| Attribute | Details |
| --- | --- |
| **Deployment** | Standalone app/service (separate install required) |
| **API** | OpenAI-compatible + native `/api/` endpoints. `/api/embed` for embeddings |
| **Acceleration** | Metal, CUDA (inherits from llama.cpp) |
| **Model formats** | GGUF via Modelfile abstraction. One-command model download (`ollama pull`) |
| **Bundling** | No — requires users to install Ollama separately |
| **Streaming** | Yes — SSE streaming |
| **Embeddings** | Yes — `/api/embed` endpoint with batching, dimension reduction, truncation |
| **License** | MIT |
| **Status** | Very popular, large community, regular updates |

**Strengths over raw llama.cpp:** Model management (pull/list/delete), auto-updates, unified model registry, thinking/reasoning model detection, easy multi-model switching.

**Weaknesses for bundling:** Requires separate install. Users must manage Ollama independently. Version mismatches possible.

**Recommendation:** Keep as a supported option alongside bundled llama-server. Detect Ollama availability at startup.

### MLX (Apple Silicon Native)

Apple's open-source ML framework optimized for Apple Silicon unified memory.

| Attribute | Details |
| --- | --- |
| **Deployment** | Python framework (primary), C++ library, Rust bindings via `mlx-rs` |
| **API** | No HTTP API — library-level only. Python `mlx-lm` has OpenAI-compatible server |
| **Acceleration** | Apple Silicon only (Metal, Neural Engine on M5) |
| **Model formats** | safetensors (primary), MLX-converted models on Hugging Face |
| **Bundling** | Theoretically via `mlx-rs`, but experimental |
| **Streaming** | Yes (at library level) |
| **License** | MIT |
| **Status** | Active development by Apple. WWDC 2025 featured MLX prominently. Strategic Apple ecosystem component |

**Rust bindings (**`mlx-rs`**):**

- Unofficial bindings at v0.25.3 (actively maintained, MIT/Apache-2.0)
- Minimum Rust version 1.82.0
- Provides safe, idiomatic Rust interface to MLX
- `burn-mlx` crate provides Burn deep learning backend using MLX
- Apple Silicon only — not cross-platform

**Performance advantage:** Benchmarks show MLX achieves 21-87% higher throughput than llama.cpp for Apple Silicon, particularly for larger models. Exploits unified memory architecture more efficiently.

**Practical assessment:** The `mlx-rs` bindings are functional but the ecosystem is less mature than llama.cpp for production use. The primary MLX ecosystem is Python-centric. Worth monitoring but not ready for production Rust embedding in a desktop app today. llama.cpp's Metal backend already delivers strong Apple Silicon performance.

### vLLM

High-performance inference engine designed for server/production workloads.

| Attribute | Details |
| --- | --- |
| **Deployment** | Python server (heavy dependencies) |
| **API** | OpenAI-compatible |
| **Acceleration** | CUDA (primary), ROCm, now Apple Silicon via vllm-mlx/vllm-metal |
| **Model formats** | safetensors, GPTQ, AWQ, GGUF |
| **Bundling** | No — too heavy for desktop embedding. Requires Python runtime |
| **License** | Apache 2.0 |
| **Status** | Industry standard for production serving. Not suitable for desktop apps |

**Verdict:** Designed for multi-user server environments with high concurrency. Overkill and impractical for a single-user desktop app. Skip.

### LM Studio

Desktop GUI application built on llama.cpp.

| Attribute | Details |
| --- | --- |
| **Deployment** | Standalone desktop app (\~500MB before models) |
| **API** | OpenAI-compatible local server at `localhost:1234` |
| **Acceleration** | Metal, CUDA (via llama.cpp) |
| **Model formats** | GGUF |
| **Bundling** | No — separate application. Headless mode available (v0.3.5+) |
| **License** | Proprietary (free for personal use) |
| **Status** | Popular, evolving into "local development platform" |

**Verdict:** Competitor/complement, not an integration target. Users who have LM Studio could connect via its OpenAI-compatible API (same as Ollama integration pattern). Not embeddable.

### Jan.ai

Open-source ChatGPT alternative with local inference.

| Attribute | Details |
| --- | --- |
| **Deployment** | Electron desktop app |
| **API** | OpenAI-compatible at `localhost:1337` |
| **Acceleration** | CUDA, Vulkan, Metal (via llama.cpp engine) |
| **Model formats** | GGUF |
| **Bundling** | No — separate application |
| **MCP support** | Yes — built-in MCP server support |
| **MLX support** | Yes — native MLX support added in v0.7.7 for macOS |
| **License** | AGPL-3.0 |
| **Status** | Active development, \~60k GitHub stars |

**Verdict:** Similar to LM Studio — a standalone app, not an embeddable engine. Could be supported as an external provider via its OpenAI-compatible API. AGPL license is restrictive for bundling.

### llamafile

Mozilla's single-file LLM distribution format.

| Attribute | Details |
| --- | --- |
| **Deployment** | Single executable file containing model weights + inference engine |
| **API** | OpenAI-compatible server (runs alongside CLI) |
| **Acceleration** | CPU-optimized via Cosmopolitan Libc (cross-platform single binary) |
| **Model formats** | GGUF (embedded in executable via PKZIP) |
| **Bundling** | Partially — the concept is a single file, but files are large (model included) |
| **License** | Apache 2.0 |
| **Status** | Revived by Mozilla.ai in late 2025 after going dormant |

**Verdict:** Interesting concept but not practical for bundling. The single-file approach means the binary includes model weights (hundreds of MB to GB), which is the opposite of what a desktop app wants (small installer, download models on demand). The CPU-only optimization means slower inference than Metal-accelerated llama.cpp.

### Candle (Hugging Face)

Pure Rust ML framework — no C/C++ dependencies.

| Attribute | Details |
| --- | --- |
| **Deployment** | Rust library (compile into your binary) |
| **API** | Library-level only (no HTTP server) |
| **Acceleration** | Metal (macOS Accelerate), CUDA, MKL (x86), WebAssembly |
| **Model formats** | safetensors, GGUF/GGML |
| **Bundling** | Yes — compiles to a single binary, megabyte-sized |
| **Streaming** | Yes (at library level) |
| **License** | MIT/Apache-2.0 |
| **Status** | Active (Hugging Face). Inference-first, training experimental |

**Supported models:** LLaMA v1/v2/v3, Mistral, Mixtral, Phi, Falcon, StarCoder, BERT, Whisper, Stable Diffusion, and more.

**Strengths:** Pure Rust (no C++ build complexity), compiles to small binary, WASM support for browser-side inference, starts in milliseconds.

**Weaknesses:** Less battle-tested than llama.cpp for LLM inference. Fewer optimizations for GGUF quantized models. Smaller community. No built-in HTTP server.

**Verdict:** Worth considering for embedding-specific use cases (BERT models for semantic search) where the pure-Rust toolchain and small binary size matter. For LLM chat/completion, llama.cpp is more mature and faster.

---

## 2. Recommended Architecture for Notesage

### Approach: Hybrid with Progressive Disclosure

```
User Experience Tiers:
├── Tier 1: Zero-config (bundled llama-server sidecar)
│   ├── Small model auto-downloaded on first use (~2-4GB)
│   ├── Works immediately, no separate software needed
│   └── OpenAI-compatible API on localhost
│
├── Tier 2: Power user (Ollama detected)
│   ├── Existing Ollama integration continues to work
│   ├── Access to full Ollama model library
│   └── User manages models via Ollama CLI
│
└── Tier 3: Advanced (LM Studio, Jan, custom endpoint)
    ├── Any OpenAI-compatible endpoint
    └── Already supported via existing provider abstraction
```

### Implementation: llama-server Sidecar

```
src-tauri/
├── binaries/
│   ├── llama-server-aarch64-apple-darwin    # Apple Silicon
│   └── llama-server-x86_64-apple-darwin     # Intel Mac
├── src/
│   └── commands/
│       └── local_inference.rs
│           ├── start_local_server(model_path, port) -> Result<()>
│           ├── stop_local_server() -> Result<()>
│           ├── download_model(model_id, size) -> Result<()>  // with progress events
│           ├── list_local_models() -> Result<Vec<ModelInfo>>
│           └── get_server_status() -> Result<ServerStatus>
```

**Why sidecar over library embedding:**

- Simpler build process (no C++ compilation in CI)
- Process isolation (crash in llama-server doesn't crash the app)
- Can update llama-server independently of app updates
- Same OpenAI-compatible API as Ollama — minimal frontend changes
- Already proven pattern in Tauri ecosystem

**Why keep library embedding as future option:**

- `llama-cpp-2` crate for latency-critical paths (inline completions, embeddings)
- No HTTP overhead for sub-100ms response requirements
- Could run alongside sidecar for different use cases

### Model Management

```
~/.notesage/models/
├── llm/
│   ├── qwen3-4b-q4_k_m.gguf         # Default chat model (~2.5GB)
│   └── qwen3-0.6b-q8.gguf           # Fast completion model (~650MB)
├── embedding/
│   └── bge-small-en-v1.5.onnx       # Embedding model (~130MB)
└── whisper/                           # Already exists
    └── ggml-base.bin
```

---

## 3. Use Case Analysis

### Chat / Conversational AI (Current Ollama Use Case)

**Best approach:** llama-server sidecar with OpenAI-compatible API.

**Recommended models by RAM:**

| Mac RAM | Model | Size | Quality | Speed |
| --- | --- | --- | --- | --- |
| 8GB | Qwen3-1.7B Q4 | \~1GB | Basic | Fast |
| 8GB | Phi-4-mini 3.8B Q4 | \~2GB | Good | Moderate |
| 16GB | Qwen3-4B Q4 | \~2.5GB | Good | Good |
| 16GB | Llama-3.2-8B Q4 | \~4.5GB | Very good | Moderate |
| 32GB | Qwen3-14B Q4 | \~8GB | Excellent | Good |
| 32GB | Llama-3.3-70B Q2 | \~26GB | Best (aggressive quant) | Slow |

**Key considerations:**

- macOS needs 2-3GB for itself, leaving 5-6GB for model + context on 8GB machines
- 4-bit quantization (Q4_K_M) is the sweet spot: \~0.5 bytes per parameter
- Memory bandwidth is the bottleneck on Apple Silicon, not compute
- M3 Max (400 GB/s) generates tokens faster than M4 Pro (273 GB/s) due to bandwidth

### Inline Text Completions (Autocomplete While Typing)

**Best approach:** Small model via `llama-cpp-2` direct library embedding for lowest latency, OR small model on llama-server with short generation.

**Requirements:**

- Sub-200ms time-to-first-token for responsive feel
- Small context window (current paragraph + surroundings)
- Short generations (1-3 sentences)

**Recommended models:**

- Qwen3-0.6B (Q8): \~650MB, very fast, adequate for text completion
- Phi-4-mini 3.8B (Q4): \~2GB, better quality, still fast on Apple Silicon

**Architecture note:** This could complement or replace the existing Copilot LSP integration for users without GitHub Copilot subscriptions. Same `GhostText` Tiptap extension, different completion source.

### Text Improvement / Summarization / Expansion (Bubble Menu Actions)

**Best approach:** Same chat model via llama-server. These are short prompt → medium response tasks.

**No special requirements beyond the chat model.** The existing `AIProvider` interface already handles these operations. Swapping Ollama for bundled llama-server is transparent.

### Embeddings for Semantic Search

**Best approach:** `fastembed` Rust crate (ONNX Runtime) — purpose-built, fast, lightweight.

| Option | Approach | Latency | Size | Notes |
| --- | --- | --- | --- | --- |
| **fastembed** (Rust) | ONNX Runtime | Very fast (\~5ms/doc) | \~130MB model | Purpose-built, best option |
| **ort** (Rust) | ONNX Runtime (raw) | Very fast | Depends on model | More control, more setup |
| **Candle** (Rust) | Pure Rust inference | Fast | Depends on model | No C++ deps |
| **llama-server** | HTTP API `/v1/embeddings` | Moderate | Shared with LLM model | Simple but less efficient |
| **Ollama** | HTTP API `/api/embed` | Moderate | Requires Ollama install | Batching support |

**Recommended embedding models:**

| Model | Dimensions | Size | Quality | Notes |
| --- | --- | --- | --- | --- |
| BGE-small-en-v1.5 | 384 | \~130MB | Good | Fast, English-focused |
| all-MiniLM-L6-v2 | 384 | \~90MB | Good | Classic, very fast |
| EmbeddingGemma (Google) | 768 | \~200MB (quantized) | Very good | Multilingual, designed for on-device |
| Qwen3-Embedding-0.6B | 1024 | \~600MB (GGUF) | Excellent | Via llama-server, multilingual |

`fastembed` **is the recommendation** because:

- Uses ONNX Runtime (3-5x faster than Python equivalents)
- Auto-downloads models on first use
- No dependency on the LLM inference engine
- Supports text embeddings, sparse embeddings, and reranking
- 60-80% less memory than Python equivalents

### RAG Over Local Documents

**Architecture:**

```
Document indexing pipeline:
  .md files → split into chunks → fastembed → vectors → SQLite + vec extension

Query pipeline:
  User query → fastembed → vector similarity search → top-K chunks → LLM context
```

**Storage options:**

- SQLite with `sqlite-vec` extension (pure Rust, fits Tauri perfectly)
- In-memory with periodic persistence (simpler, good enough for &lt;10K documents)

**No need for a full vector database** — a note-taking app's corpus is small enough for SQLite or even flat-file storage with brute-force similarity search.

### Voice Transcription

**Already implemented** via `whisper-rs` with Metal acceleration. No changes needed for Phase 9.

---

## 4. Key Questions Answered

### Is there a better option than Ollama for a bundled desktop app experience?

**Yes — llama-server as a Tauri sidecar.** It provides the same OpenAI-compatible API as Ollama but can be bundled directly into the app installer. Users get local AI out of the box with zero separate software to install. The trade-off is that Notesage would need to handle model management (download, storage, selection) that Ollama currently handles.

### What's the best approach for embedding local AI without requiring users to install separate software?

**Two-tier approach:**

1. **Sidecar binary** (llama-server): Bundle pre-built binaries for each architecture. Tauri handles selection. Ship small (\~5-10MB per architecture), models download on first use. This is the proven pattern — multiple Tauri apps already do this.

2. **Rust library** (llama-cpp-2 or fastembed): Compile directly into the Tauri binary for latency-critical operations (embeddings, fast completions). Increases build complexity but eliminates subprocess management.

### What's the state of llama.cpp as a Rust library?

**Mature and actively maintained.** The `llama-cpp-2` crate (by utilityai) is the most active, with v0.1.138 published days ago. It stays intentionally close to the raw C API for maximum compatibility. Supports Metal, CUDA, and Vulkan via Cargo feature flags. Licensed MIT/Apache-2.0.

The main caveat is build complexity — it links against the C++ llama.cpp library, requiring a C++ toolchain in CI. This is manageable but adds build time.

### Can MLX be used from Rust on Apple Silicon?

**Yes, via** `mlx-rs` **(v0.25.3)** — unofficial but actively maintained Rust bindings. However:

- Apple Silicon only (not cross-platform)
- Less mature ecosystem than llama.cpp
- Primary MLX community is Python-centric
- Benchmarks show 21-87% higher throughput than llama.cpp, but this advantage varies by model
- Apple is investing heavily (WWDC 2025 featured MLX, M5 Neural Engine support)

**Recommendation:** Monitor `mlx-rs` but don't depend on it yet. llama.cpp's Metal backend already provides strong Apple Silicon performance. MLX becomes compelling if/when the Rust bindings mature and you want to squeeze maximum performance on macOS.

### What model sizes are practical on consumer Macs?

| RAM | Available for Model | Comfortable Models | Aggressive (short context) |
| --- | --- | --- | --- |
| 8GB | \~5-6GB | 1.7B-3.8B (Q4) | 7B-8B (Q4, limited context) |
| 16GB | \~12-13GB | 7B-8B (Q4-Q6) | 14B (Q4) |
| 32GB | \~28GB | 14B-32B (Q4-Q6) | 70B (Q2-Q3, degraded quality) |
| 48GB+ | \~44GB | 70B (Q4) | 70B (Q6-Q8) |
| 64GB+ | \~60GB | 70B (Q6-Q8) | Multiple models simultaneously |

**For Notesage's default bundled model:**

- Target 8GB Macs as the floor (most common configuration)
- Default model should be 1.7B-4B (Q4) — fits in \~1-2.5GB
- Offer larger models as optional downloads for users with more RAM
- Auto-detect available memory and recommend appropriate model size

### Is there a way to do fast local embeddings for semantic search?

**Yes —** `fastembed` **Rust crate.** It uses ONNX Runtime under the hood, provides:

- 3-5x faster inference than Python equivalents
- \~5ms per document embedding
- Auto-downloads optimized ONNX models (\~90-200MB)
- No dependency on the LLM engine
- Supports text, sparse, and image embeddings plus reranking

For a note-taking app with hundreds to low thousands of documents, `fastembed` with SQLite storage would provide instant semantic search with minimal resource usage.

---

## 5. Recommended Phase 9 Implementation Plan

### Step 1: Model Management Infrastructure

- Create `~/.notesage/models/llm/` directory structure
- Implement model download from Hugging Face (reuse existing download pattern from whisper model management)
- Model list with size, quantization, RAM requirements
- Auto-detect available system memory and recommend models
- Download progress events (same pattern as whisper models)

### Step 2: llama-server Sidecar

- Bundle pre-built `llama-server` binaries for macOS architectures
- Implement `local_inference.rs` Tauri commands (start, stop, status, health check)
- Auto-start on app launch if local AI is enabled
- Graceful shutdown on app exit (same pattern as ACP agent cleanup)
- Port selection and conflict avoidance

### Step 3: Provider Integration

- New `LocalProvider` implementing existing `AIProvider` interface
- Routes through bundled llama-server's OpenAI-compatible API
- Transparent to the rest of the app — chat panel, bubble menu, inline actions all work unchanged
- Add to connections/routing system alongside Ollama, Anthropic, OpenAI

### Step 4: First-Run Experience

- Detect if no AI providers are configured
- Offer one-click local AI setup: "Download a small model and start using AI locally"
- Model selection based on detected RAM
- Progress indicator during model download
- "Ready to go" state with bundled llama-server running

### Step 5 (Future): Embeddings & Semantic Search

- Integrate `fastembed` for document embeddings
- Index all project documents on open
- Semantic search in command palette
- RAG context for chat conversations

---

## Sources

- [llama.cpp GitHub](https://github.com/ggml-org/llama.cpp) — Main repository
- [llama-server HTTP API](https://deepwiki.com/ggml-org/llama.cpp/6.2-llama-server-http-api) — API documentation
- [llama-cpp-2 crate](https://crates.io/crates/llama-cpp-2) — Rust bindings (utilityai)
- [llama_cpp crate](https://crates.io/crates/llama_cpp) — High-level Rust bindings (edgenai)
- [llama-gguf crate](https://lib.rs/crates/llama-gguf) — Pure Rust GGUF implementation
- [MLX GitHub](https://github.com/ml-explore/mlx) — Apple's ML framework
- [mlx-rs crate](https://crates.io/crates/mlx-rs/0.21.0) — Rust bindings for MLX
- [WWDC 2025 - MLX on Apple Silicon](https://developer.apple.com/videos/play/wwdc2025/298/) — Apple's MLX presentation
- [MLX vs llama.cpp benchmark](https://arxiv.org/abs/2511.05502) — Comparative study on Apple Silicon
- [vLLM GitHub](https://github.com/vllm-project/vllm) — High-performance inference engine
- [Jan.ai](https://www.jan.ai/) — Open-source ChatGPT alternative
- [llamafile GitHub](https://github.com/mozilla-ai/llamafile) — Mozilla's single-file LLM distribution
- [Candle GitHub](https://github.com/huggingface/candle) — Hugging Face Rust ML framework
- [Ollama Embeddings](https://docs.ollama.com/capabilities/embeddings) — Ollama embedding API
- [fastembed crate](https://crates.io/crates/fastembed) — Rust embedding library
- [ort crate](https://github.com/pykeio/ort) — ONNX Runtime Rust bindings
- [EmbeddingGemma](https://developers.googleblog.com/introducing-embeddinggemma/) — Google's on-device embedding model
- [Tauri Sidecar](https://v2.tauri.app/develop/sidecar/) — Tauri external binary documentation
- [Building Local LM Desktop Apps with Tauri](https://medium.com/@dillon.desilva/building-local-lm-desktop-applications-with-tauri-f54c628b13d9) — Practical guide
- [Ollama Alternatives Guide 2026](https://localllm.in/blog/complete-guide-ollama-alternatives) — Comprehensive comparison
- [llama.cpp vs Ollama 2026](https://www.openxcell.com/blog/llama-cpp-vs-ollama/) — Detailed comparison
- [Local LLM Hardware Requirements 2026](https://www.sitepoint.com/local-llm-hardware-requirements-mac-vs-pc-2026/) — Hardware guide
- [Best Local LLMs for Mac 2026](https://insiderllm.com/guides/best-local-llms-mac-2026/) — Apple Silicon recommendations
- [Best Embedding Models 2026](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models) — Embedding model guide