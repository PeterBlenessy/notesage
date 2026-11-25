//! Meeting recording: capture to disk, and getting the result into the
//! library.
//!
//! Capture is deliberately dumb: samples go to a file and nothing else
//! happens to them until the recording has stopped. Transcription is a
//! separate background job on the finished file (`super::transcription`).
//!
//! | module | what it holds |
//! | --- | --- |
//! | `wav` | streaming WAV writer, header repair, reader |
//! | `ring` | lock-free ring between the audio callback and the capture thread |
//! | `mix` | downmix, sample-rate conversion, the mono mix of two tracks |
//! | `monitor` | level metering, silence, stall, disk and timeline rules |
//! | `track` | ring → file for one track |
//! | `owner` | the capture owner and what it shares with the capture thread |
//! | `session` | the capture thread's loop, against an abstract audio backend |
//! | `capture` | the cpal backend (the only audio-stack code) |
//! | `staging` | staging bundles, finalize into the library, orphan recovery |
//! | `encode` | WAV → AAC after stop, verified |
//! | `finish` | the stop path after the audio thread has let go |
//! | `preflight` | permissions, OS support, free space |
//! | `state` | managed state and the admission rules |
//!
//! Only `capture` and the command functions below need audio hardware or
//! Tauri; everything else is pure and unit-tested.

mod capture;
mod encode;
mod finish;
mod mix;
mod monitor;
mod owner;
mod preflight;
mod ring;
mod session;
mod staging;
mod state;
mod track;
mod types;
mod wav;

pub use state::{is_capture_active, RecordingState};
pub use types::{
    FinalizedBundle, OrphanRecording, RecordingPreflight, RecordingResult, RecordingStateInfo,
};

use monitor::{LevelPayload, MIN_FREE_BYTES_TO_START};
use owner::{CaptureEvents, CaptureOwner};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use types::{Source, WarningKind, WarningPayload};

/// How long `stop_recording` waits for the audio thread to release the
/// devices before carrying on with the files as they are on disk.
const STOP_TIMEOUT: Duration = Duration::from_secs(10);
/// The same wait at app exit, where holding up the quit is worse.
pub const EXIT_STOP_TIMEOUT: Duration = Duration::from_secs(3);

/// Forwards the capture thread's reports to the webview.
struct TauriEvents(AppHandle);

impl CaptureEvents for TauriEvents {
    fn level(&self, payload: LevelPayload) {
        let _ = self.0.emit("recording-level", payload);
    }

    fn warning(&self, kind: WarningKind, role: Option<monitor::Role>, message: String, fatal: bool) {
        log::warn!(
            target: "notesage::recording",
            "recording-warning {} (fatal: {}): {}", kind.as_str(), fatal, message
        );
        let _ = self
            .0
            .emit("recording-warning", WarningPayload::new(kind, role, message, fatal));
    }
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("Background task failed: {}", e))
}

/// Checks that need no audio stream: is the request something this machine
/// can do at all? Kept apart from opening the streams so a refusal costs
/// nothing and creates nothing.
fn check_source_available(source: Source) -> Result<(), String> {
    if source.includes_mic() && preflight::microphone_status() == "denied" {
        return Err(
            "Microphone access is denied. Allow Notesage in System Settings > Privacy & Security > Microphone."
                .into(),
        );
    }
    if source.includes_system() {
        match preflight::system_audio_status() {
            "available" => {}
            _ if !cfg!(target_os = "macos") => {
                return Err("System audio recording is not available on this platform".into())
            }
            "unsupported" => {
                return Err("System audio recording requires macOS 14.2 or later".into())
            }
            _ => {
                return Err(
                    "System audio recording is not available: the macOS version could not be determined"
                        .into(),
                )
            }
        }
    }
    Ok(())
}

/// Everything `start_recording` does off the async runtime: create the
/// staging bundle and open the streams. On failure nothing is left behind.
fn open_capture(app: AppHandle, staging_root: PathBuf, source: Source) -> Result<CaptureOwner, String> {
    check_source_available(source)?;
    if let Some(free) = preflight::free_bytes(&staging_root) {
        if free < MIN_FREE_BYTES_TO_START {
            return Err(format!(
                "Not enough free disk space to record ({} MB free)",
                free / (1024 * 1024)
            ));
        }
    }

    let now = chrono::Local::now();
    let bundle_dir =
        staging::create_staging_bundle(&staging_root, &staging::bundle_name(now.naive_local()))?;
    let marker = staging::CaptureMarker {
        version: 1,
        started_at: now.to_rfc3339(),
        source: source.as_str().to_string(),
    };
    let opened = staging::write_marker(&bundle_dir, &marker).and_then(|()| {
        let track_files = source
            .track_files()
            .into_iter()
            .map(|(role, file)| (role, bundle_dir.join(file)))
            .collect();
        capture::spawn_capture(
            capture::CaptureConfig { source, bundle_dir: bundle_dir.clone(), track_files },
            Box::new(TauriEvents(app)),
        )
    });
    if opened.is_err() {
        let _ = std::fs::remove_dir_all(&bundle_dir);
    }
    opened
}

/// What can be known before recording, without prompting for anything.
#[tauri::command]
pub async fn recording_preflight(
    state: State<'_, RecordingState>,
    source: String,
) -> Result<RecordingPreflight, String> {
    Source::parse(&source)?;
    let staging_root = state.staging_root().to_path_buf();
    blocking(move || {
        let (input_device, output_device) = capture::default_device_names();
        RecordingPreflight {
            microphone: preflight::microphone_status().to_string(),
            system_audio: preflight::system_audio_status().to_string(),
            input_device,
            output_device,
            free_bytes: preflight::free_bytes(&staging_root).unwrap_or(0),
        }
    })
    .await
}

/// Start recording `source` (`"microphone"`, `"system"` or `"both"`) into a
/// new local staging bundle. Exactly one recording may be active at a time.
/// Fails rather than record less than was asked for.
#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, RecordingState>,
    source: String,
) -> Result<(), String> {
    let source = Source::parse(&source)?;
    // Admission: refused while a recording is active, another start is
    // opening its streams, or a stop is still tearing down (#264).
    state.begin_start()?;
    let staging_root = state.staging_root().to_path_buf();
    // Opening CoreAudio streams can take hundreds of milliseconds (and the
    // system tap longer): never on an async worker (C7).
    let opened = blocking(move || open_capture(app, staging_root, source))
        .await
        .and_then(|r| r);
    if let Ok(owner) = &opened {
        log::info!(
            target: "notesage::recording",
            "Recording started (source: {}) → {}", source.as_str(), owner.bundle_dir.display()
        );
    }
    state.finish_start(opened)
}

/// Pause the active recording: the audio callbacks discard their samples
/// while the streams stay open. Idempotent.
#[tauri::command]
pub async fn pause_recording(state: State<'_, RecordingState>) -> Result<(), String> {
    state.with_capture(|owner| owner.set_paused(true))?;
    log::info!(target: "notesage::recording", "Recording paused");
    Ok(())
}

/// Resume a paused recording. Idempotent.
#[tauri::command]
pub async fn resume_recording(state: State<'_, RecordingState>) -> Result<(), String> {
    state.with_capture(|owner| owner.set_paused(false))?;
    log::info!(target: "notesage::recording", "Recording resumed");
    Ok(())
}

/// Stop recording: wait for the audio thread to release the devices and
/// finalise the files, mix the tracks of a "both" recording, compress to AAC
/// (macOS), and describe the result. Takes seconds to tens of seconds for an
/// hour of audio; all of it runs off the async workers.
#[tauri::command]
pub async fn stop_recording(state: State<'_, RecordingState>) -> Result<RecordingResult, String> {
    let mut owner = state.take_for_stop()?;
    let source = owner.source;
    let bundle_dir = owner.bundle_dir.clone();

    // Phase 1: teardown. `stopping` stays set across it, so no start can
    // open a stream while this one is still closing (#264).
    let teardown = blocking(move || {
        let stopped = owner.stop(STOP_TIMEOUT);
        let timed_out = stopped.timed_out;
        let outcome = stopped.outcome.unwrap_or_else(|| owner.outcome_from_disk());
        let lingering = timed_out.then(|| owner.shared().clone());
        (outcome, timed_out, lingering)
    })
    .await;
    let (outcome, timed_out, lingering) = match teardown {
        Ok(t) => t,
        Err(e) => {
            state.end_stop(None);
            state.untrack_bundle(&bundle_dir);
            return Err(e);
        }
    };
    state.end_stop(lingering);
    if timed_out {
        log::error!(
            target: "notesage::recording",
            "The audio thread did not stop within {:?}; using the files as they are on disk", STOP_TIMEOUT
        );
    }

    // Phase 2: files. A new recording may start while this runs.
    let dir = bundle_dir.clone();
    let finished = blocking(move || {
        finish::finish_recording(source, &dir, outcome, timed_out, &encode::encode_to_aac)
    })
    .await
    .and_then(|r| r);

    match &finished {
        Ok(result) => log::info!(
            target: "notesage::recording",
            "Recording stopped ({:.1}s @ {}Hz, peak={:.6}, dropped={}, warnings={:?}) → {}",
            result.duration_secs, result.sample_rate, result.peak, result.dropped_frames,
            result.warnings, result.audio_path
        ),
        Err(e) => {
            log::error!(target: "notesage::recording", "stop_recording failed: {}", e);
            // Leave the bundle on disk and let recovery offer it.
            state.untrack_bundle(&bundle_dir);
        }
    }
    finished
}

/// Stop the live recording (if any) and delete its staging bundle; or, with
/// `bundle_dir`, delete that staging bundle.
#[tauri::command]
pub async fn discard_recording(
    state: State<'_, RecordingState>,
    bundle_dir: Option<String>,
) -> Result<(), String> {
    let root = state.staging_root().to_path_buf();
    let requested = bundle_dir.map(PathBuf::from);
    let live = state.live_bundle();
    let targets_live = match (&requested, &live) {
        (None, Some(_)) => true,
        (Some(req), Some(live)) => same_dir(req, live),
        _ => false,
    };

    if targets_live {
        // A concurrent stop may have taken it in the meantime: then there is
        // nothing live to discard.
        if let Ok(mut owner) = state.take_for_stop() {
            let dir = owner.bundle_dir.clone();
            let lingering = blocking(move || {
                let stopped = owner.stop(STOP_TIMEOUT);
                stopped.timed_out.then(|| owner.shared().clone())
            })
            .await;
            state.end_stop(lingering.unwrap_or(None));
            state.untrack_bundle(&dir);
            let removed = blocking(move || staging::remove_staging_bundle(&root, &dir))
                .await
                .and_then(|r| r);
            log::info!(target: "notesage::recording", "Recording discarded");
            return removed;
        }
        return Ok(());
    }

    match requested {
        // No live recording and nothing named: nothing to do.
        None => Ok(()),
        Some(dir) => {
            state.untrack_bundle(&dir);
            blocking(move || staging::remove_staging_bundle(&root, &dir))
                .await
                .and_then(|r| r)
        }
    }
}

fn same_dir(a: &Path, b: &Path) -> bool {
    a == b
        || match (a.canonicalize(), b.canonicalize()) {
            (Ok(a), Ok(b)) => a == b,
            _ => false,
        }
}

/// Move a stopped staging bundle into the library's `Recordings` folder.
/// Called by the frontend after it has written `recording.json` into the
/// bundle, so a bundle never appears in the library without its manifest.
#[tauri::command]
pub async fn finalize_recording_bundle(
    state: State<'_, RecordingState>,
    staging_dir: String,
    dest_recordings_dir: String,
) -> Result<FinalizedBundle, String> {
    let staging_dir = PathBuf::from(staging_dir);
    if state.live_bundle().is_some_and(|live| same_dir(&live, &staging_dir)) {
        return Err("Recording is still in progress".into());
    }
    let root = state.staging_root().to_path_buf();
    let dest = PathBuf::from(dest_recordings_dir);
    let from = staging_dir.clone();
    let done = blocking(move || staging::finalize_bundle(&root, &from, &dest, &staging::FsMover))
        .await
        .and_then(|r| r)?;
    state.untrack_bundle(&staging_dir);
    log::info!(target: "notesage::recording", "Recording moved into the library → {}", done.bundle_dir);
    Ok(done)
}

/// Find, repair and report recordings that a crash or quit left in staging.
#[tauri::command]
pub async fn recover_orphan_recordings(
    state: State<'_, RecordingState>,
) -> Result<Vec<OrphanRecording>, String> {
    let root = state.staging_root().to_path_buf();
    let skip = state.session_bundles();
    let found = blocking(move || {
        staging::recover_orphans(&root, &skip, &encode::encoded_duration_secs)
    })
    .await?;
    if !found.is_empty() {
        log::info!(target: "notesage::recording", "Recovered {} orphaned recording(s)", found.len());
    }
    Ok(found)
}

/// Whether a recording is live, and how much has been recorded.
#[tauri::command]
pub async fn get_recording_state(
    state: State<'_, RecordingState>,
) -> Result<RecordingStateInfo, String> {
    Ok(state.info())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_dir_compares_spellings_of_one_folder() {
        let dir = std::env::temp_dir().join(format!("notesage-same-dir-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("a")).unwrap();
        assert!(same_dir(&dir.join("a"), &dir.join("a")));
        assert!(same_dir(&dir.join("a"), &dir.join("a").join("..").join("a")));
        assert!(!same_dir(&dir.join("a"), &dir));
        assert!(!same_dir(&dir.join("missing"), &dir.join("other-missing")));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
