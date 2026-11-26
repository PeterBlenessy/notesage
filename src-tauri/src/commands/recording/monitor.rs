//! The capture thread's decisions, as pure state machines.
//!
//! Each of these takes time as an argument (a `Duration` since the capture's
//! base instant) or counts audio frames, and returns what to do. None of them
//! touches a clock, a device or the event channel, so every rule the recorder
//! follows (when to say "silence", when a device is considered lost, how often
//! a level may be emitted) is unit-tested.

use std::time::Duration;

/// Which captured source a track holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    Mic,
    System,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Mic => "mic",
            Role::System => "system",
        }
    }
}

/// Peak absolute value of a block.
pub fn block_peak(data: &[f32]) -> f32 {
    let mut peak = 0.0f32;
    for &s in data {
        let a = s.abs();
        if a > peak {
            peak = a;
        }
    }
    peak
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/// The `recording-level` payload: peak since the previous event, per source.
/// `None` for a source that is not being recorded.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct LevelPayload {
    pub mic: Option<f32>,
    pub system: Option<f32>,
}

/// Collects per-source peaks and releases them at a bounded rate (C4: the old
/// recorder emitted ~94 events a second from the audio callback).
pub struct LevelMeter {
    interval: Duration,
    last_emit: Option<Duration>,
    mic: Option<f32>,
    system: Option<f32>,
}

impl LevelMeter {
    /// `mic` / `system`: whether that source is part of this recording.
    pub fn new(interval: Duration, mic: bool, system: bool) -> Self {
        Self {
            interval,
            last_emit: None,
            mic: mic.then_some(0.0),
            system: system.then_some(0.0),
        }
    }

    pub fn observe(&mut self, role: Role, peak: f32) {
        let slot = match role {
            Role::Mic => &mut self.mic,
            Role::System => &mut self.system,
        };
        if let Some(current) = slot {
            if peak > *current {
                *current = peak.min(1.0);
            }
        }
    }

    /// The payload to emit now, if one is due. Nothing is emitted while
    /// paused, and whatever was observed during the pause is discarded so the
    /// first event after a resume does not carry stale peaks.
    pub fn poll(&mut self, now: Duration, paused: bool) -> Option<LevelPayload> {
        if paused {
            self.reset();
            return None;
        }
        if let Some(last) = self.last_emit {
            if now.saturating_sub(last) < self.interval {
                return None;
            }
        }
        self.last_emit = Some(now);
        let payload = LevelPayload { mic: self.mic, system: self.system };
        self.reset();
        Some(payload)
    }

    fn reset(&mut self) {
        if let Some(v) = &mut self.mic {
            *v = 0.0;
        }
        if let Some(v) = &mut self.system {
            *v = 0.0;
        }
    }
}

// ---------------------------------------------------------------------------
// Silence
// ---------------------------------------------------------------------------

/// Below this peak a block counts as silence. A denied or muted input
/// delivers exact zeros; the built-in microphone in a quiet room sits around
/// 0.001 to 0.003, so this catches the former without flagging the latter.
pub const SILENCE_THRESHOLD: f32 = 0.0002;

/// Detects "nothing is arriving on this source" while it still matters (C5):
/// after the first few seconds, rather than once the meeting is over.
///
/// Time is counted in audio frames that were processed, so the detector needs
/// no clock, ignores pauses by construction, and is deterministic in tests.
/// (A source that delivers no frames at all is the stall watchdog's business.)
pub struct SilenceDetector {
    threshold: f32,
    initial_frames: u64,
    later_frames: u64,
    silent_run: u64,
    heard_signal: bool,
    warned: bool,
}

impl SilenceDetector {
    pub fn new(sample_rate: u32) -> Self {
        Self::with_limits(sample_rate, SILENCE_THRESHOLD, 5.0, 30.0)
    }

    pub fn with_limits(sample_rate: u32, threshold: f32, initial_secs: f64, later_secs: f64) -> Self {
        Self {
            threshold,
            initial_frames: (initial_secs * sample_rate as f64) as u64,
            later_frames: (later_secs * sample_rate as f64) as u64,
            silent_run: 0,
            heard_signal: false,
            warned: false,
        }
    }

    /// Feed one processed block. Returns `true` when a silence warning is due:
    /// once when the recording starts silent, and once per later silent
    /// stretch (a new stretch begins after signal was heard again).
    pub fn observe(&mut self, frames: u64, peak: f32) -> bool {
        if frames == 0 {
            return false;
        }
        if peak > self.threshold {
            self.silent_run = 0;
            self.heard_signal = true;
            self.warned = false;
            return false;
        }
        self.silent_run += frames;
        let limit = if self.heard_signal { self.later_frames } else { self.initial_frames };
        if !self.warned && self.silent_run >= limit {
            self.warned = true;
            return true;
        }
        false
    }
}

// ---------------------------------------------------------------------------
// Stalls (device loss)
// ---------------------------------------------------------------------------

/// What the capture loop should do about one stream this tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StallAction {
    /// Callbacks are arriving, or nothing is due yet.
    None,
    /// No callbacks for `stall_after`: tell the user and try to reopen now.
    Lost,
    /// Still lost: try to reopen again.
    Retry,
    /// Lost for `give_up_after` with no audio since. Reported once; retries
    /// continue at a slower pace in case the device comes back.
    GaveUp,
    /// Audio is arriving again from a stream opened after the loss.
    Recovered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StallState {
    Healthy,
    Lost { since: Duration, last_attempt: Duration, gave_up: bool },
}

/// Detects a stream that stopped calling back (C1).
///
/// cpal swallows device-loss errors for the default input device and merely
/// pauses the stream, so the absence of callbacks is the only signal there
/// is. The watchdog declares recovery only when a callback arrives AFTER the
/// last reopen attempt: a reopened stream that also stays silent keeps the
/// clock running towards `give_up_after` instead of resetting it. Retries
/// are spaced so that a reopened stream has time to deliver before it is
/// replaced again.
pub struct StallWatchdog {
    stall_after: Duration,
    /// Allowed silence for a stream that has not called back yet. Longer
    /// than `stall_after`: a stream may take a moment to start (a process
    /// tap being set up, a Bluetooth device waking), and reopening it early
    /// would only restart that wait.
    first_callback_grace: Duration,
    retry_every: Duration,
    give_up_after: Duration,
    slow_retry_every: Duration,
    state: StallState,
}

impl StallWatchdog {
    pub fn new() -> Self {
        Self::with_limits(
            Duration::from_secs(2),
            Duration::from_secs(6),
            Duration::from_secs(4),
            Duration::from_secs(30),
            Duration::from_secs(10),
        )
    }

    pub fn with_limits(
        stall_after: Duration,
        first_callback_grace: Duration,
        retry_every: Duration,
        give_up_after: Duration,
        slow_retry_every: Duration,
    ) -> Self {
        Self {
            stall_after,
            first_callback_grace,
            retry_every,
            give_up_after,
            slow_retry_every,
            state: StallState::Healthy,
        }
    }

    pub fn is_lost(&self) -> bool {
        matches!(self.state, StallState::Lost { .. })
    }

    #[cfg(test)]
    pub fn has_given_up(&self) -> bool {
        matches!(self.state, StallState::Lost { gave_up: true, .. })
    }

    /// Mark the stream lost right now without waiting for the stall timeout
    /// (the driver reported an error, or the device to follow changed). The
    /// caller makes the first reopen attempt itself; recovery is then detected
    /// by `tick` as usual. No-op when already lost.
    pub fn force_lost(&mut self, now: Duration) {
        if !self.is_lost() {
            self.state = StallState::Lost { since: now, last_attempt: now, gave_up: false };
        }
    }

    /// `opened_at`: when the current stream was (re)opened. `last_callback`:
    /// time of the newest audio callback of the CURRENT stream, if any.
    pub fn tick(
        &mut self,
        now: Duration,
        opened_at: Duration,
        last_callback: Option<Duration>,
    ) -> StallAction {
        match self.state {
            StallState::Healthy => {
                let (last_signal, allowed) = match last_callback {
                    Some(t) if t >= opened_at => (t, self.stall_after),
                    _ => (opened_at, self.first_callback_grace),
                };
                if now.saturating_sub(last_signal) >= allowed {
                    self.state = StallState::Lost { since: now, last_attempt: now, gave_up: false };
                    StallAction::Lost
                } else {
                    StallAction::None
                }
            }
            StallState::Lost { since, last_attempt, gave_up } => {
                if last_callback.is_some_and(|t| t > last_attempt) {
                    self.state = StallState::Healthy;
                    return StallAction::Recovered;
                }
                if !gave_up && now.saturating_sub(since) >= self.give_up_after {
                    self.state = StallState::Lost { since, last_attempt, gave_up: true };
                    return StallAction::GaveUp;
                }
                let every = if gave_up { self.slow_retry_every } else { self.retry_every };
                if now.saturating_sub(last_attempt) >= every {
                    self.state = StallState::Lost { since, last_attempt: now, gave_up };
                    StallAction::Retry
                } else {
                    StallAction::None
                }
            }
        }
    }
}

impl Default for StallWatchdog {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Pauses and the shared timeline
// ---------------------------------------------------------------------------

/// Tracks how much of the time since the recording's origin was spent paused,
/// so "how long have we been recording" excludes pauses.
#[derive(Default)]
pub struct PauseClock {
    paused_total: Duration,
    paused_since: Option<Duration>,
}

impl PauseClock {
    /// Report the pause flag as observed at `now`.
    pub fn observe(&mut self, now: Duration, paused: bool) {
        match (self.paused_since, paused) {
            (None, true) => self.paused_since = Some(now),
            (Some(since), false) => {
                self.paused_total += now.saturating_sub(since);
                self.paused_since = None;
            }
            _ => {}
        }
    }

    /// Recording time between `origin` and `at`, pauses excluded.
    pub fn active_between(&self, origin: Duration, at: Duration) -> Duration {
        let mut paused = self.paused_total;
        if let Some(since) = self.paused_since {
            paused += at.saturating_sub(since);
        }
        at.saturating_sub(origin).saturating_sub(paused)
    }
}

/// Frames of silence to insert so a track that (re)starts delivering audio
/// `active_elapsed` into the recording lines up with the shared timeline.
///
/// This is what makes two tracks start at the same instant (the later stream
/// is padded by its head start deficit) and what keeps timestamps true across
/// a device loss (the gap becomes silence instead of being spliced out).
pub fn pad_frames(active_elapsed: Duration, sample_rate: u32, frames_written: u64) -> u64 {
    let expected = (active_elapsed.as_secs_f64() * sample_rate as f64).round() as u64;
    expected.saturating_sub(frames_written)
}

/// How far a track's written audio is from the clock, in milliseconds
/// (positive: more audio than elapsed time). Two devices have two crystals;
/// this is how their disagreement over an hour is measured and reported.
pub fn drift_ms(frames_written: u64, sample_rate: u32, active_elapsed: Duration) -> i64 {
    if sample_rate == 0 {
        return 0;
    }
    let audio_ms = frames_written as f64 * 1000.0 / sample_rate as f64;
    (audio_ms - active_elapsed.as_secs_f64() * 1000.0).round() as i64
}

// ---------------------------------------------------------------------------
// Disk
// ---------------------------------------------------------------------------

/// Refuse to start below this (the phone's rule, `Recorder.swift`).
pub const MIN_FREE_BYTES_TO_START: u64 = 200 * 1024 * 1024;
/// Warn below this while recording: about 85 minutes of mono 48 kHz PCM.
pub const LOW_DISK_BYTES: u64 = 500 * 1024 * 1024;
/// Stop below this, while there is still room to finalise.
pub const CRITICAL_DISK_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiskAction {
    None,
    /// Emit one `low-disk` warning.
    Warn,
    /// Stop the recording now.
    Stop,
}

/// Turns free-space readings into at most one warning and one stop.
#[derive(Default)]
pub struct DiskMonitor {
    warned: bool,
    stopped: bool,
}

impl DiskMonitor {
    /// `free`: bytes available, or `None` when it could not be read (never a
    /// reason to stop a recording).
    pub fn observe(&mut self, free: Option<u64>) -> DiskAction {
        let Some(free) = free else {
            return DiskAction::None;
        };
        if free < CRITICAL_DISK_BYTES {
            if self.stopped {
                return DiskAction::None;
            }
            self.stopped = true;
            return DiskAction::Stop;
        }
        if free < LOW_DISK_BYTES {
            if self.warned {
                return DiskAction::None;
            }
            self.warned = true;
            return DiskAction::Warn;
        }
        // Space came back (the user deleted something): warn again next time.
        self.warned = false;
        DiskAction::None
    }
}

/// Rate limiter for a repeating warning: fires on the first occurrence and
/// then at most once per `every`.
pub struct Throttle {
    every: Duration,
    last: Option<Duration>,
}

impl Throttle {
    pub fn new(every: Duration) -> Self {
        Self { every, last: None }
    }

    pub fn allow(&mut self, now: Duration) -> bool {
        if self.last.is_some_and(|l| now.saturating_sub(l) < self.every) {
            return false;
        }
        self.last = Some(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(v: u64) -> Duration {
        Duration::from_millis(v)
    }

    #[test]
    fn block_peak_is_the_largest_magnitude() {
        assert_eq!(block_peak(&[]), 0.0);
        assert_eq!(block_peak(&[0.1, -0.7, 0.3]), 0.7);
    }

    /// C4: at most 10 level events a second, each carrying the peak since the
    /// previous one.
    #[test]
    fn level_meter_is_rate_limited_and_reports_peak_since_last_event() {
        let mut m = LevelMeter::new(ms(100), true, false);
        m.observe(Role::Mic, 0.2);
        assert_eq!(m.poll(ms(0), false), Some(LevelPayload { mic: Some(0.2), system: None }));

        // 20 ms ticks for one second: observe every tick, count emissions.
        let mut emitted = 0;
        for tick in 1..=50u64 {
            m.observe(Role::Mic, 0.1);
            if tick % 5 == 3 {
                m.observe(Role::Mic, 0.9);
            }
            if let Some(p) = m.poll(ms(tick * 20), false) {
                emitted += 1;
                assert_eq!(p.mic, Some(0.9), "peak of the whole interval, not the last block");
                assert_eq!(p.system, None, "a source that is not recorded is null");
            }
        }
        assert_eq!(emitted, 10);
    }

    #[test]
    fn level_meter_is_silent_while_paused_and_forgets_paused_peaks() {
        let mut m = LevelMeter::new(ms(100), true, true);
        m.observe(Role::Mic, 0.8);
        m.observe(Role::System, 0.6);
        assert_eq!(m.poll(ms(0), true), None);
        assert_eq!(m.poll(ms(500), true), None);
        // Resumed: the peaks seen while paused are gone.
        assert_eq!(m.poll(ms(600), false), Some(LevelPayload { mic: Some(0.0), system: Some(0.0) }));
        m.observe(Role::System, 2.0);
        assert_eq!(
            m.poll(ms(700), false),
            Some(LevelPayload { mic: Some(0.0), system: Some(1.0) }),
            "clamped to 1"
        );
    }

    /// C5: a source that is silent from the start is reported after ~5 s, not
    /// after the meeting.
    #[test]
    fn silence_from_the_start_warns_once_after_five_seconds() {
        let mut d = SilenceDetector::new(48_000);
        let block = 480; // 10 ms
        let mut warned_at = None;
        for i in 0..2000u64 {
            if d.observe(block, 0.0) {
                assert!(warned_at.is_none(), "warned twice in one episode");
                warned_at = Some((i + 1) * block);
            }
        }
        assert_eq!(warned_at, Some(5 * 48_000));
    }

    #[test]
    fn silence_after_signal_needs_thirty_seconds_and_rearms_per_episode() {
        let mut d = SilenceDetector::new(1000);
        // Signal for a second, then silence.
        assert!(!d.observe(1000, 0.3));
        let mut warnings = 0;
        for _ in 0..29 {
            warnings += d.observe(1000, 0.0) as u32;
        }
        assert_eq!(warnings, 0, "29 s of silence after speech is a pause in conversation");
        assert!(d.observe(1000, 0.0), "30 s");
        for _ in 0..100 {
            assert!(!d.observe(1000, 0.0), "once per episode");
        }
        // Someone speaks, then it goes quiet again: a new episode.
        assert!(!d.observe(1000, 0.05));
        for _ in 0..29 {
            assert!(!d.observe(1000, 0.0));
        }
        assert!(d.observe(1000, 0.0));
    }

    #[test]
    fn noise_floor_is_not_silence_and_signal_resets_the_run() {
        let mut d = SilenceDetector::new(1000);
        // A quiet room: above the threshold, never warns.
        for _ in 0..100 {
            assert!(!d.observe(1000, 0.001));
        }
        let mut d = SilenceDetector::new(1000);
        // 4 s silent, a blip, 4 s silent: never 5 s in a row; the blip also
        // moves it to the 30 s rule.
        for _ in 0..4 {
            assert!(!d.observe(1000, 0.0));
        }
        assert!(!d.observe(1000, 0.5));
        for _ in 0..4 {
            assert!(!d.observe(1000, 0.0));
        }
        assert!(!d.observe(0, 0.0), "an empty block is not evidence");
    }

    /// C1: no callbacks for 2 s → lost; retries every 4 s; recovery only once
    /// the REOPENED stream delivers audio.
    #[test]
    fn stall_is_detected_retried_and_recovered() {
        let mut w = StallWatchdog::new();
        let opened = ms(0);
        assert_eq!(w.tick(ms(500), opened, None), StallAction::None, "still starting up");
        assert_eq!(w.tick(ms(1000), opened, Some(ms(990))), StallAction::None);
        assert_eq!(w.tick(ms(2900), opened, Some(ms(1000))), StallAction::None, "1.9 s");
        assert_eq!(w.tick(ms(3000), opened, Some(ms(1000))), StallAction::Lost);
        assert!(w.is_lost());
        // The caller reopened at 3000 (new stream: no callbacks yet).
        assert_eq!(w.tick(ms(3020), ms(3000), None), StallAction::None);
        assert_eq!(w.tick(ms(6999), ms(3000), None), StallAction::None, "give the new stream time");
        assert_eq!(w.tick(ms(7000), ms(3000), None), StallAction::Retry);
        assert_eq!(w.tick(ms(7020), ms(7000), None), StallAction::None);
        // Audio from the stream opened at 7000.
        assert_eq!(w.tick(ms(7300), ms(7000), Some(ms(7290))), StallAction::Recovered);
        assert!(!w.is_lost());
        assert_eq!(w.tick(ms(7320), ms(7000), Some(ms(7310))), StallAction::None);
    }

    /// A stream that has not delivered yet gets longer than one that went
    /// quiet: starting can be slow, and reopening early restarts the wait.
    #[test]
    fn a_stream_that_never_calls_back_gets_a_longer_grace_from_when_it_was_opened() {
        let mut w = StallWatchdog::new();
        assert_eq!(w.tick(ms(12_000), ms(10_000), None), StallAction::None, "2 s is not enough");
        assert_eq!(w.tick(ms(15_900), ms(10_000), None), StallAction::None);
        assert_eq!(w.tick(ms(16_000), ms(10_000), None), StallAction::Lost);
        // A callback time from before the stream was opened is not this stream's.
        let mut w = StallWatchdog::new();
        assert_eq!(w.tick(ms(12_500), ms(10_000), Some(ms(9_000))), StallAction::None);
        assert_eq!(w.tick(ms(16_000), ms(10_000), Some(ms(9_000))), StallAction::Lost);
    }

    /// A stale callback time from before the loss must not look like recovery.
    #[test]
    fn old_callbacks_do_not_count_as_recovery_and_giving_up_happens_once() {
        let mut w = StallWatchdog::new();
        assert_eq!(w.tick(ms(2000), ms(0), Some(ms(0))), StallAction::Lost);
        let stale = Some(ms(1500));
        let mut retries = 0;
        let mut gave_up_at = None;
        let mut t = 2020;
        while t <= 60_000 {
            match w.tick(ms(t), ms(0), stale) {
                StallAction::Retry => retries += 1,
                StallAction::GaveUp => {
                    assert!(gave_up_at.is_none(), "gave up twice");
                    gave_up_at = Some(t);
                }
                StallAction::Recovered => panic!("stale callback treated as recovery"),
                StallAction::Lost => panic!("lost twice"),
                StallAction::None => {}
            }
            t += 20;
        }
        assert_eq!(gave_up_at, Some(32_000), "30 s after the loss");
        assert!(w.has_given_up());
        // Retries every 4 s for 30 s (7), then every 10 s (2 or 3).
        assert!((8..=11).contains(&retries), "retries: {retries}");
        // It can still come back after giving up.
        assert_eq!(w.tick(ms(60_020), ms(60_000), Some(ms(60_010))), StallAction::Recovered);
    }

    #[test]
    fn force_lost_skips_the_timeout_and_recovers_normally() {
        let mut w = StallWatchdog::new();
        w.force_lost(ms(1000));
        assert!(w.is_lost());
        // Callbacks of the OLD stream up to the forced loss are not recovery.
        assert_eq!(w.tick(ms(1020), ms(1000), Some(ms(1000))), StallAction::None);
        assert_eq!(w.tick(ms(1200), ms(1000), Some(ms(1150))), StallAction::Recovered);
        // Forcing while already lost keeps the original loss time.
        let mut w = StallWatchdog::new();
        w.force_lost(ms(0));
        w.force_lost(ms(29_000));
        assert_eq!(w.tick(ms(30_000), ms(0), None), StallAction::GaveUp);
    }

    #[test]
    fn pause_clock_excludes_paused_time() {
        let mut c = PauseClock::default();
        let origin = ms(1000);
        assert_eq!(c.active_between(origin, ms(4000)), ms(3000));
        c.observe(ms(4000), true);
        c.observe(ms(4500), true); // repeated observations change nothing
        assert_eq!(c.active_between(origin, ms(6000)), ms(3000), "frozen while paused");
        c.observe(ms(7000), false);
        assert_eq!(c.active_between(origin, ms(8000)), ms(4000));
        c.observe(ms(8000), true);
        c.observe(ms(8250), false);
        assert_eq!(c.active_between(origin, ms(9000)), ms(4750));
        assert_eq!(c.active_between(ms(5000), ms(2000)), ms(0), "never negative");
    }

    /// N1: the stream that starts later is padded by exactly its deficit, so
    /// both tracks begin at the same instant.
    #[test]
    fn pad_frames_aligns_a_late_track_and_fills_a_gap() {
        // System stream delivered its first block 250 ms after the mic.
        assert_eq!(pad_frames(ms(250), 48_000, 0), 12_000);
        assert_eq!(pad_frames(ms(0), 48_000, 0), 0);
        // Reopened 12 s in with 10 s of audio written: 2 s of silence.
        assert_eq!(pad_frames(ms(12_000), 44_100, 441_000), 88_200);
        // A track that is ahead of the clock is never trimmed.
        assert_eq!(pad_frames(ms(1000), 48_000, 48_100), 0);
    }

    #[test]
    fn drift_is_audio_time_minus_clock_time() {
        assert_eq!(drift_ms(48_000 * 3600, 48_000, Duration::from_secs(3600)), 0);
        // 50 ppm fast over an hour: 180 ms more audio than clock.
        assert_eq!(drift_ms(48_000 * 3600 + 8_640, 48_000, Duration::from_secs(3600)), 180);
        assert_eq!(drift_ms(47_000, 48_000, Duration::from_secs(1)), -21);
        assert_eq!(drift_ms(100, 0, Duration::from_secs(1)), 0);
    }

    #[test]
    fn disk_monitor_warns_once_and_stops_once() {
        let mut d = DiskMonitor::default();
        assert_eq!(d.observe(Some(10 * LOW_DISK_BYTES)), DiskAction::None);
        assert_eq!(d.observe(None), DiskAction::None, "an unreadable volume never stops a recording");
        assert_eq!(d.observe(Some(LOW_DISK_BYTES - 1)), DiskAction::Warn);
        assert_eq!(d.observe(Some(LOW_DISK_BYTES - 2)), DiskAction::None);
        // Space freed, then low again: a new warning.
        assert_eq!(d.observe(Some(LOW_DISK_BYTES)), DiskAction::None);
        assert_eq!(d.observe(Some(LOW_DISK_BYTES - 1)), DiskAction::Warn);
        assert_eq!(d.observe(Some(CRITICAL_DISK_BYTES - 1)), DiskAction::Stop);
        assert_eq!(d.observe(Some(0)), DiskAction::None);
        assert!(MIN_FREE_BYTES_TO_START > CRITICAL_DISK_BYTES);
    }

    #[test]
    fn throttle_fires_first_then_once_per_period() {
        let mut t = Throttle::new(Duration::from_secs(60));
        assert!(t.allow(ms(5)));
        assert!(!t.allow(ms(30_000)));
        assert!(!t.allow(ms(60_004)));
        assert!(t.allow(ms(60_005)));
    }
}
