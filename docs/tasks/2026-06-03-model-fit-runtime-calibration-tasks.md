# Local Model-Fit Runtime Calibration (Phase 2) — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-06-03 |
| **Status** | Not started |
| **PRD** | [model-fit-runtime-calibration](../prds/2026-06-03-model-fit-runtime-calibration.md) |
| **Total** | 13 tasks: 6S, 7M |
| **Suggested order** | Backend (#1–#2) → Measurement state/logic (#3–#6) → UI (#7) → Community share (#8–#12) → Tests (#13) |

## Risks & open questions

- **High blast radius — #1 touches the streaming hot path.** `ai_streaming.rs` is the shared local/cloud streaming layer. Adding a timings emit must be additive (a new event field/payload) and must not alter existing `ai-stream-*` behaviour. Cover with the existing streaming tests + a manual local-chat smoke check.
- **Timings availability varies by provider.** `llama-server` emits `timings.predicted_per_second`; Ollama/openai_compatible may not. Phase 2 targets `local_bundled` first; the wall-clock fallback (tokens ÷ elapsed) covers the rest. Don't record a measurement when neither a reliable timing nor a clean wall-clock window exists.
- **Peak RAM via polling is approximate.** Sampling the server RSS every ~100–250 ms during a generation can miss the instantaneous peak. Acceptable — it's a better signal than the estimate. Document it as approximate; don't oversell "measured RAM" precision.
- **Privacy is the headline feature — encode it as tests, not prose.** #13's "no network from the measurement path" and "no GitHub write token shipped" assertions are the regression locks that keep a future refactor from quietly turning this into telemetry. Treat them as load-bearing.
- **Prefill URL length.** GitHub issue-form prefill rides in the query string; keep the payload compact (a handful of models) so the URL stays well under browser/GitHub limits. If a power user has dozens of measurements, cap the shared set (e.g. top N by sampleCount) and note it in the dialog.
- **Pseudonymity, stated honestly.** The share dialog must say the GitHub handle is visible — do not label the flow "anonymous" (see PRD).

---

## Backend

### 1. Emit real decode timings on local stream completion
**Description:** In the local streaming path, surface `llama-server`'s `timings.predicted_per_second` and decoded token count to the frontend — e.g. include them in the `ai-stream-done` payload (or a new `ai-stream-timings` event) for `local_bundled`. Additive only; must not change existing chunk/done semantics for any provider. **AC:** after a `local_bundled` generation, the frontend receives the real decode tok/s + token count; cloud/other providers are unaffected (existing streaming tests still pass); a local chat still streams normally (manual smoke).
**Complexity:** M · **Category:** backend · **Depends on:** — · **Files:** `src-tauri/src/commands/ai_streaming.rs` (reference the existing `ai-stream-done` emit ~line 535 consumer in `useDirectApiChat.ts`)

### 2. `get_local_server_rss` command
**Description:** Add a command that returns the current resident memory (bytes) of the running bundled server, by PID from `LocalInferenceState`. Reuse the `ps`-based `sample_rss_bytes` helper already written in `model_fit/calibration.rs` (extract it to a shared spot if cleaner). Returns 0/None when no server is running. **AC:** while the local server runs, the command returns a plausible RSS; returns gracefully when stopped. Registered in `lib.rs` + wrapped in `tauri.ts`.
**Complexity:** S · **Category:** backend · **Depends on:** — · **Files:** `src-tauri/src/commands/local_inference.rs` (or `model_fit/`), `src-tauri/src/lib.rs`, `src/lib/tauri.ts`

---

## Measurement state & logic

### 3. RuntimeMeasurement store (persisted, chip-keyed)
**Description:** Add a persisted measurement store (new `model-fit-measurement-store` or a slice of `local-ai-store`): `Record<modelId, RuntimeMeasurement>` plus the bound `chipName`. `RuntimeMeasurement = { modelId, measuredTokPerSec (rolling median), peakRamBytes (rolling max), decodeTokens, sampleCount, measuredAt }`. Actions: `recordMeasurement(modelId, tokPerSec, peakRam, decodeTokens)` (updates rolling median/max + bumps count), `getMeasurement(modelId)`, and chip-change invalidation (if persisted `chipName` ≠ current profile's, clear all). **AC:** recording N samples yields a stable rolling median; a changed `chipName` discards prior measurements; persists across reload. Unit-tested.
**Complexity:** M · **Category:** frontend · **Depends on:** — · **Files:** `src/stores/model-fit-measurement-store.ts` (new), reference `local-ai-store.ts` persist pattern

### 4. Capture measurements from real local runs
**Description:** Orchestrate capture: when a `local_bundled` generation completes (the `ai-stream-done` path in `useDirectApiChat.ts`), read the real tok/s + token count from #1 (fallback to wall-clock tokens÷elapsed when timings absent), and use the peak of `get_local_server_rss` (#2) polled during the generation. Record via #3 only when decodeTokens ≥ a threshold (e.g. 32). **AC:** a sufficiently long local generation produces exactly one recorded measurement with sane tok/s + peak RAM; short replies and non-local providers record nothing.
**Complexity:** M · **Category:** frontend · **Depends on:** #1, #2, #3 · **Files:** `src/hooks/useDirectApiChat.ts` (or a small `useModelFitCapture` hook it calls), `src/lib/ai/model-fit-runtime.ts` (new)

### 5. Host correction factors
**Description:** Compute per-host `speedScale = median(measured/estimated)` and `ramScale` across measured models, with guardrails: require ≥ 2 measured models before applying, clamp each scale to [0.5, 2.0]. Pure function in `lib/ai/model-fit.ts` consuming the measurement store + the engine estimates. **AC:** with <2 measurements the scale is identity (1.0); with ≥2 it's the clamped median ratio; a wild outlier can't push a scale outside the clamp. Unit-tested.
**Complexity:** S · **Category:** frontend · **Depends on:** #3 · **Files:** `src/lib/ai/model-fit.ts`

### 6. Wire measured + host-scaled numbers into `useModelFit`
**Description:** In the Phase 1 hook, when rendering a model: if it has a direct measurement (#3), surface the measured tok/s + RAM; otherwise apply the host scale (#5) to the engine estimate. Expose per-model `{ source: 'measured' | 'scaled-estimate' | 'estimate' }` so the UI can label it. **AC:** a measured model shows its measured numbers; an unmeasured model on a host with ≥2 measurements shows a scaled estimate that moves toward real performance; a fresh host shows the raw prior. 
**Complexity:** M · **Category:** frontend · **Depends on:** #3, #5 · **Files:** `src/hooks/useModelFit.ts`, `src/lib/ai/model-fit.ts`

---

## UI display

### 7. Measured-vs-estimated verdict display
**Description:** Extend the verdict line (ModelCard / `fitSummary`) to show measured numbers without the `~` and with a small "measured" marker + tooltip ("Measured on this Mac on <date> over N runs"); scaled estimates keep `~`. Neutral palette, no new chrome. **AC:** measured models read as measured (no `~`), estimates read as estimates; legible in light + dark.
**Complexity:** S · **Category:** frontend · **Depends on:** #6 · **Files:** `src/components/settings/ModelCard.tsx`, `src/lib/ai/model-fit.ts` (extend `fitSummary` or add a sibling)

---

## Community share (opt-in, no telemetry)

### 8. `buildCalibrationShare` payload builder
**Description:** Pure function `buildCalibrationShare(profile, measurements, appVersion)` → `{ issueUrl, markdown }`. Emits ONLY the whitelisted fields: chip, total_ram_gb, bandwidth_gbs, app_version, and per-model `{ model, quant, params_b, measured_tok_per_sec, peak_ram_gb }`. No paths, prompts, document content, or app-added identifiers. Caps the model set (top N by sampleCount) to keep the URL small. **AC:** output contains exactly the whitelist (asserted by test); URL is well-formed and under length limits; markdown is paste-ready.
**Complexity:** S · **Category:** frontend · **Depends on:** #3 · **Files:** `src/lib/ai/calibration-share.ts` (new)

### 9. GitHub Issue Form template
**Description:** Add a structured GitHub Issue Form (`.github/ISSUE_TEMPLATE/model-fit-calibration.yml`) with labeled fields matching the share payload, a fixed label (e.g. `calibration-data`), and a short intro explaining it's a hardware/model performance contribution. This is the harvest target maintainers ingest into the calibration manifest. **AC:** template renders on GitHub's new-issue page; the prefill URL from #8 targets it correctly.
**Complexity:** S · **Category:** backend (repo config) · **Depends on:** — · **Files:** `.github/ISSUE_TEMPLATE/model-fit-calibration.yml` (new)

### 10. Share dialog (consent-forward) + open-in-browser + copy-markdown
**Description:** A dialog that shows the share payload **verbatim** before any action, states plainly that a GitHub submission carries the user's handle (pseudonymous, not anonymous), and offers two actions: "Open GitHub to share" (opens the prefilled #8 URL in the default browser via the existing external-open path — locate the app's `openExternal`/opener usage) and "Copy as markdown". No embedded token; the app never posts. Neutral palette; Tooltips inside a TooltipProvider. **AC:** the dialog displays the exact fields; "Open GitHub" opens the prefilled form in the browser; "Copy" copies the markdown; nothing is transmitted by the app itself.
**Complexity:** M · **Category:** frontend · **Depends on:** #8, #9 · **Files:** `src/components/settings/CalibrationShareDialog.tsx` (new)

### 11. Trigger logic (one-time, N-model gate, respects dismissal)
**Description:** Show the #10 dialog once after the host has direct measurements for **N distinct models** (e.g. 3). Persist `{ promptedAt, dontAskAgain }`; never re-prompt after dismissal or "Don't ask again". Gate the whole prompt behind the settings toggle (#12). **AC:** the prompt appears exactly once at the threshold; "Don't ask again" suppresses it permanently across restarts; disabling the toggle suppresses it.
**Complexity:** M · **Category:** frontend · **Depends on:** #3, #10 · **Files:** trigger hook (e.g. `src/hooks/useCalibrationSharePrompt.ts` new), `src/stores/settings-store.ts` (share state)

### 12. Settings toggle — "Offer to share calibration data"
**Description:** Add a toggle in Settings → Local AI (default on for the *prompt*; the prompt only ever opens a reviewable submission, never sends). Copy must make clear nothing is sent automatically and is never worded to undercut the Local AI "nothing leaves your device" promise. **AC:** toggle persists; off → no prompt ever; on → prompt eligible per #11.
**Complexity:** S · **Category:** frontend · **Depends on:** #11 · **Files:** `src/components/settings/LocalAISettings.tsx`, `src/stores/settings-store.ts`

---

## Tests

### 13. Tests + privacy regression locks
**Description:** Unit tests for: measurement store (rolling median, rolling-max RAM, chip-change discard, persistence), host-scale clamp + ≥2 guardrail, `buildCalibrationShare` field whitelist (asserts NO path/prompt/document/identifier fields), and measured-vs-estimate display source. **Privacy regression locks:** (a) a test asserting the measurement/capture path issues **no network call**; (b) a test asserting the app ships **no GitHub write credential** (the share path is browser-URL/clipboard only). **AC:** `pnpm test` green; the two privacy-lock tests fail if a future change adds a beacon or an embedded token.
**Complexity:** M · **Category:** frontend · **Depends on:** #3, #4, #5, #8, #10 · **Files:** `src/stores/__tests__/model-fit-measurement-store.test.ts`, `src/lib/ai/__tests__/calibration-share.test.ts`, `src/lib/ai/__tests__/model-fit.test.ts` (extend)
