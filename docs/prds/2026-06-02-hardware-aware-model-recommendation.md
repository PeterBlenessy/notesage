# PRD: Hardware-Aware Local Model Recommendation

|  |  |
| --- | --- |
| **Date** | 2026-06-02 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Users see which local models will actually run — and run *well* — on their specific Mac, and which genuinely support the feature they need (completions / agents), verified before any download. |
| **Tasks** | — (not yet planned) |
| **Phase** | Local AI |

## Problem

Notesage's local-model picker recommends models using a hand-authored `recommended_for` RAM tier (`"8gb"`, `"16gb"`, …) baked into `model-catalog.json`. Those tiers are a *theory* — the models were slotted by guesswork, not tested. The result is concrete user harm:

- The catalog currently offers models that **cannot run** on the maintainer's own laptop. A user on a 16 GB machine can download a model, wait for several GB, and find it thrashes or won't load.
- The catalog's **capability flags** (`supports_fim`, `supports_tool_calling`, `supports_thinking`) are derived from repo tags / chat-template *presence*, not from the actual model file. A model flagged for tool calling may lack a tool-call chat template; a "completion" model may lack native FIM tokens. So the completion and agent routing slots can be pointed at models that don't actually support the mechanism.
- The tiers don't model **speed at all**. A model can fit in memory and still generate at ~3 tok/s — technically recommendable, practically unusable. RAM tiers can't express this, and they ignore memory bandwidth entirely (an 8 GB model is unusable on a 100 GB/s chip and snappy on an 800 GB/s one).
- MoE models break the size↔tier assumption completely: `gemma-4-26B-A4B` is large in memory but fast to decode (only ~4B active params), which a RAM tier mis-ranks.

The user wants a **trusted** selection — runnable *and* feature-supporting — based on facts read from the model and the host machine, **before downloading**, not on a maintainer's guess.

A spike (`scripts/spikes/model-fit-spike.mjs`) proved the approach end-to-end against real catalog sizes: it computes per-machine memory fit + bandwidth-bound tok/s, gates on verified capability, and correctly rejects unrunnable models — with zero weight downloads. Capability is read from the GGUF *header* via an HTTP Range request (first ~16 MB), never the multi-GB body.

## Goals / Non-Goals

**Goals**

1. Replace the static `recommended_for` tiers with a **computed, per-machine verdict** for every candidate model: estimated RAM fit, estimated tok/s, and a runnable/not-runnable decision — all pre-download.
2. **Verify feature mechanisms from the model file**, not catalog claims: native FIM tokens (completions slot) and tool-call chat template (agents slot), read from the GGUF header without downloading weights.
3. Apply the same verdict to **both catalog models and live HuggingFace search results**, so the recommendation extends beyond the curated list.
4. **Never silently hide** an unrunnable model — show it disabled, with a plain-language reason ("needs ~42 GB", "~3 tok/s — too slow on this Mac", "no FIM support").
5. Demote the catalog from "trusted source" to a **curated discovery list** — its quality signal becomes the verified facts, not its hand-authored flags.
6. **Ground the engine constants empirically** before the estimator ships any number to a user, via a one-off **calibration harness** that measures real tok/s + peak RAM on actual hardware and tunes the constant tables — so v1 estimates are validated, not blindly ported from whichllm.

**Non-Goals**

- **Empirical self-correction** (measuring real tok/s after a run and overriding the estimate) — deferred to Phase 2.
- **Benchmark-based quality ranking** (LiveBench/Arena/etc. à la whichllm's scorer) — explicitly out; high-maintenance and fragile. Curation + verified capability is the v1 quality signal.
- **Multi-vendor discrete-GPU modeling** (NVIDIA/AMD/Intel VRAM, PCIe partial-offload layer counts) — macOS/Apple-Silicon unified memory only in v1; non-Apple gets a conservative RAM-based fallback.
- **Whisper / transcription model recommendation** — separate, simpler subsystem; unchanged.
- **Auto-downloading** a recommended model — the user still chooses and triggers the download.

## User Stories

- *As a user on a 16 GB MacBook Air*, I want the model list to show me which models will run smoothly, so that I don't download several GB only to find the model won't load.
- *As a user setting up local completions*, I want to only be offered models that actually have native FIM support, so that my inline completions work instead of falling back silently.
- *As a user setting up a local agent*, I want only models with a real tool-call template recommended for the agent slot, so that tool calling functions.
- *As a power user searching HuggingFace for a model not in the catalog*, I want the same "fits / runs at ~X tok/s / has FIM" verdict on those results, so that I can judge any GGUF repo before downloading.
- *As a user on a 64 GB Studio*, I want larger models unlocked automatically because my hardware supports them, without a maintainer having to hand-tier them.

## Technical Approach

The engine lives in **Rust** (`src-tauri/src/commands/model_fit/`), consistent with "all I/O and the security boundary go through Tauri commands." Three concerns:

### 1. Hardware profile (`model_fit/hardware.rs`)

Extends the existing `get_system_memory()` (sysinfo) with **memory bandwidth** and **chip identity**:

- macOS: read chip via `sysctl machdep.cpu.brand_string` / `hw.model` (or `system_profiler SPHardwareDataType`), map to a small static **bandwidth table** keyed by Apple chip (M1 ~100, M3 Pro ~150, M4 Pro ~273, M-Max ~410, M-Ultra ~819 GB/s, etc.). This table is the one piece of curated data we keep — but it's *hardware spec*, stable and small, not model-quality data.
- Unknown chip / non-macOS: conservative default bandwidth + treat as non-unified, RAM-fit only.

### 2. GGUF header capability reader (`model_fit/gguf_header.rs`)

The no-download capability check. Given a HuggingFace `resolve` URL (or a local path for already-downloaded models), issue an **HTTP Range request** for the first ~16 MB and parse the GGUF KV metadata (reusing the existing `gguf_parser.rs` value-type readers where possible). Extracts:

- `general.architecture`, `{arch}.context_length`
- `tokenizer.chat_template` → tool-call detection (template references `tool_calls`/`tools`/`function`) and thinking detection (reuse `thinking_tags.rs` logic)
- FIM token IDs (`tokenizer.ggml.{prefix,suffix,middle}_token_id` all present)

Returns a `truncated` flag if the metadata window is exceeded (very large vocab arrays) so the caller can widen the range. For models already downloaded, read the local file directly (no network).

### 3. Fit + speed engine (`model_fit/engine.rs`)

Pure, unit-testable functions (cargo-tested). Constants ported from `Andyyyy64/whichllm` (`engine/vram.py`, `engine/performance.py`), calibrated empirically rather than derived from architecture:

- **Memory estimate** = `weights (≈ file size, mmap'd) + KV cache + activation + framework overhead`. KV uses an empirical `MB per B-active-params per 1K planning-ctx` constant (MoE scales on active params). Planning context is a setting (default 8192), *not* the model's max context.
- **Speed estimate** = bandwidth-bound decode: `bandwidth × quant_efficiency × backend_factor / effective_read_bytes`. MoE reads only active experts (with a kernel-bound floor). Quant-efficiency and Apple-Metal backend factors from a small table.
- **Fit classification**: `fits` / `tight` / `wont-fit` against usable unified memory (total × ~0.75, reserving for OS + the editor).
- **Speed classification**: `fast` / `ok` / `sluggish` / `unusable`.
- **Verdict per routing slot**: runnable (`fit ∈ {fits, tight}` AND tok/s ≥ floor) AND has the slot's required mechanism (FIM for completions, tool template for agents).

### 4. Calibration harness (`scripts/calibrate-model-fit.ts` + `model_fit/calibration.rs`)

The constants in `engine.rs` are ported from whichllm and are **un-calibrated guesses** until proven on real hardware. Shipping un-grounded tok/s figures to users would violate the "honesty" UX goal. The harness closes that gap **before** v1 ships, as a developer/CI tool (not a user-facing feature):

- **Input**: a manifest of already-downloaded models spanning the relevant axes — dense vs MoE, a few quant levels (Q4_K_M, Q5/Q6, Q8), and a small/medium/large size — plus the host's `HardwareProfile`.
- **Measure**: for each model, start the real bundled `llama-server`, run a fixed decode workload (warm-up + N tokens at the default planning context), and capture **actual decode tok/s** (from llama-server's timing output) and **peak resident memory** (sampled during the run). A new `measure_model_runtime(model_path, workload)` command in `calibration.rs` drives this, reusing the existing `local_inference.rs` server lifecycle.
- **Compare & tune**: the harness diffs measured vs estimated for memory and speed, reports per-model and aggregate error, and proposes adjusted constants (quant-efficiency factors, Metal backend factor, KV/overhead coefficients) that minimize error across the sample. Output is a human-readable calibration report committed under `docs/audits/` plus a suggested diff to the constant tables — a human applies it, the harness never auto-writes constants.
- **Re-runnable**: the same harness becomes the validation tool for Phase 2's automatic loop and for future Apple chips. It is opt-in (`pnpm calibrate:model-fit`), never part of the normal build, and requires the operator to have the sample models downloaded.

This is a **one-shot, operator-driven** calibration — distinct from the Phase 2 *automatic, per-run* self-correction loop, which is still out of scope (see below). The harness grounds the shipped constants once; Phase 2 keeps them grounded continuously from real usage.

### Data flow

```
detect_hardware_profile()  ─┐
catalog entries + HF search ─┤→ read_gguf_capabilities() (Range-GET, cached)
                            ─┤→ estimate_model_fit(candidates, profile)
                             └→ per-model { estRAM, fit, tok/s, speed, caps, runnable, reasons }
                                → LocalAISettings renders badges + per-slot shortlists
```

Capabilities and hardware profile are cached (capabilities keyed by repo+file+etag in the existing `~/.notesage/cache/model-metadata/` area; hardware profile per session). The `recommended_for` field stays in the catalog schema for back-compat but the UI stops reading it.

## UI/UX

Surfaces in **Settings → Local AI** (`LocalAISettings.tsx`) and, where models are listed for routing, the relevant pickers. Design-system compliant (neutral palette, computed badges, no chromatic accent beyond existing tokens).

- **Per-model verdict row**: each model card shows a computed line — e.g. `✓ Fits · ~24 tok/s` or `~ Tight · ~5 tok/s` or `✗ Needs ~42 GB`. Capability chips (FIM / Tools / Vision / Think) reflect the **verified** state, visually distinct from unverified-yet (loading) state.
- **Unrunnable = disabled, not hidden**: the card renders greyed with the download action disabled and a reason badge + tooltip ("Won't fit — needs ~42 GB, you have 16 GB" / "Runs at ~3 tok/s — too slow for chat"). Sorted below runnable models.
- **Per-slot recommendation**: when configuring the completion or agent routing slot, a "Recommended for your Mac" shortlist shows only verified-runnable + capable models, best tok/s first. Replaces today's "Recommended for your Mac (N GB)" tier filter.
- **States**: loading (capabilities being read — skeleton on the capability chips); estimate-uncertain (show `~` prefix and a tooltip that estimates are pre-measurement, will sharpen once run — sets up Phase 2); error (capability read failed → fall back to catalog flag with a muted "unverified" marker rather than blocking).
- **Honesty**: all speed/fit figures are labeled estimates (`~`). No claim of measured performance in v1.

## Data Model

**Rust (`model_fit/types.rs`)**

```rust
pub struct HardwareProfile {
    pub total_ram_bytes: u64,
    pub available_ram_bytes: u64,
    pub chip_name: String,        // "Apple M3 Pro" | "unknown"
    pub bandwidth_gbs: f32,
    pub is_unified: bool,
    pub backend: String,          // "metal" | "cpu"
}

pub struct GgufCapabilities {
    pub architecture: Option<String>,
    pub context_length: Option<u32>,
    pub has_fim_tokens: bool,
    pub has_tool_template: bool,
    pub has_thinking: bool,
    pub gguf_version: u32,
    pub truncated: bool,
}

pub struct ModelFitInput {
    pub id: String,
    pub file_size_bytes: u64,
    pub params_b: f32,
    pub active_params_b: Option<f32>,  // MoE
    pub quant: String,                 // "Q4_K_M"
}

pub enum Fit { Fits, Tight, WontFit }
pub enum Speed { Fast, Ok, Sluggish, Unusable }

pub struct ModelFitResult {
    pub id: String,
    pub est_ram_bytes: u64,
    pub fit: Fit,
    pub est_tok_per_sec: f32,
    pub speed: Speed,
    pub runnable: bool,
    pub reasons: Vec<String>,          // human-readable, for disabled badges
}
```

**Tauri commands** (`model_fit/mod.rs`, registered in `lib.rs`)

```rust
#[tauri::command] async fn detect_hardware_profile() -> Result<HardwareProfile, String>;
#[tauri::command] async fn read_gguf_capabilities(resolve_url: Option<String>, local_path: Option<String>) -> Result<GgufCapabilities, String>;
#[tauri::command] async fn estimate_model_fit(candidates: Vec<ModelFitInput>, profile: HardwareProfile, planning_ctx: u32) -> Result<Vec<ModelFitResult>, String>;

// Calibration harness only — drives a real llama-server decode and reports measured perf.
#[tauri::command] async fn measure_model_runtime(model_path: String, decode_tokens: u32, planning_ctx: u32) -> Result<RuntimeMeasurement, String>;
```

```rust
pub struct RuntimeMeasurement {
    pub model_path: String,
    pub measured_tok_per_sec: f32,
    pub peak_ram_bytes: u64,
    pub decode_tokens: u32,
}
```

The harness script (`scripts/calibrate-model-fit.ts`) calls `measure_model_runtime` per manifest entry, calls `estimate_model_fit` for the same inputs, and writes the comparison report. `measure_model_runtime` is registered behind a dev/debug gate and is not invoked by any user-facing surface.

**Frontend** — `local-ai-store` gains `hardwareProfile` + a `Map<modelId, ModelFitResult>` and `Map<modelId, GgufCapabilities>` (non-persisted, recomputed per session). New TS interfaces mirror the Rust structs in `src/lib/tauri.ts`. `settings-store` gains `localPlanningContext` (default 8192).

## Dependencies

- Existing: `sysinfo` (RAM), `reqwest` (Range requests), `gguf_parser.rs` (KV readers), `thinking_tags.rs` (template thinking detection), `hf_search.rs` (HF candidate metadata + per-file sizes).
- No new crates anticipated. macOS chip detection uses `sysctl`/`system_profiler` (already shelled elsewhere) — no new dependency.
- Bandwidth table is a new small static asset (Apple chip → GB/s), maintained in-repo.

## Quality Gates

**Functional**

- [ ] On a 16 GB profile, models whose estimated RAM exceeds usable memory render disabled with a reason; on a 64 GB profile the same models become enabled — driven entirely by `detect_hardware_profile()`, no catalog tiers consulted.
- [ ] A model with no native FIM tokens never appears in the completion-slot recommendation; a model with no tool-call template never appears in the agent-slot recommendation — verified from the GGUF header, not catalog flags.
- [ ] `read_gguf_capabilities` returns correct FIM / tool / thinking flags reading **only** a Range-limited header (assert bytes downloaded ≪ file size) for at least 3 representative models (a coder/FIM model, a tool-calling chat model, a thinking model).
- [ ] MoE model (`gemma-4-26B-A4B`) reports a higher tok/s than a dense model of similar on-disk size, reflecting active-param decode.
- [ ] A too-large non-catalog model (e.g. a 70B Q4) is rejected on consumer profiles and accepted on a 128 GB profile.
- [ ] HF search results receive the same verdict treatment as catalog entries.
- [ ] Capability-read failure degrades gracefully (catalog flag + "unverified" marker), never blocks the list.

**Calibration**

- [ ] `pnpm calibrate:model-fit` runs the sample manifest end-to-end on real hardware, producing a committed calibration report (measured vs estimated tok/s + RAM, per-model and aggregate error).
- [ ] After applying the harness's proposed constants, the engine's estimated tok/s is within an agreed error band (target: ±25% median) of measured on the calibration sample — and **no shipped estimate is presented as measured**.
- [ ] The harness is opt-in and excluded from the normal build/CI test run; `measure_model_runtime` is unreachable from user-facing surfaces.

**Testing**

- [ ] `cargo test` covers the engine (memory estimate, tok/s, fit/speed classification, MoE path) and the GGUF-header parser (incl. `truncated` handling) with fixture headers.
- [ ] `pnpm test` covers the store wiring and the disabled-with-reason rendering logic.
- [ ] `pnpm typecheck` passes; new commands typed in `tauri.ts`.

**Design**

- [ ] Verdict badges and disabled states look polished in light + dark mode, neutral palette, consistent with existing model cards.
- [ ] Estimates are clearly labeled (`~`) and never presented as measured.
- [ ] No unrunnable model silently disappears from the list.

## Out of Scope

- **Phase 2 — Automatic empirical self-correction**: capture real tok/s from llama-server runtime metadata on *every* user run, store per (model, hardware), override the per-model estimate in the UI, and feed deltas back to recalibrate the engine constants continuously. This is the *automatic, always-on* loop. It is distinct from the v1 **calibration harness** (in scope above), which is a *one-shot, operator-driven* grounding of the shipped constants on a fixed sample. The harness measures-and-tunes once before release; Phase 2 measures-and-tunes forever from live usage. The harness's `measure_model_runtime` command and report format are the reusable foundation Phase 2 builds on.
- **Capability *competence* probing**: a one-shot tool-call / infill request after download to confirm the model is *good* at the feature (v1 verifies the mechanism exists, not its quality).
- **Benchmark-based quality ranking** (whichllm's scorer, multi-source benchmark merge, evidence-confidence tiers).
- **Discrete-GPU / multi-vendor modeling** (NVIDIA/AMD/Intel VRAM, partial-offload layer-count math, CPU AVX feature detection).
- **Auto-selecting the optimal quantization** per repo from the HF file list (pick-heaviest-that-fits) — desirable, but a follow-up; v1 verdicts the quant(s) presented.
- **Whisper model recommendation**.
