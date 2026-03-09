# Voice Transcription Integration Research

Research date: 2026-03-08

**Constraint: Solution must work fully local/offline — no cloud API dependencies.**

## Executive Summary

Two-option approach — both implemented:

**Option 1 — Web Speech API** (`webkitSpeechRecognition`): Lightweight real-time dictation for chat input and editor. Proven in TeamAI project. Zero dependencies, browser-native. May need whisper-rs fallback if WKWebView doesn't support it (research indicates it's broken in WKWebView but needs validation).

**Option 2 — whisper-rs** (whisper.cpp Rust bindings with Metal GPU): High-quality offline meeting transcription. Records mic + system audio, transcribes post-recording with timestamps and channel-based speaker attribution. Models downloaded on-demand (~142 MB for base, up to 2.9 GB for large-v3).

Both options are fully local/offline. See PRD: `docs/prds/2026-03-08-voice-transcription.md`

---

## 1. Local/Offline Transcription

### whisper.cpp via Rust Bindings — TOP PICK

C/C++ port of OpenAI's Whisper model with mature Rust bindings.

**Rust crates:**

| Crate | Notes |
| --- | --- |
| `whisper-rs` | Most mature. Feature flags for `metal` (Apple Silicon GPU), `coreml`, `cuda`. v0.15.1. |
| `whisper-cpp-plus` | Newer. Real-time PCM streaming + Silero Voice Activity Detection built in. |
| `rwhisper` | Higher-level wrapper, simpler API. |

**Model sizes (GGML format):**

| Model | Params | Size | Speed (Apple Silicon) | Use Case |
| --- | --- | --- | --- | --- |
| Tiny | 39M | 75 MB | \~10x real-time | Quick drafts |
| Base | 74M | 142 MB | \~7x real-time | Good balance for real-time |
| Small | 244M | 466 MB | \~4x real-time | Good accuracy |
| Medium | 769M | 1.5 GB | \~2x real-time | High accuracy |
| Large-v3 | 1.55B | 2.9 GB | \~1x real-time | Best accuracy |
| Turbo | — | \~1.5 GB | Near base speed | Medium accuracy at base speed |

- **Pricing:** Free, MIT license
- **Quality:** Large-v3 is state-of-the-art. English-only variants outperform multilingual at same size.
- **Languages:** 100+
- **Real-time:** Yes with streaming APIs (small/base models)
- **Privacy:** Fully offline
- **Diarization:** Not built-in — needs pairing with another tool
- **Integration complexity:** Medium. Proven in Tauri via [Pothook](https://github.com/acknak/pothook) project.

### Vosk

- **Crate:** `vosk` (safe FFI bindings)
- **Tauri plugin:** `tauri-plugin-stt` — ready-made Tauri 2.x plugin with auto model download
- **Pricing:** Free, Apache 2.0
- **Quality:** Good but lower accuracy than Whisper. Models much smaller (\~50 MB).
- **Languages:** 20+
- **Real-time:** Yes, designed for streaming with zero-latency
- **Diarization:** Basic speaker ID built-in — **only local option with Rust bindings**
- **Integration complexity:** Low — the Tauri plugin is plug-and-play
- **Limitation:** Lower accuracy than Whisper, fewer languages, less active community

### Rust-Native ML Frameworks

| Framework | Whisper Support | Notes |
| --- | --- | --- |
| [Candle](https://github.com/huggingface/candle) (Hugging Face) | Yes, includes Whisper example | Pure Rust, Metal/CUDA GPU. 3-5x faster than Python. |
| [Burn](https://github.com/tracel-ai/burn) | Voxtral Mini 4B Realtime | Pure Rust, newer. Real-time streaming speech recognition demo. |

- **Pricing:** Free (MIT/Apache)
- **Integration complexity:** High — handle model loading, tokenization, audio preprocessing yourself
- **Verdict:** Less battle-tested than whisper.cpp bindings. Consider only if avoiding C++ dependencies is critical.

---

## 2. Web APIs (Browser/WKWebView)

Tauri v2 uses WKWebView on macOS, which provides access to some Web APIs for audio capture. However, transcription capabilities are severely limited.

### API Compatibility in Tauri's WKWebView

| API | WKWebView Status | Notes |
| --- | --- | --- |
| `getUserMedia` (audio) | **Works** | Needs `NSMicrophoneUsageDescription` in Info.plist. Double permission prompt on macOS 14+ ([Tauri #11951](https://github.com/tauri-apps/tauri/issues/11951)). Permissions may not persist between restarts ([#8979](https://github.com/tauri-apps/tauri/issues/8979)). |
| `MediaRecorder` | **Works** | MP4/AAC only (no WebM/Ogg). Newer Safari adds ALAC and PCM codecs. Enabled since Safari 14.3. |
| `AudioContext` (basic) | **Works** | `ScriptProcessorNode` works. Can route mic audio for visualization/metering. |
| `AudioWorklet` | **Not available** | [WebKit bug #182506](https://bugs.webkit.org/show_bug.cgi?id=182506) open since 2018. Not in production Safari/WKWebView. Experimental flag only. |
| `SpeechRecognition` | **Broken** | Works in Safari proper but NOT in WKWebView. Errors immediately without requesting mic access. |
| `getDisplayMedia` | **Broken** | Permission issues on macOS 14+ ([wry #1101](https://github.com/tauri-apps/wry/issues/1101), [wry #1195](https://github.com/tauri-apps/wry/issues/1195)). No system audio capture. |
| `SharedArrayBuffer` | **Requires COOP/COEP** | Extra headers needed; may conflict with Tauri's local serving. |

### What Web APIs Can Do

**Audio capture (mic only):** `getUserMedia` + `MediaRecorder` can record microphone audio as MP4/AAC blobs. The recorded blob can be sent to the Rust backend via `invoke()` for processing. This is a viable alternative to native `cpal` for mic recording.

**Real-time audio routing:** `getUserMedia` + `AudioContext` + `ScriptProcessorNode` can provide raw PCM buffers on the main thread. Could feed audio to WASM Whisper, but `ScriptProcessorNode` is deprecated, runs on the main thread (causes UI jank), and the absence of `AudioWorklet` makes this unreliable for real-time use.

### What Web APIs Cannot Do

- **Transcription:** `SpeechRecognition` is broken in WKWebView. No browser-native STT available.
- **System audio:** `getDisplayMedia` is broken. Cannot capture Zoom/Teams audio via web APIs.
- **Low-latency audio processing:** No `AudioWorklet` means no off-main-thread audio processing. WASM Whisper in the frontend is impractical for real-time.
- **WASM Whisper:** Without `AudioWorklet` and `SharedArrayBuffer`, running whisper.cpp WASM with live audio is unreliable. Only viable for processing pre-recorded audio files (not live transcription).

### Web API Verdict

Web APIs can serve as a **secondary mic capture path** (`getUserMedia` + `MediaRecorder` → send blob to Rust backend), but they cannot replace native Rust audio processing for transcription. The native path (`cpal` → `whisper-rs`) is faster, more reliable, and supports system audio capture.

**If using Web APIs for mic capture, Tauri config needed:**

```xml
<!-- src-tauri/Info.plist -->
<key>NSMicrophoneUsageDescription</key>
<string>Notesage needs microphone access for voice transcription</string>
```

### WebAssembly Whisper (Frontend-Side, Pre-Recorded Only)

| Project | Notes |
| --- | --- |
| [whisper.cpp WASM](https://ggml.ai/whisper.cpp/) | Official WASM build with real-time demo |
| [Transformers.js](https://huggingface.co/docs/transformers.js) | Hugging Face JS bindings, handles WASM compilation |
| [Whisper Web](https://whisperweb.app/) | WASM + WebGPU acceleration |

- Limited to tiny/base models for reasonable WASM performance
- Could work for transcribing imported audio files (not live recording)
- **Verdict:** For a Tauri app, running whisper.cpp in the Rust backend via `whisper-rs` is significantly faster and more capable. WASM is only worth considering if you want a zero-Rust-dependency fallback for small files.

---

## 3. Audio Capture in Tauri/Desktop Apps

### Microphone Capture

| Approach | Type | Notes |
| --- | --- | --- |
| `cpal` | Rust crate | Cross-platform audio I/O. CoreAudio on macOS. Low-latency. Stream callbacks not `Send+Sync` on macOS. |
| `tauri-plugin-mic-recorder` | Tauri v2 plugin | Uses `cpal` + `hound`. Records to WAV. v2.0.0 (March 2025). |
| `tauri-plugin-audio-recorder` | Tauri v2 plugin | Pause/resume, quality levels, device listing, permission requests. |
| `tauri-plugin-stt` | Tauri v2 plugin | Combined mic capture + Vosk transcription. |
| `rodio` | Rust crate | Higher-level, built on `cpal`. Recording + playback. |
| `getUserMedia` + `MediaRecorder` | Web API | Works in WKWebView. MP4/AAC output. Double permission prompt quirk. |

**Recommendation:** `tauri-plugin-mic-recorder` for simplest integration, raw `cpal` for maximum control. Web API as fallback.

### System Audio Capture (Recording Meeting Apps)

This is the **hardest part**. Capturing Zoom/Teams audio requires system-level audio loopback.

| Approach | macOS Version | Notes |
| --- | --- | --- |
| `screencapturekit` Rust crate | macOS 13+ | Rust bindings for Apple's ScreenCaptureKit. Audio-only capture supported. **Best option.** |
| `cpal` with ScreenCaptureKit host | macOS 13+ | [PR #894](https://github.com/RustAudio/cpal/pull/894) adds system audio as input device. |
| Virtual audio device (BlackHole) | All macOS | Requires user to install third-party software. Poor UX. |
| `getDisplayMedia` Web API | — | **Broken in WKWebView.** Not viable. |

**Key considerations:**

- ScreenCaptureKit requires macOS 13+ and user permission (screen recording prompt)
- System audio capture always requires explicit user consent
- For meetings: need both mic + system audio simultaneously (your voice + remote participants)
- The `screencapturekit` crate tested on macOS 14.5 / M1 — works for WAV recording

---

## 4. Meeting-Specific Features

### Speaker Diarization (Local Only)

| Approach | Type | Quality | Notes |
| --- | --- | --- | --- |
| **Vosk** | Rust bindings | Basic | Only option with Rust bindings. Lower quality but easiest to integrate. |
| **pyannote-audio** | Python subprocess | State-of-the-art OSS | Requires bundling Python or requiring user install. |
| **WhisperX** | Python subprocess | Whisper + pyannote | Best OSS meeting pipeline. Requires Python. |
| **Separate audio channels** | Hardware trick | Perfect (if available) | Record mic + system audio as separate channels → attribute by channel. No ML needed. |

**No mature pure-Rust diarization library exists.** Practical local options:

1. **Separate channels** — if recording mic + system audio separately (via `screencapturekit` + `cpal`), attribute speakers by audio source. Your voice = mic channel, remote participants = system audio channel. Simple and reliable.
2. **Vosk** — basic speaker ID with Rust bindings. Lower quality but zero additional dependencies.
3. **pyannote as subprocess** — best quality but requires Python runtime. Could bundle via PyInstaller or require user install.

### Real-Time vs Post-Recording

| Mode | Best Option | Notes |
| --- | --- | --- |
| Real-time preview | whisper.cpp streaming (base model) or Vosk | Lower accuracy, immediate feedback |
| Final transcript | whisper.cpp (large-v3 model) | Best accuracy, process after recording ends |

**Hybrid approach:** Show rough real-time transcript during meeting (base model), re-process with larger model after meeting ends. Best of both worlds.

### Timestamps & Formatting

- whisper.cpp provides word-level and segment-level timestamps natively
- Punctuation is automatic in Whisper models
- Markdown formatting (speaker labels, timestamps, paragraphs) done in Notesage during conversion

---

## 5. Existing Open-Source Reference Projects

| Project | Tech Stack | Relevance |
| --- | --- | --- |
| [**Pothook**](https://github.com/acknak/pothook) | Tauri + whisper.cpp + Rust | **Closest reference.** Has `whisper.rs` backend module. |
| [**Whispering**](https://github.com/henliao/whispering) | Tauri-based | Press shortcut, speak, get text. |
| [**taurscribe**](https://github.com/machowdh/taurscribe) | Tauri + Whisper + PyAudio | Windows-focused. |
| [**Buzz**](https://github.com/chidiwilliams/buzz) | Python + Qt | Cross-platform Whisper GUI. Real-time + batch. |
| [**MacWhisper**](https://goodsnooze.gumroad.com/l/macwhisper) | Native macOS | $29/$79. Polished, batch only. |
| [**WhisperX**](https://github.com/m-bain/whisperX) | Python | Whisper + diarization + word timestamps. Best OSS meeting pipeline. |

---

## 6. Recommended Architecture (Local-Only)

```
Audio Input
├── Microphone (cpal / tauri-plugin-mic-recorder)
└── System Audio (screencapturekit, macOS 13+)
     ↓
  WAV buffer (16-bit PCM, 16kHz mono — Whisper's native format)
     ↓
  whisper-rs (Metal GPU on Apple Silicon)
     ↓
  TranscriptionResult { segments: [{ start, end, text, speaker? }] }
     ↓
  Markdown formatter (speaker labels, timestamps, sections)
     ↓
  .md file in project
```

### Core Stack

- **`whisper-rs`** with `metal` feature in `src-tauri/` for Apple Silicon GPU acceleration
- **`tauri-plugin-mic-recorder`** or raw `cpal` for microphone capture
- **`screencapturekit`** for system audio (meeting apps, macOS 13+)
- Ship with `base` model (\~142 MB), offer `small`/`medium`/`large` as downloadable upgrades
- Post-recording transcription for best quality; optional real-time preview with `base` model

### Diarization Strategy

- **Primary:** Separate audio channels (mic = you, system audio = others) — no ML needed
- **Secondary:** Vosk basic speaker ID for single-source recordings
- **Future:** pyannote subprocess if high-quality single-source diarization is needed

### New Tauri Commands

```rust
// Audio capture
start_recording(source: "microphone" | "system" | "both") -> Result<(), String>
stop_recording() -> Result<AudioBuffer, String>

// Local transcription
transcribe_local(audio: AudioBuffer, model: String) -> Result<TranscriptionResult, String>

// Model management
download_whisper_model(size: String) -> Result<(), String>  // with progress events
list_whisper_models() -> Result<Vec<ModelInfo>, String>
delete_whisper_model(size: String) -> Result<(), String>
```

### Markdown Output Format

```markdown
---
type: meeting-transcript
date: 2026-03-08
duration: "45:23"
participants:
  - Speaker A
  - Speaker B
tags:
  - meeting
  - standup
---

# Meeting Transcript — March 8, 2026

## 00:00 – Opening

**[00:00:12] Speaker A:** Welcome everyone to the weekly standup...

**[00:00:45] Speaker B:** Thanks. I wanted to discuss the roadmap...

## 00:15 – Discussion

**[00:15:03] Speaker A:** Let's move on to the design review...
```

### Estimated Complexity

| Component | Effort | Dependencies |
| --- | --- | --- |
| Mic recording | Low | `tauri-plugin-mic-recorder` (plug-and-play) |
| System audio capture | Medium | `screencapturekit` crate, macOS 13+ |
| Local transcription (whisper-rs) | Medium | whisper-rs + model download system |
| Channel-based diarization | Low | Separate mic/system audio streams |
| Vosk speaker ID | Medium | Vosk crate + model download |
| Real-time preview | Medium | Streaming whisper.cpp + UI updates |
| Markdown formatting | Low | Pure frontend logic |
| Model download/management | Medium | Progress events, storage management |

---

## Appendix: Cloud API Options (Reference Only)

Included for completeness — **not recommended** given the local-only constraint, but could be offered as an optional upgrade path in the future.

| Service | Price/min | Real-Time | Diarization | Languages |
| --- | --- | --- | --- | --- |
| OpenAI GPT-4o Transcribe Diarize | $0.006 | No (batch) | Yes (built-in) | 100+ |
| OpenAI Whisper API | $0.006 | No (batch) | No | 50+ |
| Deepgram Nova-3 | $0.0043–0.0077 | Yes (WebSocket) | Yes (included) | 45+ |
| AssemblyAI Universal-2 | $0.0025+ | Yes (300ms) | Yes (+$0.02/hr) | 99 |
| Azure Speech | $0.017 | Yes | Yes (included) | 100+ |
| Google Cloud STT | $0.024 | Yes | Yes (included) | 125+ |
| AWS Transcribe | $0.024 | Yes | Yes (included) | 100+ |
| Anthropic Claude | N/A | N/A | N/A | **No speech-to-text API** |

---

## Sources

- [whisper-rs](https://github.com/tazz4843/whisper-rs) — Rust bindings for whisper.cpp
- [whisper-cpp-plus](https://github.com/operator-kit/whisper-cpp-plus-rs) — Rust bindings with streaming + VAD
- [Pothook](https://github.com/acknak/pothook) — Tauri + Whisper reference app
- [tauri-plugin-mic-recorder](https://github.com/ayangweb/tauri-plugin-mic-recorder) — Tauri v2 mic plugin
- [tauri-plugin-stt](https://github.com/brenogonzaga/tauri-plugin-stt) — Tauri v2 Vosk plugin
- [screencapturekit crate](https://crates.io/crates/screencapturekit/1.5.0) — macOS system audio
- [Candle](https://github.com/huggingface/candle) — Rust ML framework with Whisper
- [WhisperX](https://github.com/m-bain/whisperX) — Whisper + diarization pipeline
- [Can I WebView - Speech Recognition](https://caniwebview.com/features/web-feature-speech-recognition/)
- [WebKit Bug #182506 - AudioWorklet](https://bugs.webkit.org/show_bug.cgi?id=182506)
- [Tauri Issue #11951 - macOS Microphone Permission](https://github.com/tauri-apps/tauri/issues/11951)
- [Tauri Issue #8979 - Permissions not remembered](https://github.com/tauri-apps/tauri/issues/8979)
- [Wry Issue #1101 - getDisplayMedia on macOS Sonoma](https://github.com/tauri-apps/wry/issues/1101)
