//! Transcribe one audio track as it is decoded, in parts.
//!
//! The decoder pushes 16 kHz mono samples in; whenever about ten minutes have
//! accumulated the buffer is cut at the quietest point near the end, that
//! part is transcribed, and its memory is released. So neither this buffer
//! nor Whisper's own working memory (it builds a spectrogram of everything
//! it is given) grows with the length of the recording: a three-hour meeting
//! needs what a ten-minute one does.
//!
//! Parts do not overlap. The cut is placed in a pause, where nothing is being
//! said, and each part's timestamps are offset by the part's exact start, so
//! the result reads as one transcript.

use super::engine::{EngineOutput, EngineProgress, EngineSegment, SpeechEngine, AUTO_LANGUAGE, CANCELLED};
use super::preprocess::{find_seam, gate_silence, normalise};
use super::progress::{ProgressReporter, Span, Stage};
use super::resample::TARGET_RATE;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const RATE: usize = TARGET_RATE as usize;

/// How a track is cut into parts (all in samples at 16 kHz).
#[derive(Debug, Clone, Copy)]
pub struct ChunkConfig {
    /// Longest part.
    pub target: usize,
    /// The cut is the quietest half second in the last `seam_search` samples
    /// before `target`.
    pub seam_search: usize,
    /// A part is only cut off once this much audio lies beyond `target`, so
    /// the last part is never a sliver.
    pub min_tail: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            // Ten minutes: 38 MB of samples, and about as much again inside
            // Whisper. Long enough that cuts are rare (six an hour), short
            // enough that memory stays flat.
            target: 10 * 60 * RATE,
            seam_search: 60 * RATE,
            min_tail: 30 * RATE,
        }
    }
}

/// The share of a part's progress span given to decoding it; the rest is
/// inference, which takes nearly all of the time.
const DECODE_SHARE: f64 = 0.1;
/// Less sound than this after removing silence is not worth a model call.
const MIN_SOUND: usize = RATE * 3 / 10;
/// Whisper refuses very short input; shorter parts are padded with silence.
const MIN_ENGINE_INPUT: usize = RATE + RATE / 10;

#[derive(Debug, Clone, PartialEq)]
pub struct TrackOutput {
    /// Seconds from the start of the track, in original (untrimmed) time.
    pub segments: Vec<EngineSegment>,
    /// The language used: the one asked for, or the one detected. `None`
    /// when detection was asked for and nothing was detected.
    pub language: Option<String>,
    pub duration_secs: f64,
    /// Number of parts that were sent to the engine.
    pub parts_transcribed: usize,
    /// Whether the engine has been prepared (its model loaded), by this
    /// track or an earlier one.
    pub engine_prepared: bool,
}

pub struct TrackTranscriber<'a> {
    engine: &'a mut dyn SpeechEngine,
    cfg: ChunkConfig,
    language: String,
    progress: Arc<ProgressReporter>,
    span: Span,
    cancel: Arc<AtomicBool>,

    buf: Vec<f32>,
    /// Sample number (in the track) of `buf[0]`.
    buf_start: u64,
    /// Fraction of the source file consumed when `buf[0]` was produced.
    part_from: f64,
    /// Latest fraction of the source file consumed.
    file_fraction: f64,
    total_samples: u64,
    prepared: bool,
    segments: Vec<EngineSegment>,
    parts_transcribed: usize,
    max_buffered: usize,
}

impl<'a> TrackTranscriber<'a> {
    /// `language` is a language code or [`AUTO_LANGUAGE`]. `span` is this
    /// track's share of the job's progress.
    pub fn new(
        engine: &'a mut dyn SpeechEngine,
        cfg: ChunkConfig,
        language: &str,
        progress: Arc<ProgressReporter>,
        span: Span,
        cancel: Arc<AtomicBool>,
    ) -> Self {
        let language = if language.trim().is_empty() { AUTO_LANGUAGE } else { language.trim() };
        Self {
            engine,
            cfg,
            language: language.to_string(),
            progress,
            span,
            cancel,
            buf: Vec::new(),
            buf_start: 0,
            part_from: 0.0,
            file_fraction: 0.0,
            total_samples: 0,
            prepared: false,
            segments: Vec::new(),
            parts_transcribed: 0,
            max_buffered: 0,
        }
    }

    /// Say that the engine was already prepared by an earlier track of the
    /// same job, so the model is neither loaded nor announced again.
    pub fn engine_prepared(mut self, prepared: bool) -> Self {
        self.prepared = prepared;
        self
    }

    /// Most samples ever held at once (for the log, and so a test can show
    /// it does not grow with the recording).
    pub fn max_buffered(&self) -> usize {
        self.max_buffered
    }

    /// Feed decoded samples. `file_fraction` is how far through the source
    /// file the decoder is (0..=1); it only drives progress.
    pub fn push(&mut self, samples: &[f32], file_fraction: f64) -> Result<(), String> {
        self.check_cancel()?;
        self.buf.extend_from_slice(samples);
        self.total_samples += samples.len() as u64;
        self.max_buffered = self.max_buffered.max(self.buf.len());
        if file_fraction.is_finite() {
            self.file_fraction = self.file_fraction.max(file_fraction.clamp(0.0, 1.0));
        }
        self.progress.report(
            Stage::Decoding,
            self.span.at(self.part_from + (self.file_fraction - self.part_from) * DECODE_SHARE),
        );

        while self.buf.len() >= self.cfg.target + self.cfg.min_tail {
            let lo = self.cfg.target.saturating_sub(self.cfg.seam_search);
            let seam = find_seam(&self.buf, lo, self.cfg.target).clamp(1, self.cfg.target);
            // The part's share of the file, by its share of what is buffered.
            let share = seam as f64 / self.buf.len() as f64;
            let part_to = self.part_from + (self.file_fraction - self.part_from) * share;
            self.transcribe_front(seam, part_to)?;
        }
        Ok(())
    }

    /// End of the track: transcribe what is left and return everything.
    pub fn finish(mut self) -> Result<TrackOutput, String> {
        self.check_cancel()?;
        if !self.buf.is_empty() {
            let n = self.buf.len();
            self.transcribe_front(n, 1.0)?;
        }
        self.progress.report(Stage::Transcribing, self.span.at(1.0));
        let language = if self.language == AUTO_LANGUAGE { None } else { Some(self.language) };
        Ok(TrackOutput {
            segments: self.segments,
            language,
            duration_secs: self.total_samples as f64 / RATE as f64,
            parts_transcribed: self.parts_transcribed,
            engine_prepared: self.prepared,
        })
    }

    fn check_cancel(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::Relaxed) {
            Err(CANCELLED.to_string())
        } else {
            Ok(())
        }
    }

    /// Transcribe the first `n` buffered samples and release them.
    fn transcribe_front(&mut self, n: usize, part_to: f64) -> Result<(), String> {
        let rest = self.buf.split_off(n);
        let part = std::mem::replace(&mut self.buf, rest);
        let offset = self.buf_start as f64 / RATE as f64;
        let part_span = self.span.sub(self.part_from, part_to);
        self.buf_start += n as u64;
        self.part_from = part_to;

        let (mut sound, map) = gate_silence(&part);
        drop(part);
        if sound.len() < MIN_SOUND {
            // Nothing but silence: no model call, which is also what keeps
            // Whisper from inventing text for it.
            self.progress.report(Stage::Transcribing, part_span.hi);
            return Ok(());
        }
        normalise(&mut sound);
        if sound.len() < MIN_ENGINE_INPUT {
            sound.resize(MIN_ENGINE_INPUT, 0.0);
        }

        let infer_span = part_span.sub(DECODE_SHARE, 1.0);
        if !self.prepared {
            self.progress.report(Stage::Loading, infer_span.lo);
            self.engine.prepare()?;
            self.prepared = true;
            self.check_cancel()?;
        }
        self.progress.report(Stage::Transcribing, infer_span.lo);

        let reporter = self.progress.clone();
        let on_progress: EngineProgress = Arc::new(move |percent: i32| {
            reporter.report(Stage::Transcribing, infer_span.at(percent as f64 / 100.0));
        });
        let result = self.engine.transcribe(&sound, &self.language, on_progress, self.cancel.clone());
        drop(sound);
        // A cancelled engine call fails with whatever the engine says about
        // being interrupted; the caller is owed the one agreed string.
        self.check_cancel()?;
        let EngineOutput { segments, language } = result?;
        self.parts_transcribed += 1;

        let mut any_text = false;
        for seg in segments {
            let text = seg.text.trim();
            if text.is_empty() {
                continue;
            }
            any_text = true;
            let start = offset + map.start_to_original(seg.start);
            let end = (offset + map.end_to_original(seg.end)).max(start);
            self.segments.push(EngineSegment { start, end, text: text.to_string() });
        }

        // Detect once, then stay: each part would otherwise be detected on
        // its own, and one part opening with an English phrase would turn a
        // Swedish meeting English for ten minutes.
        if self.language == AUTO_LANGUAGE && any_text {
            if let Some(detected) = language {
                let detected = detected.trim().to_string();
                if !detected.is_empty() && detected != AUTO_LANGUAGE {
                    self.language = detected;
                }
            }
        }

        self.progress.report(Stage::Transcribing, part_span.hi);
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::sync::Mutex;

    /// What a fake engine was asked to do.
    #[derive(Debug, Clone, PartialEq)]
    pub struct Call {
        pub samples: usize,
        pub language: String,
    }

    /// Scriptable engine: one segment covering all it was given, or whatever
    /// `respond` returns.
    pub struct FakeEngine {
        pub calls: Arc<Mutex<Vec<Call>>>,
        pub prepared: Arc<Mutex<usize>>,
        pub detects: Option<String>,
        pub cancel_on_call: Option<usize>,
        pub fail_on_call: Option<usize>,
        pub fail_prepare: bool,
        #[allow(clippy::type_complexity)]
        pub respond: Option<Box<dyn FnMut(usize, &[f32]) -> Vec<EngineSegment> + Send>>,
    }

    impl FakeEngine {
        pub fn new() -> Self {
            Self {
                calls: Arc::new(Mutex::new(Vec::new())),
                prepared: Arc::new(Mutex::new(0)),
                detects: None,
                cancel_on_call: None,
                fail_on_call: None,
                fail_prepare: false,
                respond: None,
            }
        }
    }

    impl SpeechEngine for FakeEngine {
        fn prepare(&mut self) -> Result<(), String> {
            *self.prepared.lock().unwrap() += 1;
            if self.fail_prepare {
                return Err("Failed to load Whisper model: boom".into());
            }
            Ok(())
        }

        fn transcribe(
            &mut self,
            samples: &[f32],
            language: &str,
            progress: EngineProgress,
            cancel: Arc<AtomicBool>,
        ) -> Result<EngineOutput, String> {
            let index = {
                let mut calls = self.calls.lock().unwrap();
                calls.push(Call { samples: samples.len(), language: language.to_string() });
                calls.len() - 1
            };
            progress(0);
            progress(50);
            if self.cancel_on_call == Some(index) {
                cancel.store(true, Ordering::Relaxed);
                return Err("Transcription failed: aborted".into());
            }
            if self.fail_on_call == Some(index) {
                return Err("Transcription failed: boom".into());
            }
            progress(100);
            let secs = samples.len() as f64 / RATE as f64;
            let segments = match self.respond.as_mut() {
                Some(f) => f(index, samples),
                None => vec![EngineSegment { start: 0.0, end: secs, text: format!(" part {index} ") }],
            };
            let language = if language == AUTO_LANGUAGE {
                self.detects.clone()
            } else {
                Some(language.to_string())
            };
            Ok(EngineOutput { segments, language })
        }
    }

    pub fn recording_reporter() -> (Arc<Mutex<Vec<(Stage, u8)>>>, Arc<ProgressReporter>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let reporter = ProgressReporter::new(move |s, p| sink.lock().unwrap().push((s, p)));
        (seen, Arc::new(reporter))
    }

    pub fn speech(secs: f64, amp: f32) -> Vec<f32> {
        (0..(secs * RATE as f64) as usize).map(|i| (i as f32 * 0.05).sin() * amp).collect()
    }

    pub fn silence(secs: f64) -> Vec<f32> {
        vec![0.0; (secs * RATE as f64) as usize]
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;

    /// Small parts so tests need seconds of audio, not hours.
    fn small() -> ChunkConfig {
        ChunkConfig { target: 10 * RATE, seam_search: 4 * RATE, min_tail: 2 * RATE }
    }

    fn run(
        engine: &mut FakeEngine,
        cfg: ChunkConfig,
        language: &str,
        audio: &[f32],
    ) -> (Result<TrackOutput, String>, Vec<(Stage, u8)>, usize) {
        let (seen, reporter) = recording_reporter();
        let cancel = Arc::new(AtomicBool::new(false));
        let mut t = TrackTranscriber::new(engine, cfg, language, reporter, Span::WHOLE, cancel);
        let mut result = Ok(());
        let block = 4096;
        let mut fed = 0;
        for chunk in audio.chunks(block) {
            fed += chunk.len();
            result = t.push(chunk, fed as f64 / audio.len() as f64);
            if result.is_err() {
                break;
            }
        }
        let max = t.max_buffered();
        let out = match result {
            Ok(()) => t.finish(),
            Err(e) => Err(e),
        };
        let seen = seen.lock().unwrap().clone();
        (out, seen, max)
    }

    #[test]
    fn a_short_recording_is_one_part_with_untouched_timestamps() {
        let mut engine = FakeEngine::new();
        let audio = speech(5.0, 0.3);
        let (out, seen, _) = run(&mut engine, small(), "en", &audio);
        let out = out.unwrap();
        assert_eq!(out.parts_transcribed, 1);
        assert_eq!(out.segments, vec![EngineSegment { start: 0.0, end: 5.0, text: "part 0".into() }]);
        assert_eq!(out.language.as_deref(), Some("en"));
        assert!((out.duration_secs - 5.0).abs() < 1e-9);
        assert_eq!(*engine.prepared.lock().unwrap(), 1);

        // Decoding first, then the model, then inference; never backwards.
        let stages: Vec<Stage> = seen.iter().map(|(s, _)| *s).collect();
        let first = |s: Stage| stages.iter().position(|x| *x == s).unwrap();
        assert!(first(Stage::Decoding) < first(Stage::Loading));
        assert!(first(Stage::Loading) < first(Stage::Transcribing));
        let percents: Vec<u8> = seen.iter().map(|(_, p)| *p).collect();
        assert!(percents.windows(2).all(|w| w[0] <= w[1]), "{percents:?}");
        assert_eq!(*percents.last().unwrap(), 99);
    }

    /// 35 s of speech with a pause every ~9 s: cut into parts at the pauses,
    /// each part's segment landing at its true position in the recording.
    #[test]
    fn a_long_recording_is_cut_in_pauses_and_timestamps_stay_absolute() {
        let mut audio = Vec::new();
        let mut pauses = Vec::new();
        for _ in 0..4 {
            audio.extend(speech(8.5, 0.3));
            pauses.push(audio.len() as f64 / RATE as f64 + 0.25);
            audio.extend(silence(0.5));
        }
        let mut engine = FakeEngine::new();
        let (out, seen, max) = run(&mut engine, small(), "sv", &audio);
        let out = out.unwrap();

        assert_eq!(out.parts_transcribed, 4, "calls: {:?}", engine.calls.lock().unwrap());
        // Parts tile the recording: each begins where the previous ended, in
        // the middle of a pause.
        assert_eq!(out.segments[0].start, 0.0);
        for (i, pair) in out.segments.windows(2).enumerate() {
            assert!((pair[0].end - pair[1].start).abs() < 1e-6, "gap or overlap at seam {i}");
            assert!(
                (pair[1].start - pauses[i]).abs() < 0.2,
                "seam {i} at {} is not in the pause at {}",
                pair[1].start,
                pauses[i]
            );
        }
        assert!((out.segments.last().unwrap().end - 36.0).abs() < 1e-6);
        assert!((out.duration_secs - 36.0).abs() < 1e-9);
        // The model is loaded once, not per part.
        assert_eq!(*engine.prepared.lock().unwrap(), 1);

        // Memory: never more than one part plus the tail margin (plus a block).
        assert!(max <= small().target + small().min_tail + 4096, "buffered {max}");

        // Progress across parts is one rising run, not four restarts.
        let percents: Vec<u8> = seen.iter().map(|(_, p)| *p).collect();
        assert!(percents.windows(2).all(|w| w[0] <= w[1]), "{percents:?}");
        assert!(percents.iter().any(|p| (20..40).contains(p)));
        assert!(percents.iter().any(|p| (60..80).contains(p)));
    }

    /// Continuous sound with no pause still gets cut (at the quietest spot
    /// there is), so memory stays bounded whatever the content.
    #[test]
    fn audio_with_no_pause_is_still_cut() {
        let audio = speech(30.0, 0.3);
        let mut engine = FakeEngine::new();
        let (out, _, max) = run(&mut engine, small(), "en", &audio);
        let out = out.unwrap();
        assert!(out.parts_transcribed >= 3);
        assert!(max <= small().target + small().min_tail + 4096);
        for pair in out.segments.windows(2) {
            assert!((pair[0].end - pair[1].start).abs() < 1e-6);
        }
    }

    /// Silence skipped inside a part must not shift what follows it.
    #[test]
    fn timestamps_after_skipped_silence_are_in_original_time() {
        // 2 s speech, 5 s silence, 2 s speech = one 9 s part.
        let mut audio = speech(2.0, 0.3);
        audio.extend(silence(5.0));
        audio.extend(speech(2.0, 0.3));
        let mut engine = FakeEngine::new();
        // The engine sees 2.3 + 2.3 s and reports one segment per stretch.
        engine.respond = Some(Box::new(|_, samples| {
            let secs = samples.len() as f64 / RATE as f64;
            assert!((secs - 4.6).abs() < 0.05, "engine was given {secs}s");
            vec![
                EngineSegment { start: 0.0, end: 2.0, text: "before".into() },
                EngineSegment { start: 2.6, end: 4.6, text: "after".into() },
            ]
        }));
        let (out, _, _) = run(&mut engine, small(), "en", &audio);
        let segs = out.unwrap().segments;
        assert_eq!(segs.len(), 2);
        assert!((segs[0].start - 0.0).abs() < 1e-6 && (segs[0].end - 2.0).abs() < 1e-6);
        assert!((segs[1].start - 7.0).abs() < 0.03, "second segment starts at {}", segs[1].start);
        assert!((segs[1].end - 9.0).abs() < 0.03, "second segment ends at {}", segs[1].end);
    }

    #[test]
    fn a_silent_track_never_loads_or_calls_the_model() {
        let mut engine = FakeEngine::new();
        let (out, seen, _) = run(&mut engine, small(), "auto", &silence(25.0));
        let out = out.unwrap();
        assert!(out.segments.is_empty());
        assert_eq!(out.parts_transcribed, 0);
        assert_eq!(out.language, None);
        assert!((out.duration_secs - 25.0).abs() < 1e-9);
        assert_eq!(*engine.prepared.lock().unwrap(), 0);
        assert!(engine.calls.lock().unwrap().is_empty());
        assert!(!seen.iter().any(|(s, _)| *s == Stage::Loading));
        assert_eq!(seen.last().unwrap().1, 99);
    }

    #[test]
    fn the_detected_language_is_pinned_for_later_parts() {
        let mut engine = FakeEngine::new();
        engine.detects = Some("sv".into());
        let (out, _, _) = run(&mut engine, small(), "", &speech(30.0, 0.3));
        let out = out.unwrap();
        assert_eq!(out.language.as_deref(), Some("sv"));
        let languages: Vec<String> =
            engine.calls.lock().unwrap().iter().map(|c| c.language.clone()).collect();
        assert_eq!(languages[0], "auto");
        assert!(languages[1..].iter().all(|l| l == "sv"), "{languages:?}");
    }

    #[test]
    fn a_pinned_language_is_never_replaced() {
        let mut engine = FakeEngine::new();
        engine.detects = Some("en".into());
        let (out, _, _) = run(&mut engine, small(), " sv ", &speech(30.0, 0.3));
        assert_eq!(out.unwrap().language.as_deref(), Some("sv"));
        assert!(engine.calls.lock().unwrap().iter().all(|c| c.language == "sv"));
    }

    #[test]
    fn cancelling_during_inference_gives_the_agreed_error_and_stops() {
        let mut engine = FakeEngine::new();
        engine.cancel_on_call = Some(1);
        let (out, _, _) = run(&mut engine, small(), "en", &speech(40.0, 0.3));
        assert_eq!(out.unwrap_err(), "Transcription cancelled");
        assert_eq!(engine.calls.lock().unwrap().len(), 2, "no part may start after a cancel");
    }

    #[test]
    fn a_cancel_before_any_audio_stops_at_the_first_push() {
        let mut engine = FakeEngine::new();
        let (_, reporter) = recording_reporter();
        let cancel = Arc::new(AtomicBool::new(true));
        let mut t = TrackTranscriber::new(&mut engine, small(), "en", reporter, Span::WHOLE, cancel);
        assert_eq!(t.push(&[0.1; 100], 0.1).unwrap_err(), CANCELLED);
        assert_eq!(t.finish().unwrap_err(), CANCELLED);
    }

    #[test]
    fn engine_and_model_errors_are_passed_through() {
        let mut engine = FakeEngine::new();
        engine.fail_on_call = Some(0);
        let (out, _, _) = run(&mut engine, small(), "en", &speech(5.0, 0.3));
        assert_eq!(out.unwrap_err(), "Transcription failed: boom");

        let mut engine = FakeEngine::new();
        engine.fail_prepare = true;
        let (out, _, _) = run(&mut engine, small(), "en", &speech(5.0, 0.3));
        assert_eq!(out.unwrap_err(), "Failed to load Whisper model: boom");
        assert!(engine.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn a_very_short_clip_is_padded_for_the_engine() {
        let mut engine = FakeEngine::new();
        let (out, _, _) = run(&mut engine, small(), "en", &speech(0.5, 0.3));
        let out = out.unwrap();
        assert_eq!(engine.calls.lock().unwrap()[0].samples, MIN_ENGINE_INPUT);
        // The segment the engine reports over its padded input is clamped to
        // the real audio.
        assert!((out.segments[0].end - 0.5).abs() < 1e-6, "end {}", out.segments[0].end);
    }

    #[test]
    fn the_default_part_is_ten_minutes() {
        let cfg = ChunkConfig::default();
        assert_eq!(cfg.target, 9_600_000);
        assert!(cfg.seam_search < cfg.target && cfg.min_tail < cfg.target);
    }
}
