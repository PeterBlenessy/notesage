# PRD: Local Model-Fit Runtime Calibration (Phase 2)

|  |  |
| --- | --- |
| **Date** | 2026-06-03 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | The pre-download model recommendations stop being permanent guesses: once a user actually runs a local model, the app learns its true speed + memory on *their* Mac, shows measured numbers instead of estimates, and sharpens the estimates for every model they haven't downloaded yet — all on-device. An optional, consent-forward path lets willing users contribute their measurement to a public community dataset that improves the shipped defaults for everyone. |
| **Tasks** | [model-fit-runtime-calibration-tasks](../tasks/2026-06-03-model-fit-runtime-calibration-tasks.md) |
| **Phase** | Local AI |
| **Follows** | [hardware-aware-model-recommendation](2026-06-02-hardware-aware-model-recommendation.md) (Phase 1) |

## Problem

Phase 1 ships a **prior**: it predicts a model's RAM fit and decode tok/s before download, from `(file size, params, quant)` × the host's `(RAM, bandwidth)`, using constants baked into the binary. Those numbers carry a `~` and are honestly labelled estimates. Two gaps remain:

1. **The guess never becomes truth.** A user can download Qwen3-8B, run it daily for a month, and the app still shows the same predicted "~24 tok/s" — even though their machine reports the *real* rate on every single run. The app already has the ground truth sitting in `llama-server`'s response and never reads it.
2. **The prior can't learn the user's machine.** The shipped constants are a population average over the Macs the maintainer tested. A user's specific thermal envelope, background load, OS version, or an Apple chip newer than the bandwidth table all push their real numbers off the prior — permanently, because nothing corrects it.

Phase 1's own out-of-scope section names the fix: an automatic, on-device self-correction loop. This PRD specifies it. It also specifies an **opt-in** way for users who want to help to contribute their measurement back, so the *shipped* prior keeps improving without the maintainer hand-running the calibration harness on every Mac variant.

## Goals / Non-Goals

**Goals**

1. **Harvest real runs.** Whenever a local model finishes a generation, capture its actual decode tok/s + peak RAM on this machine — from data the run already produces, at zero extra cost.
2. **Replace the estimate with the measurement.** Once a model has a measurement on this host, the UI shows the measured number (no `~`, a "measured" marker) instead of the prior.
3. **Learn the host.** Maintain per-host correction factors (speed + memory) from the measured models, and apply them to the *estimates* of not-yet-downloaded models — so even pre-download verdicts get more accurate for this user.
4. **Stay fully local by default.** Everything above happens on-device, persisted locally, transmitted nowhere. No beacon, no endpoint, consistent with the "no data ever leaves your device" promise of Local AI.
5. **Offer an opt-in community share.** After meaningful usage, give willing users a one-time, explicit, fully-reviewable way to contribute their measurement to a public community dataset — via a prefilled GitHub submission, no telemetry infrastructure and no shipped credential.

**Non-Goals**

- **Silent / automatic telemetry.** No background transmission of anything, ever. Sharing is always an explicit user action.
- **A server-side ingestion endpoint or data pipeline.** The community path rides on GitHub; Notesage runs no collection service.
- **Cross-device sync of measurements.** A user's measurements are local to each machine (different hardware → different numbers anyway).
- **Replacing the Phase 1 prior.** The prior is still required for the cold-start, model-not-yet-downloaded decision. Phase 2 corrects it; it does not remove it.
- **Benchmark-style ranking or a leaderboard UI inside the app.** Out of scope (the community dataset may grow one on GitHub, but that's not an app feature).

## User Stories

- *As a user who runs a local model daily*, I want the app to show how fast it **actually** runs on my Mac, so the number I see is real instead of a guess.
- *As a user with a brand-new Mac the app doesn't know yet*, I want the estimates to self-correct after I run a model or two, so the recommendations fit my actual hardware.
- *As a privacy-focused user*, I want all of this to happen on my machine with nothing sent anywhere unless I explicitly choose to share.
- *As a user who wants to help*, I want a clear, one-click way to contribute my (benign) measurement to improve the app for everyone — and to see exactly what gets shared before it does.

## Technical Approach

### 1. Measurement capture (`src/lib/ai/model-fit-runtime.ts` + reuse of the local run path)

- After a `local_bundled` (and, where available, `local`/Ollama) generation completes, read the real decode rate. `llama-server` returns a `timings` object (`predicted_per_second`) on its `/v1/chat/completions` response; request it on the streaming path via `stream_options.include_usage` / the final chunk. Fallback when timings are absent: wall-clock `tokens / elapsed` measured around the stream.
- Capture **peak RAM** by sampling the local server process RSS during the generation. Reuse the sampling logic already written for the calibration harness (`model_fit/calibration.rs`) behind a lightweight command, or sample the known server PID from `local-ai-store`.
- Only record runs above a small token threshold (e.g. ≥ 32 decoded tokens) so a one-word reply doesn't pollute the rate. Keep a rolling median per `(modelId)` so one hot/cold run doesn't swing the number.

### 2. Local store (`model-fit-store` or a slice of `local-ai-store`, persisted)

```ts
interface RuntimeMeasurement {
  modelId: string;
  measuredTokPerSec: number;   // rolling median
  peakRamBytes: number;        // rolling max
  decodeTokens: number;        // last sample size
  sampleCount: number;
  measuredAt: string;          // ISO
}
```

- Persisted to disk (survives restart), keyed by `modelId`. Bound to the current hardware via a stored `chipName` — if the chip changes (new machine, same profile sync), measurements are discarded (they don't transfer).

### 3. Host correction factors

- `speedScale = median(measured / estimated)` across all measured models on this host; `ramScale` likewise.
- The `useModelFit` hook (Phase 1) applies these scales to the engine's raw estimate when rendering a model that has **no** direct measurement, and shows the **direct** measurement when one exists.
- Guardrails: require ≥ 2 measured models before trusting `speedScale` (one sample is noise); clamp the scale to a sane range (e.g. 0.5–2.0) so a pathological outlier can't make estimates absurd.

### 4. Display (extends Phase 1 UI)

- A model with a direct measurement shows e.g. **"31 tok/s · measured"** (no `~`), with a tooltip "Measured on this Mac on <date> over N runs."
- Models with only a host-scaled estimate keep the `~` but are quietly more accurate.
- A tiny "measured" vs "estimated" distinction in the verdict line — neutral palette, no new chrome.

### 5. Opt-in community share (consent-forward, no telemetry)

**Trigger.** After the host has direct measurements for **N distinct models** (e.g. 3), show a one-time dialog. Respect "Don't ask again" permanently; never re-nag. Gated behind a settings toggle too (Settings → Local AI → "Offer to share calibration data": default on for the *prompt*, but the prompt only ever *opens a reviewable submission* — it never sends anything itself).

**What's shared (the entire payload — shown verbatim in the dialog before anything happens):**

```
chip: Apple M3 Pro
total_ram_gb: 36
bandwidth_gbs: 150
app_version: 0.46.0
measurements:
  - model: qwen3-8b   quant: Q4_K_M   params_b: 8    measured_tok_per_sec: 31.2   peak_ram_gb: 6.1
  - model: qwen2.5-coder-7b ...
```

No document content, no prompts, no file paths, no account identifiers added by us.

**Mechanism — prefilled GitHub submission, browser-based:**

- Build a prefilled URL into a **GitHub Issue Form** (structured YAML template in `.github/ISSUE_TEMPLATE/`) — or a Discussions category — in the `peterblenessy/notesage` repo, with the payload pre-populated.
- Open it in the user's **default browser** via the opener plugin. The user is already signed into GitHub there, reviews the exact prefilled content, and clicks submit themselves. **No embedded token; nothing is posted by the app.** This removes both the "silent beacon" objection and the "shippable write credential" risk.
- Provide a **"Copy as markdown"** button alongside, so users without a GitHub account (or who prefer not to use it) can contribute by pasting into a Discussion, a forum, or nowhere at all.

**Honest framing (load-bearing):**

- The dialog says **"Share with the community"**, not "anonymous telemetry." It states plainly that a GitHub submission carries the user's GitHub handle (→ pseudonymous, not anonymous), and that the data fields themselves contain only hardware specs + model names + two numbers.
- This UI is **never** shown inside, or worded to undercut, the Local AI "nothing leaves your device" copy. It lives behind an explicit, separate action.

**Harvest loop (maintainer side, no new infra):** submissions land as structured GitHub issues/discussions → periodically ingested into `model-fit-calibration-manifest.json` → fed through the Phase 1 calibration harness → improved shipped constants in a later release. The community share thus closes the loop on the *shipped prior* without a single byte of automatic telemetry.

## Data Model

- `RuntimeMeasurement` (above), persisted per `modelId` under the host's `chipName`.
- Host factors: `{ chipName, speedScale, ramScale, measuredModelCount }`.
- Share state: `{ promptedAt?: string, dontAskAgain: boolean }` in settings.
- Share payload schema (the verbatim block above) — a pure builder `buildCalibrationShare(profile, measurements, appVersion)` returning both the prefilled-URL string and the copyable markdown.

## Dependencies

- Phase 1 (shipped): engine, `useModelFit`, `local-ai-store` fit/caps maps, `measure_model_runtime` sampling logic.
- `llama-server` timings (already emitted) / wall-clock fallback.
- `tauri-plugin-opener` (already in the capability allowlist) for opening the prefilled GitHub URL.
- A GitHub Issue Form template added under `.github/ISSUE_TEMPLATE/`.

## Quality Gates

**Functional**

- [ ] After a local model completes a sufficiently long generation, a `RuntimeMeasurement` is recorded for it, and its verdict line switches from `~estimate` to a `measured` number.
- [ ] With ≥ 2 measured models, a *held-out* not-yet-downloaded model's displayed estimate shifts toward the host's real performance (host-scale applied), and the scale is clamped to the sane range.
- [ ] Changing the detected chip discards prior measurements (they don't leak across hardware).
- [ ] **Nothing is transmitted automatically** — verified by a test asserting no network call originates from the measurement/recording path.
- [ ] The share dialog is opt-in, one-time, and honours "Don't ask again" permanently.
- [ ] The share action only ever **opens a browser URL** (or copies markdown) — it never posts via an embedded credential. A test asserts the app ships no GitHub write token.
- [ ] The shared payload contains exactly the whitelisted fields (hardware + model names + two numbers) and no document/prompt/path data — asserted by a unit test on `buildCalibrationShare`.

**Design**

- [ ] "measured" vs "estimated" distinction is legible in both themes, neutral palette, no `~` on measured numbers.
- [ ] The share dialog truthfully describes the GitHub-handle (pseudonymous) reality and is never bundled with the "nothing leaves your device" local-AI copy.

## Out of Scope

- **Automatic/silent telemetry of any kind**, and any server-side ingestion endpoint.
- **In-app leaderboard / benchmark browser** (the community dataset may grow one on GitHub; not an app feature here).
- **Cross-device measurement sync.**
- **Auto-applying community data to a running client** — community submissions improve the *shipped* constants via a maintainer-reviewed release, never hot-pushed to clients.
- **Non-Apple GPU runtime modelling** (inherited from Phase 1 scope).
