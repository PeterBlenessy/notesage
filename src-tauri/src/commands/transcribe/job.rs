//! One transcription job from files to a merged transcript: decode each
//! track as a stream, transcribe it in parts, label, de-duplicate, merge.
//!
//! Generic over the engine, so the whole flow runs in tests on real audio
//! files with a fake model.

use super::engine::{SpeechEngine, AUTO_LANGUAGE};
use super::multitrack::{combine_tracks, merge_tracks, SpeakerSegment};
use super::pipeline::{ChunkConfig, TrackTranscriber};
use super::progress::{ProgressReporter, Span};
use crate::commands::audio_decode::{decode_stream_16k, Decoder};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

/// One audio file to transcribe. `speaker` is `None` for a plain recording,
/// or the label every segment of this track gets.
#[derive(Debug, Clone, PartialEq)]
pub struct TrackInput {
    pub speaker: Option<&'static str>,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq)]
pub struct JobOutput {
    pub segments: Vec<SpeakerSegment>,
    /// The language used; `"auto"` only when detection was asked for and
    /// nothing was detected (no speech).
    pub language: String,
    /// Length of the longest track.
    pub duration_secs: f64,
    /// The decoder that read the first track.
    pub decoder: Decoder,
}

/// Run a whole job on the calling (blocking) thread.
///
/// Tracks are handled one after another, so only one track's current part is
/// in memory at a time. A language detected on the first track that has
/// speech is used for the rest.
pub fn run_job(
    engine: &mut dyn SpeechEngine,
    tracks: &[TrackInput],
    language: &str,
    cfg: ChunkConfig,
    progress: Arc<ProgressReporter>,
    cancel: Arc<AtomicBool>,
) -> Result<JobOutput, String> {
    if tracks.is_empty() {
        return Err("No audio to transcribe".into());
    }
    let mut language = match language.trim() {
        "" => AUTO_LANGUAGE.to_string(),
        l => l.to_string(),
    };
    let mut decoder = None;
    let mut duration_secs = 0f64;
    let mut prepared = false;
    let mut done: Vec<(Option<&'static str>, Vec<super::engine::EngineSegment>)> = Vec::new();

    for (index, track) in tracks.iter().enumerate() {
        let span = Span::WHOLE.part(index, tracks.len());
        let mut transcriber =
            TrackTranscriber::new(&mut *engine, cfg, &language, progress.clone(), span, cancel.clone())
                .engine_prepared(prepared);
        let info = decode_stream_16k(&track.path, &mut |samples, fraction| {
            transcriber.push(samples, fraction)
        })?;
        let peak_buffered = transcriber.max_buffered();
        let out = transcriber.finish()?;
        log::info!(
            target: "notesage::transcription",
            "Track {}/{}: decoded with {} ({} Hz, {} ch), {:.1}s, {} part(s), {} segment(s), at most {:.0} MB of audio held",
            index + 1,
            tracks.len(),
            info.decoder.as_str(),
            info.sample_rate,
            info.channels,
            out.duration_secs,
            out.parts_transcribed,
            out.segments.len(),
            peak_buffered as f64 * 4.0 / (1024.0 * 1024.0)
        );
        prepared = out.engine_prepared;
        decoder.get_or_insert(info.decoder);
        duration_secs = duration_secs.max(out.duration_secs);
        if language == AUTO_LANGUAGE {
            if let Some(detected) = out.language {
                language = detected;
            }
        }
        done.push((track.speaker, out.segments));
    }

    let segments = if done.iter().all(|(speaker, _)| speaker.is_some()) {
        combine_tracks(done.into_iter().map(|(speaker, s)| (speaker.unwrap_or(""), s)).collect())
    } else {
        merge_tracks(done)
    };

    Ok(JobOutput {
        segments,
        language,
        duration_secs,
        decoder: decoder.unwrap_or(Decoder::Symphonia),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::transcribe::engine::{EngineSegment, CANCELLED};
    use crate::commands::transcribe::media_import::Wav16Writer;
    use crate::commands::transcribe::multitrack::{SPEAKER_ME, SPEAKER_OTHERS};
    use crate::commands::transcribe::pipeline::test_support::*;
    use crate::commands::transcribe::progress::Stage;
    use std::path::Path;
    use std::sync::atomic::Ordering;

    const RATE: usize = 16_000;

    fn small() -> ChunkConfig {
        ChunkConfig { target: 10 * RATE, seam_search: 4 * RATE, min_tail: 2 * RATE }
    }

    fn write_wav(path: &Path, samples: &[f32]) {
        let mut w = Wav16Writer::create(path).unwrap();
        w.write(samples).unwrap();
        w.finalize().unwrap();
    }

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/audio").join(name)
    }

    fn plain(path: &Path) -> Vec<TrackInput> {
        vec![TrackInput { speaker: None, path: path.to_path_buf() }]
    }

    #[test]
    fn a_single_file_is_transcribed_end_to_end_without_speakers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audio.wav");
        let mut audio = Vec::new();
        for _ in 0..3 {
            audio.extend(speech(8.5, 0.3));
            audio.extend(silence(0.5));
        }
        write_wav(&path, &audio);

        let mut engine = FakeEngine::new();
        let (seen, reporter) = recording_reporter();
        let cancel = Arc::new(AtomicBool::new(false));
        let out = run_job(&mut engine, &plain(&path), "en", small(), reporter, cancel).unwrap();

        assert_eq!(out.language, "en");
        assert_eq!(out.decoder, Decoder::Symphonia);
        assert!((out.duration_secs - 27.0).abs() < 1e-6);
        assert_eq!(out.segments.len(), 3, "three parts, cut at the two pauses");
        assert!(out.segments.iter().all(|s| s.speaker.is_none()));
        assert_eq!(out.segments[0].start, 0.0);
        assert!((out.segments[1].start - 8.75).abs() < 0.2);
        assert!((out.segments[2].start - 17.75).abs() < 0.2);
        assert!((out.segments[2].end - 27.0).abs() < 1e-6);

        let seen = seen.lock().unwrap();
        let percents: Vec<u8> = seen.iter().map(|(_, p)| *p).collect();
        assert!(percents.windows(2).all(|w| w[0] <= w[1]), "{percents:?}");
        assert_eq!(seen.first().unwrap().0, Stage::Decoding);
        assert_eq!(*percents.last().unwrap(), 99);
    }

    /// A compressed 48 kHz file goes through the same path (decode,
    /// resample, transcribe) with nothing special at the call site.
    #[test]
    fn a_48k_aac_file_is_decoded_resampled_and_transcribed() {
        let mut engine = FakeEngine::new();
        let (_, reporter) = recording_reporter();
        let out = run_job(
            &mut engine,
            &plain(&fixture("tone-phone-48k-mono-64k.m4a")),
            "",
            small(),
            reporter,
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert!((out.duration_secs - 0.4).abs() < 0.1, "duration {}", out.duration_secs);
        assert_eq!(out.segments.len(), 1);
        // Nothing detected by the fake: the request is reported back.
        assert_eq!(out.language, "auto");
    }

    /// The "both" recording: two tracks on one clock become one transcript
    /// with "me" and "others", ordered by time, across both tracks' progress.
    #[test]
    fn two_tracks_become_one_transcript_with_speakers() {
        let dir = tempfile::tempdir().unwrap();
        let mic = dir.path().join("mic.wav");
        let system = dir.path().join("system.wav");
        // I speak 0..4 s and 12..16 s; the others speak 5..11 s.
        let mut a = speech(4.0, 0.3);
        a.extend(silence(8.0));
        a.extend(speech(4.0, 0.3));
        write_wav(&mic, &a);
        let mut b = silence(5.0);
        b.extend(speech(6.0, 0.3));
        b.extend(silence(5.0));
        write_wav(&system, &b);

        let mut engine = FakeEngine::new();
        engine.detects = Some("sv".into());
        // One segment per stretch of sound the engine is handed.
        let mut call = 0;
        engine.respond = Some(Box::new(move |_, samples| {
            call += 1;
            let secs = samples.len() as f64 / RATE as f64;
            if call == 1 {
                // The mic part: two stretches of 4.3 s (speech plus margin).
                vec![
                    EngineSegment { start: 0.0, end: 4.0, text: "Hej allihopa.".into() },
                    EngineSegment { start: 4.6, end: secs, text: "Det låter bra.".into() },
                ]
            } else {
                vec![EngineSegment { start: 0.3, end: secs - 0.3, text: "Tack för att ni kom.".into() }]
            }
        }));

        let tracks = vec![
            TrackInput { speaker: Some(SPEAKER_ME), path: mic },
            TrackInput { speaker: Some(SPEAKER_OTHERS), path: system },
        ];
        let (seen, reporter) = recording_reporter();
        let big = ChunkConfig { target: 60 * RATE, seam_search: 4 * RATE, min_tail: 2 * RATE };
        let out =
            run_job(&mut engine, &tracks, "auto", big, reporter, Arc::new(AtomicBool::new(false))).unwrap();

        let got: Vec<(&str, &str)> = out
            .segments
            .iter()
            .map(|s| (s.speaker.as_deref().unwrap(), s.text.as_str()))
            .collect();
        assert_eq!(
            got,
            vec![("me", "Hej allihopa."), ("others", "Tack för att ni kom."), ("me", "Det låter bra.")]
        );
        // Times are in the recording's clock, not each trimmed track's.
        assert!((out.segments[1].start - 5.0).abs() < 0.05, "others start at {}", out.segments[1].start);
        assert!((out.segments[2].start - 12.0).abs() < 0.05, "me again at {}", out.segments[2].start);
        assert!((out.duration_secs - 16.0).abs() < 1e-6);

        // Detected on the first track, pinned for the second.
        assert_eq!(out.language, "sv");
        let languages: Vec<String> =
            engine.calls.lock().unwrap().iter().map(|c| c.language.clone()).collect();
        assert_eq!(languages, vec!["auto", "sv"]);
        // The model is loaded once for the job.
        assert_eq!(*engine.prepared.lock().unwrap(), 1);

        // One progress run over both tracks: the second starts at half.
        let seen = seen.lock().unwrap();
        let percents: Vec<u8> = seen.iter().map(|(_, p)| *p).collect();
        assert!(percents.windows(2).all(|w| w[0] <= w[1]), "{percents:?}");
        assert!(percents.iter().any(|p| (40..=55).contains(p)), "{percents:?}");
        assert_eq!(*percents.last().unwrap(), 99);
    }

    /// With loudspeakers the microphone hears the others too.
    #[test]
    fn the_echo_of_the_others_is_removed_from_the_microphone_track() {
        let dir = tempfile::tempdir().unwrap();
        let mic = dir.path().join("mic.wav");
        let system = dir.path().join("system.wav");
        write_wav(&mic, &speech(8.0, 0.3));
        write_wav(&system, &speech(8.0, 0.3));

        let mut engine = FakeEngine::new();
        let mut call = 0;
        engine.respond = Some(Box::new(move |_, _| {
            call += 1;
            if call == 1 {
                vec![
                    EngineSegment { start: 0.4, end: 4.0, text: "shall we start with the budget numbers".into() },
                    EngineSegment { start: 4.5, end: 7.5, text: "Yes, let me share my screen.".into() },
                ]
            } else {
                vec![EngineSegment { start: 0.0, end: 3.8, text: "Shall we start with the budget numbers?".into() }]
            }
        }));
        let tracks = vec![
            TrackInput { speaker: Some(SPEAKER_ME), path: mic },
            TrackInput { speaker: Some(SPEAKER_OTHERS), path: system },
        ];
        let (_, reporter) = recording_reporter();
        let out =
            run_job(&mut engine, &tracks, "en", small(), reporter, Arc::new(AtomicBool::new(false))).unwrap();
        let got: Vec<(&str, &str)> = out
            .segments
            .iter()
            .map(|s| (s.speaker.as_deref().unwrap(), s.text.as_str()))
            .collect();
        assert_eq!(
            got,
            vec![("others", "Shall we start with the budget numbers?"), ("me", "Yes, let me share my screen.")]
        );
    }

    #[test]
    fn a_cancel_in_the_second_track_cancels_the_job() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("mic.wav");
        let b = dir.path().join("system.wav");
        write_wav(&a, &speech(5.0, 0.3));
        write_wav(&b, &speech(5.0, 0.3));
        let mut engine = FakeEngine::new();
        engine.cancel_on_call = Some(1);
        let tracks = vec![
            TrackInput { speaker: Some(SPEAKER_ME), path: a },
            TrackInput { speaker: Some(SPEAKER_OTHERS), path: b },
        ];
        let (_, reporter) = recording_reporter();
        let cancel = Arc::new(AtomicBool::new(false));
        let err = run_job(&mut engine, &tracks, "en", small(), reporter, cancel.clone()).unwrap_err();
        assert_eq!(err, CANCELLED);
        assert!(cancel.load(Ordering::Relaxed));
    }

    #[test]
    fn a_job_cancelled_before_it_starts_never_reaches_the_model() {
        let mut engine = FakeEngine::new();
        let (_, reporter) = recording_reporter();
        let err = run_job(
            &mut engine,
            &plain(&fixture("tone.wav")),
            "en",
            small(),
            reporter,
            Arc::new(AtomicBool::new(true)),
        )
        .unwrap_err();
        assert_eq!(err, "Transcription cancelled");
        assert_eq!(*engine.prepared.lock().unwrap(), 0);
    }

    #[test]
    fn decode_errors_and_empty_jobs_are_errors() {
        let dir = tempfile::tempdir().unwrap();
        let garbage = dir.path().join("x.wav");
        std::fs::write(&garbage, b"not audio").unwrap();
        let mut engine = FakeEngine::new();
        let (_, reporter) = recording_reporter();
        let cancel = Arc::new(AtomicBool::new(false));
        assert!(run_job(&mut engine, &plain(&garbage), "en", small(), reporter.clone(), cancel.clone()).is_err());
        assert_eq!(
            run_job(&mut engine, &[], "en", small(), reporter, cancel).unwrap_err(),
            "No audio to transcribe"
        );
        assert_eq!(*engine.prepared.lock().unwrap(), 0);
    }
}
