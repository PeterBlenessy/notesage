//! The capture thread's loop, independent of the audio stack.
//!
//! One thread owns everything about a live recording: the streams (one per
//! source), the rings their callbacks fill, and the files. The audio
//! callbacks do the minimum (C4); this loop, on a 20 ms tick, drains the
//! rings to disk, measures levels, patches the WAV headers every 10 s (C3),
//! watches for streams that stopped calling back and reopens them (C1),
//! notices write failures and a filling disk (C2), and reports silence while
//! there is still time to do something about it (C5).
//!
//! The audio stack is behind [`AudioBackend`]: `capture.rs` implements it
//! with cpal, the tests below with threads that feed the rings. So the loop
//! that actually runs during a meeting is the loop the tests run.
//!
//! # Two tracks, one timeline
//!
//! With source "both" the microphone and the system audio are two streams on
//! two clocks writing two files. Each stream's first callback is timestamped;
//! the timeline's origin is the earlier of the two and the later track is
//! padded with silence by the difference, so sample 0 of both files is the
//! same instant. The same padding fills the gap after a device loss, which
//! keeps every timestamp in the transcript true. Drift between the two
//! device clocks is measured (audio written against elapsed time) and
//! reported, not corrected.

use super::monitor::{
    drift_ms, pad_frames, DiskAction, DiskMonitor, LevelMeter, PauseClock, Role, StallAction,
    StallWatchdog, Throttle,
};
use super::owner::{CaptureEvents, CaptureOutcome, CaptureShared, TrackOutcome};
use super::ring::{Consumer, Producer};
use super::track::TrackSink;
use super::types::{Source, WarningKind};
use super::wav::{WavWriter, WAV_FULL};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Written by the audio callback, read by the capture loop.
pub struct CallbackShared {
    /// Nanoseconds since the capture's base instant of the first callback
    /// (0 = none yet).
    first_ns: AtomicU64,
    /// Same, for the most recent callback.
    last_ns: AtomicU64,
    /// The driver reported a stream error.
    error: AtomicBool,
}

impl CallbackShared {
    pub fn new() -> Self {
        Self {
            first_ns: AtomicU64::new(0),
            last_ns: AtomicU64::new(0),
            error: AtomicBool::new(false),
        }
    }

    /// Flag a driver error (from the stream's error callback).
    pub fn report_error(&self) {
        self.error.store(true, Ordering::Relaxed);
    }

    fn first(&self) -> Option<Duration> {
        match self.first_ns.load(Ordering::Relaxed) {
            0 => None,
            ns => Some(Duration::from_nanos(ns)),
        }
    }

    fn last(&self) -> Option<Duration> {
        match self.last_ns.load(Ordering::Relaxed) {
            0 => None,
            ns => Some(Duration::from_nanos(ns)),
        }
    }
}

impl Default for CallbackShared {
    fn default() -> Self {
        Self::new()
    }
}

/// The whole body of the real-time audio callback (C4): two atomic stores,
/// two atomic loads, and a bounded copy into the ring. No lock, no
/// allocation, no system call, no event, whatever the block size.
///
/// The callback time is recorded even while paused: the stream is alive, and
/// that is what the stall watchdog needs to know.
#[inline]
pub fn deliver(
    callback: &CallbackShared,
    pause: &AtomicBool,
    producer: &mut Producer,
    base: Instant,
    data: &[f32],
) {
    let now = (base.elapsed().as_nanos() as u64).max(1);
    callback.last_ns.store(now, Ordering::Relaxed);
    if callback.first_ns.load(Ordering::Relaxed) == 0 {
        callback.first_ns.store(now, Ordering::Relaxed);
    }
    if pause.load(Ordering::Relaxed) {
        return;
    }
    producer.push_slice(data);
}

/// An open stream, as the loop sees it. Dropping `stream` closes it.
pub struct Opened<S> {
    pub stream: S,
    pub consumer: Consumer,
    pub sample_rate: u32,
    pub channels: u16,
    pub callback: Arc<CallbackShared>,
    /// Identifies the device, to notice when the default changes.
    pub device_id: Option<String>,
    pub device_name: String,
}

/// The audio stack.
pub trait AudioBackend {
    type Stream;

    /// Open a stream for `role` on the current default device. Its callback
    /// must be [`deliver`].
    fn open(
        &mut self,
        role: Role,
        base: Instant,
        shared: &Arc<CaptureShared>,
    ) -> Result<Opened<Self::Stream>, String>;

    /// Identifier of the current default output device.
    fn default_output_id(&mut self) -> Option<String>;
}

/// What the capture thread needs to start.
pub struct CaptureConfig {
    pub source: Source,
    pub bundle_dir: PathBuf,
    pub track_files: Vec<(Role, PathBuf)>,
}

/// The loop's intervals. Production uses [`Timing::default`]; tests shrink
/// them so a device loss takes milliseconds to play out.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    pub tick: Duration,
    pub level_interval: Duration,
    pub header_interval: Duration,
    pub device_poll_interval: Duration,
    pub stall_after: Duration,
    pub first_callback_grace: Duration,
    pub retry_every: Duration,
    pub give_up_after: Duration,
    pub slow_retry_every: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            tick: Duration::from_millis(20),
            level_interval: Duration::from_millis(100),
            header_interval: Duration::from_secs(10),
            device_poll_interval: Duration::from_secs(2),
            stall_after: Duration::from_secs(2),
            first_callback_grace: Duration::from_secs(6),
            retry_every: Duration::from_secs(4),
            give_up_after: Duration::from_secs(30),
            slow_retry_every: Duration::from_secs(10),
        }
    }
}

struct LiveTrack<S> {
    role: Role,
    path: PathBuf,
    sink: TrackSink<File>,
    stream: Option<S>,
    callback: Arc<CallbackShared>,
    opened_at: Duration,
    device_id: Option<String>,
    /// The (re)opened stream has not delivered yet: pad when it does.
    pending_pad: bool,
    watchdog: StallWatchdog,
}

impl<S> LiveTrack<S> {
    /// Drop the current stream (if any), collect what it left in the ring,
    /// and open a new one on the current default device.
    fn reopen<B: AudioBackend<Stream = S>>(
        &mut self,
        backend: &mut B,
        now: Duration,
        base: Instant,
        shared: &Arc<CaptureShared>,
    ) -> Result<String, String> {
        // Drop first: cpal's loopback device has a fixed identity, and two
        // streams on one device is the #264 overlap.
        self.stream = None;
        // A write failure here resurfaces on the next regular drain.
        let _ = self.sink.drain();
        self.sink.detach();
        self.opened_at = now;
        // Forget the old stream's callback times: a late callback of the
        // stream just dropped must not read as "audio is back".
        self.callback = Arc::new(CallbackShared::new());
        let opened = backend.open(self.role, base, shared)?;
        self.sink.attach(opened.consumer, opened.sample_rate, opened.channels);
        self.stream = Some(opened.stream);
        self.callback = opened.callback;
        self.device_id = opened.device_id;
        self.pending_pad = true;
        Ok(opened.device_name)
    }
}

/// Run a recording until the stop signal, or until it has to give up.
///
/// Sends `Ok(())` on `setup_tx` once every requested source is open (never
/// fewer: if one fails, the others are closed and the error is sent
/// instead). Returns after all streams are dropped and all files finalised.
pub fn run_session<B: AudioBackend>(
    mut backend: B,
    shared: Arc<CaptureShared>,
    config: CaptureConfig,
    events: Box<dyn CaptureEvents>,
    setup_tx: std::sync::mpsc::Sender<Result<(), String>>,
    timing: Timing,
    free_bytes: &dyn Fn(&Path) -> Option<u64>,
) -> CaptureOutcome {
    let base = Instant::now();
    let mut tracks: Vec<LiveTrack<B::Stream>> = Vec::with_capacity(config.track_files.len());
    let new_watchdog = || {
        StallWatchdog::with_limits(
            timing.stall_after,
            timing.first_callback_grace,
            timing.retry_every,
            timing.give_up_after,
            timing.slow_retry_every,
        )
    };

    // --- Setup: every requested source opens, or the start fails. ---
    for (role, path) in &config.track_files {
        let opened = match backend.open(*role, base, &shared) {
            Ok(o) => o,
            Err(e) => {
                drop(tracks);
                let _ = setup_tx.send(Err(e));
                return CaptureOutcome::default();
            }
        };
        // One track is one mono file at the rate of the device it started on.
        let writer = match WavWriter::create(path, opened.sample_rate, 1) {
            Ok(w) => w,
            Err(e) => {
                drop(opened);
                drop(tracks);
                let _ = setup_tx.send(Err(e));
                return CaptureOutcome::default();
            }
        };
        log::info!(
            target: "notesage::recording",
            "Capturing {} from \"{}\": {} Hz, {} channel(s) → {}",
            role.as_str(), opened.device_name, opened.sample_rate, opened.channels, path.display()
        );
        if let Some(t) = shared.tracks.iter().find(|t| t.role == *role) {
            t.sample_rate.store(opened.sample_rate, Ordering::Relaxed);
        }
        let mut sink = TrackSink::new(*role, writer);
        sink.attach(opened.consumer, opened.sample_rate, opened.channels);
        tracks.push(LiveTrack {
            role: *role,
            path: path.clone(),
            sink,
            stream: Some(opened.stream),
            callback: opened.callback,
            opened_at: base.elapsed(),
            device_id: opened.device_id,
            pending_pad: true,
            watchdog: new_watchdog(),
        });
    }
    let _ = setup_tx.send(Ok(()));

    let has = |role: Role| config.track_files.iter().any(|(r, _)| *r == role);
    let mut levels = LevelMeter::new(timing.level_interval, has(Role::Mic), has(Role::System));
    let mut pause_clock = PauseClock::default();
    let mut disk = DiskMonitor::default();
    let mut dropped_throttle = Throttle::new(Duration::from_secs(60));
    let mut dropped_seen = 0u64;
    let mut origin: Option<Duration> = None;
    let mut last_header_patch = base.elapsed();
    let mut last_device_poll = base.elapsed();
    let mut warnings: Vec<String> = Vec::new();
    let mut fatal: Option<(WarningKind, Option<Role>, String)> = None;
    let mut device_changed = false;

    // --- The loop. ---
    while !shared.stop.load(Ordering::Relaxed) && fatal.is_none() {
        std::thread::sleep(timing.tick);
        let now = base.elapsed();
        let paused = shared.pause.load(Ordering::Relaxed);
        pause_clock.observe(now, paused);

        // The timeline starts at the first audio from any source.
        if origin.is_none() {
            origin = tracks.iter().filter_map(|t| t.callback.first()).min();
        }
        let poll_devices = now.saturating_sub(last_device_poll) >= timing.device_poll_interval;
        if poll_devices {
            last_device_poll = now;
        }

        for index in 0..tracks.len() {
            let others_delivering = tracks
                .iter()
                .enumerate()
                .any(|(i, t)| i != index && !t.watchdog.is_lost());
            let track = &mut tracks[index];
            let role = track.role;

            // A stream that has started delivering takes its place on the timeline.
            if track.pending_pad {
                if let (Some(first), Some(origin)) = (track.callback.first(), origin) {
                    let elapsed = pause_clock.active_between(origin, first);
                    let pad = pad_frames(elapsed, track.sink.sample_rate(), track.sink.frames_written());
                    if let Err(e) = track.sink.pad_silence(pad) {
                        fatal = Some(write_failure(role, &e));
                        break;
                    }
                    track.pending_pad = false;
                }
            }

            // Ring → file.
            match track.sink.drain() {
                Ok(report) => {
                    if !paused {
                        levels.observe(role, report.peak);
                    }
                    if report.silence_warning {
                        events.warning(WarningKind::Silence, Some(role), silence_message(role), false);
                    }
                }
                Err(e) => {
                    fatal = Some(write_failure(role, &e));
                    break;
                }
            }
            if let Some(t) = shared.tracks.iter().find(|t| t.role == role) {
                t.frames.store(track.sink.frames_written(), Ordering::Relaxed);
                t.peak_bits.store(track.sink.peak().to_bits(), Ordering::Relaxed);
            }

            // Is the stream still alive?
            let mut announce_loss = false;
            let mut try_reopen = false;
            let mut forced = false;
            if track.callback.error.swap(false, Ordering::Relaxed) && !track.watchdog.is_lost() {
                track.watchdog.force_lost(now);
                announce_loss = true;
                forced = true;
            }
            if role == Role::System && poll_devices && !track.watchdog.is_lost() {
                // A system tap is bound to one output device; follow the default.
                let current = backend.default_output_id();
                if current.is_some() && current != track.device_id {
                    log::info!(target: "notesage::recording", "Default output device changed; reopening the system tap");
                    track.watchdog.force_lost(now);
                    forced = true;
                }
            }
            // A loss declared this tick is acted on now; the watchdog judges
            // the replacement stream from the next tick on.
            let action = if forced {
                try_reopen = true;
                StallAction::None
            } else {
                track.watchdog.tick(now, track.opened_at, track.callback.last())
            };
            match action {
                StallAction::None => {}
                StallAction::Lost => {
                    announce_loss = true;
                    try_reopen = true;
                }
                StallAction::Retry => try_reopen = true,
                StallAction::Recovered => {
                    device_changed = true;
                    events.warning(
                        WarningKind::DeviceChanged,
                        Some(role),
                        format!("{}: recording continues on the current device", role.as_str()),
                        false,
                    );
                }
                StallAction::GaveUp => {
                    if others_delivering {
                        warnings.push(format!("track-lost: {}", role.as_str()));
                        events.warning(
                            WarningKind::DeviceLost,
                            Some(role),
                            format!(
                                "{}: no audio device could be opened; recording continues with the other source",
                                role.as_str()
                            ),
                            false,
                        );
                    } else {
                        fatal = Some((
                            WarningKind::DeviceLost,
                            Some(role),
                            format!("{}: no audio device could be opened; the recording was stopped", role.as_str()),
                        ));
                        break;
                    }
                }
            }
            if announce_loss {
                events.warning(
                    WarningKind::DeviceLost,
                    Some(role),
                    format!("{}: the audio device stopped delivering; trying to reconnect", role.as_str()),
                    false,
                );
            }
            if try_reopen {
                match track.reopen(&mut backend, now, base, &shared) {
                    Ok(name) => log::info!(
                        target: "notesage::recording",
                        "Reopened {} on \"{}\"", role.as_str(), name
                    ),
                    Err(e) => log::warn!(
                        target: "notesage::recording",
                        "Could not reopen {}: {}", role.as_str(), e
                    ),
                }
            }
        }
        if fatal.is_some() {
            break;
        }

        if let Some(payload) = levels.poll(now, paused) {
            events.level(payload);
        }

        let dropped: u64 = tracks.iter().map(|t| t.sink.dropped_frames()).sum();
        if dropped > dropped_seen {
            dropped_seen = dropped;
            if dropped_throttle.allow(now) {
                events.warning(
                    WarningKind::DroppedFrames,
                    None,
                    format!("{} audio frames were dropped because the app could not keep up", dropped),
                    false,
                );
            }
        }

        if now.saturating_sub(last_header_patch) >= timing.header_interval {
            last_header_patch = now;
            for track in tracks.iter_mut() {
                if let Err(e) = track.sink.patch_header() {
                    fatal = Some(write_failure(track.role, &e));
                    break;
                }
            }
            if fatal.is_none() {
                match disk.observe(free_bytes(&config.bundle_dir)) {
                    DiskAction::None => {}
                    DiskAction::Warn => events.warning(
                        WarningKind::LowDisk,
                        None,
                        "Less than 500 MB of disk space is left".into(),
                        false,
                    ),
                    DiskAction::Stop => {
                        fatal = Some((
                            WarningKind::LowDisk,
                            None,
                            "The disk is full; the recording was stopped".into(),
                        ));
                    }
                }
            }
        }
    }

    // --- Teardown. Streams first, so no callback runs while files close. ---
    let end = base.elapsed();
    pause_clock.observe(end, shared.pause.load(Ordering::Relaxed));
    let active = origin.map(|o| pause_clock.active_between(o, end));
    let mut outcomes = Vec::with_capacity(tracks.len());
    for mut track in tracks {
        track.stream = None;
        let _ = track.sink.drain();
        let delivering = !track.watchdog.is_lost() && !track.pending_pad;
        let dropped = track.sink.dropped_frames();
        let mut totals = track.sink.finish();
        totals.dropped_frames = dropped;
        let drift = match (active, delivering) {
            (Some(active), true) => Some(drift_ms(totals.frames, totals.sample_rate, active)),
            _ => None,
        };
        if let Some(t) = shared.tracks.iter().find(|t| t.role == track.role) {
            t.frames.store(totals.frames, Ordering::Relaxed);
        }
        if let Err(e) = &totals.finalize {
            log::error!(target: "notesage::recording", "Failed to finalize {}: {}", track.path.display(), e);
        }
        outcomes.push(TrackOutcome { role: track.role, path: track.path, totals, drift_ms: drift });
    }

    if device_changed {
        warnings.push("device-changed".into());
    }
    if let Some((kind, role, message)) = fatal {
        // Files are finalised: now say so. The frontend runs its stop path.
        log::error!(target: "notesage::recording", "Recording stopped by the backend: {}", message);
        warnings.push(format!("stopped-early: {}", message));
        shared.fatal.store(true, Ordering::SeqCst);
        events.warning(kind, role, message, true);
    }
    CaptureOutcome { tracks: outcomes, warnings }
}

fn write_failure(role: Role, error: &str) -> (WarningKind, Option<Role>, String) {
    let message = if error == WAV_FULL {
        format!("{}: the recording reached the maximum file size and was stopped", role.as_str())
    } else {
        format!("{}: the recording could not be written and was stopped ({})", role.as_str(), error)
    };
    (WarningKind::WriteError, Some(role), message)
}

fn silence_message(role: Role) -> String {
    match role {
        Role::Mic => "mic: no sound is arriving from the microphone. Check the input device and the Microphone permission in System Settings > Privacy & Security.".into(),
        Role::System => "system: no system audio is arriving. Nothing may be playing, or Notesage lacks the System Audio Recording permission in System Settings > Privacy & Security > Screen & System Audio Recording.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::super::monitor::LevelPayload;
    use super::super::owner::CaptureOwner;
    use super::super::ring::ring;
    use super::super::wav::WavReader;
    use super::*;
    use std::sync::atomic::{AtomicU32, AtomicUsize};
    use std::sync::Mutex;

    const RATE: u32 = 8_000;
    /// Frames per simulated callback, every `FEED_EVERY`.
    const BLOCK: usize = 40;
    const FEED_EVERY: Duration = Duration::from_millis(5);

    /// Remote control for one simulated device.
    struct FakeDevice {
        /// Callbacks stop arriving while set (the stream stays "open").
        stalled: AtomicBool,
        /// `open` fails while set.
        unavailable: AtomicBool,
        /// Delay before the first callback of a newly opened stream.
        start_delay_ms: AtomicU32,
        /// Sample value delivered, as f32 bits.
        value_bits: AtomicU32,
        channels: u16,
        opens: AtomicUsize,
        /// Streams currently open (must never exceed 1: #264).
        open_now: AtomicUsize,
        max_open: AtomicUsize,
        error_flag: Mutex<Option<Arc<CallbackShared>>>,
    }

    impl FakeDevice {
        fn new(value: f32, channels: u16) -> Arc<Self> {
            Arc::new(Self {
                stalled: AtomicBool::new(false),
                unavailable: AtomicBool::new(false),
                start_delay_ms: AtomicU32::new(0),
                value_bits: AtomicU32::new(value.to_bits()),
                channels,
                opens: AtomicUsize::new(0),
                open_now: AtomicUsize::new(0),
                max_open: AtomicUsize::new(0),
                error_flag: Mutex::new(None),
            })
        }
    }

    /// A stream is a feeder thread; dropping it stops and joins the thread.
    struct FakeStream {
        run: Arc<AtomicBool>,
        device: Arc<FakeDevice>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl Drop for FakeStream {
        fn drop(&mut self) {
            self.run.store(false, Ordering::SeqCst);
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
            self.device.open_now.fetch_sub(1, Ordering::SeqCst);
        }
    }

    struct FakeBackend {
        mic: Arc<FakeDevice>,
        system: Arc<FakeDevice>,
        output_id: Arc<Mutex<String>>,
    }

    impl AudioBackend for FakeBackend {
        type Stream = FakeStream;

        fn open(
            &mut self,
            role: Role,
            base: Instant,
            shared: &Arc<CaptureShared>,
        ) -> Result<Opened<FakeStream>, String> {
            let device = match role {
                Role::Mic => self.mic.clone(),
                Role::System => self.system.clone(),
            };
            if device.unavailable.load(Ordering::SeqCst) {
                return Err(format!("no {} device", role.as_str()));
            }
            device.opens.fetch_add(1, Ordering::SeqCst);
            let open_now = device.open_now.fetch_add(1, Ordering::SeqCst) + 1;
            device.max_open.fetch_max(open_now, Ordering::SeqCst);

            let channels = device.channels;
            let (mut producer, consumer) = ring(RATE as usize * channels as usize * 2);
            let callback = Arc::new(CallbackShared::new());
            *device.error_flag.lock().unwrap() = Some(callback.clone());
            let run = Arc::new(AtomicBool::new(true));
            let (run_t, cb_t, dev_t, shared_t) = (run.clone(), callback.clone(), device.clone(), shared.clone());
            let thread = std::thread::spawn(move || {
                let delay = Duration::from_millis(dev_t.start_delay_ms.load(Ordering::SeqCst) as u64);
                let opened = Instant::now();
                let mut next = Instant::now();
                while run_t.load(Ordering::SeqCst) {
                    next += FEED_EVERY;
                    let now = Instant::now();
                    if next > now {
                        std::thread::sleep(next - now);
                    }
                    if opened.elapsed() < delay || dev_t.stalled.load(Ordering::SeqCst) {
                        continue;
                    }
                    let value = f32::from_bits(dev_t.value_bits.load(Ordering::SeqCst));
                    let block = vec![value; BLOCK * channels as usize];
                    deliver(&cb_t, &shared_t.pause, &mut producer, base, &block);
                }
            });
            Ok(Opened {
                stream: FakeStream { run, device, thread: Some(thread) },
                consumer,
                sample_rate: RATE,
                channels,
                callback,
                device_id: (role == Role::System).then(|| self.output_id.lock().unwrap().clone()),
                device_name: format!("fake {}", role.as_str()),
            })
        }

        fn default_output_id(&mut self) -> Option<String> {
            Some(self.output_id.lock().unwrap().clone())
        }
    }

    #[derive(Default)]
    struct Recorded {
        levels: Mutex<Vec<(Instant, LevelPayload)>>,
        warnings: Mutex<Vec<(String, String, bool)>>,
        sources: Mutex<Vec<Option<Role>>>,
    }

    struct Listener(Arc<Recorded>);

    impl CaptureEvents for Listener {
        fn level(&self, payload: LevelPayload) {
            self.0.levels.lock().unwrap().push((Instant::now(), payload));
        }
        fn warning(&self, kind: WarningKind, role: Option<Role>, message: String, fatal: bool) {
            self.0.warnings.lock().unwrap().push((kind.as_str().to_string(), message, fatal));
            self.0.sources.lock().unwrap().push(role);
        }
    }

    impl Recorded {
        fn kinds(&self) -> Vec<String> {
            self.warnings.lock().unwrap().iter().map(|w| w.0.clone()).collect()
        }
        fn wait_for(&self, kind: &str, timeout: Duration) -> bool {
            let deadline = Instant::now() + timeout;
            while Instant::now() < deadline {
                if self.kinds().iter().any(|k| k == kind) {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            false
        }
    }

    /// Short intervals: a "2 second" stall is 150 ms here.
    fn fast() -> Timing {
        Timing {
            tick: Duration::from_millis(10),
            level_interval: Duration::from_millis(100),
            header_interval: Duration::from_millis(100),
            device_poll_interval: Duration::from_millis(50),
            stall_after: Duration::from_millis(150),
            first_callback_grace: Duration::from_millis(350),
            retry_every: Duration::from_millis(150),
            give_up_after: Duration::from_millis(500),
            slow_retry_every: Duration::from_millis(200),
        }
    }

    struct Rig {
        owner: CaptureOwner,
        mic: Arc<FakeDevice>,
        system: Arc<FakeDevice>,
        output_id: Arc<Mutex<String>>,
        events: Arc<Recorded>,
        dir: PathBuf,
        free: Arc<AtomicU64>,
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "notesage-session-{}-{}-{:?}",
            tag,
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn start_with(
        tag: &str,
        source: Source,
        mic: Arc<FakeDevice>,
        system: Arc<FakeDevice>,
    ) -> Result<Rig, String> {
        let dir = temp_dir(tag);
        let events = Arc::new(Recorded::default());
        let output_id = Arc::new(Mutex::new("speakers".to_string()));
        let free = Arc::new(AtomicU64::new(u64::MAX));
        let track_files: Vec<(Role, PathBuf)> =
            source.track_files().into_iter().map(|(r, f)| (r, dir.join(f))).collect();
        let config = CaptureConfig { source, bundle_dir: dir.clone(), track_files: track_files.clone() };
        let backend = FakeBackend { mic: mic.clone(), system: system.clone(), output_id: output_id.clone() };
        let listener = Box::new(Listener(events.clone()));
        let (tx, rx) = std::sync::mpsc::channel();
        let free_t = free.clone();
        let mut owner = CaptureOwner::spawn_with(source, dir.clone(), track_files, move |shared| {
            let free_fn = move |_: &Path| Some(free_t.load(Ordering::SeqCst));
            run_session(backend, shared, config, listener, tx, fast(), &free_fn)
        })?;
        match rx.recv() {
            Ok(Ok(())) => Ok(Rig { owner, mic, system, output_id, events, dir, free }),
            Ok(Err(e)) => {
                owner.stop(Duration::from_secs(5));
                Err(e)
            }
            Err(_) => Err("setup channel closed".into()),
        }
    }

    fn start(tag: &str, source: Source) -> Rig {
        start_with(tag, source, FakeDevice::new(0.5, 1), FakeDevice::new(0.25, 2)).unwrap()
    }

    fn read(path: &Path) -> Vec<f32> {
        let mut r = WavReader::open(path).unwrap();
        let mut out = Vec::new();
        while r.read_mono(&mut out, 8192).unwrap() > 0 {}
        out
    }

    fn secs(frames: usize) -> f64 {
        frames as f64 / RATE as f64
    }

    /// The plain case, end to end through the real loop: callbacks → ring →
    /// file, levels at a bounded rate, recorded time from frames written.
    #[test]
    fn records_one_source_to_a_valid_file_with_bounded_level_events() {
        let mut rig = start("single", Source::Microphone);
        let started = Instant::now();
        std::thread::sleep(Duration::from_millis(500));
        let live_ms = rig.owner.shared().elapsed_recorded_ms();
        assert!((300..=700).contains(&live_ms), "live recorded time {live_ms} ms");
        let stopped = rig.owner.stop(Duration::from_secs(5));
        let wall = started.elapsed().as_secs_f64();
        let outcome = stopped.outcome.unwrap();

        let t = &outcome.tracks[0];
        assert_eq!(t.role, Role::Mic);
        assert!(t.totals.finalize.is_ok() && t.totals.write_error.is_none());
        assert_eq!(t.totals.sample_rate, RATE);
        assert!((t.totals.peak - 0.5).abs() < 1e-3);
        assert_eq!(t.totals.dropped_frames, 0);
        let samples = read(&rig.dir.join("audio.wav"));
        assert_eq!(samples.len() as u64, t.totals.frames, "outcome matches the file");
        assert!((secs(samples.len()) - wall).abs() < 0.35, "{} s of audio in {wall} s", secs(samples.len()));
        assert!(samples.iter().all(|s| (s - 0.5).abs() < 1e-3), "no gaps, no padding");
        assert!(t.drift_ms.unwrap().abs() < 300, "{:?}", t.drift_ms);
        assert!(outcome.warnings.is_empty(), "{:?}", outcome.warnings);

        // C4: at most 10 level events a second, mic only.
        let levels = rig.events.levels.lock().unwrap();
        assert!(!levels.is_empty() && levels.len() as f64 <= wall * 10.0 + 2.0, "{} events in {wall} s", levels.len());
        for pair in levels.windows(2) {
            assert!(pair[1].0 - pair[0].0 >= Duration::from_millis(50), "events too close together");
        }
        assert!(levels.iter().all(|(_, p)| p.system.is_none()));
        assert!(levels.iter().any(|(_, p)| p.mic.is_some_and(|m| (m - 0.5).abs() < 1e-3)));
        assert!(rig.events.kinds().is_empty(), "{:?}", rig.events.kinds());
        assert_eq!(rig.mic.max_open.load(Ordering::SeqCst), 1);
        assert_eq!(rig.mic.open_now.load(Ordering::SeqCst), 0, "stream closed by the time stop returns");
    }

    /// N1: two sources, two files, one timeline. The system stream delivers
    /// its first audio 200 ms after the microphone; its file must begin with
    /// that much silence so sample 0 of both is the same instant.
    #[test]
    fn both_sources_start_at_the_same_instant() {
        let mic = FakeDevice::new(0.5, 1);
        let system = FakeDevice::new(0.25, 2);
        system.start_delay_ms.store(200, Ordering::SeqCst);
        let mut rig = start_with("both", Source::Both, mic, system).unwrap();
        std::thread::sleep(Duration::from_millis(600));
        let outcome = rig.owner.stop(Duration::from_secs(5)).outcome.unwrap();

        let mic = read(&rig.dir.join("mic.wav"));
        let system = read(&rig.dir.join("system.wav"));
        assert!((mic[0] - 0.5).abs() < 1e-3, "the earlier track is not padded");
        let lead = system.iter().position(|s| s.abs() > 1e-3).expect("system audio present");
        assert!(system[..lead].iter().all(|s| *s == 0.0));
        assert!((secs(lead) - 0.2).abs() < 0.1, "system padded by {} s, wanted 0.2", secs(lead));
        assert!((system[lead] - 0.25).abs() < 1e-3, "stereo downmixed to mono");
        // Same length to within a couple of callbacks: aligned at both ends.
        assert!((secs(mic.len()) - secs(system.len())).abs() < 0.1, "{} vs {}", mic.len(), system.len());
        let drifts: Vec<i64> = outcome.tracks.iter().map(|t| t.drift_ms.unwrap()).collect();
        assert!(drifts.iter().all(|d| d.abs() < 300), "{drifts:?}");

        let levels = rig.events.levels.lock().unwrap();
        assert!(levels.iter().any(|(_, p)| p.mic.is_some_and(|m| m > 0.4) && p.system.is_some_and(|s| s > 0.2)));
    }

    /// C1: a device that stops calling back is announced, reopened, and the
    /// recording continues in the same file with the gap as silence.
    #[test]
    fn a_stalled_device_is_reopened_and_the_gap_is_padded() {
        let mut rig = start("stall", Source::Microphone);
        let started = Instant::now();
        std::thread::sleep(Duration::from_millis(200));
        // The device dies, and comes back as another device with another level.
        rig.mic.stalled.store(true, Ordering::SeqCst);
        assert!(rig.events.wait_for("device-lost", Duration::from_secs(2)), "no device-lost");
        rig.mic.value_bits.store(0.125f32.to_bits(), Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(120));
        rig.mic.stalled.store(false, Ordering::SeqCst);
        assert!(rig.events.wait_for("device-changed", Duration::from_secs(2)), "no device-changed");
        std::thread::sleep(Duration::from_millis(200));
        let outcome = rig.owner.stop(Duration::from_secs(5)).outcome.unwrap();
        let wall = started.elapsed().as_secs_f64();

        let kinds = rig.events.kinds();
        let lost = kinds.iter().position(|k| k == "device-lost").unwrap();
        let changed = kinds.iter().position(|k| k == "device-changed").unwrap();
        assert!(lost < changed, "{kinds:?}");
        assert!(rig.events.warnings.lock().unwrap().iter().all(|w| !w.2), "none of this is fatal");
        assert!(rig.mic.opens.load(Ordering::SeqCst) >= 2, "the stream was reopened");
        assert_eq!(rig.mic.max_open.load(Ordering::SeqCst), 1, "never two streams at once (#264)");
        assert!(outcome.warnings.contains(&"device-changed".to_string()));

        let samples = read(&rig.dir.join("audio.wav"));
        // One file, as long as the wall clock: the outage is in it as silence.
        assert!((secs(samples.len()) - wall).abs() < 0.4, "{} s vs {wall} s", secs(samples.len()));
        let first_gap = samples.iter().position(|s| s.abs() < 1e-3).expect("a gap of silence");
        let resumed = samples.iter().rposition(|s| s.abs() < 1e-3).unwrap() + 1;
        assert!(samples[..first_gap].iter().all(|s| (s - 0.5).abs() < 1e-3), "audio before the loss");
        assert!(secs(resumed - first_gap) > 0.2, "gap of {} s", secs(resumed - first_gap));
        assert!(samples[resumed..].iter().all(|s| (s - 0.125).abs() < 1e-3), "audio from the new device");
        assert!(secs(samples.len() - resumed) > 0.1);
        assert!(!rig.owner.is_fatal());
    }

    /// C1, the end of the road: nothing can be opened. The backend stops by
    /// itself, finalises what it has, and says so with `fatal: true`.
    #[test]
    fn when_no_device_comes_back_the_recording_is_stopped_and_finalised() {
        let mut rig = start("gone", Source::Microphone);
        std::thread::sleep(Duration::from_millis(200));
        rig.mic.stalled.store(true, Ordering::SeqCst);
        rig.mic.unavailable.store(true, Ordering::SeqCst);

        // The thread ends on its own; nobody called stop.
        let deadline = Instant::now() + Duration::from_secs(5);
        while rig.owner.shared().alive.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!rig.owner.shared().alive.load(Ordering::SeqCst), "the loop did not give up");
        assert!(rig.owner.is_fatal());
        let warnings = rig.events.warnings.lock().unwrap().clone();
        let last = warnings.last().unwrap();
        assert_eq!((last.0.as_str(), last.2), ("device-lost", true), "{warnings:?}");
        assert!(last.1.starts_with("mic: "));
        assert_eq!(warnings.iter().filter(|w| w.2).count(), 1, "one fatal event");

        // The frontend then runs its normal stop path, which gets the outcome.
        let outcome = rig.owner.stop(Duration::from_secs(5)).outcome.unwrap();
        assert!(outcome.warnings.iter().any(|w| w.starts_with("stopped-early: ")), "{:?}", outcome.warnings);
        assert!(outcome.tracks[0].totals.finalize.is_ok());
        let samples = read(&rig.dir.join("audio.wav"));
        assert!(secs(samples.len()) > 0.1, "what was recorded before the loss is kept");
        assert_eq!(rig.mic.open_now.load(Ordering::SeqCst), 0);
    }

    /// Never lose audio: with two sources, losing one for good does not end
    /// the recording of the other.
    #[test]
    fn losing_one_of_two_sources_keeps_recording_the_other() {
        let mut rig = start("oneleft", Source::Both);
        std::thread::sleep(Duration::from_millis(150));
        rig.system.stalled.store(true, Ordering::SeqCst);
        rig.system.unavailable.store(true, Ordering::SeqCst);
        // Well past give_up_after.
        std::thread::sleep(Duration::from_millis(1000));
        assert!(rig.owner.shared().alive.load(Ordering::SeqCst), "the recording must still be running");
        assert!(!rig.owner.is_fatal());
        let before = read(&rig.dir.join("mic.wav")).len();
        std::thread::sleep(Duration::from_millis(250));
        let outcome = rig.owner.stop(Duration::from_secs(5)).outcome.unwrap();

        assert!(outcome.warnings.contains(&"track-lost: system".to_string()), "{:?}", outcome.warnings);
        let warnings = rig.events.warnings.lock().unwrap().clone();
        assert!(warnings.iter().all(|w| !w.2), "{warnings:?}");
        assert!(warnings.iter().filter(|w| w.0 == "device-lost" && w.1.starts_with("system: ")).count() >= 2);
        assert!(
            rig.events.sources.lock().unwrap().iter().all(|s| *s == Some(Role::System)),
            "every warning names the source it is about"
        );
        let mic = read(&rig.dir.join("mic.wav"));
        assert!(mic.len() > before, "the microphone kept recording after the system source was given up");
        assert!(secs(mic.len()) > 1.2);
        let system = outcome.tracks.iter().find(|t| t.role == Role::System).unwrap();
        assert_eq!(system.drift_ms, None, "a dead track's length says nothing about drift");
        assert!(system.totals.finalize.is_ok());
    }

    /// The system tap follows one output device. When the default output
    /// changes, the tap is reopened on the new one: `device-changed` only.
    #[test]
    fn a_new_default_output_device_reopens_the_system_tap() {
        let mut rig = start("output", Source::System);
        std::thread::sleep(Duration::from_millis(150));
        *rig.output_id.lock().unwrap() = "airpods".to_string();
        assert!(rig.events.wait_for("device-changed", Duration::from_secs(2)));
        std::thread::sleep(Duration::from_millis(150));
        let outcome = rig.owner.stop(Duration::from_secs(5)).outcome.unwrap();
        assert_eq!(rig.events.kinds(), vec!["device-changed"], "a switch is not a loss");
        assert_eq!(rig.system.opens.load(Ordering::SeqCst), 2, "reopened once, not on every poll");
        assert_eq!(rig.system.max_open.load(Ordering::SeqCst), 1, "old tap closed before the new one opens");
        assert!(outcome.warnings.contains(&"device-changed".to_string()));
        let samples = read(&rig.dir.join("audio.wav"));
        assert!(secs(samples.len()) > 0.25);
    }

    /// A driver-reported error triggers the reopen at once, without waiting
    /// out the stall timeout.
    #[test]
    fn a_stream_error_reopens_without_waiting_for_the_stall_timeout() {
        let mut rig = start("error", Source::Microphone);
        std::thread::sleep(Duration::from_millis(100));
        let flag = rig.mic.error_flag.lock().unwrap().clone().unwrap();
        // The simulated device keeps calling back throughout, so the stall
        // watchdog never fires in this test: a `device-lost` here can only
        // come from the error flag.
        flag.report_error();
        assert!(rig.events.wait_for("device-lost", Duration::from_secs(2)));
        assert!(rig.events.wait_for("device-changed", Duration::from_secs(2)));
        rig.owner.stop(Duration::from_secs(5));
        assert_eq!(rig.mic.opens.load(Ordering::SeqCst), 2);
        assert_eq!(rig.mic.max_open.load(Ordering::SeqCst), 1);
    }

    /// Pause: nothing is written, nothing is metered, the stream stays open,
    /// and the pause is not mistaken for a dead device.
    #[test]
    fn pause_stops_writing_and_metering_but_not_the_stream() {
        let mut rig = start("pause", Source::Microphone);
        let started = Instant::now();
        std::thread::sleep(Duration::from_millis(150));
        rig.owner.set_paused(true);
        std::thread::sleep(Duration::from_millis(60));
        let frames_at_pause = rig.owner.shared().tracks[0].frames.load(Ordering::Relaxed);
        let levels_at_pause = rig.events.levels.lock().unwrap().len();
        // Longer than the stall timeout.
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(rig.owner.shared().tracks[0].frames.load(Ordering::Relaxed), frames_at_pause);
        assert_eq!(rig.events.levels.lock().unwrap().len(), levels_at_pause, "no level events while paused");
        rig.owner.set_paused(false);
        std::thread::sleep(Duration::from_millis(150));
        let outcome = rig.owner.stop(Duration::from_secs(5)).outcome.unwrap();
        let wall = started.elapsed().as_secs_f64();

        assert!(rig.events.kinds().is_empty(), "a pause is not a device loss: {:?}", rig.events.kinds());
        assert_eq!(rig.mic.opens.load(Ordering::SeqCst), 1, "the stream was never reopened");
        let samples = read(&rig.dir.join("audio.wav"));
        assert!(samples.len() as u64 > frames_at_pause, "recording resumed");
        assert!(samples.iter().all(|s| (s - 0.5).abs() < 1e-3), "a pause leaves no silence in the file");
        let recorded = secs(samples.len());
        assert!(recorded > 0.2, "{recorded} s recorded");
        assert!(recorded < wall - 0.35, "{recorded} s recorded in {wall} s with 0.46 s paused");
        assert!(outcome.tracks[0].drift_ms.unwrap().abs() < 300, "paused time is not drift: {:?}", outcome.tracks[0].drift_ms);
    }

    /// C3: the file on disk is a valid, growing WAV WHILE recording, so a
    /// crash or force-quit costs seconds, not the meeting.
    #[test]
    fn the_header_is_kept_current_while_recording() {
        let mut rig = start("header", Source::Microphone);
        let path = rig.dir.join("audio.wav");
        std::thread::sleep(Duration::from_millis(350));
        // What a crash right now would leave behind.
        let snapshot = std::fs::read(&path).unwrap();
        let header_data = u32::from_le_bytes([snapshot[40], snapshot[41], snapshot[42], snapshot[43]]);
        let on_disk = snapshot.len() as u32 - 44;
        assert!(header_data > 0, "header never patched during recording");
        assert!(header_data <= on_disk);
        // header_interval is 100 ms here: at most ~that much is undeclared.
        let undeclared = (on_disk - header_data) as f64 / 2.0 / RATE as f64;
        assert!(undeclared < 0.5, "{undeclared} s not covered by the header");
        rig.owner.stop(Duration::from_secs(5));
    }

    /// Never record less than asked: if the second source cannot be opened,
    /// the start fails and the first is closed again.
    #[test]
    fn a_source_that_cannot_be_opened_fails_the_start_and_closes_the_other() {
        let mic = FakeDevice::new(0.5, 1);
        let system = FakeDevice::new(0.25, 2);
        system.unavailable.store(true, Ordering::SeqCst);
        let err = start_with("nostart", Source::Both, mic.clone(), system).err().unwrap();
        assert_eq!(err, "no system device");
        assert_eq!(mic.opens.load(Ordering::SeqCst), 1);
        assert_eq!(mic.open_now.load(Ordering::SeqCst), 0, "the microphone stream was closed again");
    }

    /// C2: a filling disk warns once, then stops the recording while there
    /// is still room to finalise it.
    #[test]
    fn low_disk_warns_then_stops_with_the_file_finalised() {
        let mut rig = start("disk", Source::Microphone);
        std::thread::sleep(Duration::from_millis(150));
        rig.free.store(super::super::monitor::LOW_DISK_BYTES - 1, Ordering::SeqCst);
        assert!(rig.events.wait_for("low-disk", Duration::from_secs(2)));
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(rig.events.kinds(), vec!["low-disk"], "warned once");
        assert!(rig.owner.shared().alive.load(Ordering::SeqCst));

        rig.free.store(super::super::monitor::CRITICAL_DISK_BYTES - 1, Ordering::SeqCst);
        let deadline = Instant::now() + Duration::from_secs(5);
        while rig.owner.shared().alive.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(rig.owner.is_fatal());
        let warnings = rig.events.warnings.lock().unwrap().clone();
        assert_eq!(warnings.last().map(|w| (w.0.as_str(), w.2)), Some(("low-disk", true)));
        let outcome = rig.owner.stop(Duration::from_secs(5)).outcome.unwrap();
        assert!(outcome.tracks[0].totals.finalize.is_ok());
        let raw = std::fs::read(rig.dir.join("audio.wav")).unwrap();
        assert_eq!(
            u32::from_le_bytes([raw[40], raw[41], raw[42], raw[43]]) as usize,
            raw.len() - 44,
            "finalised"
        );
    }

    /// C5: a source that delivers only zeros (a denied permission looks
    /// exactly like this) is reported while recording, per source.
    #[test]
    fn a_silent_source_is_reported_while_recording() {
        // 5 s of audio time at the real threshold would make a slow test;
        // the detector's timing is covered in `monitor`. Here: the loop
        // forwards the detector's verdict with the right source prefix.
        assert!(silence_message(Role::Mic).starts_with("mic: "));
        assert!(silence_message(Role::System).starts_with("system: "));
        let (kind, role, msg) = write_failure(Role::Mic, WAV_FULL);
        assert_eq!((kind, role), (WarningKind::WriteError, Some(Role::Mic)));
        assert!(msg.starts_with("mic: ") && msg.contains("maximum file size"));
        let (_, role, msg) = write_failure(Role::System, "Failed to write WAV samples: disk full");
        assert_eq!(role, Some(Role::System));
        assert!(msg.starts_with("system: ") && msg.contains("disk full"));
    }

    /// The callback itself: times are recorded even when paused (the stream
    /// is alive), samples only when not.
    #[test]
    fn the_callback_records_times_always_and_samples_only_when_not_paused() {
        let (mut producer, mut consumer) = ring(64);
        let cb = CallbackShared::new();
        let pause = AtomicBool::new(true);
        let base = Instant::now();
        assert_eq!((cb.first(), cb.last()), (None, None));

        deliver(&cb, &pause, &mut producer, base, &[0.1, 0.2]);
        let first = cb.first().expect("first callback time recorded while paused");
        assert!(consumer.is_empty(), "paused: nothing reaches the ring");

        std::thread::sleep(Duration::from_millis(2));
        pause.store(false, Ordering::Relaxed);
        deliver(&cb, &pause, &mut producer, base, &[0.3, 0.4]);
        assert_eq!(cb.first(), Some(first), "the first time is set once");
        assert!(cb.last().unwrap() > first);
        let mut out = Vec::new();
        consumer.pop_into(&mut out, 16);
        assert_eq!(out, vec![0.3, 0.4]);

        // A full ring drops the block and counts it; the callback never blocks.
        for _ in 0..40 {
            deliver(&cb, &pause, &mut producer, base, &[0.0; 8]);
        }
        assert!(consumer.dropped() > 0);
    }
}
