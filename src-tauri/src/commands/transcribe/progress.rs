//! One overall, monotonic, integer percentage for a job made of several
//! parts (tracks, and within a track the stretches it is transcribed in).
//!
//! Whisper reports progress per call; a job that makes many calls would
//! otherwise restart from zero each time. Every part is given a [`Span`] of
//! the whole and reports its own 0..1 fraction into it.

use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Loading,
    Decoding,
    Transcribing,
    Finishing,
}

impl Stage {
    pub fn as_str(self) -> &'static str {
        match self {
            Stage::Loading => "loading",
            Stage::Decoding => "decoding",
            Stage::Transcribing => "transcribing",
            Stage::Finishing => "finishing",
        }
    }
}

/// A sub-range of the whole job, as fractions in 0..=1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Span {
    pub lo: f64,
    pub hi: f64,
}

impl Span {
    pub const WHOLE: Span = Span { lo: 0.0, hi: 1.0 };

    /// The overall fraction for `x` (0..=1) within this span.
    pub fn at(&self, x: f64) -> f64 {
        let x = if x.is_finite() { x.clamp(0.0, 1.0) } else { 0.0 };
        self.lo + (self.hi - self.lo) * x
    }

    /// The part of this span between `a` and `b` (fractions of this span).
    pub fn sub(&self, a: f64, b: f64) -> Span {
        let (a, b) = (self.at(a), self.at(b));
        Span { lo: a.min(b), hi: a.max(b) }
    }

    /// Span of part `index` when the job is split into `count` equal parts.
    pub fn part(&self, index: usize, count: usize) -> Span {
        let count = count.max(1) as f64;
        self.sub(index as f64 / count, (index + 1) as f64 / count)
    }
}

struct Last {
    percent: u8,
    stage: Option<Stage>,
}

/// Turns fractions into events: integer percent, never going backwards, and
/// only when the percent or the stage actually changed.
pub struct ProgressReporter {
    last: Mutex<Last>,
    emit: Box<dyn Fn(Stage, u8) + Send + Sync>,
}

impl ProgressReporter {
    pub fn new(emit: impl Fn(Stage, u8) + Send + Sync + 'static) -> Self {
        Self { last: Mutex::new(Last { percent: 0, stage: None }), emit: Box::new(emit) }
    }

    /// Report `fraction` (0..=1 of the whole job) in `stage`. Anything short
    /// of [`ProgressReporter::finish`] tops out at 99.
    pub fn report(&self, stage: Stage, fraction: f64) {
        let fraction = if fraction.is_finite() { fraction.clamp(0.0, 1.0) } else { 0.0 };
        self.set(stage, ((fraction * 100.0).floor() as u8).min(99));
    }

    /// The job is complete: `finishing`, 100.
    pub fn finish(&self) {
        self.set(Stage::Finishing, 100);
    }

    #[cfg(test)]
    pub fn percent(&self) -> u8 {
        self.last.lock().map(|l| l.percent).unwrap_or(0)
    }

    fn set(&self, stage: Stage, percent: u8) {
        let to_emit = {
            let Ok(mut last) = self.last.lock() else { return };
            let percent = percent.max(last.percent);
            if last.stage == Some(stage) && last.percent == percent {
                None
            } else {
                last.stage = Some(stage);
                last.percent = percent;
                Some(percent)
            }
        };
        // Outside the lock: the sink may be slow (IPC).
        if let Some(percent) = to_emit {
            (self.emit)(stage, percent);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as M};

    fn recorder() -> (Arc<M<Vec<(Stage, u8)>>>, ProgressReporter) {
        let seen = Arc::new(M::new(Vec::new()));
        let sink = seen.clone();
        (seen, ProgressReporter::new(move |s, p| sink.lock().unwrap().push((s, p))))
    }

    #[test]
    fn emits_only_when_the_integer_percent_or_stage_changes() {
        let (seen, p) = recorder();
        p.report(Stage::Loading, 0.0);
        p.report(Stage::Loading, 0.001);
        p.report(Stage::Transcribing, 0.004); // stage change, same percent
        p.report(Stage::Transcribing, 0.0101);
        p.report(Stage::Transcribing, 0.0199);
        p.report(Stage::Transcribing, 0.02);
        assert_eq!(
            *seen.lock().unwrap(),
            vec![
                (Stage::Loading, 0),
                (Stage::Transcribing, 0),
                (Stage::Transcribing, 1),
                (Stage::Transcribing, 2)
            ]
        );
    }

    #[test]
    fn never_goes_backwards_and_holds_100_for_finish() {
        let (seen, p) = recorder();
        p.report(Stage::Transcribing, 0.5);
        p.report(Stage::Transcribing, 0.3); // a later part estimating lower
        p.report(Stage::Decoding, 0.2); // stage change still reported, at 50
        p.report(Stage::Transcribing, 1.0); // not finished: 99
        p.report(Stage::Transcribing, f64::NAN);
        p.finish();
        p.finish();
        assert_eq!(
            *seen.lock().unwrap(),
            vec![
                (Stage::Transcribing, 50),
                (Stage::Decoding, 50),
                (Stage::Transcribing, 99),
                (Stage::Finishing, 100)
            ]
        );
        assert_eq!(p.percent(), 100);
    }

    #[test]
    fn parts_of_a_job_add_up_to_one_monotonic_run() {
        // Two tracks, each transcribed in three stretches reporting 0..100.
        let (seen, p) = recorder();
        for track in 0..2 {
            let track_span = Span::WHOLE.part(track, 2);
            for chunk in 0..3 {
                let chunk_span = track_span.part(chunk, 3);
                for step in 0..=10 {
                    p.report(Stage::Transcribing, chunk_span.at(step as f64 / 10.0));
                }
            }
        }
        let seen = seen.lock().unwrap();
        let percents: Vec<u8> = seen.iter().map(|(_, v)| *v).collect();
        assert!(percents.windows(2).all(|w| w[0] < w[1]), "not strictly rising: {percents:?}");
        assert_eq!(*percents.first().unwrap(), 0);
        assert_eq!(*percents.last().unwrap(), 99);
        // The second track starts where the first ended, not at zero.
        assert!(percents.contains(&50));
    }

    #[test]
    fn spans_nest() {
        let s = Span::WHOLE.part(1, 2); // 0.5..1.0
        assert_eq!(s, Span { lo: 0.5, hi: 1.0 });
        let inner = s.sub(0.1, 0.5); // 0.55..0.75
        assert!((inner.lo - 0.55).abs() < 1e-12 && (inner.hi - 0.75).abs() < 1e-12);
        assert!((inner.at(0.5) - 0.65).abs() < 1e-12);
        assert_eq!(inner.at(7.0), inner.hi);
        assert_eq!(inner.at(-1.0), inner.lo);
    }

    #[test]
    fn stage_names_match_the_event_contract() {
        assert_eq!(Stage::Loading.as_str(), "loading");
        assert_eq!(Stage::Decoding.as_str(), "decoding");
        assert_eq!(Stage::Transcribing.as_str(), "transcribing");
        assert_eq!(Stage::Finishing.as_str(), "finishing");
        assert_eq!(serde_json::to_string(&Stage::Transcribing).unwrap(), "\"transcribing\"");
    }
}
