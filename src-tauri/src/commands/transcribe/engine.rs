//! The seam between the transcription pipeline and the speech model.
//!
//! Everything around inference (cutting a long recording into parts, mapping
//! timestamps, progress, cancellation, merging tracks) is plain logic that
//! can be tested with a fake engine. The real one lives in `whisper_engine`.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

/// The exact rejection `transcribe_file` gives for a cancelled job. The
/// frontend matches on this string.
pub const CANCELLED: &str = "Transcription cancelled";

/// The language value that asks the engine to detect the spoken language.
pub const AUTO_LANGUAGE: &str = "auto";

/// One piece of recognised text, in seconds from the start of the samples
/// the engine was given.
#[derive(Debug, Clone, PartialEq)]
pub struct EngineSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct EngineOutput {
    pub segments: Vec<EngineSegment>,
    /// The language decoded in: the one asked for, or the one detected when
    /// asked for [`AUTO_LANGUAGE`]. `None` when detection gave no answer.
    pub language: Option<String>,
}

/// Progress of one `transcribe` call, 0..=100.
pub type EngineProgress = Arc<dyn Fn(i32) + Send + Sync>;

pub trait SpeechEngine {
    /// Called once before the first `transcribe`, when it is known that there
    /// is audio to transcribe. The place to load a model.
    fn prepare(&mut self) -> Result<(), String> {
        Ok(())
    }

    /// Transcribe 16 kHz mono `samples`. Must return `Err` promptly once
    /// `cancel` is set (the caller turns that into [`CANCELLED`]).
    fn transcribe(
        &mut self,
        samples: &[f32],
        language: &str,
        progress: EngineProgress,
        cancel: Arc<AtomicBool>,
    ) -> Result<EngineOutput, String>;
}
