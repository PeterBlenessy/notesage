# Whisper Production Fixes — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-24 |
| **Status** | Complete |
| **Bug report** | [whisper-not-working-production](../bugs/2026-03-24-whisper-not-working-production.md) |
| **Total** | 8 tasks: 5S, 3M |
| **Suggested order** | Sequential (#1-#8), all straightforward |

---

## Task 1: Add macOS entitlements for microphone access

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/Entitlements.plist`, `src-tauri/tauri.conf.json` |

- [x] Done — created `Entitlements.plist` with `com.apple.security.device.audio-input`, referenced in `tauri.conf.json`

---

## Task 2: Add silence detection to stop_recording

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/transcription.rs` |

- [x] Done — computes RMS and peak amplitude, logs warning if peak < 0.0001

---

## Task 3: Make dictation use configurable model with fallback

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | both |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/transcription.rs`, `src/hooks/useSpeechRecognition.ts`, `src/lib/tauri.ts` |

- [x] Done — `start_dictation` accepts `model` param, falls back to any downloaded model via `find_any_downloaded_model()`

---

## Task 4: Return audio level in AudioBufferInfo for frontend warning

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | both |
| **Dependencies** | Depends on #2 |
| **Files** | `src-tauri/src/commands/transcription.rs`, `src/lib/tauri.ts`, `src/components/recording/TranscriptionDialog.tsx` |

- [x] Done — added `rms` and `peak` to `AudioBufferInfo`, frontend shows warning toast when peak < 0.0001

---

## Task 5: Run batch transcription model load on blocking thread

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/transcription.rs` |

- [x] Done — wrapped model load + transcription in `tokio::task::spawn_blocking()`, changed `whisper_ctx` to `Arc<Mutex<...>>` for cross-thread sharing

---

## Task 6: Log and emit errors from dictation background thread

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/transcription.rs` |

- [x] Done — `create_state()` and `full()` errors now logged and counted; after 3 consecutive errors, emits final error event and breaks loop

---

## Task 7: Clean up stale `.downloading` temp files on startup

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/transcription.rs` |

- [x] Done — `TranscriptionState::new()` scans for `*.downloading` files and deletes them on startup

---

## Task 8: Create models_dir on startup

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/transcription.rs` |

- [x] Done — `TranscriptionState::new()` calls `create_dir_all()` on the models directory
