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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
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

// --- Recording (mirrors `recording/types.rs`; desktop-only at runtime) ---

#[derive(Serialize, Deserialize, Clone)]
pub struct TrackRef {
    pub role: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct TrackPeaks {
    pub mic: Option<f32>,
    pub system: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RecordingResult {
    pub bundle_dir: String,
    pub audio_path: String,
    pub tracks: Vec<TrackRef>,
    pub duration_secs: f64,
    pub peak: f32,
    pub sample_rate: u32,
    pub dropped_frames: u64,
    pub warnings: Vec<String>,
    pub path: String,
    pub source: String,
    pub rms: f32,
    pub track_peaks: TrackPeaks,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FinalizedBundle {
    pub bundle_dir: String,
    pub audio_path: String,
    pub tracks: Vec<TrackRef>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct OrphanRecording {
    pub bundle_dir: String,
    pub audio_path: String,
    pub tracks: Vec<TrackRef>,
    pub duration_secs: f64,
    pub started_at: Option<String>,
    pub source: Option<String>,
    pub has_manifest: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RecordingPreflight {
    pub microphone: String,
    pub system_audio: String,
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    pub free_bytes: u64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RecordingStateInfo {
    pub recording: bool,
    pub paused: bool,
    pub source: Option<String>,
    pub started_at_ms: Option<u64>,
    pub elapsed_recorded_ms: u64,
    pub fatal: bool,
}

/// Managed state placeholder for the recorder (`recording::RecordingState` on
/// desktop). The phone records through its own Swift plugin.
pub struct RecordingState;

impl RecordingState {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RecordingState {
    fn default() -> Self {
        Self::new()
    }
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
pub async fn recording_preflight(
    _state: State<'_, RecordingState>,
    _source: String,
) -> Result<RecordingPreflight, String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn start_recording(
    _app: AppHandle,
    _state: State<'_, RecordingState>,
    _source: String,
) -> Result<(), String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn pause_recording(_state: State<'_, RecordingState>) -> Result<(), String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn resume_recording(_state: State<'_, RecordingState>) -> Result<(), String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn stop_recording(_state: State<'_, RecordingState>) -> Result<RecordingResult, String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn discard_recording(
    _state: State<'_, RecordingState>,
    _bundle_dir: Option<String>,
) -> Result<(), String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn finalize_recording_bundle(
    _state: State<'_, RecordingState>,
    _staging_dir: String,
    _dest_recordings_dir: String,
) -> Result<FinalizedBundle, String> {
    Err(UNAVAILABLE.into())
}

/// Mirrors the desktop `TranscribeTrack` argument.
#[derive(Deserialize, Clone, Debug)]
pub struct TranscribeTrack {
    pub role: String,
    pub path: String,
}

/// Mirrors the desktop `import_media` result.
#[derive(Serialize, Clone, Debug)]
pub struct ImportResult {
    pub bundle_dir: String,
    pub audio_path: String,
    pub duration_secs: f64,
    pub original_name: String,
}

#[tauri::command]
pub async fn recover_orphan_recordings(
    _state: State<'_, RecordingState>,
) -> Result<Vec<OrphanRecording>, String> {
    // Empty rather than an error: a startup sweep that finds nothing is the
    // truth here, and an error would surface as a spurious failure.
    Ok(Vec::new())
}

#[tauri::command]
pub async fn get_recording_state(
    _state: State<'_, RecordingState>,
) -> Result<RecordingStateInfo, String> {
    Ok(RecordingStateInfo::default())
}

#[tauri::command]
pub async fn transcribe_file(
    _app: AppHandle,
    _state: State<'_, TranscriptionState>,
    _job_id: Option<String>,
    _path: String,
    _model: String,
    _language: Option<String>,
    _tracks: Option<Vec<TranscribeTrack>>,
) -> Result<TranscriptionResult, String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn cancel_transcription(
    _job_id: Option<String>,
    _audio_path: Option<String>,
) -> Result<bool, String> {
    // Nothing can be running here, so there is nothing to cancel.
    Ok(false)
}

#[tauri::command]
pub async fn import_media(
    _app: AppHandle,
    _source_path: String,
    _dest_recordings_dir: String,
) -> Result<ImportResult, String> {
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

// --- Speaker identification (mirrors `speakers/commands.rs`; desktop-only) ---
//
// Same command names and argument names as the desktop module, so
// `generate_handler!` needs no platform gating. Arguments and results that
// are structs on the desktop are plain JSON here: nothing on mobile calls
// these, and every one that would do work answers with an error.

#[tauri::command]
pub async fn speaker_models_status() -> Result<serde_json::Value, String> {
    // "Nothing installed, nothing offered" reads correctly in a settings
    // screen; an error would surface as a spurious failure.
    Ok(serde_json::json!({ "installed": false, "models": [] }))
}

#[tauri::command]
pub async fn download_speaker_models(_app: AppHandle) -> Result<(), String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn cancel_speaker_models_download() -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub async fn delete_speaker_models() -> Result<(), String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn analyze_speakers(
    _app: AppHandle,
    _job_id: Option<String>,
    _audio_path: String,
    _tracks: Option<Vec<TranscribeTrack>>,
    _expected_speakers: Option<u32>,
    _segments: Option<Vec<serde_json::Value>>,
    _shared_microphone: Option<bool>,
) -> Result<serde_json::Value, String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn embed_speaker_turns(
    _audio_path: String,
    _turns: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn voice_profiles_list() -> Result<serde_json::Value, String> {
    // No voice profile can exist on this platform.
    Ok(serde_json::json!({ "profiles": [], "quarantined": 0, "directory": "" }))
}

#[tauri::command]
pub async fn voice_profile_save(
    _consent: bool,
    _name: String,
    _embedding: Vec<f32>,
    _source: serde_json::Value,
    _profile_id: Option<String>,
    _is_me: Option<bool>,
    _model: Option<String>,
) -> Result<serde_json::Value, String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn voice_profile_rename(
    _profile_id: String,
    _name: String,
) -> Result<serde_json::Value, String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn voice_profiles_merge(
    _into_id: String,
    _from_id: String,
) -> Result<serde_json::Value, String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn voice_profile_delete(_profile_id: String) -> Result<(), String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn voice_profiles_delete_all() -> Result<usize, String> {
    // Nothing exists, so nothing was removed.
    Ok(0)
}

#[tauri::command]
pub async fn voice_profiles_match(
    _consent: bool,
    _speakers: Vec<serde_json::Value>,
    _participants: Option<Vec<String>>,
    _model: Option<String>,
) -> Result<serde_json::Value, String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn enrol_own_voice(
    _consent: bool,
    _audio_path: String,
    _name: Option<String>,
) -> Result<serde_json::Value, String> {
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn extract_audio_clip(
    _audio_path: String,
    _start: f64,
    _end: f64,
) -> Result<serde_json::Value, String> {
    Err(UNAVAILABLE.into())
}
