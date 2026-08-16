//! Mobile stand-in for [`super::transcription`].
//!
//! Meeting recording and Whisper transcription are desktop-only (PRD
//! `2026-06-28-ios-mobile-app.md` § Non-Goals: "No AI features — no … voice
//! transcription"). The real module depends on `whisper-rs` and `cpal`;
//! `whisper-rs` vendors whisper.cpp, whose ggml kernels reference Accelerate
//! symbols that do not link on iOS — and bundling a speech-recognition engine
//! in a read-only reader would be wrong even if it did.
//!
//! This mirrors the public surface exactly so `generate_handler!` in `lib.rs`
//! needs no platform gating. Commands return an error rather than `Ok(())`:
//! there is no mobile UI that calls them, so reaching one is a bug, and a
//! silent success would hide it behind a recording that never happens.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

const UNAVAILABLE: &str = "Recording and transcription are not available on this platform";

#[derive(Serialize, Deserialize, Clone)]
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptSegment>,
    pub duration_secs: f64,
    pub language: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TranscriptSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker_id: Option<String>,
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
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RecordingResult {
    pub path: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
    pub source: String,
    pub rms: f32,
    pub peak: f32,
}

/// Diagnostics shape mirrored for `logging.rs`, which folds Whisper state into
/// its support bundle regardless of platform.
#[derive(Serialize, Clone, Debug)]
pub struct WhisperDiagnostics {
    pub models_dir: String,
    pub models_dir_exists: bool,
    pub models_on_disk: Vec<super::model_management::DiagnosticFile>,
    pub stale_files: Vec<super::model_management::DiagnosticFile>,
    pub cached_model: Option<String>,
    pub is_recording: bool,
}

/// Managed state placeholder. Holds nothing: there is no capture stream and no
/// model directory on mobile.
pub struct TranscriptionState;

impl TranscriptionState {
    pub fn new() -> Self {
        Self
    }

    /// Empty diagnostics rather than an error: the support bundle should still
    /// generate on mobile, and "no models, not recording" is the truth here.
    pub fn collect_diagnostics(&self) -> WhisperDiagnostics {
        WhisperDiagnostics {
            models_dir: String::new(),
            models_dir_exists: false,
            models_on_disk: Vec::new(),
            stale_files: Vec::new(),
            cached_model: None,
            is_recording: false,
        }
    }
}

impl Default for TranscriptionState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn start_recording(
    _app: AppHandle,
    _state: State<'_, TranscriptionState>,
    _source: String,
) -> Result<(), String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn pause_recording(_state: State<'_, TranscriptionState>) -> Result<(), String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn resume_recording(_state: State<'_, TranscriptionState>) -> Result<(), String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn stop_recording(
    _state: State<'_, TranscriptionState>,
) -> Result<RecordingResult, String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn transcribe_file(
    _app: AppHandle,
    _state: State<'_, TranscriptionState>,
    _job_id: String,
    _path: String,
    _model: String,
    _language: Option<String>,
) -> Result<TranscriptionResult, String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn list_whisper_models(
    _state: State<'_, TranscriptionState>,
) -> Result<Vec<ModelInfo>, String> {
    // Empty rather than an error: a settings screen listing zero models reads
    // correctly, whereas an error would surface as a spurious failure.
    Ok(Vec::new())
}

#[tauri::command]
pub async fn download_whisper_model(
    _app: AppHandle,
    _state: State<'_, TranscriptionState>,
    _size: String,
) -> Result<(), String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn cancel_model_download(
    _state: State<'_, TranscriptionState>,
    _size: String,
) -> Result<(), String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn delete_whisper_model(
    _state: State<'_, TranscriptionState>,
    _size: String,
) -> Result<(), String> {
    Err(UNAVAILABLE.into())
}
