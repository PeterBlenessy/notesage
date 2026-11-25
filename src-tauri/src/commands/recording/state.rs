//! The recorder's managed state: at most one capture, and the rules about
//! when one may start.
//!
//! Kept free of Tauri so the admission rules (the #264 guard and its
//! extensions) are tested as they are used.

use super::owner::{CaptureOwner, CaptureShared};
use super::types::RecordingStateInfo;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Whether a capture owner is currently installed, process-wide. Read by the
/// diagnostics export, which has no handle on this state.
static CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);

/// `true` while a recording is in progress.
pub fn is_capture_active() -> bool {
    CAPTURE_ACTIVE.load(Ordering::Relaxed)
}

pub struct RecordingState {
    /// The single active capture owner, if any. Guarding this in a mutex is
    /// what enforces "exactly one capture at a time".
    capture: Mutex<Option<CaptureOwner>>,
    /// Set while a stop is mid-teardown: the owner has been taken out of
    /// `capture` but its streams may still be open. `start_recording` refuses
    /// while it is set, closing the window (#264) in which `capture` reads
    /// `None` although a stream is alive. Read and written under the
    /// `capture` lock so check-and-set is atomic against a start.
    stopping: AtomicBool,
    /// Set while a start is opening its streams (off the async runtime, C7):
    /// `capture` is still `None`, and a second start must not slip in.
    starting: AtomicBool,
    /// A capture thread that did not exit within its stop timeout. While it
    /// is alive it still holds the audio device.
    lingering: Mutex<Option<Arc<CaptureShared>>>,
    staging_root: PathBuf,
    /// Staging bundles this app session created and has not yet finalised or
    /// discarded. Orphan recovery skips them.
    session_bundles: Mutex<HashSet<PathBuf>>,
}

impl RecordingState {
    pub fn new() -> Self {
        Self::with_root(super::staging::staging_root())
    }

    pub fn with_root(staging_root: PathBuf) -> Self {
        Self {
            capture: Mutex::new(None),
            stopping: AtomicBool::new(false),
            starting: AtomicBool::new(false),
            lingering: Mutex::new(None),
            staging_root,
            session_bundles: Mutex::new(HashSet::new()),
        }
    }

    pub fn staging_root(&self) -> &Path {
        &self.staging_root
    }

    /// The `start_recording` admission guard, as a predicate so production
    /// code and the #264 regression test exercise the same rule. `busy` is
    /// "a stop is mid-teardown or another start is in flight".
    pub fn check_can_start(capture_is_some: bool, busy: bool) -> Result<(), String> {
        if capture_is_some || busy {
            return Err("Recording already in progress".into());
        }
        Ok(())
    }

    fn lock_capture(&self) -> Result<std::sync::MutexGuard<'_, Option<CaptureOwner>>, String> {
        self.capture.lock().map_err(|e| format!("Lock error: {}", e))
    }

    /// Reserve the right to start. On `Ok`, the caller MUST call
    /// [`Self::finish_start`] exactly once, whatever happens.
    pub fn begin_start(&self) -> Result<(), String> {
        let capture = self.lock_capture()?;
        Self::check_can_start(
            capture.is_some(),
            self.stopping.load(Ordering::Relaxed) || self.starting.load(Ordering::Relaxed),
        )?;
        {
            let mut lingering = self.lingering.lock().unwrap_or_else(|e| e.into_inner());
            match lingering.as_ref() {
                Some(shared) if shared.alive.load(Ordering::SeqCst) => {
                    return Err(
                        "The previous recording is still shutting down. If this does not clear, restart Notesage."
                            .into(),
                    );
                }
                _ => *lingering = None,
            }
        }
        self.starting.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Complete a start begun with [`Self::begin_start`]: install the owner,
    /// or just release the reservation if opening failed.
    pub fn finish_start(&self, owner: Result<CaptureOwner, String>) -> Result<(), String> {
        let mut capture = self.capture.lock().unwrap_or_else(|e| e.into_inner());
        self.starting.store(false, Ordering::Relaxed);
        let owner = owner?;
        self.track_bundle(&owner.bundle_dir);
        *capture = Some(owner);
        CAPTURE_ACTIVE.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Run `f` on the active capture. Errors if there is none.
    pub fn with_capture<R>(&self, f: impl FnOnce(&CaptureOwner) -> R) -> Result<R, String> {
        let capture = self.lock_capture()?;
        let owner = capture.as_ref().ok_or("No recording in progress")?;
        Ok(f(owner))
    }

    /// Take the owner out for stopping and set `stopping` under the same
    /// lock. The caller stops it (off the async runtime) and then MUST call
    /// [`Self::end_stop`].
    pub fn take_for_stop(&self) -> Result<CaptureOwner, String> {
        let mut capture = self.lock_capture()?;
        let owner = capture.take().ok_or("No recording in progress")?;
        self.stopping.store(true, Ordering::Relaxed);
        CAPTURE_ACTIVE.store(false, Ordering::Relaxed);
        Ok(owner)
    }

    /// Teardown is over. `lingering`: the shared state of a capture thread
    /// that did NOT exit in time, so that new starts wait for it.
    pub fn end_stop(&self, lingering: Option<Arc<CaptureShared>>) {
        let _capture = self.capture.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(shared) = lingering {
            *self.lingering.lock().unwrap_or_else(|e| e.into_inner()) = Some(shared);
        }
        self.stopping.store(false, Ordering::Relaxed);
    }

    /// The bundle folder of the live recording, if any.
    pub fn live_bundle(&self) -> Option<PathBuf> {
        self.capture
            .lock()
            .ok()
            .and_then(|c| c.as_ref().map(|o| o.bundle_dir.clone()))
    }

    pub fn info(&self) -> RecordingStateInfo {
        let capture = self.capture.lock().unwrap_or_else(|e| e.into_inner());
        match capture.as_ref() {
            Some(owner) => RecordingStateInfo {
                recording: true,
                paused: owner.is_paused(),
                source: Some(owner.source.as_str().to_string()),
                started_at_ms: Some(owner.started_at_ms),
                elapsed_recorded_ms: owner.shared().elapsed_recorded_ms(),
                fatal: owner.is_fatal(),
            },
            None => RecordingStateInfo::default(),
        }
    }

    pub fn track_bundle(&self, dir: &Path) {
        self.session_bundles
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(dir.to_path_buf());
    }

    /// Forget a bundle (finalised, discarded, or given up on). Matches the
    /// path as given and by file name, so a canonicalised spelling of the
    /// same folder is forgotten too.
    pub fn untrack_bundle(&self, dir: &Path) {
        let mut set = self.session_bundles.lock().unwrap_or_else(|e| e.into_inner());
        let name = dir.file_name().map(|n| n.to_os_string());
        set.retain(|p| p != dir && (name.is_none() || p.file_name().map(|n| n.to_os_string()) != name));
    }

    /// Bundles orphan recovery must leave alone.
    pub fn session_bundles(&self) -> HashSet<PathBuf> {
        self.session_bundles.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// App exit: stop any live capture and make its files valid, waiting at
    /// most `timeout` for the audio thread. Never blocks beyond that, even
    /// if the thread is stuck in the audio driver. Nothing is encoded or
    /// moved; the bundle is picked up as an orphan on the next launch.
    pub fn stop_for_exit(&self, timeout: Duration) {
        let owner = match self.capture.lock() {
            Ok(mut capture) => capture.take(),
            Err(poisoned) => poisoned.into_inner().take(),
        };
        let Some(mut owner) = owner else {
            return;
        };
        CAPTURE_ACTIVE.store(false, Ordering::Relaxed);
        let stopped = owner.stop(timeout);
        if stopped.outcome.is_none() {
            // The thread could not finalise: repair the headers from the
            // file lengths so what was flushed is a valid recording.
            let _ = owner.outcome_from_disk();
        }
    }
}

impl Default for RecordingState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::super::monitor::Role;
    use super::super::owner::CaptureOutcome;
    use super::super::types::Source;
    use super::super::wav::{wav_header, WavReader};
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::time::Instant;

    fn state() -> RecordingState {
        RecordingState::with_root(std::env::temp_dir().join("notesage-state-test-staging"))
    }

    /// A real owner around a parking thread (no audio). `live` counts
    /// "devices held".
    fn fake_owner(live: Arc<AtomicUsize>, bundle: &str) -> CaptureOwner {
        live.fetch_add(1, Ordering::SeqCst);
        let dir = PathBuf::from(bundle);
        CaptureOwner::spawn_with(
            Source::Microphone,
            dir.clone(),
            vec![(Role::Mic, dir.join("audio.wav"))],
            move |shared| {
                while !shared.stop.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(1));
                }
                live.fetch_sub(1, Ordering::SeqCst);
                CaptureOutcome::default()
            },
        )
        .unwrap()
    }

    /// #264 regression: while a stop is mid-teardown (the owner has been
    /// taken out, so `capture` reads `None`, but the stream is still alive)
    /// a start MUST be refused; only after teardown may one succeed.
    ///
    /// Drives the real state through the same calls the commands make. It
    /// fails against a guard that only checks `capture.is_some()`.
    #[test]
    fn start_is_refused_while_stop_is_in_progress() {
        let state = state();
        let live = Arc::new(AtomicUsize::new(0));

        state.begin_start().expect("first start should be admitted");
        state.finish_start(Ok(fake_owner(live.clone(), "/tmp/ns-a"))).unwrap();
        assert_eq!(live.load(Ordering::SeqCst), 1, "stream should be live after start");
        assert!(state.info().recording);

        // stop_recording, phase 1: take the owner; `stopping` is now set.
        let mut owner = state.take_for_stop().expect("owner present");
        assert_eq!(live.load(Ordering::SeqCst), 1, "stream still alive mid-teardown");
        assert!(!state.info().recording);
        let refused = state.begin_start().unwrap_err();
        assert_eq!(
            refused, "Recording already in progress",
            "start admitted while a stop was in progress: a second stream would overlap (#264)"
        );

        // Phase 2: awaited teardown, then the flag is cleared.
        assert!(!owner.stop(Duration::from_secs(5)).timed_out);
        state.end_stop(None);
        assert_eq!(live.load(Ordering::SeqCst), 0, "stream still live after stop returned");

        state.begin_start().expect("start after teardown should be admitted");
        state.finish_start(Err("no device".into())).unwrap_err();
    }

    #[test]
    fn the_predicate_itself() {
        assert!(RecordingState::check_can_start(false, false).is_ok());
        assert!(RecordingState::check_can_start(true, false).is_err());
        assert!(RecordingState::check_can_start(false, true).is_err());
    }

    /// C7 made start asynchronous-safe by opening the streams off the
    /// runtime, which leaves a window where nothing is installed yet. Two
    /// rapid starts (a double press of the shortcut) must not both get in.
    #[test]
    fn a_second_start_is_refused_while_the_first_is_still_opening() {
        let state = state();
        let live = Arc::new(AtomicUsize::new(0));
        state.begin_start().unwrap();
        assert_eq!(state.begin_start().unwrap_err(), "Recording already in progress");

        // The first start fails: the reservation is released.
        assert_eq!(state.finish_start(Err("No microphone available".into())).unwrap_err(), "No microphone available");
        assert!(!state.info().recording);
        state.begin_start().expect("a failed start must not wedge the recorder");
        state.finish_start(Ok(fake_owner(live.clone(), "/tmp/ns-b"))).unwrap();
        assert_eq!(state.begin_start().unwrap_err(), "Recording already in progress");

        let mut owner = state.take_for_stop().unwrap();
        owner.stop(Duration::from_secs(5));
        state.end_stop(None);
        assert_eq!(state.take_for_stop().err().as_deref(), Some("No recording in progress"));
    }

    /// A capture thread that never released the device blocks new starts
    /// for as long as it lives, and no longer.
    #[test]
    fn a_lingering_capture_thread_blocks_starts_until_it_exits() {
        let state = state();
        let release = Arc::new(AtomicBool::new(false));
        let release_t = release.clone();
        let stuck = CaptureOwner::spawn_with(
            Source::Microphone,
            PathBuf::from("/tmp/ns-stuck"),
            vec![(Role::Mic, PathBuf::from("/tmp/ns-stuck/audio.wav"))],
            move |_| {
                while !release_t.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(1));
                }
                CaptureOutcome::default()
            },
        )
        .unwrap();
        state.begin_start().unwrap();
        state.finish_start(Ok(stuck)).unwrap();

        let mut owner = state.take_for_stop().unwrap();
        let stopped = owner.stop(Duration::from_millis(50));
        assert!(stopped.timed_out);
        state.end_stop(Some(owner.shared().clone()));

        let err = state.begin_start().unwrap_err();
        assert!(err.starts_with("The previous recording is still shutting down"), "{err}");

        release.store(true, Ordering::Relaxed);
        let deadline = Instant::now() + Duration::from_secs(5);
        while owner.shared().alive.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(2));
        }
        state.begin_start().expect("admitted once the old thread is gone");
        state.finish_start(Err("x".into())).unwrap_err();
    }

    #[test]
    fn pause_and_state_info_follow_the_owner() {
        let state = state();
        assert_eq!(state.info(), RecordingStateInfo::default());
        assert_eq!(state.with_capture(|o| o.set_paused(true)).unwrap_err(), "No recording in progress");

        let live = Arc::new(AtomicUsize::new(0));
        state.begin_start().unwrap();
        state.finish_start(Ok(fake_owner(live, "/tmp/ns-c"))).unwrap();
        state
            .with_capture(|o| {
                o.shared().tracks[0].sample_rate.store(48_000, Ordering::Relaxed);
                o.shared().tracks[0].frames.store(72_000, Ordering::Relaxed);
            })
            .unwrap();
        let info = state.info();
        assert!(info.recording && !info.paused && !info.fatal);
        assert_eq!(info.source.as_deref(), Some("microphone"));
        assert!(info.started_at_ms.unwrap() > 1_600_000_000_000);
        assert_eq!(info.elapsed_recorded_ms, 1500, "from frames written, not wall clock");

        state.with_capture(|o| o.set_paused(true)).unwrap();
        assert!(state.info().paused);
        state.with_capture(|o| o.set_paused(false)).unwrap();
        assert!(!state.info().paused);
        assert_eq!(state.live_bundle(), Some(PathBuf::from("/tmp/ns-c")));

        let mut owner = state.take_for_stop().unwrap();
        owner.stop(Duration::from_secs(5));
        state.end_stop(None);
        assert_eq!(state.live_bundle(), None);
    }

    #[test]
    fn session_bundles_are_tracked_until_finalised_or_discarded() {
        let state = state();
        let live = Arc::new(AtomicUsize::new(0));
        state.begin_start().unwrap();
        state.finish_start(Ok(fake_owner(live, "/tmp/staging/Recording A"))).unwrap();
        assert!(state.session_bundles().contains(Path::new("/tmp/staging/Recording A")));
        let mut owner = state.take_for_stop().unwrap();
        owner.stop(Duration::from_secs(5));
        state.end_stop(None);
        assert!(
            state.session_bundles().contains(Path::new("/tmp/staging/Recording A")),
            "stopped but not yet finalised: still not an orphan"
        );
        state.track_bundle(Path::new("/tmp/staging/Recording B"));
        // A canonicalised spelling of the same folder.
        state.untrack_bundle(Path::new("/private/tmp/staging/Recording A"));
        assert_eq!(state.session_bundles().len(), 1);
        state.untrack_bundle(Path::new("/tmp/staging/Recording B"));
        assert!(state.session_bundles().is_empty());
    }

    /// App exit (C3): the live capture is stopped and its file left valid,
    /// and a stuck audio thread cannot hold the exit up.
    #[test]
    fn exit_stops_the_capture_and_never_waits_past_its_timeout() {
        let state = state();
        state.stop_for_exit(Duration::from_secs(1)); // nothing live: no-op

        let live = Arc::new(AtomicUsize::new(0));
        state.begin_start().unwrap();
        state.finish_start(Ok(fake_owner(live.clone(), "/tmp/ns-exit"))).unwrap();
        state.stop_for_exit(Duration::from_secs(5));
        assert_eq!(live.load(Ordering::SeqCst), 0, "device released on exit");
        assert!(!state.info().recording);

        // Stuck thread, and a crash-shaped file on disk.
        let dir = std::env::temp_dir().join(format!("notesage-exit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("audio.wav");
        let mut bytes = wav_header(48_000, 1, 0).to_vec();
        bytes.extend(vec![0u8; 9600]);
        std::fs::write(&wav, bytes).unwrap();
        let release = Arc::new(AtomicBool::new(false));
        let release_t = release.clone();
        let stuck = CaptureOwner::spawn_with(
            Source::Microphone,
            dir.clone(),
            vec![(Role::Mic, wav.clone())],
            move |_| {
                while !release_t.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(1));
                }
                CaptureOutcome::default()
            },
        )
        .unwrap();
        state.begin_start().unwrap();
        state.finish_start(Ok(stuck)).unwrap();

        let started = Instant::now();
        state.stop_for_exit(Duration::from_millis(100));
        assert!(started.elapsed() < Duration::from_secs(2), "exit was held up by a stuck audio thread");
        // The header was repaired from the file length all the same.
        let raw = std::fs::read(&wav).unwrap();
        assert_eq!(u32::from_le_bytes([raw[40], raw[41], raw[42], raw[43]]), 9600);
        assert_eq!(WavReader::open(&wav).unwrap().frames_left(), 4800);
        release.store(true, Ordering::Relaxed);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
