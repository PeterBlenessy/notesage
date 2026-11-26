use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
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
    /// Which decoder read the file — `"symphonia"` or `"coreaudio"`.
    ///
    /// Recorded in `notesage.log` at info. The CoreAudio fallback exists to
    /// cover two specific gaps (Opus, and AAC that symphonia rejects); whether
    /// it earns its place is a measurable question, and the log is where that
    /// measurement now lives — nothing about it leaves the device.
    ///
    /// Still carried on the response, where nothing currently reads it.
    pub decoder: String,
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
    /// Who spoke, when the job was given separate tracks: `"me"` for the
    /// microphone track, `"others"` for system audio. Absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
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

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

pub struct TranscriptionState {
    // parking_lot::Mutex (not std) on purpose: this lock is held for the entire
    // whole-file Whisper inference (minutes), and an FFI panic in whisper_rs
    // under the guard would *permanently poison* a std::sync::Mutex — every
    // later transcribe_file would then fail at .lock() until app restart. Audit
    // rust H2. parking_lot never poisons, so a panicked job can't brick the
    // feature.
    whisper_ctx: Arc<parking_lot::Mutex<Option<(String, whisper_rs::WhisperContext)>>>,
    models_dir: PathBuf,
    /// Cancel signals for in-progress model downloads.
    download_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl TranscriptionState {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let models_dir = home.join(".notesage").join("whisper-models");

        // Ensure models directory exists on startup
        if let Err(e) = std::fs::create_dir_all(&models_dir) {
            log::warn!(target: "notesage::transcription", "Failed to create whisper models dir {}: {}", models_dir.display(), e);
        }

        // A partial download of a model that is still offered is KEPT: the
        // next download continues it. Only partial files nothing can resume
        // (a retired model, another revision) are removed.
        let offered: Vec<&str> = KNOWN_MODELS.iter().map(|m| m.name).collect();
        for name in super::transcribe::model_download::remove_unresumable_temp_files(&models_dir, &offered) {
            log::info!(target: "notesage::transcription", "Removed stale temp file: {}", name);
        }

        Self {
            whisper_ctx: Arc::new(parking_lot::Mutex::new(None)),
            models_dir,
            download_cancels: Mutex::new(HashMap::new()),
        }
    }

    /// Collect diagnostic info for the diagnostics export.
    pub fn collect_diagnostics(&self) -> WhisperDiagnostics {
        let models_dir_exists = self.models_dir.exists();
        // `try_lock`: the lock is held for a whole transcription, and a
        // diagnostics export must not wait minutes for one. While a job runs
        // the model in memory is the one that job is using.
        let cached_model = match self.whisper_ctx.try_lock() {
            Some(slot) => slot.as_ref().map(|(name, _)| name.clone()),
            None => super::transcribe::jobs::JobRegistry::global().running_model(),
        };

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

        let is_recording = super::recording::is_capture_active();

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
    /// SHA-256 of the file at `MODEL_REVISION`, lowercase hex. `None` until
    /// one has been taken from the repository itself and checked (see
    /// `transcribe::model_download::MODEL_REVISION`); with a hash the
    /// download is verified against it and against `size_bytes` exactly.
    sha256: Option<&'static str>,
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
        sha256: None,
    },
    WhisperModelMeta {
        name: "small",
        size_bytes: 487_601_967,
        parameters: "244M",
        description: "Fast · English only",
        detail: "Whisper small. Five times faster than the quality model and \
excellent on English (1.0% word error), but weak on other languages — 25.6% \
on Swedish, roughly one word in four. Around 3 minutes per hour of audio.",
        sha256: None,
    },
];

fn model_download_url(size: &str) -> String {
    super::transcribe::model_download::model_url(size)
}

/// Resample a whole buffer from native sample rate / channels to 16kHz mono.
///
/// Band-limited (see `transcribe::resample`). Transcription itself no longer
/// calls this: it resamples packet by packet while decoding, so that a long
/// recording is never held at its native rate.
#[cfg_attr(not(test), allow(dead_code))]
fn resample_to_16k_mono(data: &[f32], from_rate: u32, channels: u16) -> Vec<f32> {
    super::transcribe::resample::resample_all(data, from_rate, channels)
}

// ---------------------------------------------------------------------------
// Commands — whole-file transcription
// ---------------------------------------------------------------------------

/// One separately recorded track of a recording made with source "both".
#[derive(Deserialize, Clone, Debug)]
pub struct TranscribeTrack {
    /// `"mic"` (labelled `me`) or `"system"` (labelled `others`).
    pub role: String,
    pub path: String,
}

/// What `transcribe_file` is asked to transcribe: the tracks when given,
/// otherwise the one file at `path`.
fn job_inputs(
    path: &str,
    tracks: Option<Vec<TranscribeTrack>>,
) -> Result<Vec<super::transcribe::job::TrackInput>, String> {
    use super::transcribe::job::TrackInput;
    use super::transcribe::multitrack::speaker_for_role;
    match tracks {
        Some(tracks) if !tracks.is_empty() => tracks
            .into_iter()
            .map(|t| {
                Ok(TrackInput { speaker: Some(speaker_for_role(&t.role)?), path: PathBuf::from(t.path) })
            })
            .collect(),
        _ => Ok(vec![TrackInput { speaker: None, path: PathBuf::from(path) }]),
    }
}

/// Free the loaded model if nothing has used it for `IDLE_UNLOAD_SECS`.
/// Armed after every job; a job that starts or ends in the meantime makes
/// this timer a no-op (the next job arms its own).
fn schedule_idle_unload(
    whisper_ctx: Arc<parking_lot::Mutex<super::transcribe::whisper_engine::ModelSlot>>,
) {
    use super::transcribe::jobs::{IdleTracker, IDLE_UNLOAD_SECS};
    let token = IdleTracker::global().touch();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(IDLE_UNLOAD_SECS)).await;
        if !IdleTracker::global().is_current(token) {
            return;
        }
        // Dropping a context frees hundreds of MB: not on an async worker.
        let _ = tokio::task::spawn_blocking(move || {
            if let Some(mut slot) = whisper_ctx.try_lock() {
                if IdleTracker::global().is_current(token) {
                    if let Some((name, _)) = slot.take() {
                        log::info!(
                            target: "notesage::transcription",
                            "Unloaded Whisper model '{}' after {} idle minutes",
                            name,
                            IDLE_UNLOAD_SECS / 60
                        );
                    }
                }
            }
        })
        .await;
    });
}

/// Transcribe a finalized audio file, or the separate tracks of one.
///
/// The file is decoded as a stream straight to 16 kHz mono and transcribed in
/// parts of about ten minutes, cut in pauses, so memory does not grow with
/// the length of the recording. Jobs run one at a time and wait for their
/// turn BEFORE touching the file. Emits `transcription-progress`
/// (`{ job_id, audio_path, stage, percent }`, integer percent, on change).
/// `cancel_transcription` stops a waiting or running job, which then rejects
/// with exactly `Transcription cancelled`.
///
/// With `tracks`, each is transcribed on its own and the segments are merged
/// by start time with `speaker` set to `me` (mic) or `others` (system).
#[tauri::command]
pub async fn transcribe_file(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    job_id: Option<String>,
    path: String,
    model: String,
    language: Option<String>,
    tracks: Option<Vec<TranscribeTrack>>,
) -> Result<TranscriptionResult, String> {
    use super::transcribe::engine::CANCELLED;
    use super::transcribe::job::run_job;
    use super::transcribe::jobs::{IdleTracker, JobKind, JobRegistry};
    use super::transcribe::local_file::{
        ensure_local, locality, EnsureError, Locality, RealProbe, DOWNLOAD_POLL, DOWNLOAD_TIMEOUT,
    };
    use super::transcribe::pipeline::ChunkConfig;
    use super::transcribe::progress::{ProgressReporter, Stage};
    use super::transcribe::whisper_engine::WhisperEngine;

    let inputs = job_inputs(&path, tracks)?;
    // `stat` only: an evicted iCloud file is not read here (that would block
    // this async worker until it has been downloaded).
    for input in &inputs {
        if locality(&RealProbe, &input.path) == Locality::Missing {
            return Err(format!("Audio file not found: {}", input.path.display()));
        }
    }

    let model_path = state.models_dir.join(format!("ggml-{}.bin", model));
    log::info!(target: "notesage::transcription", "transcribe_file: job={:?}, model={}, path={}, tracks={}, exists={}", job_id, model, model_path.display(), inputs.len(), model_path.exists());

    if !model_path.exists() {
        return Err(format!(
            "Model '{}' not downloaded. Download it from Settings > Transcription.",
            model
        ));
    }
    let model_path_str = model_path.to_str().ok_or("Invalid model path")?.to_string();

    // An empty / missing language means auto-detect. whisper.cpp treats the
    // sentinel "auto" as "detect the spoken language for this file". Anything
    // else is pinned: the user's choice is never overridden by detection.
    let lang = match language {
        Some(l) if !l.trim().is_empty() => l.trim().to_string(),
        _ => "auto".to_string(),
    };

    // Take a turn before doing any work. A waiting job holds no audio and no
    // model; it can be cancelled here and then never starts.
    let registry = JobRegistry::global();
    let mut ticket =
        registry.register(JobKind::Transcription, job_id.clone(), path.clone(), Some(model.clone()));
    if ticket.wait_turn().await.is_err() {
        log::info!(target: "notesage::transcription", "transcribe_file cancelled while waiting (job={:?})", job_id);
        return Err(CANCELLED.to_string());
    }
    // A running job is activity: an idle timer armed earlier must not fire.
    IdleTracker::global().touch();

    let app_progress = app.clone();
    let (event_job_id, event_path) = (job_id.clone(), path.clone());
    let reporter = Arc::new(ProgressReporter::new(move |stage: Stage, percent: u8| {
        let _ = app_progress.emit(
            "transcription-progress",
            serde_json::json!({
                "job_id": event_job_id,
                "audio_path": event_path,
                "stage": stage.as_str(),
                "percent": percent,
            }),
        );
    }));
    reporter.report(Stage::Loading, 0.0);

    let whisper_ctx = state.whisper_ctx.clone();
    let reporter_task = reporter.clone();
    let model_task = model.clone();
    let started = std::time::Instant::now();

    // Everything from here runs on a blocking thread: waiting for iCloud,
    // decoding, the model load and inference.
    let outcome = tokio::task::spawn_blocking(move || {
        // The turn is held until this closure returns, whatever becomes of
        // the command's future.
        let ticket = ticket;
        let cancel = ticket.cancel_flag();

        for input in &inputs {
            match ensure_local(&RealProbe, &input.path, DOWNLOAD_TIMEOUT, DOWNLOAD_POLL, &cancel) {
                Ok(()) => {}
                Err(EnsureError::Cancelled) => return Err(CANCELLED.to_string()),
                Err(EnsureError::Missing) => {
                    return Err(format!("Audio file not found: {}", input.path.display()))
                }
                Err(EnsureError::Download(detail)) => {
                    return Err(format!(
                        "The audio file is still in iCloud and could not be downloaded: {detail}"
                    ))
                }
            }
        }

        // ONE lock scope for loading the model and running it. The guard and
        // every audio buffer are dropped when this closure returns, which a
        // cancel makes happen within one Whisper step.
        let mut slot = whisper_ctx.lock();
        let mut engine = WhisperEngine::new(&mut slot, &model_task, &model_path_str);
        run_job(&mut engine, &inputs, &lang, ChunkConfig::default(), reporter_task, cancel)
    })
    .await;

    schedule_idle_unload(state.whisper_ctx.clone());

    let output = match outcome.map_err(|e| format!("Transcription task panicked: {}", e))? {
        Ok(output) => output,
        Err(e) => {
            log::info!(target: "notesage::transcription", "transcribe_file ended without a transcript (job={:?}): {}", job_id, e);
            return Err(e);
        }
    };

    log::info!(
        target: "notesage::transcription",
        "transcribe_file complete (job={:?}): {} segments, {:.1}s of audio in {:.1}s, language {}, decoder {}",
        job_id,
        output.segments.len(),
        output.duration_secs,
        started.elapsed().as_secs_f64(),
        output.language,
        output.decoder.as_str()
    );
    reporter.finish();

    Ok(TranscriptionResult {
        segments: output
            .segments
            .into_iter()
            .map(|s| TranscriptSegment {
                start: s.start,
                end: s.end,
                text: s.text,
                speaker: s.speaker,
                speaker_id: None,
                speaker_name: None,
            })
            .collect(),
        duration_secs: output.duration_secs,
        // The language actually used: the pinned one, or the one detected
        // ("auto" only when there was no speech to detect it from).
        language: output.language,
        decoder: output.decoder.as_str().to_string(),
    })
}

/// Stop a transcription (or an import) that is waiting or running. Matches
/// by `job_id`, or by `audio_path` (the `path` the job was started with; for
/// an import, its source file). Returns whether anything matched.
#[tauri::command]
pub async fn cancel_transcription(
    job_id: Option<String>,
    audio_path: Option<String>,
) -> Result<bool, String> {
    let cancelled = super::transcribe::jobs::JobRegistry::global()
        .cancel(job_id.as_deref(), audio_path.as_deref());
    log::info!(target: "notesage::transcription", "cancel_transcription(job={:?}, path={:?}) -> {}", job_id, audio_path, cancelled);
    Ok(cancelled)
}

/// Extract the audio of a video or audio file into a new recording bundle
/// `Import <name> <YYYY-MM-DD HHMMSS>` in `dest_recordings_dir`. The source
/// is not copied. Emits `import-progress` (`{ source_path, percent }`).
/// `cancel_transcription(null, source_path)` stops it (`Import cancelled`).
#[tauri::command]
pub async fn import_media(
    app: AppHandle,
    source_path: String,
    dest_recordings_dir: String,
) -> Result<super::transcribe::media_import::ImportResult, String> {
    use super::transcribe::jobs::{JobKind, JobRegistry};
    use super::transcribe::local_file::{RealProbe, DOWNLOAD_TIMEOUT};
    use super::transcribe::media_import::{
        default_staging_root, import_media_blocking, now_stamp, system_afconvert, ImportEnv,
    };

    let mut ticket = JobRegistry::global().register(JobKind::Import, None, source_path.clone(), None);
    ticket.start_unqueued();

    let result = tokio::task::spawn_blocking(move || {
        let ticket = ticket;
        let cancel = ticket.cancel_flag();
        let staging_root = default_staging_root();
        let encoder = system_afconvert();
        let env = ImportEnv {
            staging_root: &staging_root,
            encoder: encoder.as_deref(),
            probe: &RealProbe,
            stamp: now_stamp(),
            download_timeout: DOWNLOAD_TIMEOUT,
        };
        let result = import_media_blocking(
            Path::new(&source_path),
            Path::new(&dest_recordings_dir),
            &env,
            &cancel,
            &mut |percent| {
                let _ = app.emit(
                    "import-progress",
                    serde_json::json!({ "source_path": source_path, "percent": percent }),
                );
            },
        );
        match &result {
            Ok(r) => log::info!(target: "notesage::transcription", "import_media: {} -> {} ({:.1}s)", source_path, r.audio_path, r.duration_secs),
            Err(e) => log::warn!(target: "notesage::transcription", "import_media: {} failed: {}", source_path, e),
        }
        result
    })
    .await
    .map_err(|e| format!("Import task panicked: {}", e))?;
    result
}

#[cfg(test)]
mod transcribe_command_tests {
    use super::*;

    #[test]
    fn without_tracks_the_path_itself_is_the_job() {
        for tracks in [None, Some(Vec::new())] {
            let inputs = job_inputs("/rec/audio.m4a", tracks).unwrap();
            assert_eq!(inputs.len(), 1);
            assert_eq!(inputs[0].path, PathBuf::from("/rec/audio.m4a"));
            assert_eq!(inputs[0].speaker, None);
        }
    }

    #[test]
    fn tracks_replace_the_path_and_carry_their_speaker() {
        // The shape the frontend sends (and `stop_recording` returns).
        let tracks: Vec<TranscribeTrack> = serde_json::from_value(serde_json::json!([
            { "role": "mic", "path": "/rec/mic.m4a" },
            { "role": "system", "path": "/rec/system.m4a" }
        ]))
        .unwrap();
        let inputs = job_inputs("/rec/audio.m4a", Some(tracks)).unwrap();
        let got: Vec<(Option<&str>, &str)> =
            inputs.iter().map(|i| (i.speaker, i.path.to_str().unwrap())).collect();
        assert_eq!(got, vec![(Some("me"), "/rec/mic.m4a"), (Some("others"), "/rec/system.m4a")]);

        let bad = vec![TranscribeTrack { role: "mix".into(), path: "/rec/audio.m4a".into() }];
        assert_eq!(job_inputs("/rec/audio.m4a", Some(bad)).unwrap_err(), "Unknown track role: mix");
    }

    /// The result's field names are the IPC contract: `speaker` only when
    /// there is one, the two legacy keys always.
    #[test]
    fn segments_serialise_with_an_optional_speaker() {
        let plain = TranscriptSegment {
            start: 1.5,
            end: 2.5,
            text: "Hej".into(),
            speaker: None,
            speaker_id: None,
            speaker_name: None,
        };
        assert_eq!(
            serde_json::to_value(&plain).unwrap(),
            serde_json::json!({ "start": 1.5, "end": 2.5, "text": "Hej", "speaker_id": null, "speaker_name": null })
        );
        let labelled = TranscriptSegment { speaker: Some("others".into()), ..plain.clone() };
        assert_eq!(serde_json::to_value(&labelled).unwrap()["speaker"], "others");
        // A segment stored before `speaker` existed still reads.
        let old: TranscriptSegment = serde_json::from_value(serde_json::json!({
            "start": 0.0, "end": 1.0, "text": "x", "speaker_id": null, "speaker_name": null
        }))
        .unwrap();
        assert_eq!(old.speaker, None);
    }

    #[test]
    fn the_cancel_error_is_the_agreed_string() {
        assert_eq!(super::super::transcribe::engine::CANCELLED, "Transcription cancelled");
        assert_eq!(super::super::transcribe::media_import::IMPORT_CANCELLED, "Import cancelled");
    }

    /// The URL the UI shows as "where this comes from" is the URL downloaded.
    #[test]
    fn listed_download_urls_are_the_ones_used() {
        let dir = std::env::temp_dir().join(format!("notesage-model-url-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        for model in build_model_list(&dir).iter().filter(|m| !m.retired) {
            assert_eq!(
                model.download_url.as_deref(),
                Some(super::super::transcribe::model_download::model_url(&model.name).as_str())
            );
        }
        // No catalogue entry claims a hash of the wrong shape.
        for meta in KNOWN_MODELS {
            if let Some(hash) = meta.sha256 {
                assert_eq!(hash.len(), 64, "{}", meta.name);
                assert!(hash.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn cancelling_nothing_reports_false() {
        assert!(!cancel_transcription(None, None).await.unwrap());
        assert!(!cancel_transcription(Some("no-such-job".into()), Some("/no/such/file.wav".into()))
            .await
            .unwrap());
    }

    /// A job known to the registry is found by the command, by id and by path.
    #[tokio::test]
    async fn a_listed_job_is_cancelled_by_id_or_path() {
        use super::super::transcribe::jobs::{JobKind, JobRegistry};
        let registry = JobRegistry::global();
        let by_id = registry.register(
            JobKind::Transcription,
            Some("cmd-test-job".into()),
            "/cmd-test/a.wav".into(),
            Some("cmd-test-model".into()),
        );
        let by_path = registry.register(JobKind::Import, None, "/cmd-test/video.mp4".into(), None);

        assert!(registry.uses_model("cmd-test-model"));
        assert!(cancel_transcription(Some("cmd-test-job".into()), None).await.unwrap());
        assert!(by_id.handle().is_cancelled());
        assert!(!by_path.handle().is_cancelled());
        assert!(cancel_transcription(None, Some("/cmd-test/video.mp4".into())).await.unwrap());
        assert!(by_path.handle().is_cancelled());

        drop(by_id);
        assert!(!registry.uses_model("cmd-test-model"));
    }
}

// ---------------------------------------------------------------------------
// Commands — model management
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
///
/// A partial download is continued (HTTP `Range`), also after a restart of
/// the app; the finished file is verified before it gets its final name.
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

    // Clean up the cancel signal. The partial file is kept unless the user
    // cancelled (see `download_model_inner`).
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
    use super::transcribe::model_download::{
        download_with_resume, temp_file_name, DownloadSpec, Tuning, CANCELLED,
    };

    let meta = KNOWN_MODELS
        .iter()
        .find(|m| m.name == size)
        .ok_or_else(|| format!("Unknown model size: {}", size))?;
    let spec = DownloadSpec {
        url: model_download_url(size),
        final_path: state.models_dir.join(format!("ggml-{}.bin", size)),
        temp_path: state.models_dir.join(temp_file_name(size)),
        catalogue_size: Some(meta.size_bytes),
        sha256: meta.sha256.map(|h| h.to_string()),
    };

    log::info!(target: "notesage::transcription", "Downloading model '{}' from {}", size, spec.url);

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Download failed: {}", e))?;

    // Throttled inside `download_with_resume` (about ten a second).
    let mut on_progress = |downloaded: u64, total: u64| {
        let _ = app.emit(
            "model-download-progress",
            serde_json::json!({ "model": size, "downloaded": downloaded, "total": total }),
        );
    };

    match download_with_resume(&client, &spec, cancel, Tuning::default(), &mut on_progress).await {
        Ok(bytes) => {
            log::info!(target: "notesage::transcription", "Model '{}' downloaded successfully ({} bytes)", size, bytes);
            Ok(())
        }
        Err(e) => {
            // A cancel is the user saying "not this": nothing is left behind.
            // Any other failure keeps the partial file, and the next attempt
            // continues from it.
            if e == CANCELLED {
                let _ = tokio::fs::remove_file(&spec.temp_path).await;
            }
            Err(e)
        }
    }
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

    // The model lock is held for a whole transcription, so it is only TRIED
    // here: a delete must not hang for minutes on a running job. A model a
    // job is using (or waiting to use) is not deleted from under it.
    if super::transcribe::jobs::JobRegistry::global().uses_model(&size) {
        return Err(format!(
            "Model '{}' is in use by a running transcription. Try again when it finishes.",
            size
        ));
    }
    // Drop the cached context if it is this model. When the lock is busy
    // (a job with another model), that job replaces the cached model itself.
    let cached = state.whisper_ctx.try_lock().and_then(|mut slot| {
        if matches!(slot.as_ref(), Some((name, _)) if *name == size) {
            slot.take()
        } else {
            None
        }
    });
    if cached.is_some() {
        // Freeing the context releases hundreds of MB; keep it off the
        // async worker.
        let _ = tokio::task::spawn_blocking(move || drop(cached)).await;
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

    #[test]
    fn resample_passthrough_at_16k() {
        let data = vec![0.1, 0.2, 0.3, 0.4];
        let out = resample_to_16k_mono(&data, 16000, 1);
        assert_eq!(out, data);
    }
}
