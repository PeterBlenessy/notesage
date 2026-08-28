//! Decode an audio file to interleaved f32 samples for transcription (#803).
//!
//! Replaces a hand-rolled RIFF parser that accepted 16-bit PCM WAV and nothing
//! else. That was invisible for as long as the only file ever transcribed was
//! one `start_recording` had just written — the app produced exactly the one
//! format it could read. It stops being invisible the moment a user drops in a
//! Voice Memo, which is `.m4a`.
//!
//! # Why symphonia is the primary and CoreAudio only the fallback
//!
//! `transcription.rs` carries no `target_os` gate. The backend has plenty of
//! them, but each sits where the *capability* is platform-specific — Seatbelt
//! profiles, the NSColor accent bridge, iCloud xattr. Decoding an MP3 is not
//! in that category, so making the audio path Apple-only would be a
//! portability loss taken for nothing.
//!
//! It is also the difference between a function over bytes, testable with
//! fixtures anywhere, and a call into a live AVFoundation runtime. Given the
//! decoder is the point at which a recording becomes numbers, that is the last
//! place to give up on tests.
//!
//! # Why there is a fallback at all
//!
//! Two gaps in symphonia are known rather than suspected:
//!
//! - **Opus.** symphonia ships `ogg` (container) and `vorbis` (codec), but no
//!   Opus — and most modern `.ogg` is Opus. Share-to-Inbox saves `.ogg`.
//! - **AAC.** Its decoder is less battle-tested than Apple's, and `.m4a` is
//!   the single likeliest input.
//!
//! On macOS, CoreAudio catches both. Elsewhere symphonia stands alone, which
//! is correct: the fallback covers a decoder gap, it is not the design.
//!
//! Which one actually ran is reported back to the caller rather than logged
//! and forgotten, because "how often is the fallback load-bearing" is a real
//! question with a real answer, and guessing at it is how the ordering here
//! would silently become wrong.

use std::path::Path;

/// Decoded audio, in the shape `resample_to_16k_mono` already consumes.
///
/// `Debug` prints the sample COUNT, never the samples: a decode failure dump
/// carrying a few hundred thousand floats is unreadable, and the count plus
/// the format is what actually diagnoses one.
pub struct Decoded {
    /// Interleaved samples, nominally in [-1.0, 1.0].
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
    /// Which decoder produced this. Rides out through `TranscriptionResult`
    /// so the frontend can report it as telemetry — the fallback is only
    /// worth keeping if we can see whether it fires.
    pub decoder: Decoder,
}

impl std::fmt::Debug for Decoded {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Decoded")
            .field("samples", &self.samples.len())
            .field("sample_rate", &self.sample_rate)
            .field("channels", &self.channels)
            .field("decoder", &self.decoder)
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Decoder {
    Symphonia,
    CoreAudio,
}

impl Decoder {
    pub fn as_str(self) -> &'static str {
        match self {
            Decoder::Symphonia => "symphonia",
            Decoder::CoreAudio => "coreaudio",
        }
    }
}

/// Decode `path`, preferring symphonia and falling back to CoreAudio on macOS.
pub fn decode_audio_f32(path: &Path) -> Result<Decoded, String> {
    let primary = match decode_with_symphonia(path) {
        Ok(decoded) => return Ok(decoded),
        Err(e) => e,
    };

    #[cfg(target_os = "macos")]
    {
        match coreaudio::decode(path) {
            Ok(decoded) => {
                log::info!(
                    target: "notesage::transcription",
                    "symphonia declined {} ({primary}); CoreAudio decoded it",
                    path.display()
                );
                return Ok(decoded);
            }
            // Report the PRIMARY error, not the fallback's. The fallback ran
            // only because the primary failed, and its complaint about a file
            // it was never meant to handle is the less informative of the two.
            Err(fallback) => {
                return Err(format!("{primary} (CoreAudio also failed: {fallback})"))
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    Err(primary)
}

fn decode_with_symphonia(path: &Path) -> Result<Decoded, String> {
    use symphonia::core::codecs::audio::AudioDecoderOptions;
    use symphonia::core::formats::probe::Hint;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;

    let file = std::fs::File::open(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());

    // The extension is a HINT, never the decision — symphonia probes the
    // bytes. A `.wav` that is really an MP3 (which download-and-rename
    // produces routinely) decodes correctly rather than being rejected for
    // failing a magic-number check on the name it happens to carry.
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let mut format = symphonia::default::get_probe()
        .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| format!("Unrecognised audio format: {e}"))?;

    let track = format
        .default_track(symphonia::core::formats::TrackType::Audio)
        .ok_or("File contains no audio track")?;
    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or("Audio track has no codec parameters")?
        .clone();

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(|e| format!("Unsupported audio codec: {e}"))?;

    let mut samples: Vec<f32> = Vec::new();
    let mut sample_rate = params.sample_rate.unwrap_or(16_000);
    let mut channels = params.channels.as_ref().map(|c| c.count() as u16).unwrap_or(1);

    loop {
        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            // A truncated file still holds everything decoded up to the tear.
            // Whisper can transcribe that; refusing it because the tail is
            // missing loses a recording that is mostly intact.
            Err(_) => break,
        };
        if packet.track_id != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let spec = decoded.spec();
        sample_rate = spec.rate();
        channels = spec.channels().count() as u16;

        // Every codec is normalised to interleaved f32 here rather than at the
        // call site: sample format is a property of the codec (FLAC is
        // integer, AAC is float), and leaking that upward would put a match on
        // codec internals into the transcription pipeline. Interleaved because
        // that is what `resample_to_16k_mono` already consumes, and what the
        // CoreAudio path below produces — the caller never learns which ran.
        let mut chunk: Vec<f32> = Vec::new();
        decoded.copy_to_vec_interleaved(&mut chunk);
        samples.append(&mut chunk);
    }

    if samples.is_empty() {
        return Err("Audio file decoded to no samples".into());
    }

    Ok(Decoded { samples, sample_rate, channels, decoder: Decoder::Symphonia })
}

#[cfg(target_os = "macos")]
mod coreaudio {
    //! `AVAudioFile` reads anything CoreAudio can open and hands back
    //! deinterleaved float PCM, which is most of the work already done.
    use super::{Decoded, Decoder};
    use objc2::AllocAnyThread;
    use objc2_avf_audio::{AVAudioCommonFormat, AVAudioFile, AVAudioPCMBuffer};
    use objc2_foundation::{NSString, NSURL};
    use std::path::Path;

    pub fn decode(path: &Path) -> Result<Decoded, String> {
        let path_str = path.to_str().ok_or("Path is not valid UTF-8")?;
        unsafe {
            let url = NSURL::fileURLWithPath(&NSString::from_str(path_str));
            let file = AVAudioFile::initForReading_error(AVAudioFile::alloc(), &url)
                .map_err(|e| format!("CoreAudio could not open the file: {e:?}"))?;

            // `processingFormat` is what reads DECODE to, not what the file
            // stores — always float PCM, so no integer conversion here.
            let format = file.processingFormat();
            if format.commonFormat() != AVAudioCommonFormat::PCMFormatFloat32 {
                return Err("CoreAudio returned a non-float processing format".into());
            }
            let sample_rate = format.sampleRate() as u32;
            let channels = format.channelCount() as u16;

            let frames = file.length();
            if frames <= 0 {
                return Err("CoreAudio reported an empty file".into());
            }
            let capacity = u32::try_from(frames).map_err(|_| "Audio file is too long to decode")?;
            let buffer = AVAudioPCMBuffer::initWithPCMFormat_frameCapacity(
                AVAudioPCMBuffer::alloc(),
                &format,
                capacity,
            )
            .ok_or("Could not allocate a decode buffer")?;

            file.readIntoBuffer_error(&buffer)
                .map_err(|e| format!("CoreAudio could not decode the file: {e:?}"))?;

            let read = buffer.frameLength() as usize;
            let data = buffer.floatChannelData();
            if data.is_null() || read == 0 {
                return Err("CoreAudio decoded no samples".into());
            }

            // Deinterleaved planes in, interleaved out — matching what
            // symphonia produces, so the caller never learns which ran.
            let mut samples = Vec::with_capacity(read * channels as usize);
            for frame in 0..read {
                for ch in 0..channels as usize {
                    // `processingFormat` is the standard DEINTERLEAVED float
                    // format, so each channel is its own plane with stride 1 —
                    // the interleaving below is ours to do, matching what
                    // symphonia hands back.
                    let plane = (*data.add(ch)).as_ptr();
                    samples.push(*plane.add(frame));
                }
            }

            Ok(Decoded { samples, sample_rate, channels, decoder: Decoder::CoreAudio })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/audio").join(name)
    }

    /// Every fixture is the SAME 440 Hz tone, so one set of assertions covers
    /// all of them without needing a reference decoder: 0.4 s at 16 kHz mono,
    /// peaking near 0.4. Regenerate with `scripts/generate-audio-fixtures.sh`.
    fn assert_is_the_tone(d: &Decoded, tolerance_frames: usize) {
        assert_eq!(d.sample_rate, 16_000, "sample rate");
        assert_eq!(d.channels, 1, "channels");
        let expected = 6400;
        let diff = d.samples.len().abs_diff(expected);
        assert!(
            diff <= tolerance_frames,
            "expected ~{expected} samples, got {} (diff {diff})",
            d.samples.len()
        );
        let peak = d.samples.iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((0.2..0.6).contains(&peak), "peak {peak} is not a 0.4-amplitude tone");
    }

    #[test]
    fn decodes_plain_16_bit_wav() {
        // The format the recorder itself writes. Everything else here is new
        // capability; this one is the regression guard.
        let d = decode_audio_f32(&fixture("tone.wav")).expect("wav");
        assert_eq!(d.decoder, Decoder::Symphonia);
        assert_is_the_tone(&d, 0);
    }

    /// The format an iPhone Voice Memo actually is, and the whole reason #803
    /// exists — it failed outright with "Not a valid WAV file" before.
    #[test]
    fn decodes_aac_in_an_mp4_container() {
        let d = decode_audio_f32(&fixture("tone.m4a")).expect("m4a");
        // AAC is lossy and its encoder pads: allow a frame or two of drift,
        // but not a wholesale mismatch that would mean the wrong track.
        assert_is_the_tone(&d, 3000);
    }

    #[test]
    fn decodes_core_audio_format() {
        let d = decode_audio_f32(&fixture("tone.caf")).expect("caf");
        assert_is_the_tone(&d, 128);
    }

    /// The extension is a hint to the prober, never the decision. A file
    /// misnamed by a download is common enough that rejecting it on the name
    /// would be a real failure, and the old parser did exactly that — it
    /// checked for `RIFF` magic and gave up.
    #[test]
    fn decodes_by_content_not_by_extension() {
        let dir = std::env::temp_dir().join("notesage-audio-decode-misnamed");
        std::fs::create_dir_all(&dir).unwrap();
        let misnamed = dir.join("actually-aac.wav");
        std::fs::copy(fixture("tone.m4a"), &misnamed).unwrap();

        let d = decode_audio_f32(&misnamed).expect("an AAC file named .wav must still decode");
        assert_is_the_tone(&d, 3000);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reports_a_useful_error_for_a_file_that_is_not_audio() {
        let dir = std::env::temp_dir().join("notesage-audio-decode-garbage");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("not-audio.mp3");
        std::fs::write(&path, b"this is not audio, it is prose about audio").unwrap();

        let err = decode_audio_f32(&path).expect_err("garbage must not decode");
        // The old message named a format the user never chose ("Not a valid
        // WAV file" for an .mp3), which sent people looking in the wrong
        // place. Anything but that.
        assert!(!err.contains("Not a valid WAV file"), "stale WAV-specific error: {err}");
        assert!(!err.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reports_an_error_for_a_missing_file() {
        let err = decode_audio_f32(&fixture("does-not-exist.wav")).expect_err("missing file");
        assert!(!err.is_empty());
    }
}
