use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptSegment>,
    pub duration_secs: f64,
    pub language: String,
}

/// A timestamped transcript segment. `speaker_id` / `speaker_name` are reserved
/// for a future diarization + naming pass and are always `None` in v1.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TranscriptSegment {
    /// Seconds from recording start.
    pub start: f64,
    /// Seconds from recording start.
    pub end: f64,
    pub text: String,
    /// Reserved for diarization; `None` in v1.
    pub speaker_id: Option<String>,
    /// Reserved for the naming pass; `None` in v1.
    pub speaker_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ModelInfo {
    pub name: String,
    pub size_bytes: u64,
    pub downloaded: bool,
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub languages_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hf_repo_id: Option<String>,
    /// Longer explanation, shown on demand rather than in the row.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Exactly where the file comes from. Shown so "downloads a model" is a
    /// checkable claim rather than something the user has to take on trust.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
    /// On disk but no longer offered — listed so it stays visible and
    /// deletable instead of silently occupying gigabytes.
    #[serde(default)]
    pub retired: bool,
}

/// Returned by `stop_recording`. Carries the finalized WAV path plus enough
/// signal metadata for the frontend's silence-detection warning.
#[derive(Serialize, Deserialize, Clone)]
pub struct RecordingResult {
    /// Absolute path to the finalized WAV file on disk.
    pub path: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
    pub source: String,
    /// RMS amplitude of the recorded audio (0.0 = silence).
    pub rms: f32,
    /// Peak amplitude of the recorded audio (0.0 = silence).
    pub peak: f32,
}

// ---------------------------------------------------------------------------
// WAV writer — minimal 16-bit PCM writer (avoids a new dependency)
// ---------------------------------------------------------------------------

/// Streaming WAV writer for 16-bit PCM. Writes a placeholder header up front,
/// appends samples incrementally, and patches the RIFF/data sizes on finalize.
/// `finalize()` MUST be called (and is, by the capture owner) before the file
/// is considered valid.
struct WavWriter {
    file: std::fs::File,
    /// Total number of i16 samples written (across all channels).
    samples_written: u64,
}

impl WavWriter {
    fn create(path: &Path, sample_rate: u32, channels: u16) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create recording directory: {}", e))?;
        }
        let mut file = std::fs::File::create(path)
            .map_err(|e| format!("Failed to create WAV file: {}", e))?;

        // Write a 44-byte canonical header with placeholder sizes (0). These
        // are patched in `finalize()` once the sample count is known.
        let header = wav_header(sample_rate, channels, 0);
        file.write_all(&header)
            .map_err(|e| format!("Failed to write WAV header: {}", e))?;

        Ok(Self {
            file,
            samples_written: 0,
        })
    }

    /// Append a block of f32 samples (interleaved if multi-channel), clamping
    /// to [-1.0, 1.0] and converting to 16-bit PCM.
    fn write_f32(&mut self, data: &[f32]) -> Result<(), String> {
        let mut bytes = Vec::with_capacity(data.len() * 2);
        for &s in data {
            let clamped = s.clamp(-1.0, 1.0);
            let v = (clamped * i16::MAX as f32) as i16;
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        self.file
            .write_all(&bytes)
            .map_err(|e| format!("Failed to write WAV samples: {}", e))?;
        self.samples_written += data.len() as u64;
        Ok(())
    }

    /// Patch the RIFF chunk size and data chunk size, then flush. Consumes self.
    fn finalize(mut self) -> Result<(), String> {
        let data_bytes = self.samples_written * 2; // 16-bit
        let riff_size = 36 + data_bytes;

        // RIFF chunk size at offset 4 (u32 LE)
        self.file
            .seek(SeekFrom::Start(4))
            .map_err(|e| format!("WAV seek error: {}", e))?;
        self.file
            .write_all(&(riff_size as u32).to_le_bytes())
            .map_err(|e| format!("WAV write error: {}", e))?;

        // data chunk size at offset 40 (u32 LE)
        self.file
            .seek(SeekFrom::Start(40))
            .map_err(|e| format!("WAV seek error: {}", e))?;
        self.file
            .write_all(&(data_bytes as u32).to_le_bytes())
            .map_err(|e| format!("WAV write error: {}", e))?;

        self.file
            .flush()
            .map_err(|e| format!("WAV flush error: {}", e))?;
        Ok(())
    }
}

/// Build a 44-byte canonical WAV header for 16-bit PCM.
fn wav_header(sample_rate: u32, channels: u16, data_bytes: u32) -> Vec<u8> {
    let bits_per_sample: u16 = 16;
    let byte_rate = sample_rate * channels as u32 * (bits_per_sample as u32 / 8);
    let block_align = channels * (bits_per_sample / 8);
    let riff_size = 36 + data_bytes;

    let mut h = Vec::with_capacity(44);
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&riff_size.to_le_bytes());
    h.extend_from_slice(b"WAVE");
    h.extend_from_slice(b"fmt ");
    h.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    h.extend_from_slice(&1u16.to_le_bytes()); // PCM
    h.extend_from_slice(&channels.to_le_bytes());
    h.extend_from_slice(&sample_rate.to_le_bytes());
    h.extend_from_slice(&byte_rate.to_le_bytes());
    h.extend_from_slice(&block_align.to_le_bytes());
    h.extend_from_slice(&bits_per_sample.to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&data_bytes.to_le_bytes());
    h
}

/// Read a 16-bit PCM WAV file into (samples_f32, sample_rate, channels).
/// Minimal parser: handles the canonical layout produced by `WavWriter` and
/// tolerates extra chunks before `data`.
fn read_wav_f32(path: &Path) -> Result<(Vec<f32>, u32, u16), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read WAV file: {}", e))?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Not a valid WAV file".into());
    }

    let mut channels: u16 = 1;
    let mut sample_rate: u32 = 16000;
    let mut bits_per_sample: u16 = 16;
    let mut data: Option<(usize, usize)> = None; // (offset, len)

    // Walk chunks starting after the 12-byte RIFF/WAVE header.
    let mut pos = 12usize;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes([
            bytes[pos + 4],
            bytes[pos + 5],
            bytes[pos + 6],
            bytes[pos + 7],
        ]) as usize;
        let body = pos + 8;
        if id == b"fmt " && body + 16 <= bytes.len() {
            channels = u16::from_le_bytes([bytes[body + 2], bytes[body + 3]]);
            sample_rate = u32::from_le_bytes([
                bytes[body + 4],
                bytes[body + 5],
                bytes[body + 6],
                bytes[body + 7],
            ]);
            bits_per_sample = u16::from_le_bytes([bytes[body + 14], bytes[body + 15]]);
        } else if id == b"data" {
            let end = (body + size).min(bytes.len());
            data = Some((body, end - body));
            break;
        }
        // Chunks are word-aligned (padded to even length).
        pos = body + size + (size & 1);
    }

    let (offset, len) = data.ok_or("WAV file missing data chunk")?;
    if bits_per_sample != 16 {
        return Err(format!(
            "Unsupported WAV bit depth: {} (only 16-bit PCM supported)",
            bits_per_sample
        ));
    }

    let mut samples = Vec::with_capacity(len / 2);
    let mut i = offset;
    while i + 2 <= offset + len {
        let v = i16::from_le_bytes([bytes[i], bytes[i + 1]]);
        samples.push(v as f32 / i16::MAX as f32);
        i += 2;
    }

    Ok((samples, sample_rate, channels))
}

// ---------------------------------------------------------------------------
// Capture owner — single mic-stream owner with awaited teardown
// ---------------------------------------------------------------------------

/// Owns exactly one mic stream + the WAV file it writes to. The `cpal::Stream`
/// (which is `!Send`) lives entirely on the capture thread, so the owner is
/// `Send` and can be parked in managed state.
///
/// CRITICAL INVARIANT (#264): `stop()` signals the capture thread to stop, then
/// **joins** it — the thread drops the stream and finalizes the WAV before it
/// exits, so by the time `stop()` returns CoreAudio has fully released the
/// device. No second stream can open while a previous owner is alive because
/// the owner sits in a mutex-guarded `Option` and is only `take()`-n by `stop`.
struct CaptureOwner {
    source: String,
    path: PathBuf,
    sample_rate: u32,
    channels: u16,
    stop_signal: Arc<AtomicBool>,
    /// While set, the input callback discards samples (nothing is written to
    /// the WAV, stats don't accumulate). The cpal stream itself stays alive —
    /// pausing never tears down or reopens the CoreAudio stream, so the #264
    /// single-stream invariant is untouched.
    pause_signal: Arc<AtomicBool>,
    /// Result reported back from the capture thread on teardown (rms, peak).
    stats: Arc<Mutex<Option<CaptureStats>>>,
    /// `WavWriter::finalize()` result reported back from the capture thread.
    /// `None` until the thread finishes finalizing; `Some(Ok(()))` on success,
    /// `Some(Err(..))` if the RIFF/data-size patch or flush failed. `stop()`
    /// surfaces the `Err` so a corrupt/incomplete WAV is never scheduled for
    /// transcription.
    finalize_result: Arc<Mutex<Option<Result<(), String>>>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

#[derive(Clone, Copy, Default, Debug)]
struct CaptureStats {
    rms: f32,
    peak: f32,
    /// Total i16-equivalent samples actually written (interleaved across
    /// channels). Paused stretches contribute nothing, so this — not wall
    /// clock — is the source of truth for the recorded duration.
    samples: u64,
}

/// Recorded duration from the written-sample count — pause-aware, unlike the
/// wall-clock `start_time.elapsed()`.
fn duration_from_samples(samples: u64, sample_rate: u32, channels: u16) -> f64 {
    let per_second = sample_rate as u64 * channels.max(1) as u64;
    if per_second == 0 {
        return 0.0;
    }
    samples as f64 / per_second as f64
}

impl CaptureOwner {
    /// Pause/resume the capture without touching the cpal stream. Idempotent.
    fn set_paused(&self, paused: bool) {
        self.pause_signal.store(paused, Ordering::Relaxed);
    }

    /// Signal stop, await full teardown (stream dropped + thread joined), and
    /// return capture stats. Idempotent-ish: a second call after the thread is
    /// already joined returns default stats.
    fn stop(&mut self) -> Result<CaptureStats, String> {
        self.stop_signal.store(true, Ordering::Relaxed);

        // Await thread teardown — the stream is dropped and the WAV finalized
        // INSIDE the thread before it returns. This join is the load-bearing
        // synchronization point for #264.
        if let Some(thread) = self.thread.take() {
            thread
                .join()
                .map_err(|_| "Capture thread panicked during teardown".to_string())?;
        }

        // Surface a WAV finalize failure as an error — the file on disk is
        // corrupt/incomplete and must not be handed to transcription. `None`
        // means the thread was already joined on a prior `stop()` call; we keep
        // the prior contract of re-reporting stats in that case.
        if let Some(result) = self
            .finalize_result
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?
            .take()
        {
            result?;
        }

        let stats = self
            .stats
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?
            .unwrap_or_default();
        Ok(stats)
    }
}

impl Drop for CaptureOwner {
    fn drop(&mut self) {
        // Defensive: if an owner is dropped without an explicit stop (e.g. app
        // exit), still tear down the stream and join the thread so CoreAudio is
        // released and the WAV is finalized.
        self.stop_signal.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Spawn the single cpal input stream on a dedicated thread that streams
/// samples to `path` (a WAV file). Returns the owner once the stream is
/// confirmed playing. The thread owns the `cpal::Stream` and the `WavWriter`,
/// finalizing the WAV on stop.
fn spawn_capture(app: AppHandle, source: String, path: PathBuf) -> Result<CaptureOwner, String> {
    let stop_signal = Arc::new(AtomicBool::new(false));
    let pause_signal = Arc::new(AtomicBool::new(false));
    let stats: Arc<Mutex<Option<CaptureStats>>> = Arc::new(Mutex::new(None));
    let finalize_result: Arc<Mutex<Option<Result<(), String>>>> = Arc::new(Mutex::new(None));

    let stop = stop_signal.clone();
    let pause = pause_signal.clone();
    let stats_t = stats.clone();
    let finalize_t = finalize_result.clone();
    let path_t = path.clone();

    // Setup barrier — the thread reports (sample_rate, channels) on success or
    // an error string on failure. We block on this ONCE during start (not in
    // the stop path), which is acceptable: it returns immediately once the
    // stream is built.
    let (tx, rx) = std::sync::mpsc::channel::<Result<(u32, u16), String>>();

    let thread = std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                let _ = tx.send(Err("No microphone available".into()));
                return;
            }
        };

        let default_config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(Err(format!("Failed to get default audio config: {}", e)));
                return;
            }
        };

        let config = cpal::StreamConfig {
            channels: default_config.channels(),
            sample_rate: default_config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };
        let actual_rate = config.sample_rate;
        let actual_channels = config.channels;

        log::info!(
            target: "notesage::transcription",
            "Audio input: {}Hz, {} channel(s) → {}",
            actual_rate, actual_channels, path_t.display()
        );

        // Create the WAV writer for this capture. The stream callback can't own
        // it directly (it must finalize after the stream stops), so we share it
        // via a mutex with the callback.
        let writer = match WavWriter::create(&path_t, actual_rate, actual_channels) {
            Ok(w) => w,
            Err(e) => {
                let _ = tx.send(Err(e));
                return;
            }
        };
        let writer = Arc::new(Mutex::new(Some(writer)));

        // Running signal accumulators for the final stats.
        let sum_sq = Arc::new(Mutex::new(0.0f64));
        let count = Arc::new(Mutex::new(0u64));
        let peak = Arc::new(Mutex::new(0.0f32));

        let writer_cb = writer.clone();
        let sum_sq_cb = sum_sq.clone();
        let count_cb = count.clone();
        let peak_cb = peak.clone();
        let app_cb = app.clone();
        let pause_cb = pause.clone();
        let ch = actual_channels as usize;

        let err_fn = |err: cpal::StreamError| {
            log::error!(target: "notesage::transcription", "Audio stream error: {}", err);
        };

        let stream = match device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Paused: discard the block entirely — nothing written, no
                // stats — but keep the level meter alive at zero so the UI
                // visibly flatlines instead of freezing on the last value.
                if pause_cb.load(Ordering::Relaxed) {
                    let _ = app_cb.emit(
                        "recording-level",
                        serde_json::json!({ "mic": 0.0_f32, "system": 0.0_f32 }),
                    );
                    return;
                }
                // Write to disk.
                if let Ok(mut guard) = writer_cb.lock() {
                    if let Some(w) = guard.as_mut() {
                        let _ = w.write_f32(data);
                    }
                }
                // Accumulate stats + emit a level event for the UI.
                if data.is_empty() {
                    return;
                }
                let mut block_sq = 0.0f64;
                let mut block_peak = 0.0f32;
                for &s in data {
                    block_sq += (s * s) as f64;
                    let a = s.abs();
                    if a > block_peak {
                        block_peak = a;
                    }
                }
                if let Ok(mut g) = sum_sq_cb.lock() {
                    *g += block_sq;
                }
                if let Ok(mut g) = count_cb.lock() {
                    *g += data.len() as u64;
                }
                if let Ok(mut g) = peak_cb.lock() {
                    if block_peak > *g {
                        *g = block_peak;
                    }
                }
                // Mono-mixed RMS for the level meter.
                let frames = (data.len() / ch.max(1)).max(1);
                let rms = (block_sq / data.len() as f64).sqrt() as f32;
                let _ = frames;
                let _ = app_cb.emit(
                    "recording-level",
                    serde_json::json!({ "mic": rms, "system": 0.0_f32 }),
                );
            },
            err_fn,
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                let _ = tx.send(Err(format!("Failed to build audio stream: {}", e)));
                return;
            }
        };

        if let Err(e) = stream.play() {
            let _ = tx.send(Err(format!("Failed to start audio stream: {}", e)));
            return;
        }

        // Stream is live — report success.
        let _ = tx.send(Ok((actual_rate, actual_channels)));

        // Park until told to stop.
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        // Teardown: drop the stream FIRST so no more callbacks fire, then
        // finalize the WAV. Order matters — finalizing while callbacks still
        // run would race the writer mutex.
        drop(stream);

        if let Ok(mut guard) = writer.lock() {
            if let Some(w) = guard.take() {
                let result = w.finalize();
                if let Err(e) = &result {
                    log::error!(target: "notesage::transcription", "Failed to finalize WAV: {}", e);
                }
                // Report the finalize outcome so `stop()` can fail the command
                // when the WAV is corrupt instead of scheduling a bad file.
                if let Ok(mut g) = finalize_t.lock() {
                    *g = Some(result);
                }
            }
        }

        // Compute final stats.
        let total_sq = *sum_sq.lock().unwrap_or_else(|e| e.into_inner());
        let total_count = *count.lock().unwrap_or_else(|e| e.into_inner());
        let total_peak = *peak.lock().unwrap_or_else(|e| e.into_inner());
        let rms = if total_count > 0 {
            (total_sq / total_count as f64).sqrt() as f32
        } else {
            0.0
        };
        if let Ok(mut g) = stats_t.lock() {
            *g = Some(CaptureStats {
                rms,
                peak: total_peak,
                samples: total_count,
            });
        }
    });

    // Block briefly for stream setup (returns as soon as the stream is built).
    let (actual_rate, actual_channels) = rx
        .recv()
        .map_err(|_| "Audio thread died during setup".to_string())??;

    Ok(CaptureOwner {
        source,
        path,
        sample_rate: actual_rate,
        channels: actual_channels,
        stop_signal,
        pause_signal,
        stats,
        finalize_result,
        thread: Some(thread),
    })
}

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

pub struct TranscriptionState {
    /// The single active capture owner, if any. Guarding this in a mutex is
    /// what enforces "exactly one mic stream owner at a time".
    capture: Mutex<Option<CaptureOwner>>,
    /// Set `true` while a `stop_recording` is mid-teardown — i.e. the owner has
    /// been taken out of `capture` but its cpal stream/thread is still draining.
    /// `start_recording` rejects when this is set, closing the window (#264)
    /// between `take()` and the awaited join where `capture` is momentarily
    /// `None` but a stream is still alive. Always read/written under the
    /// `capture` mutex so the check-and-set is atomic against `start_recording`.
    stopping: AtomicBool,
    // parking_lot::Mutex (not std) on purpose: this lock is held for the entire
    // whole-file Whisper inference (minutes), and an FFI panic in whisper_rs
    // under the guard would *permanently poison* a std::sync::Mutex — every
    // later transcribe_file would then fail at .lock() until app restart. Audit
    // rust H2. parking_lot never poisons, so a panicked job can't brick the
    // feature.
    whisper_ctx: Arc<parking_lot::Mutex<Option<(String, whisper_rs::WhisperContext)>>>,
    models_dir: PathBuf,
    /// Root directory for recording bundles (`~/Notesage/Recordings`).
    recordings_dir: PathBuf,
    /// Cancel signals for in-progress model downloads.
    download_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl TranscriptionState {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let models_dir = home.join(".notesage").join("whisper-models");
        let recordings_dir = home.join("Notesage").join("Recordings");

        // Ensure models directory exists on startup
        if let Err(e) = std::fs::create_dir_all(&models_dir) {
            log::warn!(target: "notesage::transcription", "Failed to create whisper models dir {}: {}", models_dir.display(), e);
        }

        // Clean up stale .downloading temp files from interrupted downloads
        if let Ok(entries) = std::fs::read_dir(&models_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".downloading") {
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    log::info!(target: "notesage::transcription", "Cleaning up stale temp file: {} ({} bytes)", name, size);
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }

        Self {
            capture: Mutex::new(None),
            stopping: AtomicBool::new(false),
            whisper_ctx: Arc::new(parking_lot::Mutex::new(None)),
            models_dir,
            recordings_dir,
            download_cancels: Mutex::new(HashMap::new()),
        }
    }

    /// The `start_recording` admission guard, factored out so production code
    /// and the #264 regression test exercise the SAME predicate. Returns `Ok(())`
    /// if a new capture may be opened, or `Err` if a recording is already active
    /// OR a stop is mid-teardown (`stopping` set). MUST be called while holding
    /// the `capture` lock so the check is atomic against `stop_recording`'s
    /// take-and-set-stopping step.
    fn check_can_start(capture_is_some: bool, stopping: bool) -> Result<(), String> {
        if capture_is_some || stopping {
            return Err("Recording already in progress".into());
        }
        Ok(())
    }

    /// Collect diagnostic info for the diagnostics export.
    pub fn collect_diagnostics(&self) -> WhisperDiagnostics {
        let models_dir_exists = self.models_dir.exists();
        let cached_model = self
            .whisper_ctx
            .lock()
            .as_ref()
            .map(|(name, _)| name.clone());

        let mut models_on_disk = Vec::new();
        let mut stale_files = Vec::new();

        if models_dir_exists {
            if let Ok(entries) = std::fs::read_dir(&self.models_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);

                    if name.ends_with(".downloading")
                        || name.ends_with(".tmp")
                        || name.ends_with(".part")
                    {
                        stale_files.push(super::model_management::DiagnosticFile {
                            name: name.clone(),
                            size_bytes: size,
                        });
                    }

                    models_on_disk.push(super::model_management::DiagnosticFile {
                        name,
                        size_bytes: size,
                    });
                }
            }
        }

        let is_recording = self.capture.lock().map(|r| r.is_some()).unwrap_or(false);

        WhisperDiagnostics {
            models_dir: self.models_dir.to_string_lossy().to_string(),
            models_dir_exists,
            models_on_disk,
            stale_files,
            cached_model,
            is_recording,
        }
    }
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct WhisperDiagnostics {
    pub models_dir: String,
    pub models_dir_exists: bool,
    pub models_on_disk: Vec<super::model_management::DiagnosticFile>,
    pub stale_files: Vec<super::model_management::DiagnosticFile>,
    pub cached_model: Option<String>,
    pub is_recording: bool,
}

// Known Whisper models with metadata
struct WhisperModelMeta {
    name: &'static str,
    size_bytes: u64,
    parameters: &'static str,
    /// The one line shown next to the model — what it is FOR, not what it is.
    description: &'static str,
    /// The longer explanation, available on demand: what the model actually is
    /// and how it measured. Users deciding between two options deserve more
    /// than a tagline, but not in their face.
    detail: &'static str,
}

// Pre-download size estimates from huggingface.co/ggerganov/whisper.cpp (2026-03).
// For downloaded models, list_whisper_models() uses the actual file size from disk.
const KNOWN_MODELS: &[WhisperModelMeta] = &[
    WhisperModelMeta {
        name: "large-v3-turbo-q5_0",
        size_bytes: 574_041_195,
        parameters: "809M",
        description: "Best quality · all languages",
        detail: "Whisper large-v3-turbo, 5-bit quantized. The accuracy of the \
full large-v3 at a sixth of the memory, and the only tier that reliably \
identifies Swedish rather than guessing at it. Measured 11.0% word error on \
Swedish and 0.6% on English; roughly 15 minutes per hour of audio.",
    },
    WhisperModelMeta {
        name: "small",
        size_bytes: 487_601_967,
        parameters: "244M",
        description: "Fast · English only",
        detail: "Whisper small. Five times faster than the quality model and \
excellent on English (1.0% word error), but weak on other languages — 25.6% \
on Swedish, roughly one word in four. Around 3 minutes per hour of audio.",
    },
];

fn model_download_url(size: &str) -> String {
    let filename = format!("ggml-{}.bin", size);
    format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
        filename
    )
}

/// Resample audio from native sample rate / channels to 16kHz mono for Whisper.
fn resample_to_16k_mono(data: &[f32], from_rate: u32, channels: u16) -> Vec<f32> {
    // Step 1: mix down to mono by averaging channels
    let mono: Vec<f32> = if channels > 1 {
        data.chunks(channels as usize)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        data.to_vec()
    };

    // Step 2: resample to 16kHz via linear interpolation
    if from_rate == 16000 {
        return mono;
    }

    let ratio = 16000.0 / from_rate as f64;
    let output_len = (mono.len() as f64 * ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_idx = i as f64 / ratio;
        let idx0 = src_idx as usize;
        let frac = (src_idx - idx0 as f64) as f32;
        let s0 = mono.get(idx0).copied().unwrap_or(0.0);
        let s1 = mono.get(idx0 + 1).copied().unwrap_or(s0);
        output.push(s0 + frac * (s1 - s0));
    }

    output
}

/// Build the default WAV path for a new recording bundle:
/// `~/Notesage/Recordings/Recording <YYYY-MM-DD HH-MM-SS>/audio.wav`.
fn new_recording_path(recordings_dir: &Path) -> PathBuf {
    let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M-%S").to_string();
    recordings_dir
        .join(format!("Recording {}", stamp))
        .join("audio.wav")
}

// ---------------------------------------------------------------------------
// Commands — capture
// ---------------------------------------------------------------------------

/// Start recording audio from the specified source, streaming samples to a WAV
/// file in the `~/Notesage/Recordings` inbox. Exactly one capture owner may be
/// active at a time.
#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    source: String,
) -> Result<(), String> {
    {
        let capture = state
            .capture
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        // Reject if a recording is active OR a stop is mid-teardown. The
        // `stopping` flag is set under this same lock by `stop_recording`, so
        // the moment `capture` reads `None` (owner taken) `stopping` is already
        // `true` — there is no window in which a second stream can open while
        // the previous owner's cpal stream is still draining (#264).
        TranscriptionState::check_can_start(
            capture.is_some(),
            state.stopping.load(Ordering::Relaxed),
        )?;
    }

    // System audio capture — not yet implemented (microphone only in v1).
    if source == "system" {
        return Err(
            "System audio capture is not yet available. Use microphone recording instead.".into(),
        );
    }
    if source == "both" {
        log::warn!(target: "notesage::transcription", "System audio capture not yet implemented — recording mic only");
    }

    let path = new_recording_path(&state.recordings_dir);
    let owner = spawn_capture(app, source.clone(), path.clone())?;

    let mut capture = state
        .capture
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    *capture = Some(owner);

    log::info!(target: "notesage::transcription", "Recording started (source: {}) → {}", source, path.display());
    Ok(())
}

/// Pause the active recording: the input callback discards samples while the
/// cpal stream stays alive. Idempotent — pausing an already-paused recording
/// is a no-op. Errors if no recording is in progress.
#[tauri::command]
pub async fn pause_recording(state: State<'_, TranscriptionState>) -> Result<(), String> {
    let capture = state
        .capture
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let owner = capture.as_ref().ok_or("No recording in progress")?;
    owner.set_paused(true);
    log::info!(target: "notesage::transcription", "Recording paused");
    Ok(())
}

/// Resume a paused recording. Idempotent. Errors if no recording is in progress.
#[tauri::command]
pub async fn resume_recording(state: State<'_, TranscriptionState>) -> Result<(), String> {
    let capture = state
        .capture
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let owner = capture.as_ref().ok_or("No recording in progress")?;
    owner.set_paused(false);
    log::info!(target: "notesage::transcription", "Recording resumed");
    Ok(())
}

/// Stop recording: signal stop, **await** stream teardown + thread join,
/// finalize the WAV, and return the finalized file path plus signal metadata.
#[tauri::command]
pub async fn stop_recording(
    state: State<'_, TranscriptionState>,
) -> Result<RecordingResult, String> {
    // Take the owner out of state AND set the `stopping` flag under the same
    // lock. The flag stays set across the (unlocked) blocking join, so a
    // concurrent `start_recording` — which checks `stopping` under this lock —
    // cannot open a second stream while the old one is still draining (#264).
    let mut owner = {
        let mut capture = state
            .capture
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let owner = capture.take().ok_or("No recording in progress")?;
        state.stopping.store(true, Ordering::Relaxed);
        owner
    };

    let source = owner.source.clone();
    let path = owner.path.clone();
    let sample_rate = owner.sample_rate;
    let channels = owner.channels;

    // Awaited teardown: this joins the capture thread, which drops the stream
    // and finalizes the WAV before returning. Runs on a blocking thread so we
    // never park the async runtime on the join. Clear `stopping` afterwards
    // regardless of outcome so a finalize error doesn't wedge recording forever.
    let stats_result = tokio::task::spawn_blocking(move || owner.stop()).await;
    state.stopping.store(false, Ordering::Relaxed);
    let stats = stats_result.map_err(|e| format!("Teardown task panicked: {}", e))??;

    // Recorded duration from the written-sample count — pause-aware, where
    // wall-clock `start_time.elapsed()` would overstate a paused recording.
    let duration = duration_from_samples(stats.samples, sample_rate, channels);

    log::info!(
        target: "notesage::transcription",
        "Recording stopped ({:.1}s @ {}Hz {}ch, rms={:.6}, peak={:.6}) → {}",
        duration, sample_rate, channels, stats.rms, stats.peak, path.display()
    );

    if stats.peak < 0.0001 {
        log::warn!(
            target: "notesage::transcription",
            "Recording appears to be silence (peak={:.6}). Microphone access may be blocked by macOS privacy settings.",
            stats.peak
        );
    }

    Ok(RecordingResult {
        path: path.to_string_lossy().to_string(),
        duration_secs: duration,
        sample_rate,
        source,
        rms: stats.rms,
        peak: stats.peak,
    })
}

// ---------------------------------------------------------------------------
// Commands — whole-file transcription
// ---------------------------------------------------------------------------

/// Transcribe a finalized audio file (whole-file, single Whisper pass).
///
/// Reads the WAV at `path`, resamples to 16kHz mono, runs Whisper once over the
/// entire file, and returns ordered timestamped segments. Emits
/// `transcription-progress` events carrying `jobId` so the orb can distinguish
/// concurrent jobs.
#[tauri::command]
pub async fn transcribe_file(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    job_id: String,
    path: String,
    model: String,
    language: Option<String>,
) -> Result<TranscriptionResult, String> {
    let audio_path = PathBuf::from(&path);
    if !audio_path.exists() {
        return Err(format!("Audio file not found: {}", path));
    }

    let model_path = state.models_dir.join(format!("ggml-{}.bin", model));
    log::info!(target: "notesage::transcription", "transcribe_file: job={}, model={}, path={}, exists={}", job_id, model, model_path.display(), model_path.exists());

    if !model_path.exists() {
        return Err(format!(
            "Model '{}' not downloaded. Download it from Settings > Transcription.",
            model
        ));
    }

    let model_path_str = model_path.to_str().ok_or("Invalid model path")?.to_string();

    let _ = app.emit(
        "transcription-progress",
        serde_json::json!({ "jobId": job_id, "percent": 2, "segment": "Loading audio..." }),
    );

    // Load + resample the WAV.
    let (raw, file_rate, file_channels) = read_wav_f32(&audio_path)?;
    let audio_data = resample_to_16k_mono(&raw, file_rate, file_channels);
    if audio_data.is_empty() {
        return Err("Audio file contains no samples".into());
    }
    let sample_rate = 16000u32;

    let _ = app.emit(
        "transcription-progress",
        serde_json::json!({ "jobId": job_id, "percent": 5, "segment": "Loading model..." }),
    );

    let whisper_ctx = state.whisper_ctx.clone();
    // An empty / missing language means auto-detect. whisper.cpp treats the
    // sentinel "auto" as "detect the spoken language for this file". Previously
    // we coerced the unset case to "en", which forced English decoding and
    // produced "[speaking in foreign language]" garbage for every other tongue.
    let lang = match language {
        Some(l) if !l.trim().is_empty() => l,
        _ => "auto".to_string(),
    };
    let lang_result = lang.clone();
    let job_id_task = job_id.clone();
    let model_task = model.clone();
    let app_final = app.clone();

    // Model load + whole-file transcription on a blocking thread so it never
    // contends with a live capture (which lives on its own dedicated thread).
    let result = tokio::task::spawn_blocking(
        move || -> Result<(Vec<TranscriptSegment>, f64, Option<String>), String> {
            // Load (or reuse cached) whisper context.
            {
                let mut ctx_lock = whisper_ctx.lock();
                let needs_reload = match &*ctx_lock {
                    Some((cached_model, _)) => cached_model != &model_task,
                    None => true,
                };
                if needs_reload {
                    log::info!(target: "notesage::transcription", "Loading Whisper model: {} ({})", model_task, model_path_str);
                    let load_start = std::time::Instant::now();
                    let params = whisper_rs::WhisperContextParameters::default();
                    let ctx =
                        whisper_rs::WhisperContext::new_with_params(&model_path_str, params)
                            .map_err(|e| format!("Failed to load Whisper model: {}", e))?;
                    log::info!(target: "notesage::transcription", "Model loaded in {:.1}s", load_start.elapsed().as_secs_f64());
                    *ctx_lock = Some((model_task.clone(), ctx));
                }
            }

            let _ = app.emit(
                "transcription-progress",
                serde_json::json!({ "jobId": job_id_task, "percent": 15, "segment": "Transcribing..." }),
            );

            let ctx_lock = whisper_ctx.lock();
            let (_, ctx) = ctx_lock.as_ref().ok_or("Whisper context not loaded")?;

            let mut params =
                whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_language(Some(&lang));

            let mut whisper_state = ctx
                .create_state()
                .map_err(|e| format!("Failed to create Whisper state: {}", e))?;

            whisper_state
                .full(params, &audio_data)
                .map_err(|e| format!("Transcription failed: {}", e))?;

            // When auto-detecting, surface the language Whisper actually picked
            // (e.g. "sv") so the transcript note records it instead of "auto".
            // A pinned language is reported back verbatim.
            let detected_lang = if lang == "auto" {
                let id = whisper_state.full_lang_id_from_state();
                whisper_rs::get_lang_str(id).map(|s| s.to_string())
            } else {
                Some(lang.clone())
            };

            let num_segments = whisper_state.full_n_segments();
            let mut segments = Vec::new();
            for i in 0..num_segments {
                let seg = whisper_state
                    .get_segment(i)
                    .ok_or_else(|| format!("Segment {} out of bounds", i))?;
                let start = seg.start_timestamp();
                let end = seg.end_timestamp();
                let text = seg
                    .to_str_lossy()
                    .map_err(|e| format!("Failed to get segment text: {}", e))?
                    .trim()
                    .to_string();

                segments.push(TranscriptSegment {
                    start: start as f64 / 100.0,
                    end: end as f64 / 100.0,
                    text: text.clone(),
                    speaker_id: None,
                    speaker_name: None,
                });

                let percent = 15 + (85 * (i + 1) as u32 / num_segments.max(1) as u32);
                let _ = app.emit(
                    "transcription-progress",
                    serde_json::json!({ "jobId": job_id_task, "percent": percent, "segment": text }),
                );
            }

            let duration_secs = audio_data.len() as f64 / sample_rate as f64;
            Ok((segments, duration_secs, detected_lang))
        },
    )
    .await
    .map_err(|e| format!("Transcription task panicked: {}", e))??;

    let (segments, duration_secs, detected_lang) = result;
    log::info!(target: "notesage::transcription", "transcribe_file complete (job={}): {} segments, {:.1}s", job_id, segments.len(), duration_secs);

    let _ = app_final.emit(
        "transcription-progress",
        serde_json::json!({ "jobId": job_id, "percent": 100, "segment": "Done" }),
    );

    Ok(TranscriptionResult {
        segments,
        duration_secs,
        // Prefer the detected language; fall back to the requested value
        // (e.g. "auto") only if Whisper couldn't map the detected id.
        language: detected_lang.unwrap_or(lang_result),
    })
}

// ---------------------------------------------------------------------------
// Commands — model management (unchanged)
// ---------------------------------------------------------------------------

/// The model list, as a pure function of what is on disk.
///
/// Split out from the command so the retired-model behaviour is testable:
/// a model the catalogue no longer offers must still be LISTED, or it
/// becomes invisible in the UI while occupying gigabytes the user cannot
/// reclaim.
fn build_model_list(models_dir: &Path) -> Vec<ModelInfo> {

    let mut models = Vec::new();

    for meta in KNOWN_MODELS {
        let path = models_dir.join(format!("ggml-{}.bin", meta.name));
        let downloaded = path.exists();
        let actual_size = if downloaded {
            std::fs::metadata(&path)
                .map(|m| m.len())
                .unwrap_or(meta.size_bytes)
        } else {
            meta.size_bytes
        };

        models.push(ModelInfo {
            name: meta.name.to_string(),
            size_bytes: actual_size,
            downloaded,
            path: if downloaded {
                path.to_str().map(|s| s.to_string())
            } else {
                None
            },
            author: Some("OpenAI".to_string()),
            license: Some("MIT".to_string()),
            parameters: Some(meta.parameters.to_string()),
            description: Some(meta.description.to_string()),
            languages_count: Some(99),
            hf_repo_id: Some("ggerganov/whisper.cpp".to_string()),
            detail: Some(meta.detail.to_string()),
            download_url: Some(model_download_url(meta.name)),
            retired: false,
        });
    }

    // Models on disk that the catalog no longer offers. Without this they
    // vanish from the UI while still occupying disk — a `medium` left over
    // from an older release is 1.5 GB the user can neither see nor delete.
    if let Ok(entries) = std::fs::read_dir(&models_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("bin") {
                continue;
            }
            let Some(name) = path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| s.strip_prefix("ggml-"))
            else {
                continue;
            };
            if models.iter().any(|m| m.name == name) {
                continue;
            }
            models.push(ModelInfo {
                name: name.to_string(),
                size_bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
                downloaded: true,
                path: path.to_str().map(|s| s.to_string()),
                author: Some("OpenAI".to_string()),
                license: Some("MIT".to_string()),
                parameters: None,
                description: Some("No longer offered".to_string()),
                languages_count: Some(99),
                hf_repo_id: Some("ggerganov/whisper.cpp".to_string()),
                detail: Some(
                    "Downloaded by an earlier version of Notesage. It still works if \
selected, but is no longer recommended — the models offered above measured better \
for their size. Safe to delete."
                        .to_string(),
                ),
                download_url: None,
                retired: true,
            });
        }
    }

    models
}

/// List available Whisper models (both downloaded and not).
#[tauri::command]
pub async fn list_whisper_models(
    state: State<'_, TranscriptionState>,
) -> Result<Vec<ModelInfo>, String> {
    Ok(build_model_list(&state.models_dir))
}

/// Download a Whisper GGML model from Hugging Face.
#[tauri::command]
pub async fn download_whisper_model(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    size: String,
) -> Result<(), String> {
    if !KNOWN_MODELS.iter().any(|m| m.name == size) {
        return Err(format!("Unknown model size: {}", size));
    }

    // Register cancel signal for this download
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut cancels = state
            .download_cancels
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if cancels.contains_key(&size) {
            return Err(format!("Model '{}' is already being downloaded", size));
        }
        cancels.insert(size.clone(), cancel.clone());
    }

    log::info!(target: "notesage::transcription", "Starting download of Whisper model '{}'", size);
    let result = download_model_inner(&app, &state, &size, &cancel).await;

    // Clean up cancel signal and temp file on cancel/error
    {
        if let Ok(mut cancels) = state.download_cancels.lock() {
            cancels.remove(&size);
        }
    }
    if let Err(ref e) = result {
        log::error!(target: "notesage::transcription", "Download of model '{}' failed: {}", size, e);
    }

    result
}

async fn download_model_inner(
    app: &AppHandle,
    state: &TranscriptionState,
    size: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    use futures::StreamExt;

    std::fs::create_dir_all(&state.models_dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;

    let url = model_download_url(size);
    let final_path = state.models_dir.join(format!("ggml-{}.bin", size));
    let temp_path = state
        .models_dir
        .join(format!("ggml-{}.bin.downloading", size));

    log::info!(target: "notesage::transcription", "Downloading model '{}' from {}", size, url);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = std::fs::remove_file(&temp_path);
            return Err("Download cancelled".to_string());
        }

        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Write error: {}", e))?;

        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "model-download-progress",
            serde_json::json!({ "model": size, "downloaded": downloaded, "total": total }),
        );
    }

    drop(file);

    std::fs::rename(&temp_path, &final_path)
        .map_err(|e| format!("Failed to finalize download: {}", e))?;

    log::info!(target: "notesage::transcription", "Model '{}' downloaded successfully ({} bytes)", size, downloaded);
    Ok(())
}

/// Cancel an in-progress model download.
#[tauri::command]
pub async fn cancel_model_download(
    state: State<'_, TranscriptionState>,
    size: String,
) -> Result<(), String> {
    let cancels = state
        .download_cancels
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    if let Some(cancel) = cancels.get(&size) {
        cancel.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err(format!("No active download for model '{}'", size))
    }
}

/// Delete a downloaded Whisper model.
#[tauri::command]
pub async fn delete_whisper_model(
    state: State<'_, TranscriptionState>,
    size: String,
) -> Result<(), String> {
    let path = state.models_dir.join(format!("ggml-{}.bin", size));

    if !path.exists() {
        return Err(format!("Model '{}' is not downloaded", size));
    }

    // Clear cached context if it was using this model
    {
        let mut ctx_lock = state.whisper_ctx.lock();
        if let Some((cached_model, _)) = &*ctx_lock {
            if cached_model == &size {
                *ctx_lock = None;
            }
        }
    }

    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete model: {}", e))?;

    log::info!(target: "notesage::transcription", "Model '{}' deleted", size);
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// A model the catalogue no longer offers must stay LISTED and marked
    /// downloaded (#698).
    ///
    /// This is what keeps it deletable. `delete_whisper_model` works by path
    /// and accepts any name, and the UI renders its delete control for any
    /// entry with `downloaded: true` — so listing is the only thing standing
    /// between the user and 1.5 GB of `medium` they can neither see nor
    /// reclaim after upgrading.
    #[test]
    fn retired_models_stay_listed_so_they_can_be_deleted() {
        let dir = std::env::temp_dir().join(format!(
            "notesage-models-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // A model from an older release, plus one the catalogue still offers.
        std::fs::write(dir.join("ggml-medium.bin"), b"x").unwrap();
        std::fs::write(dir.join("ggml-small.bin"), b"x").unwrap();

        let models = build_model_list(&dir);

        let medium = models
            .iter()
            .find(|m| m.name == "medium")
            .expect("a downloaded model missing from the catalogue must still be listed");
        assert!(medium.downloaded, "must report as downloaded, or no delete control renders");
        assert!(medium.retired, "must be marked so the UI can say it is no longer offered");
        assert!(medium.download_url.is_none(), "nothing to re-download it from");

        let small = models.iter().find(|m| m.name == "small").unwrap();
        assert!(!small.retired, "a current model must not be marked retired");
        assert!(small.download_url.is_some(), "current models show where they come from");

        // The catalogue's other model is listed even though it is not on disk,
        // so it can be downloaded.
        let quality = models
            .iter()
            .find(|m| m.name == "large-v3-turbo-q5_0")
            .expect("catalogue models are listed whether downloaded or not");
        assert!(!quality.downloaded);

        let _ = std::fs::remove_dir_all(&dir);
    }

    use std::sync::atomic::{AtomicUsize, Ordering as O};
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    /// Build a real `CaptureOwner` backed by a parking thread (no cpal). The
    /// thread increments `live` on entry and decrements it on stop, so a test
    /// can prove the stream is still "alive" mid-teardown. `finalize_result` is
    /// pre-seeded with `Ok(())` so `stop()` returns cleanly.
    fn fake_owner(live: Arc<AtomicUsize>) -> CaptureOwner {
        let stop_signal = Arc::new(AtomicBool::new(false));
        let stats: Arc<Mutex<Option<CaptureStats>>> = Arc::new(Mutex::new(None));
        let finalize_result: Arc<Mutex<Option<Result<(), String>>>> =
            Arc::new(Mutex::new(None));

        let stop = stop_signal.clone();
        let stats_t = stats.clone();
        let finalize_t = finalize_result.clone();
        live.fetch_add(1, O::SeqCst);
        let live_t = live.clone();
        let thread = thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(1));
            }
            *stats_t.lock().unwrap() = Some(CaptureStats {
                rms: 0.1,
                peak: 0.2,
                samples: 16000,
            });
            *finalize_t.lock().unwrap() = Some(Ok(()));
            // "Release the device" only after the join completes its work.
            live_t.fetch_sub(1, O::SeqCst);
        });

        CaptureOwner {
            source: "microphone".into(),
            path: PathBuf::from("/tmp/notesage-test-audio.wav"),
            sample_rate: 16000,
            channels: 1,
            stop_signal,
            pause_signal: Arc::new(AtomicBool::new(false)),
            stats,
            finalize_result,
            thread: Some(thread),
        }
    }

    /// Pause/resume flips the shared `pause_signal` the capture callback reads
    /// — and never touches `stop_signal`, so pausing can't tear the stream down.
    #[test]
    fn pause_resume_toggle_the_pause_signal_only() {
        let live = Arc::new(AtomicUsize::new(0));
        let mut owner = fake_owner(live);

        assert!(!owner.pause_signal.load(Ordering::Relaxed));
        owner.set_paused(true);
        assert!(owner.pause_signal.load(Ordering::Relaxed));
        assert!(!owner.stop_signal.load(Ordering::Relaxed));
        // Idempotent re-pause, then resume.
        owner.set_paused(true);
        assert!(owner.pause_signal.load(Ordering::Relaxed));
        owner.set_paused(false);
        assert!(!owner.pause_signal.load(Ordering::Relaxed));

        // Stopping still works after a pause/resume cycle.
        owner.stop().expect("stop succeeds");
    }

    /// Recorded duration comes from the written-sample count (pause-aware),
    /// not wall clock: interleaved samples / (rate × channels).
    #[test]
    fn duration_from_samples_is_pause_aware() {
        // 16 kHz mono, 16000 samples → exactly 1 s.
        assert_eq!(duration_from_samples(16_000, 16_000, 1), 1.0);
        // 48 kHz stereo, 480_000 interleaved samples → 5 s.
        assert_eq!(duration_from_samples(480_000, 48_000, 2), 5.0);
        // Nothing written (e.g. paused the whole time) → 0 s.
        assert_eq!(duration_from_samples(0, 48_000, 2), 0.0);
        // Degenerate config never divides by zero.
        assert_eq!(duration_from_samples(100, 0, 0), 0.0);
    }

    /// #264 regression: while a stop is mid-teardown — the owner has been taken
    /// out of `capture` (so it reads `None`) but the cpal stream/thread is still
    /// alive — a `start_recording` admission attempt MUST be refused, and only
    /// after teardown completes may a start succeed.
    ///
    /// This drives the REAL `TranscriptionState` fields and the REAL
    /// `check_can_start` guard used by `start_recording`, reproducing exactly
    /// the steps `stop_recording` performs under (and after) the capture lock.
    /// It FAILS against a guard that only checks `capture.is_some()` (the old
    /// take-then-join-without-`stopping` logic): with the owner taken, `capture`
    /// is `None`, so an `is_some()`-only guard would admit a second stream while
    /// the first is still draining. It PASSES once the `stopping` flag closes
    /// the window.
    #[test]
    fn start_is_refused_while_stop_is_in_progress() {
        let state = TranscriptionState::new();
        let live = Arc::new(AtomicUsize::new(0));

        // --- start_recording: install an owner under the capture lock. ---
        {
            let mut cap = state.capture.lock().unwrap();
            TranscriptionState::check_can_start(
                cap.is_some(),
                state.stopping.load(Ordering::Relaxed),
            )
            .expect("first start should be admitted");
            *cap = Some(fake_owner(live.clone()));
        }
        assert_eq!(live.load(O::SeqCst), 1, "stream should be live after start");

        // --- stop_recording, phase 1: under the lock, take the owner AND set
        // `stopping`. This is the exact transition stop_recording performs. ---
        let mut owner = {
            let mut cap = state.capture.lock().unwrap();
            let owner = cap.take().expect("owner present");
            state.stopping.store(true, Ordering::Relaxed);
            owner
        };

        // The stream is STILL ALIVE here (thread hasn't been joined) even though
        // `capture` now reads `None`. A start attempt MUST be refused. An
        // `is_some()`-only guard would (wrongly) admit here — that is the #264
        // overlap this test locks against.
        assert_eq!(live.load(O::SeqCst), 1, "stream still alive mid-teardown");
        {
            let cap = state.capture.lock().unwrap();
            let admitted = TranscriptionState::check_can_start(
                cap.is_some(),
                state.stopping.load(Ordering::Relaxed),
            )
            .is_ok();
            assert!(
                !admitted,
                "start admitted while a stop was in progress — second stream would overlap (#264)"
            );
        }

        // --- stop_recording, phase 2: awaited teardown (join), then clear
        // `stopping`. After this the device is released. ---
        owner.stop().expect("stop should succeed");
        state.stopping.store(false, Ordering::Relaxed);
        assert_eq!(live.load(O::SeqCst), 0, "stream still live after stop returned");

        // --- A start AFTER teardown completes must now be admitted. ---
        {
            let cap = state.capture.lock().unwrap();
            TranscriptionState::check_can_start(
                cap.is_some(),
                state.stopping.load(Ordering::Relaxed),
            )
            .expect("start after teardown should be admitted");
        }
    }

    /// The real `CaptureOwner::stop` invariant in isolation: signalling stop
    /// joins the owning thread, and `finished` flips to true before stop
    /// returns. Uses a hand-built owner with a parking thread (no cpal/hardware).
    #[test]
    fn capture_owner_stop_awaits_thread_join() {
        let stop_signal = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let stats: Arc<Mutex<Option<CaptureStats>>> = Arc::new(Mutex::new(None));

        let finalize_result: Arc<Mutex<Option<Result<(), String>>>> = Arc::new(Mutex::new(None));

        let stop = stop_signal.clone();
        let finished_t = finished.clone();
        let stats_t = stats.clone();
        let finalize_t = finalize_result.clone();
        let thread = thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(1));
            }
            *stats_t.lock().unwrap() = Some(CaptureStats {
                rms: 0.1,
                peak: 0.2,
                samples: 16000,
            });
            *finalize_t.lock().unwrap() = Some(Ok(()));
            finished_t.store(true, Ordering::Relaxed);
        });

        let mut owner = CaptureOwner {
            source: "microphone".into(),
            path: PathBuf::from("/tmp/notesage-test-audio.wav"),
            sample_rate: 16000,
            channels: 1,
            stop_signal,
            pause_signal: Arc::new(AtomicBool::new(false)),
            stats,
            finalize_result,
            thread: Some(thread),
        };

        assert!(!finished.load(Ordering::Relaxed), "finished before stop");
        let s = owner.stop().expect("stop failed");
        // After stop returns the thread has joined, so finished MUST be set and
        // stats MUST be reported.
        assert!(finished.load(Ordering::Relaxed), "thread not joined by stop");
        assert!((s.peak - 0.2).abs() < 1e-6);
        // Second stop is a no-op for the (already-joined) thread and simply
        // re-reports the stored stats — it must not hang or panic.
        let s2 = owner.stop().expect("second stop failed");
        assert!((s2.peak - 0.2).abs() < 1e-6);
    }

    /// Fix 3 regression: a WAV finalize failure reported by the capture thread
    /// MUST surface as an `Err` from `CaptureOwner::stop()`, so `stop_recording`
    /// never returns a path to a corrupt/incomplete file.
    #[test]
    fn stop_propagates_wav_finalize_error() {
        let stop_signal = Arc::new(AtomicBool::new(false));
        let stats: Arc<Mutex<Option<CaptureStats>>> = Arc::new(Mutex::new(None));
        let finalize_result: Arc<Mutex<Option<Result<(), String>>>> =
            Arc::new(Mutex::new(None));

        let stop = stop_signal.clone();
        let finalize_t = finalize_result.clone();
        let thread = thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(1));
            }
            // Simulate a failed WavWriter::finalize() (e.g. seek failure).
            *finalize_t.lock().unwrap() = Some(Err("WAV seek error: boom".into()));
        });

        let mut owner = CaptureOwner {
            source: "microphone".into(),
            path: PathBuf::from("/tmp/notesage-test-bad.wav"),
            sample_rate: 16000,
            channels: 1,
            stop_signal,
            pause_signal: Arc::new(AtomicBool::new(false)),
            stats,
            finalize_result,
            thread: Some(thread),
        };

        let err = owner.stop().expect_err("stop must fail when finalize failed");
        assert!(err.contains("WAV seek error"), "error not propagated: {}", err);
    }

    #[test]
    fn wav_round_trips_through_writer_and_reader() {
        let dir = std::env::temp_dir().join(format!("notesage-wav-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("audio.wav");

        let mut w = WavWriter::create(&path, 16000, 1).unwrap();
        let input: Vec<f32> = (0..1000).map(|i| ((i as f32) * 0.001).sin() * 0.5).collect();
        w.write_f32(&input).unwrap();
        w.finalize().unwrap();

        let (samples, rate, channels) = read_wav_f32(&path).unwrap();
        assert_eq!(rate, 16000);
        assert_eq!(channels, 1);
        assert_eq!(samples.len(), input.len());
        // 16-bit quantization tolerance.
        for (a, b) in input.iter().zip(samples.iter()) {
            assert!((a - b).abs() < 1e-3, "sample drift too large: {} vs {}", a, b);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resample_passthrough_at_16k() {
        let data = vec![0.1, 0.2, 0.3, 0.4];
        let out = resample_to_16k_mono(&data, 16000, 1);
        assert_eq!(out, data);
    }
}
