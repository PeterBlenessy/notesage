use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptionSegment>,
    pub duration_secs: f64,
    pub language: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TranscriptionSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,
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
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AudioBufferInfo {
    pub duration_secs: f64,
    pub sample_count: usize,
    pub sample_rate: u32,
    pub source: String,
}

// ---------------------------------------------------------------------------
// Recording handle — lives on a dedicated thread, managed via Arc signals
// ---------------------------------------------------------------------------

struct RecordingHandle {
    mic_buffer: Arc<Mutex<Vec<f32>>>,
    source: String,
    sample_rate: u32,
    channels: u16,
    start_time: std::time::Instant,
    stop_signal: Arc<AtomicBool>,
    // Thread that owns the cpal::Stream (not Send, so lives on its own thread)
    _audio_thread: std::thread::JoinHandle<()>,
}

// RecordingHandle is Send because cpal::Stream lives inside _audio_thread,
// and everything else is Send-safe (Arc, AtomicBool, etc.)

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

pub struct TranscriptionState {
    recording: Mutex<Option<RecordingHandle>>,
    dictation_cancel: Mutex<Option<Arc<AtomicBool>>>,
    whisper_ctx: Mutex<Option<(String, whisper_rs::WhisperContext)>>,
    models_dir: PathBuf,
    /// Audio buffer shared between recording and transcription
    last_recording_buffer: Mutex<Option<(Vec<f32>, String, u32)>>,
    /// Cancel signals for in-progress model downloads
    download_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl TranscriptionState {
    pub fn new() -> Self {
        let models_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".notesage")
            .join("whisper-models");
        Self {
            recording: Mutex::new(None),
            dictation_cancel: Mutex::new(None),
            whisper_ctx: Mutex::new(None),
            models_dir,
            last_recording_buffer: Mutex::new(None),
            download_cancels: Mutex::new(HashMap::new()),
        }
    }
}

// Known Whisper models with metadata
struct WhisperModelMeta {
    name: &'static str,
    size_bytes: u64,
    parameters: &'static str,
    description: &'static str,
}

const KNOWN_MODELS: &[WhisperModelMeta] = &[
    WhisperModelMeta { name: "tiny", size_bytes: 75_000_000, parameters: "39M", description: "Fastest, least accurate" },
    WhisperModelMeta { name: "base", size_bytes: 142_000_000, parameters: "74M", description: "Good balance for short recordings" },
    WhisperModelMeta { name: "small", size_bytes: 466_000_000, parameters: "244M", description: "Accurate for most languages" },
    WhisperModelMeta { name: "medium", size_bytes: 1_500_000_000, parameters: "769M", description: "High accuracy, slower" },
    WhisperModelMeta { name: "large-v3", size_bytes: 2_900_000_000, parameters: "1550M", description: "Best accuracy, slowest" },
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

/// Start a cpal input stream on a dedicated thread (because cpal::Stream is !Send).
/// Returns the stop signal, shared buffer, actual sample rate, and channel count.
fn start_mic_on_thread(
    app: AppHandle,
) -> Result<(Arc<Mutex<Vec<f32>>>, Arc<AtomicBool>, u32, u16, std::thread::JoinHandle<()>), String>
{
    let mic_buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let stop_signal = Arc::new(AtomicBool::new(false));

    let buf = mic_buffer.clone();
    let stop = stop_signal.clone();

    // Barrier to wait for stream setup to complete — sends (sample_rate, channels) on success
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

        // Use the device's default config — don't assume 16kHz mono is supported
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

        let actual_rate = config.sample_rate.0;
        let actual_channels = config.channels;

        log::info!(
            target: "notesage::transcription",
            "Audio input: {}Hz, {} channel(s)",
            actual_rate,
            actual_channels
        );

        let buf_clone = buf.clone();
        let err_fn = |err: cpal::StreamError| {
            log::error!(target: "notesage::transcription", "Audio stream error: {}", err);
        };

        let stream = match device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if let Ok(mut buffer) = buf_clone.lock() {
                    buffer.extend_from_slice(data);
                }
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

        // Signal success with actual format info
        let _ = tx.send(Ok((actual_rate, actual_channels)));

        // Keep thread alive, emitting audio levels at ~10 Hz
        let mut last_len = 0usize;
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(buffer) = buf.lock() {
                let current_len = buffer.len();
                if current_len > last_len {
                    let recent = &buffer[last_len..current_len];
                    // RMS over mono-mixed samples for level display
                    let ch = actual_channels as usize;
                    let rms = if ch > 1 {
                        let mono_rms: f32 = recent
                            .chunks(ch)
                            .map(|frame| {
                                let avg = frame.iter().sum::<f32>() / ch as f32;
                                avg * avg
                            })
                            .sum::<f32>()
                            / (recent.len() as f32 / ch as f32);
                        mono_rms.sqrt()
                    } else {
                        (recent.iter().map(|s| s * s).sum::<f32>() / recent.len() as f32).sqrt()
                    };
                    last_len = current_len;
                    let _ = app.emit(
                        "recording-level",
                        serde_json::json!({ "mic": rms, "system": 0.0_f32 }),
                    );
                }
            }
        }

        // stream is dropped here, stopping audio capture
    });

    // Wait for stream setup
    let (actual_rate, actual_channels) = rx
        .recv()
        .map_err(|_| "Audio thread died during setup".to_string())??;

    Ok((mic_buffer, stop_signal, actual_rate, actual_channels, thread))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Start recording audio from the specified source.
#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    source: String,
) -> Result<(), String> {
    {
        let recording = state
            .recording
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if recording.is_some() {
            return Err("Recording already in progress".into());
        }
    }

    // System audio capture — not yet implemented
    if source == "system" {
        return Err(
            "System audio capture is not yet available. Use microphone recording instead.".into(),
        );
    }

    if source == "system" || source == "both" {
        log::warn!(target: "notesage::transcription", "System audio capture not yet implemented — recording mic only");
    }

    let (mic_buffer, stop_signal, actual_rate, actual_channels, audio_thread) =
        start_mic_on_thread(app)?;

    let handle = RecordingHandle {
        mic_buffer,
        source: source.clone(),
        sample_rate: actual_rate,
        channels: actual_channels,
        start_time: std::time::Instant::now(),
        stop_signal,
        _audio_thread: audio_thread,
    };

    let mut recording = state
        .recording
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    *recording = Some(handle);

    log::info!(target: "notesage::transcription", "Recording started (source: {})", source);
    Ok(())
}

/// Stop recording and return buffer metadata.
#[tauri::command]
pub async fn stop_recording(
    state: State<'_, TranscriptionState>,
) -> Result<AudioBufferInfo, String> {
    let handle = {
        let mut recording = state
            .recording
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        recording.take().ok_or("No recording in progress")?
    };

    // Signal stop
    handle.stop_signal.store(true, Ordering::Relaxed);

    let duration = handle.start_time.elapsed().as_secs_f64();
    let raw_data = {
        let buf = handle
            .mic_buffer
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        buf.clone()
    };

    // Resample to 16kHz mono (what Whisper expects)
    let audio_data = resample_to_16k_mono(&raw_data, handle.sample_rate, handle.channels);
    let sample_count = audio_data.len();

    log::info!(
        target: "notesage::transcription",
        "Recording stopped ({:.1}s, {} raw samples @ {}Hz {}ch → {} samples @ 16kHz mono)",
        duration, raw_data.len(), handle.sample_rate, handle.channels, sample_count
    );

    // Save resampled buffer for transcription (always 16kHz mono)
    {
        let mut last = state
            .last_recording_buffer
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *last = Some((audio_data, handle.source.clone(), 16000));
    }

    Ok(AudioBufferInfo {
        duration_secs: duration,
        sample_count,
        sample_rate: 16000,
        source: handle.source,
    })
}

/// Transcribe the last recorded audio buffer using a Whisper model.
#[tauri::command]
pub async fn transcribe(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    model: String,
    language: Option<String>,
) -> Result<TranscriptionResult, String> {
    let (audio_data, source, sample_rate) = {
        let last = state
            .last_recording_buffer
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        last.clone()
            .ok_or("No audio data available. Record audio first.")?
    };

    if audio_data.is_empty() {
        return Err("No audio data recorded".into());
    }

    let model_path = state.models_dir.join(format!("ggml-{}.bin", model));
    if !model_path.exists() {
        return Err(format!(
            "Model '{}' not downloaded. Download it from Settings > Transcription.",
            model
        ));
    }

    let model_path_str = model_path
        .to_str()
        .ok_or("Invalid model path")?
        .to_string();

    let _ = app.emit(
        "transcription-progress",
        serde_json::json!({ "percent": 5, "segment": "Loading model..." }),
    );

    // Load whisper context (cached if same model)
    {
        let mut ctx_lock = state
            .whisper_ctx
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        let needs_reload = match &*ctx_lock {
            Some((cached_model, _)) => cached_model != &model,
            None => true,
        };

        if needs_reload {
            log::info!(target: "notesage::transcription", "Loading Whisper model: {}", model);
            let params = whisper_rs::WhisperContextParameters::default();
            let ctx = whisper_rs::WhisperContext::new_with_params(&model_path_str, params)
                .map_err(|e| format!("Failed to load Whisper model: {}", e))?;
            *ctx_lock = Some((model.clone(), ctx));
        }
    }

    let _ = app.emit(
        "transcription-progress",
        serde_json::json!({ "percent": 15, "segment": "Transcribing..." }),
    );

    // Run transcription
    let ctx_lock = state
        .whisper_ctx
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let (_, ctx) = ctx_lock.as_ref().ok_or("Whisper context not loaded")?;

    let lang = language.unwrap_or_else(|| "en".to_string());
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
            .to_string();

        let speaker = if source == "both" {
            Some("You".to_string())
        } else {
            None
        };

        let trimmed = text.trim().to_string();
        segments.push(TranscriptionSegment {
            start: start as f64 / 100.0,
            end: end as f64 / 100.0,
            text: trimmed.clone(),
            speaker,
        });

        let percent = 15 + (85 * (i + 1) as u32 / num_segments.max(1) as u32);
        let _ = app.emit(
            "transcription-progress",
            serde_json::json!({ "percent": percent, "segment": trimmed }),
        );
    }

    let duration_secs = audio_data.len() as f64 / sample_rate as f64;

    log::info!(target: "notesage::transcription", "Transcription complete: {} segments, {:.1}s", segments.len(), duration_secs);

    Ok(TranscriptionResult {
        segments,
        duration_secs,
        language: "en".to_string(),
    })
}

/// Check if transcribed text is a Whisper hallucination (silence markers, repeated noise).
fn is_hallucination(text: &str) -> bool {
    let lower = text.to_lowercase();
    // Common Whisper hallucinations on silence/noise
    let hallucination_patterns = [
        "[silence]",
        "[blank_audio]",
        "[blank audio]",
        "[music]",
        "[applause]",
        "[laughter]",
        "(silence)",
        "(blank audio)",
        "thank you for watching",
        "thanks for watching",
        "please subscribe",
        "thank you.",
        "you",
        // Single punctuation or whitespace
    ];
    for pat in &hallucination_patterns {
        if lower.trim() == *pat {
            return true;
        }
    }
    // Text that's only brackets/parens content
    let stripped = lower.trim();
    if (stripped.starts_with('[') && stripped.ends_with(']'))
        || (stripped.starts_with('(') && stripped.ends_with(')'))
    {
        return true;
    }
    // Very short text that's just punctuation
    if stripped.len() <= 2 && stripped.chars().all(|c| c.is_ascii_punctuation() || c.is_whitespace())
    {
        return true;
    }
    false
}

/// Start streaming dictation (mic capture + real-time whisper-rs transcription).
#[tauri::command]
pub async fn start_dictation(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    language: Option<String>,
) -> Result<(), String> {
    {
        let dictation = state
            .dictation_cancel
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if dictation.is_some() {
            return Err("Dictation already in progress".into());
        }
    }

    let model_path = state.models_dir.join("ggml-base.bin");
    if !model_path.exists() {
        return Err(
            "No Whisper model available for dictation. Download the 'base' model in Settings > Transcription."
                .into(),
        );
    }

    let (mic_buffer, stop_signal, native_rate, native_channels, _audio_thread) =
        start_mic_on_thread(app.clone())?;

    // Store cancel signal
    {
        let mut dictation = state
            .dictation_cancel
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *dictation = Some(stop_signal.clone());
    }

    let model_path_str = model_path.to_str().unwrap_or("").to_string();
    let cancel = stop_signal;
    let lang = language.unwrap_or_else(|| "en".to_string());

    // Background transcription loop on a std::thread (whisper-rs is CPU-bound)
    std::thread::spawn(move || {
        let params = whisper_rs::WhisperContextParameters::default();
        let ctx = match whisper_rs::WhisperContext::new_with_params(&model_path_str, params) {
            Ok(ctx) => ctx,
            Err(e) => {
                log::error!(target: "notesage::transcription", "Failed to load dictation model: {}", e);
                let _ = app.emit(
                    "dictation-result",
                    serde_json::json!({ "text": "", "is_final": true, "error": format!("Failed to load model: {}", e) }),
                );
                return;
            }
        };

        // ~3 seconds of raw samples at native rate/channels
        let raw_chunk_size = native_rate as usize * native_channels as usize * 3;
        // Track last emitted text to avoid duplicates
        let mut last_emitted = String::new();
        // RMS silence threshold — below this, skip transcription entirely
        const SILENCE_RMS_THRESHOLD: f32 = 0.005;

        while !cancel.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_secs(3));

            if cancel.load(Ordering::Relaxed) {
                break;
            }

            let audio_chunk: Vec<f32> = {
                let mut buffer = match mic_buffer.lock() {
                    Ok(b) => b,
                    Err(_) => continue,
                };
                if buffer.len() < raw_chunk_size {
                    log::debug!(target: "notesage::transcription", "Dictation: buffer {} < chunk size {}, waiting", buffer.len(), raw_chunk_size);
                    continue;
                }
                let raw = buffer.clone();
                buffer.clear();
                // Resample to 16kHz mono for Whisper
                resample_to_16k_mono(&raw, native_rate, native_channels)
            };

            if audio_chunk.is_empty() {
                log::debug!(target: "notesage::transcription", "Dictation: empty audio chunk after resample");
                continue;
            }

            // Skip silent chunks — avoids Whisper hallucinating on silence
            let rms = (audio_chunk.iter().map(|s| s * s).sum::<f32>()
                / audio_chunk.len() as f32)
                .sqrt();
            log::debug!(target: "notesage::transcription", "Dictation: chunk {} samples, RMS {:.4}", audio_chunk.len(), rms);
            if rms < SILENCE_RMS_THRESHOLD {
                log::debug!(target: "notesage::transcription", "Dictation: skipping silent chunk (RMS {:.4} < {})", rms, SILENCE_RMS_THRESHOLD);
                continue;
            }

            let lang_str = lang.clone();
            let mut wparams =
                whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
            wparams.set_print_progress(false);
            wparams.set_print_realtime(false);
            wparams.set_print_timestamps(false);
            wparams.set_language(Some(&lang_str));
            wparams.set_no_context(true);

            let mut ws = match ctx.create_state() {
                Ok(s) => s,
                Err(_) => continue,
            };

            match ws.full(wparams, &audio_chunk) {
                Ok(_) => {
                    let n = ws.full_n_segments();
                    log::debug!(target: "notesage::transcription", "Dictation: whisper returned {} segments", n);
                    let mut text = String::new();
                    for i in 0..n {
                        if let Some(seg) = ws.get_segment(i) {
                            if let Ok(t) = seg.to_str_lossy() {
                                let segment_text = t.trim();
                                if is_hallucination(segment_text) {
                                    log::debug!(target: "notesage::transcription", "Dictation: filtered hallucination: {:?}", segment_text);
                                } else {
                                    text.push_str(segment_text);
                                    text.push(' ');
                                }
                            }
                        }
                    }
                    let trimmed = text.trim().to_string();
                    if trimmed.is_empty() {
                        log::debug!(target: "notesage::transcription", "Dictation: empty result after filtering");
                    } else if trimmed == last_emitted {
                        log::debug!(target: "notesage::transcription", "Dictation: duplicate, skipping: {:?}", trimmed);
                    } else {
                        log::info!(target: "notesage::transcription", "Dictation: emitting: {:?}", trimmed);
                        last_emitted = trimmed.clone();
                        let _ = app.emit(
                            "dictation-result",
                            serde_json::json!({ "text": trimmed, "is_final": false }),
                        );
                    }
                }
                Err(e) => {
                    log::warn!(target: "notesage::transcription", "Dictation: whisper inference failed: {}", e);
                }
            }
        }

        let _ = app.emit(
            "dictation-result",
            serde_json::json!({ "text": "", "is_final": true }),
        );
    });

    log::info!(target: "notesage::transcription", "Dictation started");
    Ok(())
}

/// Stop streaming dictation.
#[tauri::command]
pub async fn stop_dictation(
    state: State<'_, TranscriptionState>,
) -> Result<(), String> {
    let cancel = {
        let mut dictation = state
            .dictation_cancel
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        dictation.take().ok_or("No dictation in progress")?
    };

    cancel.store(true, Ordering::Relaxed);

    log::info!(target: "notesage::transcription", "Dictation stopped");
    Ok(())
}

/// List available Whisper models (both downloaded and not).
#[tauri::command]
pub async fn list_whisper_models(
    state: State<'_, TranscriptionState>,
) -> Result<Vec<ModelInfo>, String> {
    let mut models = Vec::new();

    for meta in KNOWN_MODELS {
        let path = state.models_dir.join(format!("ggml-{}.bin", meta.name));
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
        });
    }

    Ok(models)
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
        let mut cancels = state.download_cancels.lock().unwrap();
        if cancels.contains_key(&size) {
            return Err(format!("Model '{}' is already being downloaded", size));
        }
        cancels.insert(size.clone(), cancel.clone());
    }

    let result = download_model_inner(&app, &state, &size, &cancel).await;

    // Clean up cancel signal and temp file on cancel/error
    {
        let mut cancels = state.download_cancels.lock().unwrap();
        cancels.remove(&size);
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
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
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
        use std::io::Write;
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
    let cancels = state.download_cancels.lock().unwrap();
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
        let mut ctx_lock = state
            .whisper_ctx
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
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
