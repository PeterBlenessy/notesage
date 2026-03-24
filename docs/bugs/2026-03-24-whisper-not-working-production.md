# Bug: Whisper transcription not working in production build

|  |  |
| --- | --- |
| **Date observed** | 2026-03-24 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Impact** | Voice dictation and transcription unusable on production builds |
| **Versions affected** | Unknown (never tested on production laptop) |
| **Tasks** | [whisper-production-fixes-tasks](../tasks/2026-03-24-whisper-production-fixes-tasks.md) |

## Symptoms

- Dictation produces no output or hallucinated text
- Transcription of recordings returns empty or nonsensical results
- No error messages shown to the user

## Root cause

Multiple issues contributing:

1. **Missing macOS entitlements** — production `.app` bundle lacked `com.apple.security.device.audio-input` entitlement. In dev mode macOS doesn't enforce this, so `cpal` captures audio. In production, the stream receives silence. **Fixed in 123c7f3.**
2. **No silence detection** — recordings of silence (blocked mic) appear successful. User proceeds to transcribe, waits for model load, gets empty/hallucinated output. **Partially fixed in 123c7f3** (backend logs warning, but frontend not informed).
3. **Dictation hardcoded to `base` model** — ignored user's default model setting, failed if `base` wasn't downloaded even when other models were available. **Fixed in next commit.**
4. **Batch transcription blocks async runtime** — `WhisperContext::new_with_params()` in `transcribe()` runs on the Tauri async command handler, blocking for seconds on large models.
5. **Dictation errors silently swallowed** — `create_state()` and `full()` failures in the background thread `continue` the loop with no logging or frontend notification.
6. **Stale `.downloading` temp files** — app crash mid-download leaves `ggml-{size}.bin.downloading` files. No cleanup on startup.
7. **`models_dir` never created on startup** — `~/.notesage/whisper-models/` only created during first download.

## Affected files

- `src-tauri/src/commands/transcription.rs` — all transcription logic
- `src-tauri/Entitlements.plist` — macOS entitlements (new)
- `src-tauri/tauri.conf.json` — entitlements reference
- `src/hooks/useSpeechRecognition.ts` — dictation frontend
- `src/hooks/useRecording.ts` — recording frontend
- `src/lib/tauri.ts` — API types
