# Hardware-Aware Local Model Recommendation — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-06-02 |
| **Status** | Not started |
| **PRD** | [hardware-aware-model-recommendation](../prds/2026-06-02-hardware-aware-model-recommendation.md) |
| **Total** | 20 tasks: 5S, 12M, 3L |
| **Suggested order** | Backend core (#1–#7) → Calibration (#8–#10) → State/plumbing (#11–#14) → UI (#15–#19) → Tests (#20) |

## Risks & open questions

- **High blast radius — `gguf_parser.rs` refactor (#2).** The value-type readers are currently `Read`-from-`File`. Generalizing them to any `impl Read` touches the existing `parse_gguf_header` / `parse_gguf_metadata` command path. Keep the existing public signature working (add a generic inner, keep the file-path wrapper) so nothing downstream breaks.
- **Constants are un-validated until #9–#10.** No estimate should ship to users (UI tasks #15+) presented as measured. The `~` labeling (#17) and the calibration gate (#10) are what make the shipped numbers honest — do not skip them to land UI faster.
- **Bandwidth table coverage.** The Apple-chip→GB/s table (#1) will miss chips released after authoring. The conservative fallback must degrade to RAM-fit-only, never block a model.
- **HF Range-GET reliability (#3).** Some HF mirrors/CDNs may not honor `Range`. Need a fallback (widen range, or fall back to catalog flag + "unverified") so a capability read never hard-fails the list.
- **Planning-context default.** PRD sets 8192. Confirm this matches the default llama-server context Notesage launches with, else memory estimates will diverge from reality.

---

## Backend — core engine

### 1. Hardware profile module + Apple bandwidth table + `detect_hardware_profile`
**Description:** New `src-tauri/src/commands/model_fit/hardware.rs`. Extend the existing `get_system_memory()` approach (sysinfo) with memory bandwidth and chip identity. On macOS read the chip via `sysctl`/`system_profiler` and map to a small static bandwidth table (M1 ~100, M3 Pro ~150, M4 Pro ~273, Max ~410, Ultra ~819 GB/s, etc.). Unknown chip / non-macOS → conservative default bandwidth, `is_unified: false`, `backend: "cpu"`. Returns `HardwareProfile { total_ram_bytes, available_ram_bytes, chip_name, bandwidth_gbs, is_unified, backend }`. **AC:** returns a populated profile on the dev Mac with a recognized chip name and plausible bandwidth; unknown-chip path returns the conservative fallback without erroring.
**Complexity:** M · **Category:** backend · **Depends on:** — · **Files:** `src-tauri/src/commands/model_fit/hardware.rs`, `src-tauri/src/commands/model_fit/mod.rs` (new), reference `model_management.rs:220` (`get_system_memory`)

### 2. Generalize GGUF readers + capability extraction
**Description:** Refactor `gguf_parser.rs` value-type readers (`read_u32`, `read_gguf_string`, `read_gguf_value`, etc.) to operate on a generic `impl Read` source rather than only a `File`, **keeping the existing `parse_gguf_header(path)` / `parse_gguf_metadata` command working** (file-path wrapper over the generic inner). Add capability extraction from the parsed KV map → `GgufCapabilities { architecture, context_length, has_fim_tokens, has_tool_template, has_thinking, gguf_version, truncated }`. FIM = all of `tokenizer.ggml.{prefix,suffix,middle}_token_id` present; tool template = `tokenizer.chat_template` references `tool_calls`/`tools`/`function`; thinking = reuse `thinking_tags.rs` detection on the template. **AC:** existing `parse_gguf_metadata` callers unchanged; capability extraction returns correct flags for a local fixture GGUF of each kind.
**Complexity:** L · **Category:** backend · **Depends on:** — · **Files:** `src-tauri/src/commands/gguf_parser.rs`, `src-tauri/src/commands/model_fit/gguf_header.rs` (new), reference `thinking_tags.rs`

### 3. Remote header Range-GET reader + `read_gguf_capabilities` command
**Description:** Add an HTTP `Range`-request reader (reqwest) that pulls the first ~16 MB of a HF `resolve` URL and feeds it to the generic reader from #2 — never the multi-GB body. `read_gguf_capabilities(resolve_url: Option<String>, local_path: Option<String>)`: local path reads the file directly, URL uses Range-GET. Set `truncated: true` and widen the window once if metadata overruns 16 MB. Cache results keyed by repo+file+etag under `~/.notesage/cache/model-metadata/`. Fallback when `Range` is unsupported → return best-effort + `truncated`, never hard-fail. **AC:** reading a known FIM/coder model over Range reports correct caps with bytes downloaded ≪ file size (assert in #6).
**Complexity:** M · **Category:** backend · **Depends on:** #2 · **Files:** `src-tauri/src/commands/model_fit/gguf_header.rs`, reference `hf_search.rs` (HF URL construction + reqwest patterns)

### 4. Fit + speed engine (types + pure functions)
**Description:** New `src-tauri/src/commands/model_fit/types.rs` + `engine.rs`. Define `HardwareProfile`, `GgufCapabilities`, `ModelFitInput`, `Fit {Fits,Tight,WontFit}`, `Speed {Fast,Ok,Sluggish,Unusable}`, `ModelFitResult`. Implement pure functions: memory estimate (weights ≈ file size + KV cache on active params × planning-ctx + activation + overhead), bandwidth-bound tok/s (bandwidth × quant-eff × backend-factor / effective-read-bytes, MoE reads active experts with a kernel-bound floor), fit + speed classification, per-slot runnable verdict (fit ∈ {Fits,Tight} AND tok/s ≥ floor AND required mechanism present). Port constants from whichllm (`engine/vram.py`, `engine/performance.py`) into clearly-marked tables — **flag them `// UNCALIBRATED — see task #10`**. **AC:** functions compile and produce sane numbers for hand-checked dense + MoE inputs.
**Complexity:** L · **Category:** backend · **Depends on:** — · **Files:** `src-tauri/src/commands/model_fit/types.rs`, `src-tauri/src/commands/model_fit/engine.rs`, reference `scripts/spikes/model-fit-spike.mjs`

### 5. `estimate_model_fit` command
**Description:** Thin command wrapping #4: `estimate_model_fit(candidates: Vec<ModelFitInput>, profile: HardwareProfile, planning_ctx: u32) -> Vec<ModelFitResult>`. Populates `reasons` with human-readable strings for disabled badges ("needs ~42 GB", "~3 tok/s — too slow on this Mac", "no FIM support"). **AC:** given a 16 GB profile, oversized models return `WontFit` with a reason string; raising profile RAM flips them to runnable.
**Complexity:** S · **Category:** backend · **Depends on:** #1, #4 · **Files:** `src-tauri/src/commands/model_fit/mod.rs`

### 6. Rust unit tests — engine + GGUF header
**Description:** `cargo test` coverage: engine memory estimate, tok/s, fit/speed classification, MoE active-param path (assert `gemma-4-26B-A4B`-shaped input out-ranks a dense model of similar on-disk size on tok/s); GGUF header parser incl. `truncated` handling against fixture headers; Range reader asserts bytes-downloaded ≪ file size for ≥3 representative models (coder/FIM, tool-calling chat, thinking). **AC:** all new tests pass under `cd src-tauri && cargo test`.
**Complexity:** M · **Category:** backend · **Depends on:** #2, #4 · **Files:** `src-tauri/src/commands/model_fit/engine.rs` (`#[cfg(test)]`), `model_fit/gguf_header.rs` tests, fixtures under `src-tauri/tests/fixtures/` or inline

### 7. Register commands in `lib.rs`
**Description:** Add `detect_hardware_profile`, `read_gguf_capabilities`, `estimate_model_fit` to the `generate_handler![]` list and wire the `model_fit` module. Clean rebuild per CLAUDE.md (added commands). **AC:** `cd src-tauri && cargo build` succeeds; commands invokable from frontend.
**Complexity:** S · **Category:** backend · **Depends on:** #1, #3, #5 · **Files:** `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`

---

## Backend — calibration harness

### 8. `measure_model_runtime` command
**Description:** Dev/debug-gated command in `model_fit/calibration.rs`: start the real bundled `llama-server` for a given model path, run a fixed decode workload (warm-up + N tokens at planning ctx), capture **actual decode tok/s** (llama-server timing output) and **peak resident memory** (sampled during the run). Returns `RuntimeMeasurement { model_path, measured_tok_per_sec, peak_ram_bytes, decode_tokens }`. Reuse `local_inference.rs` server lifecycle; ensure teardown. **Not** registered on any user-facing surface. **AC:** running against a downloaded model returns a plausible tok/s and peak RAM; server is cleanly stopped afterward.
**Complexity:** M · **Category:** backend · **Depends on:** #4 · **Files:** `src-tauri/src/commands/model_fit/calibration.rs`, reference `local_inference.rs`

### 9. Calibration harness script + report writer
**Description:** `scripts/calibrate-model-fit.ts` + a sample manifest (dense vs MoE × Q4_K_M/Q5–Q6/Q8 × small/medium/large of already-downloaded models). For each entry: call `measure_model_runtime` and `estimate_model_fit`, diff measured vs estimated (memory + tok/s), compute per-model and aggregate error, and write a human-readable report under `docs/audits/` plus a proposed constant-table diff. Add `pnpm calibrate:model-fit` (opt-in, excluded from normal build/CI). Harness never auto-writes constants. **AC:** `pnpm calibrate:model-fit` runs end-to-end on a manifest of downloaded models and emits a committed report with the comparison table.
**Complexity:** L · **Category:** both · **Depends on:** #5, #8 · **Files:** `scripts/calibrate-model-fit.ts`, `scripts/model-fit-manifest.json`, `package.json` (script), `docs/audits/` (output)

### 10. Apply calibrated constants + lock the error band
**Description:** Run #9 on real hardware, apply the proposed constant adjustments to `engine.rs`, re-run to confirm estimated tok/s lands within the agreed band (target ±25% median) on the sample, and record the validated report. Update the `// UNCALIBRATED` markers to reference the calibration date/report. **AC:** post-tuning report shows median error ≤ target band; no shipped estimate is presented as measured.
**Complexity:** S · **Category:** backend · **Depends on:** #9 · **Files:** `src-tauri/src/commands/model_fit/engine.rs`, `docs/audits/<date>-model-fit-calibration.md`

---

## Frontend — state & plumbing

### 11. TS interfaces + `tauri.ts` bindings
**Description:** Mirror the Rust structs (`HardwareProfile`, `GgufCapabilities`, `ModelFitInput`, `ModelFitResult`, `Fit`/`Speed` unions) in TS and add typed wrappers for `detect_hardware_profile`, `read_gguf_capabilities`, `estimate_model_fit` in `src/lib/tauri.ts`. **AC:** `pnpm typecheck` passes; wrappers callable. (`measure_model_runtime` is intentionally **not** exposed here.)
**Complexity:** S · **Category:** frontend · **Depends on:** #7 · **Files:** `src/lib/tauri.ts`

### 12. `local-ai-store` — profile + fit/caps maps
**Description:** Add non-persisted `hardwareProfile: HardwareProfile | null`, `fitById: Map<string, ModelFitResult>`, `capsById: Map<string, GgufCapabilities>`, and actions to set/clear them. Recomputed per session (not in `partialize`). **AC:** store unit test covers set/clear and selector reads.
**Complexity:** M · **Category:** frontend · **Depends on:** #11 · **Files:** `src/stores/local-ai-store.ts`

### 13. `settings-store` — `localPlanningContext`
**Description:** Add persisted `localPlanningContext: number` (default 8192) driving the memory estimate. **AC:** persists across reload; default applied on first run. Confirm the default matches the context llama-server is actually launched with (see risks).
**Complexity:** S · **Category:** frontend · **Depends on:** — · **Files:** `src/stores/settings-store.ts`

### 14. `useModelFit` orchestration hook
**Description:** Fetch `detect_hardware_profile` once per session, read capabilities (`read_gguf_capabilities`) and estimates (`estimate_model_fit`) for a given candidate set, populate the store maps, dedupe/cache so re-renders don't refetch. Drive `planning_ctx` from #13. Capability-read failure → leave caps unverified (don't block). **AC:** opening Local AI settings populates verdicts for catalog models without redundant IPC.
**Complexity:** M · **Category:** frontend · **Depends on:** #12, #13 · **Files:** `src/hooks/useModelFit.ts`

---

## Frontend — UI

### 15. Per-model verdict row + verified capability chips
**Description:** In `LocalAISettings.tsx` model cards, render the computed verdict line (`✓ Fits · ~24 tok/s`, `~ Tight · ~5 tok/s`, `✗ Needs ~42 GB`) and capability chips (FIM / Tools / Vision / Think) reflecting **verified** caps, visually distinct from unverified. Stop reading `recommended_for` for the recommendation (keep the field in the schema). Neutral palette, design-system compliant. **AC:** cards show live verdicts driven by `useModelFit`; no tier strings remain in the UI path.
**Complexity:** M · **Category:** frontend · **Depends on:** #14 · **Files:** `src/components/settings/LocalAISettings.tsx`, `src/components/settings/LocalAIModelsDialog.tsx`

### 16. Disabled-with-reason cards + sort unrunnable below
**Description:** Unrunnable models render greyed with download disabled, a reason badge + tooltip ("Won't fit — needs ~42 GB, you have 16 GB" / "Runs at ~3 tok/s — too slow for chat"), sorted below runnable models. Never hidden. **AC:** on a constrained profile, oversized/too-slow models are visibly disabled with the reason and ordered last.
**Complexity:** M · **Category:** frontend · **Depends on:** #15 · **Files:** `src/components/settings/LocalAISettings.tsx`, `src/components/settings/LocalAIModelsDialog.tsx`

### 17. Loading / uncertain / error states + `~` labeling
**Description:** Capability-loading → skeleton on capability chips; estimate present → `~` prefix with a tooltip noting figures are pre-measurement estimates (seeds Phase 2); capability-read error → fall back to catalog flag with a muted "unverified" marker rather than blocking. **AC:** all three states render correctly; every speed/fit number carries `~` and reads as an estimate, never "measured".
**Complexity:** S · **Category:** frontend · **Depends on:** #15 · **Files:** `src/components/settings/LocalAISettings.tsx`

### 18. Per-slot "Recommended for your Mac" shortlist
**Description:** When configuring the completion or agent routing slot, show a shortlist of only verified-runnable + slot-capable models (FIM for completions, tool template for agents), best tok/s first — replacing today's RAM-tier filter. **AC:** completion slot never lists a non-FIM model; agent slot never lists a model without a tool template; ordering is by estimated tok/s.
**Complexity:** M · **Category:** frontend · **Depends on:** #14 · **Files:** routing/connection model pickers under `src/components/settings/`, `src/stores/routing-store.ts` (read-only)

### 19. Extend verdicts to HuggingFace search results
**Description:** Apply the same `useModelFit` verdict treatment to live HF search results (per-file size + params from `hf_search`), so any GGUF repo gets fits / tok/s / capability badges and the disabled-with-reason treatment before download. **AC:** searching a non-catalog repo yields the same verdict UI as catalog entries, including disabled state for unrunnable results.
**Complexity:** M · **Category:** frontend · **Depends on:** #14, #16 · **Files:** the HF search results UI in `src/components/settings/LocalAIModelsDialog.tsx`, reference `hf_search.rs`

### 20. Frontend tests — store wiring + disabled rendering
**Description:** Vitest coverage for the `local-ai-store` map actions and the disabled-with-reason rendering logic (runnable vs disabled, reason text, sort order, slot-capability filtering). **AC:** `pnpm test` passes; covers the constrained-profile path and the FIM/agent slot filters.
**Complexity:** M · **Category:** frontend · **Depends on:** #12, #16 · **Files:** `src/stores/__tests__/local-ai-store.test.ts`, `src/components/settings/__tests__/LocalAISettings.test.tsx`
