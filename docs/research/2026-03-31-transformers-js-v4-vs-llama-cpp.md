# Transformers.js v4 vs llama.cpp for Desktop AI Inference

**Date:** 2026-03-31 **Status:** Research complete

**Context:** Transformers.js v4 was released (Feb 2026) with a completely rewritten WebGPU backend. This research evaluates whether it changes the calculus for Notesage's local AI strategy, which currently uses llama-server (llama.cpp) as a bundled Tauri sidecar.

---

## Executive Summary

**Transformers.js v4 is impressive but does not displace llama.cpp for Notesage's use case.** The two tools serve different niches:

- **llama.cpp** excels at LLM text generation (chat, completions, tool calling) with deep GGUF quantization, Metal acceleration, and battle-tested production stability. This is Notesage's primary local AI workload.
- **Transformers.js v4** excels at multi-modal inference in JavaScript environments (embeddings, classification, image/audio processing, smaller LLMs) via ONNX Runtime + WebGPU. It's the better choice for in-process browser/frontend inference without a sidecar.

**Where Transformers.js v4 could complement llama.cpp in Notesage:**

- Frontend-side text embeddings for semantic search (no IPC round-trip)
- On-device classification/NER for smart tagging
- Small model inference directly in the renderer process

**Where llama.cpp remains superior:**

- Large LLM inference (8B+ models, the primary chat/agent workload)
- GGUF quantization ecosystem (Q2-Q8, K-quants) — far more mature
- Metal GPU acceleration for Apple Silicon (native, not via WebGPU translation layer)
- Tool calling, structured output, FIM completions
- Process isolation (sidecar crash doesn't take down the UI)

---

## Transformers.js v4 — What's New

### Runtime Architecture

- **Completely rewritten C++ WebGPU backend** developed with the ONNX Runtime team
- Replaces the previous WASM-only execution with GPU-accelerated inference
- Uses specialized ONNX Runtime Contrib Operators:
  - `com.microsoft.GroupQueryAttention` — efficient attention for LLMs
  - `com.microsoft.MatMulNBits` — quantized matrix multiplication
  - `com.microsoft.QMoE` — Mixture of Experts support
  - `com.microsoft.MultiHeadAttention` — \~4x speedup for BERT-class models

### Platform Support

| Platform | WebGPU Status |
| --- | --- |
| Browsers (Chrome, Edge, Firefox) | Yes |
| Node.js | Yes (via `@aspect-build/wgpu` or Dawn) |
| Bun | Yes |
| Deno | Yes |
| Tauri WebView | Partial (WKWebView WebGPU support varies) |

### Model Support

- \~200+ architectures including new v4-exclusive ones: GPT-OSS, Chatterbox, GraniteMoeHybrid, LFM2-MoE, FalconH1
- Advanced patterns: Mamba (state-space), MLA (Multi-head Latent Attention), MoE
- Models exceeding 8B parameters now supported
- Quantization: fp32, fp16, q4, q4f16

### Performance Headlines

| Metric | Result |
| --- | --- |
| GPT-OSS 20B (q4f16) | \~60 tok/s on M4 Pro Max |
| BERT embeddings | \~4x speedup vs v3 (MultiHeadAttention op) |
| Build time | 10x faster (Webpack -&gt; esbuild) |
| Bundle size | \~10% smaller; `transformers.web.js` 53% smaller |

### New APIs

- **ModelRegistry**: Pre-load inspection of pipeline assets (file listing, metadata, cache status, available dtypes)
- **Standalone @huggingface/tokenizers**: 8.8kB gzipped, zero dependencies
- **Environment controls**: `env.useWasmCache`, custom `env.fetch`, configurable log levels
- **Progress callbacks**: End-to-end loading progress with `progress_total` events

### Model Format

- **ONNX** (primary and only format) — models must be converted from PyTorch/safetensors to ONNX
- Pre-converted models available on Hugging Face under `onnx-community/` namespace
- Not all models have ONNX conversions available

---

## Head-to-Head Comparison

### LLM Text Generation (Chat, Completions)

| Aspect | llama.cpp (llama-server) | Transformers.js v4 |
| --- | --- | --- |
| **Model format** | GGUF (native, massive ecosystem) | ONNX (requires conversion) |
| **Quantization** | Q2_K through Q8_0, IQ quants, K-quants | fp32, fp16, q4, q4f16 |
| **GPU acceleration** | Metal (native), CUDA, Vulkan | WebGPU (translation layer over Metal/Vulkan) |
| **Max practical model size** | 70B+ (with sufficient RAM) | 20B demonstrated, likely ceiling for WebGPU memory |
| **Token generation (8B Q4, M4 Pro)** | \~40-60 tok/s | Not benchmarked at this size |
| **Token generation (20B Q4, M4 Pro Max)** | \~30-40 tok/s (estimated) | \~60 tok/s (reported) |
| **Tool calling** | Yes (OpenAI-compatible, Jinja templates) | No built-in support |
| **FIM (code completions)** | Yes (`/infill` endpoint) | No |
| **Streaming** | SSE (OpenAI-compatible) | Async generator |
| **KV cache management** | Sophisticated (continuous batching, cache reuse) | Basic |
| **Context length** | 128K+ (with RoPE scaling) | Limited by WebGPU buffer sizes |
| **Process isolation** | Yes (sidecar subprocess) | No (runs in renderer/main process) |
| **Crash recovery** | Restart sidecar, app survives | Crash affects renderer |

**Verdict:** llama.cpp is decisively better for Notesage's primary chat/completion workload. The GGUF ecosystem, Metal-native acceleration, tool calling, FIM, and process isolation are all critical for us.

The 60 tok/s figure for GPT-OSS 20B on M4 Pro Max is impressive but: (a) it's a specific model optimized for ONNX, (b) the M4 Pro Max is top-tier hardware, and (c) llama.cpp achieves comparable or better speeds for equivalent model sizes with more quantization flexibility.

### Embeddings & Feature Extraction

| Aspect | llama.cpp | Transformers.js v4 |
| --- | --- | --- |
| **Embedding quality** | Good (LLM-based, e.g., Qwen3-Embedding) | Excellent (purpose-built models like all-MiniLM, BGE) |
| **Speed** | \~10-20ms/doc (via HTTP API) | \~2-5ms/doc (in-process, WebGPU) |
| **Model variety** | Limited to GGUF-converted models | Huge ONNX model zoo (BERT, BGE, E5, etc.) |
| **IPC overhead** | Yes (Tauri invoke -&gt; HTTP -&gt; response) | None (runs in renderer process) |
| **Memory** | Shared with LLM (model swap required) | Independent (separate ONNX model) |

**Verdict:** Transformers.js v4 is better for embeddings. Purpose-built embedding models in ONNX format are faster, smaller, and higher quality than repurposing an LLM for embeddings. Running in-process eliminates IPC latency. However, we already identified `fastembed` (Rust, ONNX Runtime) as our embedding strategy in the Phase 9 research — it provides the same ONNX Runtime advantage from the Rust side without adding a JS dependency.

### Classification, NER, and Other Non-Generative Tasks

| Aspect | llama.cpp | Transformers.js v4 |
| --- | --- | --- |
| **Task support** | LLM-based (prompt engineering) | Native pipelines (token-classification, zero-shot, sentiment, etc.) |
| **Accuracy** | Depends on LLM quality | Purpose-built models, typically better |
| **Latency** | Higher (LLM inference + HTTP) | Lower (specialized model, in-process) |
| **Model size** | 1-8GB (full LLM) | 10-200MB (task-specific) |

**Verdict:** If we ever need smart tagging, entity extraction, or classification, Transformers.js would be the natural choice. These are small, fast models that benefit from running in-process. Not a current Notesage requirement but worth noting.

### Audio/Vision/Multimodal

| Aspect | llama.cpp | Transformers.js v4 |
| --- | --- | --- |
| **Whisper (speech-to-text)** | Via whisper.cpp (separate) | Built-in pipeline |
| **Image understanding** | Vision LLMs (LLaVA, etc.) | CLIP, ViT, DETR, etc. |
| **Image generation** | No | Stable Diffusion (slow via WebGPU) |

**Verdict:** Not relevant — Notesage already uses `whisper-rs` for transcription and doesn't need other multimodal pipelines.

---

## WebGPU in Tauri — Practical Considerations

A critical question for Transformers.js in Notesage is WebGPU availability in Tauri's WebView:

| Platform | WebView Engine | WebGPU Status |
| --- | --- | --- |
| macOS | WKWebView (WebKit) | Experimental (behind flag in Safari 18.2+) |
| Windows | WebView2 (Chromium) | Yes (Chrome 113+) |
| Linux | WebKitGTK | No |

**On macOS (our primary platform), WebGPU in WKWebView is not reliably available.** This is a significant blocker for using Transformers.js with GPU acceleration in the Tauri renderer. It would fall back to WASM (CPU), which is dramatically slower.

Workarounds:

- Run Transformers.js in a Node.js/Bun subprocess with WebGPU (adds process management complexity — at which point, why not just use llama-server?)
- Wait for Apple to ship WebGPU in WKWebView GA (timeline unclear)
- Use `fastembed` (Rust/ONNX Runtime) on the backend instead — this is what we already planned

---

## Where Transformers.js v4 Could Fit in Notesage

### Not a replacement for llama.cpp

The two tools don't compete directly. llama.cpp is an LLM inference engine; Transformers.js is a multi-model ML inference framework. For our core workload (chat, completions, tool calling with 4-8B+ LLMs), llama.cpp is the clear winner.

### Potential complementary uses (future)

1. **Frontend-side embeddings** — If we want semantic search without IPC round-trips, Transformers.js could run a small embedding model (all-MiniLM-L6-v2, \~90MB) directly in the renderer. But `fastembed` on the Rust side is equally fast and avoids the WebGPU availability question.

2. **Smart document classification** — Zero-shot classification for auto-tagging notes. Small models (\~50MB), fast inference, no LLM needed. This is a future feature idea, not a current need.

3. **Tokenizer-only** — The standalone `@huggingface/tokenizers` package (8.8kB) could be useful for accurate token counting in the frontend (currently we estimate). Low-risk, high-value addition.

---

## Decision Matrix

| Criterion | llama.cpp | Transformers.js v4 | Winner for Notesage |
| --- | --- | --- | --- |
| LLM chat/completion | Native, optimized | ONNX conversion required | llama.cpp |
| GGUF model ecosystem | Thousands of models | N/A (ONNX only) | llama.cpp |
| Metal acceleration | Native | Via WebGPU (unreliable in WKWebView) | llama.cpp |
| Tool calling | Yes (OpenAI-compatible) | No | llama.cpp |
| FIM completions | Yes | No | llama.cpp |
| Process isolation | Yes (sidecar) | No (in-process) | llama.cpp |
| Embeddings | Adequate | Excellent | Transformers.js (but fastembed covers this) |
| Bundle size | \~5-10MB binary | \~2-5MB JS + WASM | Comparable |
| Classification/NER | Via LLM prompting | Native pipelines | Transformers.js |
| Maturity for LLMs | Battle-tested, years of production use | New WebGPU backend, less proven | llama.cpp |
| Cross-platform GPU | Metal + CUDA + Vulkan | WebGPU (platform-dependent) | llama.cpp |

---

## Recommendation

**Stay with llama.cpp as the primary local inference engine.** The decision from the Phase 9 research remains sound. Transformers.js v4 is a major step forward for browser/JS ML inference, but it doesn't address Notesage's core needs better than llama.cpp:

1. Our workload is LLM text generation — llama.cpp's specialty
2. GGUF is the dominant format for quantized local models — switching to ONNX would cut off most of the ecosystem
3. WebGPU in macOS WKWebView is not production-ready — the GPU acceleration story falls apart on our primary platform
4. Process isolation (sidecar) is a feature, not a limitation — LLM crashes shouldn't take down the editor

**One actionable takeaway:** Consider adopting `@huggingface/tokenizers` (8.8kB, zero deps) for accurate token counting in the frontend. It's standalone, tiny, and solves a real problem (our current token estimates are approximations).

**Watch for future:** If Apple ships WebGPU GA in WKWebView and we need frontend-side embeddings or classification, Transformers.js becomes a natural complement to llama.cpp — not a replacement.

---

## Sources

- [Transformers.js v4 Blog Post](https://huggingface.co/blog/transformersjs-v4) — Official announcement with technical details
- [Transformers.js v4 Release Notes](https://github.com/huggingface/transformers.js/releases/tag/4.0.0) — GitHub release
- [Notesage Local AI Research](local-ai-inference-options.md) — Phase 9 research (2026-03-09)
- [ONNX Runtime WebGPU](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html) — WebGPU execution provider docs
- [WebKit WebGPU Status](https://webkit.org/status/#specification-webgpu) — Safari/WKWebView WebGPU implementation status