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
#[cfg_attr(not(test), allow(dead_code))]
pub struct Decoded {
    /// Interleaved samples, nominally in [-1.0, 1.0].
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
    /// Which decoder produced this. Logged by `transcribe_file` — the
    /// fallback is only worth keeping if we can see whether it fires.
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
    // Only constructed by the macOS fallback.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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

/// Decode `path` WHOLE, preferring symphonia and falling back to CoreAudio on
/// macOS.
///
/// Holds the entire file as native-rate interleaved f32 (1.4 GB for an hour
/// of 48 kHz stereo). Transcription and import do not use it any more: they
/// go through [`decode_stream_16k`], which never holds more than a packet.
/// It remains for short buffers and the fixtures below.
#[cfg_attr(not(test), allow(dead_code))]
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

#[cfg_attr(not(test), allow(dead_code))]
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

// ---------------------------------------------------------------------------
// Streaming decode: straight to 16 kHz mono, a packet at a time
// ---------------------------------------------------------------------------

/// What a streaming decode found out about the file.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StreamInfo {
    pub decoder: Decoder,
    /// The file's own sample rate and channel count.
    pub sample_rate: u32,
    pub channels: u16,
    /// 16 kHz mono samples handed to the sink.
    pub samples_out: u64,
}

/// Receives 16 kHz mono samples and how far through the file the decoder is
/// (0..=1). Returning `Err` stops the decode and is returned to the caller
/// unchanged (this is how a cancel gets out).
pub type Sink16k<'a> = dyn FnMut(&[f32], f64) -> Result<(), String> + 'a;

/// A `File` that reports how far it has been read, so a decode can say how
/// far along it is for any container without knowing its duration.
struct CountingFile {
    file: std::fs::File,
    len: u64,
    position: std::sync::Arc<std::sync::atomic::AtomicU64>,
}

impl std::io::Read for CountingFile {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.file.read(buf)?;
        self.position.fetch_add(n as u64, std::sync::atomic::Ordering::Relaxed);
        Ok(n)
    }
}

impl std::io::Seek for CountingFile {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        let at = self.file.seek(pos)?;
        self.position.store(at, std::sync::atomic::Ordering::Relaxed);
        Ok(at)
    }
}

impl symphonia::core::io::MediaSource for CountingFile {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.len)
    }
}

/// Downmixes and resamples blocks of interleaved audio on their way to a sink.
struct To16k {
    resampler: Option<crate::commands::transcribe::resample::StreamResampler>,
    mono: Vec<f32>,
    out: Vec<f32>,
    samples_out: u64,
    sample_rate: u32,
    channels: u16,
}

impl To16k {
    fn new() -> Self {
        Self {
            resampler: None,
            mono: Vec::new(),
            out: Vec::new(),
            samples_out: 0,
            sample_rate: 0,
            channels: 0,
        }
    }

    fn feed(
        &mut self,
        interleaved: &[f32],
        sample_rate: u32,
        channels: u16,
        fraction: f64,
        sink: &mut Sink16k<'_>,
    ) -> Result<(), String> {
        use crate::commands::transcribe::resample::{downmix_into, StreamResampler};
        if interleaved.is_empty() {
            return Ok(());
        }
        self.out.clear();
        // A stream may change rate part-way (chained files); finish the old
        // filter and start a new one rather than mis-timing what follows.
        if self.resampler.as_ref().map(|r| r.from_rate()) != Some(sample_rate.max(1)) {
            if let Some(mut old) = self.resampler.take() {
                old.flush(&mut self.out);
            }
            self.resampler = Some(StreamResampler::new(sample_rate));
        }
        self.sample_rate = sample_rate;
        self.channels = channels;
        self.mono.clear();
        downmix_into(interleaved, channels, &mut self.mono);
        if let Some(r) = self.resampler.as_mut() {
            r.process(&self.mono, &mut self.out);
        }
        self.emit(fraction, sink)
    }

    fn finish(&mut self, sink: &mut Sink16k<'_>) -> Result<(), String> {
        self.out.clear();
        if let Some(mut r) = self.resampler.take() {
            r.flush(&mut self.out);
        }
        self.emit(1.0, sink)
    }

    fn emit(&mut self, fraction: f64, sink: &mut Sink16k<'_>) -> Result<(), String> {
        if self.out.is_empty() {
            return Ok(());
        }
        self.samples_out += self.out.len() as u64;
        sink(&self.out, fraction)
    }
}

/// Why a streaming decoder stopped early.
enum StreamStop {
    /// The decoder could not read the file. `started` says whether any audio
    /// had already reached the sink (then another decoder must not be tried:
    /// the sink would receive the beginning twice).
    Decoder { message: String, started: bool },
    /// The sink refused (cancel, write error). Passed through as is.
    Sink(String),
}

/// Decode `path` to 16 kHz mono, handing it to `sink` block by block.
///
/// Symphonia first; on macOS, CoreAudio when symphonia cannot open the file
/// at all. Nothing but the current packet and the resampler's short history
/// is held here, so memory does not depend on the length of the file.
pub fn decode_stream_16k(path: &Path, sink: &mut Sink16k<'_>) -> Result<StreamInfo, String> {
    let primary = match stream_with_symphonia(path, sink) {
        Ok(info) => return Ok(info),
        Err(StreamStop::Sink(e)) => return Err(e),
        Err(StreamStop::Decoder { message, started: true }) => return Err(message),
        Err(StreamStop::Decoder { message, started: false }) => message,
    };

    #[cfg(target_os = "macos")]
    {
        let mut to16k = To16k::new();
        let mut sink_error: Option<String> = None;
        let outcome = coreaudio::decode_blocks(path, &mut |block, rate, channels, fraction| {
            to16k.feed(block, rate, channels, fraction, sink).map_err(|e| {
                sink_error = Some(e.clone());
                e
            })
        });
        if let Some(e) = sink_error {
            return Err(e);
        }
        match outcome {
            Ok(()) => {
                to16k.finish(sink)?;
                if to16k.samples_out == 0 {
                    return Err("Audio file decoded to no samples".into());
                }
                log::info!(
                    target: "notesage::transcription",
                    "symphonia declined {} ({primary}); CoreAudio decoded it",
                    path.display()
                );
                return Ok(StreamInfo {
                    decoder: Decoder::CoreAudio,
                    sample_rate: to16k.sample_rate,
                    channels: to16k.channels,
                    samples_out: to16k.samples_out,
                });
            }
            Err(fallback) => return Err(format!("{primary} (CoreAudio also failed: {fallback})")),
        }
    }

    #[cfg(not(target_os = "macos"))]
    Err(primary)
}

/// A symphonia reader positioned at the first packet of the audio track.
struct OpenAudio {
    format: Box<dyn symphonia::core::formats::FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::audio::AudioDecoder>,
    track_id: u32,
    sample_rate: Option<u32>,
    channels: Option<u16>,
    num_frames: Option<u64>,
    position: std::sync::Arc<std::sync::atomic::AtomicU64>,
    len: u64,
}

fn open_with_symphonia(path: &Path) -> Result<OpenAudio, String> {
    use symphonia::core::codecs::audio::AudioDecoderOptions;
    use symphonia::core::formats::probe::Hint;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;

    let file =
        std::fs::File::open(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let position = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let source = CountingFile { file, len, position: position.clone() };
    let stream = MediaSourceStream::new(Box::new(source), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let format = symphonia::default::get_probe()
        .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| format!("Unrecognised audio format: {e}"))?;

    let track = format
        .default_track(symphonia::core::formats::TrackType::Audio)
        .ok_or(NO_AUDIO_TRACK)?;
    let track_id = track.id;
    let num_frames = track.num_frames;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or("Audio track has no codec parameters")?
        .clone();

    let decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(|e| format!("Unsupported audio codec: {e}"))?;

    Ok(OpenAudio {
        format,
        decoder,
        track_id,
        sample_rate: params.sample_rate,
        channels: params.channels.as_ref().map(|c| c.count() as u16),
        num_frames,
        position,
        len,
    })
}

/// The error for a container that opened but holds no audio (a screen
/// recording without sound). `import_media` matches on it.
pub const NO_AUDIO_TRACK: &str = "File contains no audio track";

/// What can be learned about a file's audio without decoding it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AudioProbe {
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    /// From the container's frame count; `None` when it does not say.
    pub duration_secs: Option<f64>,
}

/// Open `path` far enough to know it has decodable audio (symphonia only).
pub fn probe_audio(path: &Path) -> Result<AudioProbe, String> {
    let open = open_with_symphonia(path)?;
    let duration_secs = match (open.num_frames, open.sample_rate) {
        (Some(frames), Some(rate)) if rate > 0 && frames > 0 => Some(frames as f64 / rate as f64),
        _ => None,
    };
    Ok(AudioProbe { sample_rate: open.sample_rate, channels: open.channels, duration_secs })
}

fn stream_with_symphonia(path: &Path, sink: &mut Sink16k<'_>) -> Result<StreamInfo, StreamStop> {
    use std::sync::atomic::Ordering;

    let mut open = open_with_symphonia(path)
        .map_err(|message| StreamStop::Decoder { message, started: false })?;
    let mut to16k = To16k::new();
    let mut packet_samples: Vec<f32> = Vec::new();

    loop {
        let packet = match open.format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            // A truncated file still holds everything decoded up to the tear.
            Err(_) => break,
        };
        if packet.track_id != open.track_id {
            continue;
        }
        let decoded = match open.decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let spec = decoded.spec();
        let rate = spec.rate();
        let channels = spec.channels().count() as u16;
        // Resizes to this packet: the buffer is reused, not grown.
        decoded.copy_to_vec_interleaved(&mut packet_samples);

        let fraction = if open.len > 0 {
            (open.position.load(Ordering::Relaxed) as f64 / open.len as f64).min(1.0)
        } else {
            0.0
        };
        to16k
            .feed(&packet_samples, rate, channels, fraction, sink)
            .map_err(StreamStop::Sink)?;
    }

    to16k.finish(sink).map_err(StreamStop::Sink)?;
    if to16k.samples_out == 0 {
        return Err(StreamStop::Decoder {
            message: "Audio file decoded to no samples".into(),
            started: false,
        });
    }
    Ok(StreamInfo {
        decoder: Decoder::Symphonia,
        sample_rate: to16k.sample_rate,
        channels: to16k.channels,
        samples_out: to16k.samples_out,
    })
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

    /// Frames read per call: 32,768 frames of stereo float is 256 KB.
    const BLOCK_FRAMES: u32 = 32_768;

    /// Like [`decode`], but hands the audio over in blocks of interleaved
    /// samples `(samples, sample_rate, channels, fraction_done)` instead of
    /// allocating one buffer for the whole file.
    pub fn decode_blocks(
        path: &Path,
        on_block: &mut dyn FnMut(&[f32], u32, u16, f64) -> Result<(), String>,
    ) -> Result<(), String> {
        let path_str = path.to_str().ok_or("Path is not valid UTF-8")?;
        unsafe {
            let url = NSURL::fileURLWithPath(&NSString::from_str(path_str));
            let file = AVAudioFile::initForReading_error(AVAudioFile::alloc(), &url)
                .map_err(|e| format!("CoreAudio could not open the file: {e:?}"))?;

            let format = file.processingFormat();
            if format.commonFormat() != AVAudioCommonFormat::PCMFormatFloat32 {
                return Err("CoreAudio returned a non-float processing format".into());
            }
            let sample_rate = format.sampleRate() as u32;
            let channels = format.channelCount() as u16;

            let total = file.length();
            if total <= 0 {
                return Err("CoreAudio reported an empty file".into());
            }
            let buffer = AVAudioPCMBuffer::initWithPCMFormat_frameCapacity(
                AVAudioPCMBuffer::alloc(),
                &format,
                BLOCK_FRAMES,
            )
            .ok_or("Could not allocate a decode buffer")?;

            let mut interleaved: Vec<f32> =
                Vec::with_capacity(BLOCK_FRAMES as usize * channels.max(1) as usize);
            let mut done: i64 = 0;
            while done < total {
                if let Err(e) = file.readIntoBuffer_error(&buffer) {
                    // `length` is an estimate for some compressed formats; a
                    // failed read after real audio is the end of the file.
                    if done > 0 {
                        break;
                    }
                    return Err(format!("CoreAudio could not decode the file: {e:?}"));
                }
                let read = buffer.frameLength() as usize;
                if read == 0 {
                    break;
                }
                let data = buffer.floatChannelData();
                if data.is_null() {
                    return Err("CoreAudio decoded no samples".into());
                }
                interleaved.clear();
                for frame in 0..read {
                    for ch in 0..channels as usize {
                        let plane = (*data.add(ch)).as_ptr();
                        interleaved.push(*plane.add(frame));
                    }
                }
                done += read as i64;
                let fraction = (done as f64 / total as f64).min(1.0);
                on_block(&interleaved, sample_rate, channels, fraction)?;
            }
            if done == 0 {
                return Err("CoreAudio decoded no samples".into());
            }
            Ok(())
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

    /// The exact shape the phone's recorder writes (recordings PRD): AAC-LC,
    /// mono, 48 kHz, 64 kbps in an MP4 container. The Mac transcribes these
    /// without any new audio work, which this locks in — and records which
    /// decoder took it, so the #803 question keeps an answer in CI.
    #[test]
    fn decodes_the_phones_recording_shape() {
        let d = decode_audio_f32(&fixture("tone-phone-48k-mono-64k.m4a")).expect("phone m4a");
        assert_eq!(d.sample_rate, 48_000, "sample rate");
        assert_eq!(d.channels, 1, "channels");
        // 0.4 s at 48 kHz; AAC adds encoder priming, so a frame or two of slack.
        let expected = 19_200;
        let diff = d.samples.len().abs_diff(expected);
        assert!(diff <= 4096, "expected ~{expected} samples, got {} (diff {diff})", d.samples.len());
        let peak = d.samples.iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((0.2..0.6).contains(&peak), "peak {peak} is not a 0.4-amplitude tone");
        eprintln!("phone-shaped AAC decoded by {}", d.decoder.as_str());
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

    // --- streaming ---------------------------------------------------------

    type Collected = (Vec<f32>, StreamInfo, Vec<f64>, usize);

    fn collect_16k(path: &Path) -> Result<Collected, String> {
        let mut samples = Vec::new();
        let mut fractions = Vec::new();
        let mut largest = 0usize;
        let info = decode_stream_16k(path, &mut |block, fraction| {
            largest = largest.max(block.len());
            samples.extend_from_slice(block);
            fractions.push(fraction);
            Ok(())
        })?;
        Ok((samples, info, fractions, largest))
    }

    /// Amplitude of one frequency in a 16 kHz signal.
    fn amplitude_at(x: &[f32], freq: f64) -> f64 {
        let (mut re, mut im) = (0.0, 0.0);
        for (i, v) in x.iter().enumerate() {
            let ph = i as f64 * freq * std::f64::consts::TAU / 16_000.0;
            re += *v as f64 * ph.cos();
            im += *v as f64 * ph.sin();
        }
        2.0 * (re * re + im * im).sqrt() / x.len() as f64
    }

    #[test]
    fn streams_a_16k_wav_through_unchanged() {
        let (samples, info, fractions, _) = collect_16k(&fixture("tone.wav")).expect("wav");
        let whole = decode_audio_f32(&fixture("tone.wav")).unwrap();
        assert_eq!(samples, whole.samples, "16 kHz mono must pass straight through");
        assert_eq!(info.decoder, Decoder::Symphonia);
        assert_eq!((info.sample_rate, info.channels), (16_000, 1));
        assert_eq!(info.samples_out, 6400);
        assert!(fractions.windows(2).all(|w| w[0] <= w[1]), "file position went backwards");
        assert!(fractions.iter().all(|f| (0.0..=1.0).contains(f)));
    }

    /// The phone's recording shape: 48 kHz AAC comes out as the same 440 Hz
    /// tone at 16 kHz, a third as many samples.
    #[test]
    fn streams_48k_aac_down_to_16k() {
        let (samples, info, _, _) =
            collect_16k(&fixture("tone-phone-48k-mono-64k.m4a")).expect("phone m4a");
        assert_eq!(info.sample_rate, 48_000);
        assert!(samples.len().abs_diff(6400) <= 1400, "got {} samples", samples.len());
        assert_eq!(info.samples_out as usize, samples.len());
        let body = &samples[1600..samples.len() - 1600];
        let a = amplitude_at(body, 440.0);
        assert!((0.3..0.5).contains(&a), "440 Hz amplitude {a}");
    }

    #[test]
    fn streams_every_fixture_format() {
        for name in ["tone.m4a", "tone.caf"] {
            let (samples, info, _, _) = collect_16k(&fixture(name)).expect(name);
            assert!(samples.len().abs_diff(6400) <= 3000, "{name}: {} samples", samples.len());
            assert_eq!(info.samples_out as usize, samples.len());
        }
    }

    /// 16-bit PCM WAV bytes: `left` on the left channel, silence on any other.
    fn wav_bytes(rate: u32, channels: u16, left: impl Iterator<Item = i16>) -> Vec<u8> {
        let mut data = Vec::new();
        for v in left {
            data.extend_from_slice(&v.to_le_bytes());
            for _ in 1..channels {
                data.extend_from_slice(&0i16.to_le_bytes());
            }
        }
        let mut bytes = Vec::with_capacity(44 + data.len());
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&channels.to_le_bytes());
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
        bytes.extend_from_slice(&(channels * 2).to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&data);
        bytes
    }

    /// The point of streaming: a long file reaches the sink in small blocks.
    /// One minute of 48 kHz stereo is 5.76 M samples; no block handed over
    /// comes anywhere near that.
    #[test]
    fn a_long_stereo_file_arrives_in_small_blocks_as_mono_16k() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("long.wav");
        let rate = 48_000u32;
        let tone = (0..rate * 60).map(|i| {
            ((i as f64 * 1000.0 * std::f64::consts::TAU / rate as f64).sin() * 0.8 * 32767.0) as i16
        });
        std::fs::write(&path, wav_bytes(rate, 2, tone)).unwrap();

        let (samples, info, fractions, largest) = collect_16k(&path).expect("long wav");
        assert_eq!((info.sample_rate, info.channels), (48_000, 2));
        assert!(samples.len().abs_diff(16_000 * 60) <= 1, "got {} samples", samples.len());
        assert!(largest < 64_000, "a block of {largest} samples is not streaming");
        // Averaged to mono (0.8 / 2), still 1 kHz.
        let a = amplitude_at(&samples[1600..samples.len() - 1600], 1000.0);
        assert!((a - 0.4).abs() < 0.01, "1 kHz amplitude {a}");
        // Progress follows the file from start to end.
        assert!(fractions.first().copied().unwrap() < 0.1);
        assert!(fractions.last().copied().unwrap() > 0.99);
    }

    /// A meeting recording as Teams and Zoom write them: H.264 video beside
    /// 48 kHz stereo AAC in an MP4. The audio track is found among the video
    /// packets, downmixed and resampled.
    #[test]
    fn streams_the_audio_track_of_a_video_mp4() {
        let (samples, info, fractions, _) =
            collect_16k(&fixture("meeting-video-aac-48k-stereo.mp4")).expect("video mp4");
        assert_eq!(info.decoder, Decoder::Symphonia, "AAC in MP4 must not need the fallback");
        assert_eq!((info.sample_rate, info.channels), (48_000, 2));
        assert!(samples.len().abs_diff(32_000) <= 1_500, "got {} samples", samples.len());
        let a = amplitude_at(&samples[3200..samples.len() - 3200], 440.0);
        assert!((0.4..0.6).contains(&a), "440 Hz amplitude {a}");
        assert!(fractions.windows(2).all(|w| w[0] <= w[1]));

        let probe = probe_audio(&fixture("meeting-video-aac-48k-stereo.mp4")).expect("probe");
        assert_eq!(probe.sample_rate, Some(48_000));
        if let Some(secs) = probe.duration_secs {
            assert!((secs - 2.0).abs() < 0.1, "duration {secs}");
        }
    }

    #[test]
    fn a_video_with_no_audio_track_says_so() {
        let err = probe_audio(&fixture("video-without-audio.mp4")).expect_err("no audio");
        assert_eq!(err, NO_AUDIO_TRACK);
        if !cfg!(target_os = "macos") {
            let err = decode_stream_16k(&fixture("video-without-audio.mp4"), &mut |_, _| Ok(()))
                .expect_err("no audio");
            assert_eq!(err, NO_AUDIO_TRACK);
        }
    }

    #[test]
    fn a_sink_error_stops_the_decode_and_comes_back_verbatim() {
        let mut calls = 0;
        let err = decode_stream_16k(&fixture("tone.wav"), &mut |_, _| {
            calls += 1;
            Err("Transcription cancelled".to_string())
        })
        .expect_err("sink error");
        assert_eq!(err, "Transcription cancelled");
        assert_eq!(calls, 1, "decoding must stop at the first refusal");
    }

    #[test]
    fn streaming_reports_unreadable_and_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let garbage = dir.path().join("not-audio.mp4");
        std::fs::write(&garbage, b"this is not audio, it is prose about audio").unwrap();
        let err = decode_stream_16k(&garbage, &mut |_, _| Ok(())).expect_err("garbage");
        assert!(!err.is_empty());
        assert!(probe_audio(&garbage).is_err());

        let err = decode_stream_16k(&fixture("does-not-exist.wav"), &mut |_, _| Ok(()))
            .expect_err("missing");
        assert!(err.contains("Cannot read"), "{err}");
    }

    #[test]
    fn probing_reads_the_shape_without_decoding() {
        let wav = probe_audio(&fixture("tone.wav")).expect("wav");
        assert_eq!(wav.sample_rate, Some(16_000));
        assert_eq!(wav.channels, Some(1));
        assert!((wav.duration_secs.unwrap() - 0.4).abs() < 0.01);

        let m4a = probe_audio(&fixture("tone-phone-48k-mono-64k.m4a")).expect("m4a");
        assert_eq!(m4a.sample_rate, Some(48_000));
        if let Some(secs) = m4a.duration_secs {
            assert!((secs - 0.4).abs() < 0.1, "duration {secs}");
        }
    }
}
