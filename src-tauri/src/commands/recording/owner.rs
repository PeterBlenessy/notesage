//! The capture owner: the handle the commands hold on a live recording, and
//! the state it shares with the capture thread.
//!
//! Nothing here knows about the audio stack. The thread body is a parameter,
//! so the owner's contract (stop waits for teardown, stop is bounded, a dead
//! or stuck thread is survivable) is tested with stand-in threads.

use super::monitor::{LevelPayload, Role};
use super::track::TrackTotals;
use super::types::{Source, WarningKind};
use super::wav::repair_wav_header;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How the capture thread reports to the UI. A trait so the thread does not
/// know about Tauri (and tests can listen in).
pub trait CaptureEvents: Send + 'static {
    fn level(&self, payload: LevelPayload);
    /// `role`: the source the warning is about, when it is about one.
    fn warning(&self, kind: WarningKind, role: Option<Role>, message: String, fatal: bool);
}

/// Live numbers of one track, readable from any thread.
pub struct TrackShared {
    pub role: Role,
    /// Frames accepted so far, at `sample_rate`.
    pub frames: AtomicU64,
    pub sample_rate: AtomicU32,
    /// Running peak, as `f32` bits.
    pub peak_bits: AtomicU32,
}

/// State shared between the owner (commands) and the capture thread.
pub struct CaptureShared {
    pub stop: AtomicBool,
    /// While set, the audio callbacks discard their samples. The streams stay
    /// open: pausing never tears down or reopens CoreAudio (#264).
    pub pause: AtomicBool,
    /// Cleared when the capture thread has exited, however it exited.
    pub alive: AtomicBool,
    /// The thread stopped capturing by itself (see `recording-warning`).
    pub fatal: AtomicBool,
    pub tracks: Vec<TrackShared>,
}

impl CaptureShared {
    pub fn new(roles: &[Role]) -> Self {
        Self {
            stop: AtomicBool::new(false),
            pause: AtomicBool::new(false),
            alive: AtomicBool::new(true),
            fatal: AtomicBool::new(false),
            tracks: roles
                .iter()
                .map(|&role| TrackShared {
                    role,
                    frames: AtomicU64::new(0),
                    sample_rate: AtomicU32::new(0),
                    peak_bits: AtomicU32::new(0),
                })
                .collect(),
        }
    }

    /// Recorded time: the longest track, from frames written.
    pub fn elapsed_recorded_ms(&self) -> u64 {
        self.tracks
            .iter()
            .map(|t| {
                let rate = t.sample_rate.load(Ordering::Relaxed) as u64;
                if rate == 0 {
                    0
                } else {
                    t.frames.load(Ordering::Relaxed) * 1000 / rate
                }
            })
            .max()
            .unwrap_or(0)
    }
}

/// One finished track.
#[derive(Debug, Clone, PartialEq)]
pub struct TrackOutcome {
    pub role: Role,
    pub path: PathBuf,
    pub totals: TrackTotals,
    /// Audio written minus recording time, in ms; `None` if the track was
    /// not delivering at the end (its length then says nothing about drift).
    pub drift_ms: Option<i64>,
}

/// What the capture thread hands back when it exits.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CaptureOutcome {
    pub tracks: Vec<TrackOutcome>,
    /// Warning codes for `stop_recording`'s result.
    pub warnings: Vec<String>,
}

/// Result of [`CaptureOwner::stop`].
#[derive(Debug)]
pub struct StopOutcome {
    /// `None` if the thread did not finish in time, or panicked.
    pub outcome: Option<CaptureOutcome>,
    pub timed_out: bool,
}

/// Owns the single capture thread of a recording.
///
/// INVARIANT (#264): the cpal streams live and die on the capture thread, and
/// that thread drops them before it exits. `stop()` signals the thread and
/// waits for it, so when `stop()` returns without `timed_out`, CoreAudio has
/// released the devices. A thread that does not exit in time is left running
/// and reported; its `alive` flag keeps a new recording from starting on top
/// of it.
pub struct CaptureOwner {
    pub source: Source,
    pub bundle_dir: PathBuf,
    /// Unix epoch milliseconds.
    pub started_at_ms: u64,
    pub track_files: Vec<(Role, PathBuf)>,
    shared: Arc<CaptureShared>,
    outcome: Arc<Mutex<Option<CaptureOutcome>>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

/// Clears `alive` when the thread ends, including by panic.
struct AliveGuard(Arc<CaptureShared>);

impl Drop for AliveGuard {
    fn drop(&mut self) {
        self.0.alive.store(false, Ordering::SeqCst);
    }
}

impl CaptureOwner {
    /// Spawn a capture thread running `body`. `body` returns when the stop
    /// signal is set (or it gives up) and must have released every device by
    /// then. Split from the cpal code so the owner's contract is testable
    /// with a stand-in thread.
    pub fn spawn_with<F>(
        source: Source,
        bundle_dir: PathBuf,
        track_files: Vec<(Role, PathBuf)>,
        body: F,
    ) -> Result<Self, String>
    where
        F: FnOnce(Arc<CaptureShared>) -> CaptureOutcome + Send + 'static,
    {
        let roles: Vec<Role> = track_files.iter().map(|(r, _)| *r).collect();
        let shared = Arc::new(CaptureShared::new(&roles));
        let outcome: Arc<Mutex<Option<CaptureOutcome>>> = Arc::new(Mutex::new(None));
        let shared_t = shared.clone();
        let outcome_t = outcome.clone();
        let thread = std::thread::Builder::new()
            .name("notesage-capture".into())
            .spawn(move || {
                let _alive = AliveGuard(shared_t.clone());
                let result = body(shared_t);
                *outcome_t.lock().unwrap_or_else(|e| e.into_inner()) = Some(result);
            })
            .map_err(|e| format!("Failed to start the audio thread: {}", e))?;
        let started_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Ok(Self {
            source,
            bundle_dir,
            started_at_ms,
            track_files,
            shared,
            outcome,
            thread: Some(thread),
        })
    }

    pub fn shared(&self) -> &Arc<CaptureShared> {
        &self.shared
    }

    /// Pause/resume without touching the streams. Idempotent.
    pub fn set_paused(&self, paused: bool) {
        self.shared.pause.store(paused, Ordering::Relaxed);
    }

    pub fn is_paused(&self) -> bool {
        self.shared.pause.load(Ordering::Relaxed)
    }

    pub fn is_fatal(&self) -> bool {
        self.shared.fatal.load(Ordering::Relaxed)
    }

    /// Signal stop and wait up to `timeout` for the thread to tear down. A
    /// second call after a completed stop returns the (already taken) empty
    /// outcome immediately; it never hangs.
    pub fn stop(&mut self, timeout: Duration) -> StopOutcome {
        self.shared.stop.store(true, Ordering::SeqCst);
        let deadline = Instant::now() + timeout;
        while self.shared.alive.load(Ordering::SeqCst) {
            if Instant::now() >= deadline {
                // Leave the thread to finish on its own; never block the app
                // on a stuck audio driver.
                self.thread = None;
                return StopOutcome { outcome: None, timed_out: true };
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        if let Some(thread) = self.thread.take() {
            // `alive` is already false, so this returns at once.
            let _ = thread.join();
        }
        let outcome = self.outcome.lock().unwrap_or_else(|e| e.into_inner()).take();
        StopOutcome { outcome, timed_out: false }
    }

    /// What is known about the tracks without the thread's cooperation: the
    /// files as they are on disk (headers repaired from their length) and the
    /// last numbers the thread published. Used when the thread is stuck or
    /// died.
    pub fn outcome_from_disk(&self) -> CaptureOutcome {
        let tracks = self
            .track_files
            .iter()
            .map(|(role, path)| {
                let shared = self.shared.tracks.iter().find(|t| t.role == *role);
                let peak = shared.map_or(0.0, |t| f32::from_bits(t.peak_bits.load(Ordering::Relaxed)));
                let (frames, sample_rate, finalize) = match repair_wav_header(path) {
                    Ok(info) => (info.frames(), info.sample_rate, Ok(())),
                    Err(e) => (0, 0, Err(e)),
                };
                TrackOutcome {
                    role: *role,
                    path: path.clone(),
                    totals: TrackTotals {
                        frames,
                        sample_rate,
                        peak,
                        rms: 0.0,
                        dropped_frames: 0,
                        write_error: None,
                        finalize,
                    },
                    drift_ms: None,
                }
            })
            .collect();
        CaptureOutcome { tracks, warnings: Vec::new() }
    }
}

impl Drop for CaptureOwner {
    fn drop(&mut self) {
        // An owner dropped without an explicit stop still releases the
        // devices and finalises the files, but must not hang whoever drops it.
        if self.thread.is_some() {
            let _ = self.stop(Duration::from_secs(3));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn totals(frames: u64) -> TrackTotals {
        TrackTotals {
            frames,
            sample_rate: 16_000,
            peak: 0.2,
            rms: 0.1,
            dropped_frames: 0,
            write_error: None,
            finalize: Ok(()),
        }
    }

    /// A real `CaptureOwner` around a parking thread (no cpal). `live` is 1
    /// while the "stream" is held and 0 once the thread has released it.
    fn fake_owner(live: Arc<AtomicUsize>, finalize: Result<(), String>) -> CaptureOwner {
        live.fetch_add(1, Ordering::SeqCst);
        CaptureOwner::spawn_with(
            Source::Microphone,
            PathBuf::from("/tmp/notesage-test-bundle"),
            vec![(Role::Mic, PathBuf::from("/tmp/notesage-test-bundle/audio.wav"))],
            move |shared| {
                while !shared.stop.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(1));
                }
                // "Release the device" before the thread ends.
                live.fetch_sub(1, Ordering::SeqCst);
                let mut t = totals(16_000);
                t.finalize = finalize;
                CaptureOutcome {
                    tracks: vec![TrackOutcome {
                        role: Role::Mic,
                        path: PathBuf::from("/tmp/notesage-test-bundle/audio.wav"),
                        totals: t,
                        drift_ms: Some(0),
                    }],
                    warnings: Vec::new(),
                }
            },
        )
        .unwrap()
    }

    /// Pause/resume flips the flag the audio callbacks read and nothing else:
    /// pausing can never tear a stream down.
    #[test]
    fn pause_resume_toggle_the_pause_signal_only() {
        let live = Arc::new(AtomicUsize::new(0));
        let mut owner = fake_owner(live.clone(), Ok(()));
        assert!(!owner.is_paused());
        owner.set_paused(true);
        assert!(owner.is_paused());
        assert!(!owner.shared().stop.load(Ordering::Relaxed));
        owner.set_paused(true);
        assert!(owner.is_paused());
        owner.set_paused(false);
        assert!(!owner.is_paused());
        assert_eq!(live.load(Ordering::SeqCst), 1, "stream untouched by pause/resume");
        assert!(owner.stop(Duration::from_secs(5)).outcome.is_some());
    }

    /// #264: when `stop` returns, the thread has released the device and
    /// reported. A second stop neither hangs nor panics.
    #[test]
    fn capture_owner_stop_awaits_thread_teardown() {
        let live = Arc::new(AtomicUsize::new(0));
        let mut owner = fake_owner(live.clone(), Ok(()));
        assert_eq!(live.load(Ordering::SeqCst), 1);
        assert!(owner.shared().alive.load(Ordering::SeqCst));

        let stopped = owner.stop(Duration::from_secs(5));
        assert!(!stopped.timed_out);
        assert_eq!(live.load(Ordering::SeqCst), 0, "device still held after stop returned");
        assert!(!owner.shared().alive.load(Ordering::SeqCst));
        let outcome = stopped.outcome.expect("outcome reported");
        assert!((outcome.tracks[0].totals.peak - 0.2).abs() < 1e-6);
        assert_eq!(outcome.tracks[0].totals.frames, 16_000);

        let again = owner.stop(Duration::from_secs(5));
        assert!(!again.timed_out);
        assert!(again.outcome.is_none(), "the outcome is handed out once");
    }

    /// A header that could not be finalised is reported per track, so
    /// `stop_recording` can refuse to hand a corrupt file to transcription.
    #[test]
    fn stop_reports_a_wav_finalize_error() {
        let live = Arc::new(AtomicUsize::new(0));
        let mut owner = fake_owner(live, Err("WAV header update failed: boom".into()));
        let outcome = owner.stop(Duration::from_secs(5)).outcome.unwrap();
        let err = outcome.tracks[0].totals.finalize.clone().unwrap_err();
        assert!(err.contains("WAV header update failed"), "{err}");
    }

    /// Exit handling: a capture thread stuck in the audio driver must not
    /// hang the caller. `stop` gives up after the timeout and says so, and
    /// `alive` stays set so a new recording cannot start on top of it.
    #[test]
    fn stop_is_bounded_when_the_audio_thread_is_stuck() {
        let release = Arc::new(AtomicBool::new(false));
        let release_t = release.clone();
        let mut owner = CaptureOwner::spawn_with(
            Source::Microphone,
            PathBuf::from("/tmp/notesage-test-stuck"),
            vec![(Role::Mic, PathBuf::from("/tmp/notesage-test-stuck/audio.wav"))],
            move |_shared| {
                // Ignores the stop signal, like a thread blocked in CoreAudio.
                while !release_t.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(1));
                }
                CaptureOutcome::default()
            },
        )
        .unwrap();
        let shared = owner.shared().clone();

        let started = Instant::now();
        let stopped = owner.stop(Duration::from_millis(100));
        assert!(stopped.timed_out);
        assert!(stopped.outcome.is_none());
        assert!(started.elapsed() < Duration::from_secs(2), "stop did not return promptly");
        assert!(shared.alive.load(Ordering::SeqCst), "the stuck thread is still reported alive");

        // Dropping the owner afterwards does not wait either.
        let started = Instant::now();
        drop(owner);
        assert!(started.elapsed() < Duration::from_secs(1));

        // Once the driver lets go, the flag clears by itself.
        release.store(true, Ordering::Relaxed);
        let deadline = Instant::now() + Duration::from_secs(5);
        while shared.alive.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(2));
        }
        assert!(!shared.alive.load(Ordering::SeqCst));
    }

    #[test]
    fn a_panicking_capture_thread_clears_alive_and_stop_returns() {
        let mut owner = CaptureOwner::spawn_with(
            Source::Microphone,
            PathBuf::from("/tmp/notesage-test-panic"),
            vec![(Role::Mic, PathBuf::from("/tmp/notesage-test-panic/audio.wav"))],
            |_shared| panic!("simulated audio thread panic"),
        )
        .unwrap();
        let stopped = owner.stop(Duration::from_secs(5));
        assert!(!stopped.timed_out);
        assert!(stopped.outcome.is_none());
    }

    /// When the thread cannot report, the result is rebuilt from the files:
    /// duration from what is on disk, not from what was captured.
    #[test]
    fn outcome_from_disk_repairs_and_measures_the_files() {
        let dir = std::env::temp_dir().join(format!("notesage-capture-disk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("audio.wav");
        // Crash-shaped: 1 s of data, header sizes zero.
        let mut bytes = super::super::wav::wav_header(48_000, 1, 0).to_vec();
        bytes.extend(vec![0u8; 96_000]);
        std::fs::write(&path, bytes).unwrap();

        let release = Arc::new(AtomicBool::new(false));
        let release_t = release.clone();
        let mut owner = CaptureOwner::spawn_with(
            Source::Microphone,
            dir.clone(),
            vec![(Role::Mic, path.clone()), (Role::System, dir.join("missing.wav"))],
            move |shared| {
                shared.tracks[0].peak_bits.store(0.75f32.to_bits(), Ordering::Relaxed);
                while !release_t.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(1));
                }
                CaptureOutcome::default()
            },
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(30));
        assert!(owner.stop(Duration::from_millis(50)).timed_out);

        let outcome = owner.outcome_from_disk();
        assert_eq!(outcome.tracks[0].totals.frames, 48_000);
        assert_eq!(outcome.tracks[0].totals.sample_rate, 48_000);
        assert_eq!(outcome.tracks[0].totals.peak, 0.75);
        assert!(outcome.tracks[0].totals.finalize.is_ok());
        assert!(outcome.tracks[1].totals.finalize.is_err(), "a missing file is an error, not silence");
        release.store(true, Ordering::Relaxed);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn elapsed_recorded_time_is_the_longest_track() {
        let shared = CaptureShared::new(&[Role::Mic, Role::System]);
        assert_eq!(shared.elapsed_recorded_ms(), 0, "no rate yet: no division by zero");
        shared.tracks[0].sample_rate.store(48_000, Ordering::Relaxed);
        shared.tracks[0].frames.store(96_000, Ordering::Relaxed);
        shared.tracks[1].sample_rate.store(44_100, Ordering::Relaxed);
        shared.tracks[1].frames.store(110_250, Ordering::Relaxed);
        assert_eq!(shared.elapsed_recorded_ms(), 2500);
    }
}
