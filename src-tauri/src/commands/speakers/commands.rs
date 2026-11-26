//! The Tauri commands of speaker identification. Thin: argument checking,
//! the job queue, a blocking thread, and the pure pieces of this module.
//!
//! The iOS build compiles `transcription_stub.rs` instead, which has a stub
//! for every command here: keep the two in step.

use super::analyze::{
    assemble, enrolment_embedding, speaker_order, validate_expected, AnalysisOut, AnalyzedTrack,
    NamedEmbeddings, NamedTurnCollector, TrackAnalyzer, TrackKind,
};
use super::assign::Segment;
use super::clip;
use super::engine::{VoiceEngine, CANCELLED};
use super::matching::{match_speakers, SpeakerMatch};
use super::models;
use super::profiles::{
    default_profiles_dir, require_consent, ProfileList, ProfileStore, ProfileSummary, SaveOutcome, SourceKind,
};
use super::tract_engine::TractVoiceEngine;
use super::turns::Turn;
use crate::commands::audio_decode::decode_stream_16k;
use crate::commands::transcribe::jobs::{JobKind, JobRegistry, JobTicket};
use crate::commands::transcribe::local_file::{
    ensure_local, locality, EnsureError, Locality, RealProbe, DOWNLOAD_POLL, DOWNLOAD_TIMEOUT,
};
use crate::commands::transcribe::model_download::{
    download_with_resume, DownloadSpec, Tuning, CANCELLED as DOWNLOAD_CANCELLED,
};
use crate::commands::transcribe::progress::{ProgressReporter, Span, Stage};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// The rejection of every command that needs the voice model before it has
/// been downloaded. The frontend matches on it.
pub const MODELS_MISSING: &str = "Voice models are not downloaded. Download them from Settings > Transcription.";
pub const DOWNLOAD_RUNNING: &str = "Voice models are already being downloaded";
pub const MODELS_IN_USE: &str = "The voice models are in use by a running analysis. Try again when it finishes.";
/// How a fraction of the job is named in `speaker-analysis-progress`.
pub const STAGE_LOADING: &str = "loading";
pub const STAGE_ANALYZING: &str = "analyzing";
pub const STAGE_FINISHING: &str = "finishing";

/// The cancel flag of the model download in progress, if any.
fn download_slot() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    static SLOT: std::sync::OnceLock<Mutex<Option<Arc<AtomicBool>>>> = std::sync::OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn store() -> ProfileStore {
    ProfileStore::new(default_profiles_dir(), models::embedding_model().id)
}

/// Run file work off the async workers.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work).await.map_err(|e| format!("Speaker task panicked: {e}"))?
}

fn load_engine() -> Result<TractVoiceEngine, String> {
    let model = models::embedding_model();
    let dir = models::default_models_dir();
    if !models::is_installed(&dir, model) {
        return Err(MODELS_MISSING.to_string());
    }
    TractVoiceEngine::load(&models::model_path(&dir, model), model.id)
}

/// Fail early (and without touching an evicted iCloud file) when a file is
/// not there.
fn check_exists(path: &Path) -> Result<(), String> {
    if locality(&RealProbe, path) == Locality::Missing {
        return Err(format!("Audio file not found: {}", path.display()));
    }
    Ok(())
}

/// Wait for an iCloud file to be on this Mac. Blocking.
fn make_local(path: &Path, cancel: &AtomicBool) -> Result<(), String> {
    match ensure_local(&RealProbe, path, DOWNLOAD_TIMEOUT, DOWNLOAD_POLL, cancel) {
        Ok(()) => Ok(()),
        Err(EnsureError::Cancelled) => Err(CANCELLED.to_string()),
        Err(EnsureError::Missing) => Err(format!("Audio file not found: {}", path.display())),
        Err(EnsureError::Download(detail)) => {
            Err(format!("The audio file is still in iCloud and could not be downloaded: {detail}"))
        }
    }
}

/// Take a turn in the queue transcriptions use, so that the two never run
/// at once. `Err(CANCELLED)` when cancelled while waiting.
async fn take_turn(job_id: Option<String>, path: &str) -> Result<JobTicket, String> {
    let mut ticket =
        JobRegistry::global().register(JobKind::SpeakerAnalysis, job_id, path.to_string(), None);
    if ticket.wait_turn().await.is_err() {
        return Err(CANCELLED.to_string());
    }
    Ok(ticket)
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/// Which voice models there are and whether they are downloaded.
#[tauri::command]
pub async fn speaker_models_status() -> Result<models::SpeakerModelsStatus, String> {
    blocking(|| Ok(models::status(&models::default_models_dir()))).await
}

/// Download the voice models (about 27 MB). Resumes a partial download;
/// every file is checked against its SHA-256 before it is used. Emits
/// `speaker-model-download-progress` (`{ model, downloaded, total }`).
#[tauri::command]
pub async fn download_speaker_models(app: AppHandle) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut slot = download_slot().lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_some() {
            return Err(DOWNLOAD_RUNNING.to_string());
        }
        *slot = Some(cancel.clone());
    }
    let result = download_models_inner(&app, &cancel).await;
    *download_slot().lock().unwrap_or_else(|e| e.into_inner()) = None;
    if let Err(e) = &result {
        log::warn!(target: "notesage::speakers", "Voice model download failed: {e}");
    }
    result
}

async fn download_models_inner(app: &AppHandle, cancel: &AtomicBool) -> Result<(), String> {
    let dir = models::default_models_dir();
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Download failed: {e}"))?;
    for model in models::SPEAKER_MODELS {
        if models::is_installed(&dir, model) {
            continue;
        }
        // A file of the wrong size under the final name is a broken copy.
        let _ = tokio::fs::remove_file(models::model_path(&dir, model)).await;
        let spec = DownloadSpec {
            url: model.url.to_string(),
            final_path: models::model_path(&dir, model),
            temp_path: models::temp_path(&dir, model),
            catalogue_size: Some(model.size_bytes),
            sha256: Some(model.sha256.to_string()),
            magic: None,
        };
        log::info!(target: "notesage::speakers", "Downloading voice model '{}' from {}", model.id, spec.url);
        let mut on_progress = |downloaded: u64, total: u64| {
            let _ = app.emit(
                "speaker-model-download-progress",
                serde_json::json!({ "model": model.id, "downloaded": downloaded, "total": total }),
            );
        };
        if let Err(e) = download_with_resume(&client, &spec, cancel, Tuning::default(), &mut on_progress).await {
            // A cancel is the user saying "not this": nothing is left. Any
            // other failure keeps the partial file for the next attempt.
            if e == DOWNLOAD_CANCELLED {
                let _ = tokio::fs::remove_file(&spec.temp_path).await;
            }
            return Err(e);
        }
    }
    Ok(())
}

/// Stop a running download of the voice models. Returns whether one was
/// running. The download then rejects with `Download cancelled`.
#[tauri::command]
pub async fn cancel_speaker_models_download() -> Result<bool, String> {
    let slot = download_slot().lock().unwrap_or_else(|e| e.into_inner());
    match slot.as_ref() {
        Some(cancel) => {
            cancel.store(true, Ordering::Relaxed);
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Delete the downloaded voice models. Voice profiles are kept.
#[tauri::command]
pub async fn delete_speaker_models() -> Result<(), String> {
    if JobRegistry::global().has_kind(JobKind::SpeakerAnalysis) {
        return Err(MODELS_IN_USE.to_string());
    }
    if download_slot().lock().unwrap_or_else(|e| e.into_inner()).is_some() {
        return Err(DOWNLOAD_RUNNING.to_string());
    }
    blocking(|| models::delete_all(&models::default_models_dir()).map(|_| ())).await
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/// One separately recorded track of a recording made with source "both".
#[derive(Deserialize, Clone, Debug)]
pub struct SpeakerTrack {
    /// `"mic"` or `"system"`.
    pub role: String,
    pub path: String,
}

/// Which files to analyse and how: `(path, kind)`, microphone first.
///
/// - no tracks: the one file, any number of speakers;
/// - microphone and system audio: the microphone is the user (unless
///   `shared_microphone`), the system audio is everyone else;
/// - a single track, whatever its role: any number of speakers.
pub fn plan_tracks(
    audio_path: &str,
    tracks: Option<Vec<SpeakerTrack>>,
    shared_microphone: bool,
) -> Result<Vec<(String, TrackKind)>, String> {
    let tracks = tracks.unwrap_or_default();
    if tracks.is_empty() {
        return Ok(vec![(audio_path.to_string(), TrackKind::Unknown)]);
    }
    let mut mic = Vec::new();
    let mut system = Vec::new();
    for t in tracks {
        match t.role.as_str() {
            "mic" => mic.push(t.path),
            "system" => system.push(t.path),
            other => return Err(format!("Unknown track role: {other}")),
        }
    }
    let alone = mic.len() + system.len() == 1;
    let mic_kind = if alone || shared_microphone { TrackKind::Unknown } else { TrackKind::Known };
    Ok(mic
        .into_iter()
        .map(|p| (p, mic_kind))
        .chain(system.into_iter().map(|p| (p, TrackKind::Unknown)))
        .collect())
}

/// Decode and analyse every planned track with `engine`. Blocking.
fn analyse_tracks(
    engine: &dyn VoiceEngine,
    plan: &[(String, TrackKind)],
    reporter: &ProgressReporter,
    cancel: &AtomicBool,
) -> Result<Vec<AnalyzedTrack>, String> {
    let mut out = Vec::with_capacity(plan.len());
    for (index, (path, kind)) in plan.iter().enumerate() {
        make_local(Path::new(path), cancel)?;
        let span = Span::WHOLE.part(index, plan.len());
        let mut analyzer = TrackAnalyzer::new(engine, *kind, cancel);
        decode_stream_16k(Path::new(path), &mut |samples, fraction| {
            analyzer.push(samples)?;
            reporter.report(Stage::Transcribing, span.at(fraction));
            Ok(())
        })?;
        let found = analyzer.finish()?;
        log::info!(
            target: "notesage::speakers",
            "Track {}/{}: {:.1}s, {} stretch(es) of speech, {} window(s) embedded",
            index + 1,
            plan.len(),
            found.duration_secs,
            found.speech.len(),
            found.windows.len()
        );
        out.push(AnalyzedTrack { path: path.clone(), kind: *kind, found });
    }
    Ok(out)
}

/// Find who spoke when in a recording.
///
/// Runs on a blocking thread and takes turns with transcriptions (one job at
/// a time). Emits `speaker-analysis-progress`
/// (`{ job_id, audio_path, stage, percent }`, integer percent, on change).
/// `cancel_transcription(job_id, audio_path)` stops a waiting or running
/// analysis, which then rejects with exactly `Speaker analysis cancelled`.
///
/// The returned embeddings are voiceprints: they are for passing back to
/// `voice_profile_save` / `voice_profiles_match` and must never be written
/// into a recording bundle.
#[tauri::command]
pub async fn analyze_speakers(
    app: AppHandle,
    job_id: Option<String>,
    audio_path: String,
    tracks: Option<Vec<SpeakerTrack>>,
    expected_speakers: Option<u32>,
    segments: Option<Vec<Segment>>,
    shared_microphone: Option<bool>,
) -> Result<AnalysisOut, String> {
    let plan = plan_tracks(&audio_path, tracks, shared_microphone.unwrap_or(false))?;
    let expected = validate_expected(expected_speakers)?;
    for (path, _) in &plan {
        check_exists(Path::new(path))?;
    }
    if !models::is_installed(&models::default_models_dir(), models::embedding_model()) {
        return Err(MODELS_MISSING.to_string());
    }

    let ticket = take_turn(job_id.clone(), &audio_path).await?;

    let (event_job_id, event_path) = (job_id.clone(), audio_path.clone());
    let reporter = Arc::new(ProgressReporter::new(move |stage: Stage, percent: u8| {
        let stage = match stage {
            Stage::Loading => STAGE_LOADING,
            Stage::Decoding | Stage::Transcribing => STAGE_ANALYZING,
            Stage::Finishing => STAGE_FINISHING,
        };
        let _ = app.emit(
            "speaker-analysis-progress",
            serde_json::json!({
                "job_id": event_job_id,
                "audio_path": event_path,
                "stage": stage,
                "percent": percent,
            }),
        );
    }));
    reporter.report(Stage::Loading, 0.0);

    let reporter_task = reporter.clone();
    let started = std::time::Instant::now();
    let outcome = tokio::task::spawn_blocking(move || {
        // The turn is held until this closure returns.
        let ticket = ticket;
        let cancel = ticket.cancel_flag();
        let engine = load_engine()?;
        let analysed = analyse_tracks(&engine, &plan, &reporter_task, &cancel)?;
        Ok::<_, String>(assemble(&analysed, expected, segments.as_deref(), engine.model_id()))
    })
    .await
    .map_err(|e| format!("Speaker analysis task panicked: {e}"))?;

    match outcome {
        Ok(out) => {
            log::info!(
                target: "notesage::speakers",
                "analyze_speakers complete (job={:?}): {} speaker(s), {} turn(s), {:.1}s of audio in {:.1}s",
                job_id,
                out.speakers.len(),
                out.turns.len(),
                out.duration_secs,
                started.elapsed().as_secs_f64()
            );
            reporter.finish();
            Ok(out)
        }
        Err(e) => {
            log::info!(target: "notesage::speakers", "analyze_speakers ended without a result (job={:?}): {e}", job_id);
            Err(e)
        }
    }
}

/// One voice vector per named speaker, from turns that are already known
/// (a merged Teams transcript). Speakers with too little speech of their own
/// are listed under `skipped` with the reason.
#[tauri::command]
pub async fn embed_speaker_turns(audio_path: String, turns: Vec<Turn>) -> Result<NamedEmbeddings, String> {
    check_exists(Path::new(&audio_path))?;
    if !models::is_installed(&models::default_models_dir(), models::embedding_model()) {
        return Err(MODELS_MISSING.to_string());
    }
    let ticket = take_turn(None, &audio_path).await?;
    tokio::task::spawn_blocking(move || {
        let ticket = ticket;
        let cancel = ticket.cancel_flag();
        let order = speaker_order(&turns);
        let mut collector = NamedTurnCollector::new(&turns);
        let engine = load_engine()?;
        if !collector.is_empty() {
            make_local(Path::new(&audio_path), &cancel)?;
            let last = collector.last_needed();
            let mut position = 0usize;
            let decoded = decode_stream_16k(Path::new(&audio_path), &mut |samples, _| {
                if cancel.load(Ordering::Relaxed) {
                    return Err(CANCELLED.to_string());
                }
                collector.push(samples);
                position += samples.len();
                // Nothing after the last turn is needed.
                if position >= last {
                    return Err(clip::CLIP_COMPLETE.to_string());
                }
                Ok(())
            });
            match decoded {
                Ok(_) => {}
                Err(e) if e == clip::CLIP_COMPLETE => {}
                Err(e) => return Err(e),
            }
        }
        collector.finish(&engine, &order, &cancel)
    })
    .await
    .map_err(|e| format!("Speaker task panicked: {e}"))?
}

// ---------------------------------------------------------------------------
// Voice profiles
// ---------------------------------------------------------------------------

/// Where a saved voice came from.
#[derive(Deserialize, Clone, Debug)]
pub struct SaveSource {
    pub kind: SourceKind,
    /// The recording (bundle path) the voice was heard in.
    #[serde(default)]
    pub recording: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct SpeakerEmbedding {
    pub label: String,
    pub embedding: Vec<f32>,
}

/// An embedding made with another model than the one in use cannot be
/// stored or compared.
fn check_model(model: Option<&str>) -> Result<(), String> {
    match model {
        Some(m) if m != models::embedding_model().id => Err(format!(
            "This voice embedding was made with another voice model ({m}). Analyse the recording again."
        )),
        _ => Ok(()),
    }
}

/// The remembered voices, without their embeddings.
#[tauri::command]
pub async fn voice_profiles_list() -> Result<ProfileList, String> {
    blocking(|| Ok(store().list())).await
}

/// Remember a voice under a name (or add another example of it). Refused
/// with `Voice recognition is not enabled` unless `consent` is true.
#[tauri::command]
pub async fn voice_profile_save(
    consent: bool,
    name: String,
    embedding: Vec<f32>,
    source: SaveSource,
    profile_id: Option<String>,
    is_me: Option<bool>,
    model: Option<String>,
) -> Result<SaveOutcome, String> {
    require_consent(consent)?;
    check_model(model.as_deref())?;
    blocking(move || {
        store().save(
            consent,
            &name,
            embedding,
            models::embedding_model().dim,
            source.kind,
            source.recording,
            profile_id.as_deref(),
            is_me.unwrap_or(false),
        )
    })
    .await
}

#[tauri::command]
pub async fn voice_profile_rename(profile_id: String, name: String) -> Result<ProfileSummary, String> {
    blocking(move || store().rename(&profile_id, &name)).await
}

/// Fold `from_id` into `into_id` (the same person saved twice).
#[tauri::command]
pub async fn voice_profiles_merge(into_id: String, from_id: String) -> Result<ProfileSummary, String> {
    blocking(move || store().merge(&into_id, &from_id)).await
}

#[tauri::command]
pub async fn voice_profile_delete(profile_id: String) -> Result<(), String> {
    blocking(move || store().delete(&profile_id)).await
}

/// Delete every remembered voice, the folder they are in, and every sample
/// clip. Returns how many profile files were removed.
#[tauri::command]
pub async fn voice_profiles_delete_all() -> Result<usize, String> {
    blocking(|| {
        clip::purge_all(&clip::default_clip_dir());
        store().delete_all()
    })
    .await
}

/// Suggest who each speaker might be. Never assigns: the user confirms.
/// Refused with `Voice recognition is not enabled` unless `consent` is true.
#[tauri::command]
pub async fn voice_profiles_match(
    consent: bool,
    speakers: Vec<SpeakerEmbedding>,
    participants: Option<Vec<String>>,
    model: Option<String>,
) -> Result<Vec<SpeakerMatch>, String> {
    require_consent(consent)?;
    check_model(model.as_deref())?;
    blocking(move || {
        let speakers: Vec<(String, Vec<f32>)> = speakers.into_iter().map(|s| (s.label, s.embedding)).collect();
        Ok(match_speakers(&speakers, &store().usable(), participants.as_deref()))
    })
    .await
}

/// Learn the user's own voice from a recording of them speaking (at least
/// eight seconds of speech), into the one profile marked `is_me`. Refused
/// with `Voice recognition is not enabled` unless `consent` is true.
#[tauri::command]
pub async fn enrol_own_voice(
    consent: bool,
    audio_path: String,
    name: Option<String>,
) -> Result<SaveOutcome, String> {
    require_consent(consent)?;
    check_exists(Path::new(&audio_path))?;
    if !models::is_installed(&models::default_models_dir(), models::embedding_model()) {
        return Err(MODELS_MISSING.to_string());
    }
    let ticket = take_turn(None, &audio_path).await?;
    tokio::task::spawn_blocking(move || {
        let ticket = ticket;
        let cancel = ticket.cancel_flag();
        let engine = load_engine()?;
        make_local(Path::new(&audio_path), &cancel)?;
        let mut analyzer = TrackAnalyzer::new(&engine, TrackKind::Unknown, &cancel);
        decode_stream_16k(Path::new(&audio_path), &mut |samples, _| analyzer.push(samples))?;
        let embedding = enrolment_embedding(&analyzer.finish()?)?;
        let existing_name = store().list().profiles.into_iter().find(|p| p.is_me).map(|p| p.name);
        let name = match name.as_deref().map(str::trim) {
            Some(n) if !n.is_empty() => n.to_string(),
            // Keep the name the profile has; a first enrolment is "Me".
            _ => existing_name.unwrap_or_else(|| "Me".to_string()),
        };
        store().save(consent, &name, embedding, engine.dim(), SourceKind::Enrolment, None, None, true)
    })
    .await
    .map_err(|e| format!("Speaker task panicked: {e}"))?
}

// ---------------------------------------------------------------------------
// Sample clips
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ClipResult {
    pub path: String,
}

/// Write `[start, end)` seconds of `audio_path` (at most 30 s) as a WAV in a
/// private temp folder and return its path, for playing a speaker's sample.
/// Clips are removed after an hour and when the app quits.
#[tauri::command]
pub async fn extract_audio_clip(audio_path: String, start: f64, end: f64) -> Result<ClipResult, String> {
    let (from, to) = clip::clip_range(start, end)?;
    check_exists(Path::new(&audio_path))?;
    blocking(move || {
        let dir = clip::default_clip_dir();
        clip::purge(&dir, clip::CLIP_MAX_AGE);
        let never = AtomicBool::new(false);
        make_local(Path::new(&audio_path), &never)?;
        let mut collector = clip::ClipCollector::new(from, to);
        match decode_stream_16k(Path::new(&audio_path), &mut |samples, _| collector.push(samples)) {
            Ok(_) => {}
            Err(e) if e == clip::CLIP_COMPLETE => {}
            Err(e) => return Err(e),
        }
        let path: PathBuf = clip::clip_path(&dir, &audio_path, from, to);
        clip::write_clip(&dir, &path, &collector.samples)?;
        Ok(ClipResult { path: path.to_string_lossy().to_string() })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(role: &str, path: &str) -> SpeakerTrack {
        SpeakerTrack { role: role.into(), path: path.into() }
    }

    #[test]
    fn track_plans() {
        // No tracks: the file itself, any number of speakers.
        assert_eq!(plan_tracks("/a.m4a", None, false).unwrap(), vec![("/a.m4a".to_string(), TrackKind::Unknown)]);
        assert_eq!(plan_tracks("/a.m4a", Some(vec![]), true).unwrap(), vec![("/a.m4a".to_string(), TrackKind::Unknown)]);
        // Both: the microphone is the user, and comes first whatever the order.
        let both = plan_tracks("/a.m4a", Some(vec![track("system", "/s.m4a"), track("mic", "/m.m4a")]), false).unwrap();
        assert_eq!(
            both,
            vec![("/m.m4a".to_string(), TrackKind::Known), ("/s.m4a".to_string(), TrackKind::Unknown)]
        );
        // Several people at the microphone: it is diarised too.
        let shared = plan_tracks("/a.m4a", Some(vec![track("mic", "/m.m4a"), track("system", "/s.m4a")]), true).unwrap();
        assert_eq!(shared[0].1, TrackKind::Unknown);
        // A lone microphone track is a room: any number of speakers.
        let alone = plan_tracks("/a.m4a", Some(vec![track("mic", "/m.m4a")]), false).unwrap();
        assert_eq!(alone, vec![("/m.m4a".to_string(), TrackKind::Unknown)]);
        assert_eq!(
            plan_tracks("/a.m4a", Some(vec![track("mix", "/x.m4a")]), false).unwrap_err(),
            "Unknown track role: mix"
        );
    }

    #[test]
    fn an_embedding_of_another_model_is_refused() {
        assert!(check_model(None).is_ok());
        assert!(check_model(Some(models::embedding_model().id)).is_ok());
        let err = check_model(Some("some-other-model")).unwrap_err();
        assert!(err.starts_with("This voice embedding was made with another voice model (some-other-model)"), "{err}");
    }

    #[tokio::test]
    async fn commands_refuse_without_consent_before_doing_anything() {
        let source = SaveSource { kind: SourceKind::Manual, recording: None };
        let err = voice_profile_save(false, "Anna".into(), vec![0.1; 256], source, None, None, None).await.unwrap_err();
        assert_eq!(err, "Voice recognition is not enabled");
        let err = voice_profiles_match(false, vec![], None, None).await.unwrap_err();
        assert_eq!(err, "Voice recognition is not enabled");
        // Consent is checked before the file is even looked for.
        let err = enrol_own_voice(false, "/definitely/not/here.wav".into(), None).await.unwrap_err();
        assert_eq!(err, "Voice recognition is not enabled");
    }

    #[tokio::test]
    async fn clip_arguments_and_missing_files_are_reported() {
        assert_eq!(extract_audio_clip("/x.wav".into(), 5.0, 1.0).await.unwrap_err(), "Invalid clip range");
        let err = extract_audio_clip("/definitely/not/here.wav".into(), 0.0, 5.0).await.unwrap_err();
        assert_eq!(err, "Audio file not found: /definitely/not/here.wav");
        let err = embed_speaker_turns("/definitely/not/here.wav".into(), vec![]).await.unwrap_err();
        assert_eq!(err, "Audio file not found: /definitely/not/here.wav");
    }

    #[test]
    fn the_argument_shapes_deserialize_from_what_the_frontend_sends() {
        let source: SaveSource = serde_json::from_str(r#"{"kind":"teams","recording":"/lib/Recordings/A"}"#).unwrap();
        assert_eq!(source.kind, SourceKind::Teams);
        assert_eq!(source.recording.as_deref(), Some("/lib/Recordings/A"));
        let source: SaveSource = serde_json::from_str(r#"{"kind":"manual"}"#).unwrap();
        assert!(source.recording.is_none());
        assert!(serde_json::from_str::<SaveSource>(r#"{"kind":"guess"}"#).is_err());
        let s: SpeakerEmbedding = serde_json::from_str(r#"{"label":"speaker-1","embedding":[0.5,-0.5]}"#).unwrap();
        assert_eq!(s.label, "speaker-1");
        let t: SpeakerTrack = serde_json::from_str(r#"{"role":"mic","path":"/m.m4a"}"#).unwrap();
        assert_eq!(t.role, "mic");
        let turn: Turn = serde_json::from_str(r#"{"start":1.5,"end":4,"speaker":"Anna Berg"}"#).unwrap();
        assert_eq!(turn.speaker, "Anna Berg");
        let seg: Segment = serde_json::from_str(r#"{"start":0,"end":1,"text":"hi"}"#).unwrap();
        assert!(seg.speaker.is_none());
        // Extra keys of a transcript segment (speaker_id, speaker_name) are ignored.
        let seg: Segment =
            serde_json::from_str(r#"{"start":0,"end":1,"text":"hi","speaker":"me","speaker_id":null,"speaker_name":null}"#).unwrap();
        assert_eq!(seg.speaker.as_deref(), Some("me"));
    }

    #[test]
    fn the_strings_the_frontend_matches_on() {
        assert_eq!(CANCELLED, "Speaker analysis cancelled");
        assert_eq!(MODELS_MISSING, "Voice models are not downloaded. Download them from Settings > Transcription.");
        assert_eq!(super::super::profiles::CONSENT_REQUIRED, "Voice recognition is not enabled");
        assert_eq!((STAGE_LOADING, STAGE_ANALYZING, STAGE_FINISHING), ("loading", "analyzing", "finishing"));
    }
}
