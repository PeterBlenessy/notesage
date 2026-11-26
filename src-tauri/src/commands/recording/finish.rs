//! Everything `stop_recording` does after the capture thread has let go:
//! check the files, mix the two tracks of a "both" recording, compress, and
//! describe the result.
//!
//! The encoder is a parameter, so the whole stop path (including the rules
//! about which file survives) runs in tests on any platform.

use super::encode::EncodeOutcome;
use super::mix::mix_tracks;
use super::monitor::{Role, SILENCE_THRESHOLD};
use super::owner::CaptureOutcome;
use super::types::{RecordingResult, Source, TrackPeaks, TrackRef};
use super::wav::repair_wav_header;
use std::path::{Path, PathBuf};

/// Tracks whose clocks disagree by more than this get a `drift` warning.
const DRIFT_WARNING_MS: i64 = 100;

/// `encode(wav, duration_secs, sample_rate)`.
pub type Encoder<'a> = &'a (dyn Fn(&Path, f64, u32) -> EncodeOutcome + Sync);

struct Usable {
    role: Role,
    path: PathBuf,
    frames: u64,
    sample_rate: u32,
    peak: f32,
    rms: f32,
    drift_ms: Option<i64>,
}

impl Usable {
    fn secs(&self) -> f64 {
        if self.sample_rate == 0 {
            0.0
        } else {
            self.frames as f64 / self.sample_rate as f64
        }
    }
}

fn file_label(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Turn what the capture thread left into the `stop_recording` result.
///
/// Durations and sample rates are read back from the files (their headers
/// are repaired from the file length if need be), so the result describes
/// what is on disk whatever happened on the way there.
///
/// Fails only when no track is a readable WAV. The bundle is left in place
/// in that case: recovery gets another go at it on the next launch.
pub fn finish_recording(
    source: Source,
    bundle_dir: &Path,
    outcome: CaptureOutcome,
    timed_out: bool,
    encode: Encoder<'_>,
) -> Result<RecordingResult, String> {
    let mut warnings: Vec<String> = Vec::new();
    if timed_out {
        warnings.push("stop-timeout".into());
    }
    let mut dropped_frames = 0u64;
    let mut usable: Vec<Usable> = Vec::new();
    let mut last_error = String::from("the audio thread reported no tracks");

    for track in &outcome.tracks {
        dropped_frames += track.totals.dropped_frames;
        if let Some(e) = &track.totals.write_error {
            warnings.push(format!("write-error: {}", e));
        }
        // The file is the truth. This also retries a header the capture
        // thread could not patch.
        match repair_wav_header(&track.path) {
            Ok(info) => usable.push(Usable {
                role: track.role,
                path: track.path.clone(),
                frames: info.frames(),
                sample_rate: info.sample_rate,
                peak: track.totals.peak,
                rms: track.totals.rms,
                drift_ms: track.drift_ms,
            }),
            Err(e) => {
                log::error!(target: "notesage::recording", "Unusable track {}: {}", track.path.display(), e);
                warnings.push(format!("track-unreadable: {}", track.role.as_str()));
                last_error = match &track.totals.finalize {
                    Err(finalize) => format!("{} ({})", e, finalize),
                    Ok(()) => e,
                };
            }
        }
    }
    if usable.is_empty() {
        return Err(format!("Recording could not be finalised: {}", last_error));
    }

    let peak_of = |role: Role| usable.iter().find(|t| t.role == role).map(|t| t.peak);
    let track_peaks = TrackPeaks { mic: peak_of(Role::Mic), system: peak_of(Role::System) };
    for t in &usable {
        if t.frames > 0 && t.peak < SILENCE_THRESHOLD {
            warnings.push(format!("{}-silent", t.role.as_str()));
        }
    }
    if dropped_frames > 0 {
        warnings.push(format!("dropped-frames: {}", dropped_frames));
    }
    if let [a, b] = usable.as_slice() {
        if let (Some(da), Some(db)) = (a.drift_ms, b.drift_ms) {
            if (da - db).abs() > DRIFT_WARNING_MS {
                warnings.push(format!(
                    "drift: {}={:+}ms {}={:+}ms",
                    a.role.as_str(),
                    da,
                    b.role.as_str(),
                    db
                ));
            }
        }
    }
    warnings.extend(outcome.warnings.iter().cloned());

    // --- The primary audio, and the separate tracks if there are two. ---
    let peak = usable.iter().fold(0.0f32, |p, t| p.max(t.peak));
    let rms = usable
        .iter()
        .find(|t| t.role == Role::Mic)
        .or(usable.first())
        .map_or(0.0, |t| t.rms);
    let audio_wav = bundle_dir.join("audio.wav");
    // (path, seconds, sample rate) of every WAV to compress; the first is the
    // primary audio.
    let mut files: Vec<(PathBuf, f64, u32)> = Vec::new();
    let mut track_files: Vec<(Role, usize)> = Vec::new();

    if source == Source::Both && usable.len() == 2 {
        let (first, second) = (&usable[0], &usable[1]);
        match mix_tracks(&first.path, &second.path, &audio_wav) {
            Ok(mix) => {
                let secs = mix.frames as f64 / mix.sample_rate.max(1) as f64;
                files.push((audio_wav.clone(), secs, mix.sample_rate));
            }
            Err(e) => {
                // Both tracks are intact; only the convenience copy is missing.
                log::error!(target: "notesage::recording", "Mixing failed: {}", e);
                warnings.push(format!("mix-failed: {}", e));
                let _ = std::fs::remove_file(&audio_wav);
                match std::fs::copy(&first.path, &audio_wav) {
                    Ok(_) => files.push((audio_wav.clone(), first.secs(), first.sample_rate)),
                    Err(copy_err) => {
                        return Err(format!(
                            "Recording could not be finalised: {} ({})",
                            e, copy_err
                        ))
                    }
                }
            }
        }
        for t in &usable {
            track_files.push((t.role, files.len()));
            files.push((t.path.clone(), t.secs(), t.sample_rate));
        }
    } else {
        // One source, or "both" with only one readable track: that track is
        // the recording.
        let only = &usable[0];
        let mut path = only.path.clone();
        if path != audio_wav {
            match std::fs::rename(&path, &audio_wav) {
                Ok(()) => path = audio_wav.clone(),
                Err(e) => log::warn!(
                    target: "notesage::recording",
                    "Could not rename {} to audio.wav: {}", path.display(), e
                ),
            }
        }
        files.push((path, only.secs(), only.sample_rate));
    }

    let duration_secs = files.iter().map(|f| f.1).fold(0.0f64, f64::max);
    let sample_rate = files[0].2;

    // --- Compress, all files at once: this is the slow part of a stop. ---
    let encoded: Vec<EncodeOutcome> = std::thread::scope(|scope| {
        let handles: Vec<_> = files
            .iter()
            .map(|(path, secs, rate)| {
                let (secs, rate) = (*secs, *rate);
                scope.spawn(move || {
                    if secs > 0.0 {
                        encode(path, secs, rate)
                    } else {
                        // Nothing recorded: nothing to compress, nothing to warn about.
                        EncodeOutcome { path: path.clone(), encoded: false, warning: None }
                    }
                })
            })
            .collect();
        handles
            .into_iter()
            .zip(files.iter())
            .map(|(handle, (path, _, _))| {
                handle.join().unwrap_or_else(|_| EncodeOutcome {
                    path: path.clone(),
                    encoded: false,
                    warning: Some("the encoder panicked".into()),
                })
            })
            .collect()
    });
    for (result, (path, _, _)) in encoded.iter().zip(files.iter()) {
        if let Some(w) = &result.warning {
            log::warn!(target: "notesage::recording", "Keeping {} as WAV: {}", path.display(), w);
            warnings.push(format!("encode-failed: {}: {}", file_label(path), w));
        }
    }

    let audio_path = encoded[0].path.to_string_lossy().into_owned();
    let tracks = track_files
        .iter()
        .map(|(role, index)| TrackRef {
            role: role.as_str().to_string(),
            path: encoded[*index].path.to_string_lossy().into_owned(),
        })
        .collect();

    Ok(RecordingResult {
        bundle_dir: bundle_dir.to_string_lossy().into_owned(),
        audio_path: audio_path.clone(),
        tracks,
        duration_secs,
        peak,
        sample_rate,
        dropped_frames,
        warnings,
        path: audio_path,
        source: source.as_str().to_string(),
        rms,
        track_peaks,
    })
}

#[cfg(test)]
mod tests {
    use super::super::encode::encode_verified;
    use super::super::owner::TrackOutcome;
    use super::super::track::TrackTotals;
    use super::super::wav::{wav_header, WavReader, WavWriter};
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "notesage-finish-{}-{}-{:?}",
            tag,
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_wav(path: &Path, rate: u32, frames: usize, value: f32) {
        let mut w = WavWriter::create(path, rate, 1).unwrap();
        w.write_f32(&vec![value; frames]).unwrap();
        w.finalize().unwrap();
    }

    fn track(role: Role, path: &Path, frames: u64, rate: u32, peak: f32, drift: Option<i64>) -> TrackOutcome {
        TrackOutcome {
            role,
            path: path.to_path_buf(),
            totals: TrackTotals {
                frames,
                sample_rate: rate,
                peak,
                rms: peak / 2.0,
                dropped_frames: 0,
                write_error: None,
                finalize: Ok(()),
            },
            drift_ms: drift,
        }
    }

    fn keep_wav(path: &Path, _: f64, _: u32) -> EncodeOutcome {
        EncodeOutcome { path: path.to_path_buf(), encoded: false, warning: None }
    }

    /// Stands in for afconvert: "encodes" by copying, verified like the real one.
    fn fake_aac(path: &Path, secs: f64, _: u32) -> EncodeOutcome {
        encode_verified(
            path,
            secs,
            &|input, output| std::fs::copy(input, output).map(|_| ()).map_err(|e| e.to_string()),
            &|_| Some(secs),
        )
    }

    #[test]
    fn single_source_result_is_the_audio_file_with_no_tracks() {
        let dir = temp_dir("single");
        let audio = dir.join("audio.wav");
        write_wav(&audio, 48_000, 96_000, 0.4);
        let outcome = CaptureOutcome {
            tracks: vec![track(Role::Mic, &audio, 96_000, 48_000, 0.4, Some(3))],
            warnings: vec![],
        };
        let r = finish_recording(Source::Microphone, &dir, outcome, false, &keep_wav).unwrap();
        assert_eq!(r.bundle_dir, dir.to_string_lossy());
        assert_eq!(r.audio_path, audio.to_string_lossy());
        assert_eq!(r.path, r.audio_path);
        assert!(r.tracks.is_empty(), "one source is not labelled as a speaker");
        assert_eq!(r.duration_secs, 2.0);
        assert_eq!(r.sample_rate, 48_000);
        assert_eq!(r.source, "microphone");
        assert!((r.peak - 0.4).abs() < 1e-6);
        assert_eq!(r.track_peaks, TrackPeaks { mic: Some(0.4), system: None });
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
        assert_eq!(r.dropped_frames, 0);
    }

    /// C2: the reported duration is what is in the FILE, even if the capture
    /// thread believed it had recorded more.
    #[test]
    fn duration_comes_from_the_file_not_from_what_was_captured() {
        let dir = temp_dir("truth");
        let audio = dir.join("audio.wav");
        write_wav(&audio, 48_000, 48_000, 0.4);
        let mut t = track(Role::Mic, &audio, 480_000, 48_000, 0.4, None);
        t.totals.write_error = Some("Failed to write WAV samples: No space left on device".into());
        t.totals.dropped_frames = 77;
        let outcome = CaptureOutcome { tracks: vec![t], warnings: vec!["stopped-early: mic: disk".into()] };
        let r = finish_recording(Source::Microphone, &dir, outcome, false, &keep_wav).unwrap();
        assert_eq!(r.duration_secs, 1.0);
        assert_eq!(r.dropped_frames, 77);
        assert!(r.warnings.iter().any(|w| w.starts_with("write-error: ")), "{:?}", r.warnings);
        assert!(r.warnings.contains(&"dropped-frames: 77".to_string()));
        assert!(r.warnings.contains(&"stopped-early: mic: disk".to_string()));
    }

    /// N1: "both" yields the mix as `audio`, and the two sources as tracks.
    #[test]
    fn both_sources_are_mixed_and_returned_as_tracks() {
        let dir = temp_dir("both");
        let mic = dir.join("mic.wav");
        let system = dir.join("system.wav");
        write_wav(&mic, 48_000, 48_000, 0.3);
        write_wav(&system, 44_100, 88_200, 0.2);
        let outcome = CaptureOutcome {
            tracks: vec![
                track(Role::Mic, &mic, 48_000, 48_000, 0.3, Some(5)),
                track(Role::System, &system, 88_200, 44_100, 0.2, Some(-20)),
            ],
            warnings: vec![],
        };
        let r = finish_recording(Source::Both, &dir, outcome, false, &keep_wav).unwrap();
        assert_eq!(r.audio_path, dir.join("audio.wav").to_string_lossy());
        assert_eq!(
            r.tracks,
            vec![
                TrackRef { role: "mic".into(), path: mic.to_string_lossy().into_owned() },
                TrackRef { role: "system".into(), path: system.to_string_lossy().into_owned() },
            ]
        );
        assert_eq!(r.sample_rate, 48_000, "the mix is at the microphone's rate");
        assert!((r.duration_secs - 2.0).abs() < 0.001, "the longer track: {}", r.duration_secs);
        assert_eq!(r.track_peaks, TrackPeaks { mic: Some(0.3), system: Some(0.2) });
        assert!(r.warnings.is_empty(), "25 ms apart is not worth a warning: {:?}", r.warnings);
        let mix = WavReader::open(&dir.join("audio.wav")).unwrap();
        assert!((mix.frames_left() as i64 - 96_000).abs() <= 2);
    }

    #[test]
    fn silence_drift_and_timeout_become_warning_codes() {
        let dir = temp_dir("warn");
        let mic = dir.join("mic.wav");
        let system = dir.join("system.wav");
        write_wav(&mic, 48_000, 4800, 0.3);
        write_wav(&system, 48_000, 4800, 0.0);
        let outcome = CaptureOutcome {
            tracks: vec![
                track(Role::Mic, &mic, 4800, 48_000, 0.3, Some(40)),
                track(Role::System, &system, 4800, 48_000, 0.0, Some(-300)),
            ],
            warnings: vec!["device-changed".into()],
        };
        let r = finish_recording(Source::Both, &dir, outcome, true, &keep_wav).unwrap();
        assert_eq!(
            r.warnings,
            vec!["stop-timeout", "system-silent", "drift: mic=+40ms system=-300ms", "device-changed"]
        );
    }

    /// S2: every WAV is replaced by its verified .m4a, and the result points
    /// at the files that now exist.
    #[test]
    fn verified_encodes_replace_all_three_wavs() {
        let dir = temp_dir("enc");
        let mic = dir.join("mic.wav");
        let system = dir.join("system.wav");
        write_wav(&mic, 48_000, 4800, 0.3);
        write_wav(&system, 48_000, 4800, 0.2);
        let outcome = CaptureOutcome {
            tracks: vec![
                track(Role::Mic, &mic, 4800, 48_000, 0.3, None),
                track(Role::System, &system, 4800, 48_000, 0.2, None),
            ],
            warnings: vec![],
        };
        let r = finish_recording(Source::Both, &dir, outcome, false, &fake_aac).unwrap();
        assert_eq!(r.audio_path, dir.join("audio.m4a").to_string_lossy());
        assert_eq!(r.tracks[0].path, dir.join("mic.m4a").to_string_lossy());
        assert_eq!(r.tracks[1].path, dir.join("system.m4a").to_string_lossy());
        for stem in ["audio", "mic", "system"] {
            assert!(dir.join(format!("{stem}.m4a")).is_file());
            assert!(!dir.join(format!("{stem}.wav")).exists());
        }
        assert!(r.warnings.is_empty());
    }

    /// Never lose audio: a failed encode keeps that WAV, says so, and does
    /// not affect the other files.
    #[test]
    fn a_failed_encode_keeps_that_wav_and_is_reported() {
        let dir = temp_dir("encfail");
        let mic = dir.join("mic.wav");
        let system = dir.join("system.wav");
        write_wav(&mic, 48_000, 4800, 0.3);
        write_wav(&system, 48_000, 4800, 0.2);
        let outcome = CaptureOutcome {
            tracks: vec![
                track(Role::Mic, &mic, 4800, 48_000, 0.3, None),
                track(Role::System, &system, 4800, 48_000, 0.2, None),
            ],
            warnings: vec![],
        };
        let flaky = |path: &Path, secs: f64, rate: u32| {
            if path.file_name().is_some_and(|n| n == "mic.wav") {
                EncodeOutcome { path: path.to_path_buf(), encoded: false, warning: Some("afconvert exited with 1".into()) }
            } else {
                fake_aac(path, secs, rate)
            }
        };
        let r = finish_recording(Source::Both, &dir, outcome, false, &flaky).unwrap();
        assert_eq!(r.audio_path, dir.join("audio.m4a").to_string_lossy());
        assert_eq!(r.tracks[0].path, mic.to_string_lossy(), "the WAV is what is returned");
        assert!(mic.is_file());
        assert_eq!(r.tracks[1].path, dir.join("system.m4a").to_string_lossy());
        assert_eq!(r.warnings, vec!["encode-failed: mic.wav: afconvert exited with 1"]);
    }

    /// A header the capture thread could not patch is repaired here instead
    /// of failing the stop.
    #[test]
    fn an_unfinalised_header_is_repaired_rather_than_failing_the_stop() {
        let dir = temp_dir("repair");
        let audio = dir.join("audio.wav");
        let mut bytes = wav_header(48_000, 1, 0).to_vec();
        bytes.extend(vec![0u8; 96_000]);
        std::fs::write(&audio, bytes).unwrap();
        let mut t = track(Role::Mic, &audio, 0, 48_000, 0.5, None);
        t.totals.finalize = Err("WAV header update failed: boom".into());
        let r = finish_recording(
            Source::Microphone,
            &dir,
            CaptureOutcome { tracks: vec![t], warnings: vec![] },
            false,
            &keep_wav,
        )
        .unwrap();
        assert_eq!(r.duration_secs, 1.0);
        assert_eq!(WavReader::open(&audio).unwrap().frames_left(), 48_000);
    }

    /// A file that is not a WAV at all must not be handed to transcription:
    /// the stop fails, and nothing is deleted.
    #[test]
    fn a_corrupt_file_fails_the_stop_and_stays_on_disk() {
        let dir = temp_dir("corrupt");
        let audio = dir.join("audio.wav");
        std::fs::write(&audio, vec![3u8; 500]).unwrap();
        let mut t = track(Role::Mic, &audio, 0, 48_000, 0.5, None);
        t.totals.finalize = Err("WAV header update failed: boom".into());
        let err = finish_recording(
            Source::Microphone,
            &dir,
            CaptureOutcome { tracks: vec![t], warnings: vec![] },
            false,
            &keep_wav,
        )
        .unwrap_err();
        assert!(err.starts_with("Recording could not be finalised: "), "{err}");
        assert!(err.contains("boom"), "{err}");
        assert_eq!(std::fs::read(&audio).unwrap(), vec![3u8; 500]);

        let err = finish_recording(Source::Microphone, &dir, CaptureOutcome::default(), false, &keep_wav)
            .unwrap_err();
        assert!(err.starts_with("Recording could not be finalised: "), "{err}");
    }

    /// "both" where one track is unreadable: the other still becomes the
    /// recording, flagged, rather than the whole meeting being refused.
    #[test]
    fn both_with_one_unreadable_track_falls_back_to_the_other() {
        let dir = temp_dir("oneleft");
        let mic = dir.join("mic.wav");
        let system = dir.join("system.wav");
        write_wav(&mic, 48_000, 48_000, 0.3);
        std::fs::write(&system, b"garbage").unwrap();
        let outcome = CaptureOutcome {
            tracks: vec![
                track(Role::Mic, &mic, 48_000, 48_000, 0.3, None),
                track(Role::System, &system, 0, 48_000, 0.0, None),
            ],
            warnings: vec![],
        };
        let r = finish_recording(Source::Both, &dir, outcome, false, &keep_wav).unwrap();
        assert_eq!(r.audio_path, dir.join("audio.wav").to_string_lossy());
        assert!(dir.join("audio.wav").is_file() && !mic.exists(), "the lone track is renamed");
        assert!(r.tracks.is_empty());
        assert_eq!(r.duration_secs, 1.0);
        assert_eq!(r.warnings, vec!["track-unreadable: system"]);
        assert_eq!(std::fs::read(&system).unwrap(), b"garbage", "left for inspection");
    }

    #[test]
    fn an_empty_recording_is_returned_with_zero_duration_and_not_encoded() {
        let dir = temp_dir("empty");
        let audio = dir.join("audio.wav");
        write_wav(&audio, 48_000, 0, 0.0);
        let outcome = CaptureOutcome { tracks: vec![track(Role::Mic, &audio, 0, 48_000, 0.0, None)], warnings: vec![] };
        let never = |_: &Path, _: f64, _: u32| -> EncodeOutcome { panic!("must not encode an empty file") };
        let r = finish_recording(Source::Microphone, &dir, outcome, false, &never).unwrap();
        assert_eq!(r.duration_secs, 0.0);
        assert_eq!(r.audio_path, audio.to_string_lossy());
        assert!(r.warnings.is_empty(), "an empty file is not 'silent': {:?}", r.warnings);
    }
}
