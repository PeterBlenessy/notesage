//! One recorded track: ring → mono → (resample) → WAV, with the running
//! measurements the capture loop reports.
//!
//! This is the non-real-time half of C4. The audio callback only fills the
//! ring; everything that allocates, measures or touches the file system
//! happens here, on the capture thread. It has no dependency on the audio
//! stack, so the whole path from "samples in the ring" to "bytes in the file"
//! is unit-tested, including what happens when the disk fails.

use super::mix::{downmix_into, StreamResampler};
use super::monitor::{block_peak, Role, SilenceDetector};
use super::ring::Consumer;
use super::wav::{WavSink, WavWriter};

/// Frames popped from the ring per pass: bounds the scratch buffers however
/// long the capture thread was held up.
const DRAIN_FRAMES: usize = 16_384;

struct Input {
    consumer: Consumer,
    channels: usize,
    resampler: StreamResampler,
}

/// What one `drain` call moved.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct DrainReport {
    /// Frames written to the file, at the track's rate.
    pub frames: u64,
    /// Peak of those frames.
    pub peak: f32,
    /// A `silence` warning is due for this track.
    pub silence_warning: bool,
}

/// Totals for a finished track.
#[derive(Debug, Clone, PartialEq)]
pub struct TrackTotals {
    /// Frames that reached the file.
    pub frames: u64,
    pub sample_rate: u32,
    pub peak: f32,
    pub rms: f32,
    pub dropped_frames: u64,
    /// The first data-write failure, if any.
    pub write_error: Option<String>,
    /// Outcome of the final header patch.
    pub finalize: Result<(), String>,
}

pub struct TrackSink<W: WavSink> {
    role: Role,
    writer: WavWriter<W>,
    input: Option<Input>,
    raw: Vec<f32>,
    mono: Vec<f32>,
    resampled: Vec<f32>,
    silence: SilenceDetector,
    peak: f32,
    sum_sq: f64,
    measured: u64,
    /// Frames dropped by inputs that have since been replaced.
    dropped_before: u64,
}

impl<W: WavSink> TrackSink<W> {
    /// `writer` must be mono; its sample rate is the track's rate for good.
    pub fn new(role: Role, writer: WavWriter<W>) -> Self {
        let rate = writer.sample_rate();
        Self {
            role,
            writer,
            input: None,
            raw: Vec::new(),
            mono: Vec::new(),
            resampled: Vec::new(),
            silence: SilenceDetector::new(rate),
            peak: 0.0,
            sum_sq: 0.0,
            measured: 0,
            dropped_before: 0,
        }
    }

    pub fn sample_rate(&self) -> u32 {
        self.writer.sample_rate()
    }

    /// Connect a (new) stream's ring. A stream at a different rate or channel
    /// count than the track is converted on the way in, so a device change
    /// mid-recording continues the same file.
    pub fn attach(&mut self, consumer: Consumer, in_rate: u32, in_channels: u16) {
        self.detach();
        self.input = Some(Input {
            consumer,
            channels: in_channels.max(1) as usize,
            resampler: StreamResampler::new(in_rate, self.writer.sample_rate()),
        });
    }

    /// Disconnect the current ring, keeping its dropped-frame count. Call
    /// `drain` first to collect what is still in it.
    pub fn detach(&mut self) {
        if let Some(input) = self.input.take() {
            self.dropped_before += input.consumer.dropped() / input.channels as u64;
        }
    }

    /// Frames accepted so far (committed plus buffered), at the track's rate.
    pub fn frames_written(&self) -> u64 {
        self.writer.samples_accepted()
    }

    /// Frames the audio callback had to drop because the ring was full.
    pub fn dropped_frames(&self) -> u64 {
        let current = self
            .input
            .as_ref()
            .map_or(0, |i| i.consumer.dropped() / i.channels as u64);
        self.dropped_before + current
    }

    pub fn peak(&self) -> f32 {
        self.peak
    }

    #[cfg(test)]
    pub fn write_error(&self) -> Option<&str> {
        self.writer.failure()
    }

    /// Move everything waiting in the ring into the file. An `Err` is a write
    /// failure (or the size limit): the capture must stop.
    pub fn drain(&mut self) -> Result<DrainReport, String> {
        let mut report = DrainReport::default();
        let Some(input) = self.input.as_mut() else {
            return Ok(report);
        };
        loop {
            self.raw.clear();
            let max = DRAIN_FRAMES * input.channels;
            if input.consumer.pop_into(&mut self.raw, max) == 0 {
                break;
            }
            self.mono.clear();
            downmix_into(&self.raw, input.channels, &mut self.mono);
            self.resampled.clear();
            input.resampler.process(&self.mono, &mut self.resampled);
            if self.resampled.is_empty() {
                continue;
            }

            let peak = block_peak(&self.resampled);
            for &s in &self.resampled {
                self.sum_sq += (s as f64) * (s as f64);
            }
            self.measured += self.resampled.len() as u64;
            if peak > self.peak {
                self.peak = peak;
            }
            if peak > report.peak {
                report.peak = peak;
            }
            let frames = self.resampled.len() as u64;
            if self.silence.observe(frames, peak) {
                report.silence_warning = true;
            }
            self.writer.write_f32(&self.resampled)?;
            report.frames += frames;
        }
        Ok(report)
    }

    /// Insert silence (timeline padding). Not fed to the silence detector:
    /// padding is the recorder's doing, not evidence about the source.
    pub fn pad_silence(&mut self, frames: u64) -> Result<(), String> {
        if frames == 0 {
            return Ok(());
        }
        self.writer.write_silence(frames)
    }

    /// Make the file on disk a valid WAV of everything so far (C3).
    pub fn patch_header(&mut self) -> Result<(), String> {
        self.writer.patch_header()?;
        match self.writer.failure() {
            Some(e) => Err(e.to_string()),
            None => Ok(()),
        }
    }

    /// Final drain is the caller's job; this patches the header and reports.
    pub fn finish(mut self) -> TrackTotals {
        self.detach();
        let sample_rate = self.writer.sample_rate();
        let rms = if self.measured > 0 {
            (self.sum_sq / self.measured as f64).sqrt() as f32
        } else {
            0.0
        };
        let finalize = self.writer.patch_header();
        log::debug!(
            target: "notesage::recording",
            "{} track closed: {} frames at {} Hz, peak {:.4}",
            self.role.as_str(), self.writer.samples_committed(), sample_rate, self.peak
        );
        TrackTotals {
            frames: self.writer.samples_committed(),
            sample_rate,
            peak: self.peak,
            rms,
            dropped_frames: self.dropped_before,
            write_error: self.writer.failure().map(|s| s.to_string()),
            finalize,
        }
    }

    #[cfg(test)]
    fn into_writer(self) -> WavWriter<W> {
        self.writer
    }
}

#[cfg(test)]
mod tests {
    use super::super::ring::ring;
    use super::*;
    use std::io::{Cursor, Seek, SeekFrom, Write};

    fn sink(rate: u32) -> TrackSink<Cursor<Vec<u8>>> {
        TrackSink::new(Role::Mic, WavWriter::new(Cursor::new(Vec::new()), rate, 1).unwrap())
    }

    fn samples(bytes: &[u8]) -> Vec<i16> {
        bytes[44..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect()
    }

    /// The whole C4 path: interleaved stereo blocks in the ring come out as a
    /// mono file, in order, with levels measured off the audio thread.
    #[test]
    fn drains_stereo_ring_into_mono_file_in_order() {
        let (mut p, c) = ring(4096);
        let mut s = sink(48_000);
        s.attach(c, 48_000, 2);

        // Frames (L, R): (0.2, 0.4) x 100 then (-0.5, -0.5) x 50.
        let a: Vec<f32> = (0..100).flat_map(|_| [0.2f32, 0.4]).collect();
        let b: Vec<f32> = (0..50).flat_map(|_| [-0.5f32, -0.5]).collect();
        assert!(p.push_slice(&a));
        assert!(p.push_slice(&b));

        let report = s.drain().unwrap();
        assert_eq!(report.frames, 150);
        assert!((report.peak - 0.5).abs() < 1e-6);
        assert_eq!(s.frames_written(), 150);
        assert_eq!(s.drain().unwrap(), DrainReport::default(), "nothing left");

        let totals_peak = s.peak();
        let mut w = s.into_writer();
        w.patch_header().unwrap();
        let pcm = samples(&w.into_inner().into_inner());
        assert_eq!(pcm.len(), 150);
        assert!((pcm[0] as f32 / 32767.0 - 0.3).abs() < 1e-3);
        assert!((pcm[99] as f32 / 32767.0 - 0.3).abs() < 1e-3);
        assert!((pcm[100] as f32 / 32767.0 + 0.5).abs() < 1e-3);
        assert!((totals_peak - 0.5).abs() < 1e-6);
    }

    #[test]
    fn overflowed_blocks_are_counted_in_frames_and_survive_a_reattach() {
        let (mut p, c) = ring(8);
        let mut s = sink(48_000);
        s.attach(c, 48_000, 2);
        assert!(p.push_slice(&[0.1; 8]));
        assert!(!p.push_slice(&[0.1; 4]), "ring full: 2 stereo frames dropped");
        assert_eq!(s.dropped_frames(), 2);
        s.drain().unwrap();

        // Device replaced: the old ring's count is kept.
        let (mut p2, c2) = ring(8);
        s.attach(c2, 48_000, 1);
        assert_eq!(s.dropped_frames(), 2);
        assert!(p2.push_slice(&[0.1; 8]));
        assert!(!p2.push_slice(&[0.1; 3]));
        assert_eq!(s.dropped_frames(), 5);
        let totals = {
            s.drain().unwrap();
            s.finish()
        };
        assert_eq!(totals.dropped_frames, 5);
        assert_eq!(totals.frames, 4 + 8);
    }

    /// C1: a replacement device at another rate continues the same file at
    /// the track's rate.
    #[test]
    fn a_replacement_device_at_another_rate_is_converted_to_the_tracks_rate() {
        let mut s = sink(48_000);
        let (mut p, c) = ring(1 << 16);
        s.attach(c, 48_000, 1);
        p.push_slice(&vec![0.25; 4800]);
        assert_eq!(s.drain().unwrap().frames, 4800);

        // AirPods take over at 24 kHz: 0.1 s is 2400 frames in, ~4800 out.
        let (mut p, c) = ring(1 << 16);
        s.attach(c, 24_000, 1);
        p.push_slice(&vec![0.25; 2400]);
        let frames = s.drain().unwrap().frames;
        assert!((frames as i64 - 4800).abs() <= 2, "{frames}");
        assert_eq!(s.sample_rate(), 48_000);
        let totals = s.finish();
        assert_eq!(totals.sample_rate, 48_000);
        assert!((totals.rms - 0.25).abs() < 1e-3);
    }

    #[test]
    fn padding_writes_silence_without_feeding_the_silence_detector() {
        let mut s = sink(1000);
        // 10 s of padding must not produce a silence warning on its own.
        s.pad_silence(10_000).unwrap();
        assert_eq!(s.frames_written(), 10_000);
        let (mut p, c) = ring(1 << 14);
        s.attach(c, 1000, 1);
        // 4.9 s of real silence: still below the 5 s rule.
        p.push_slice(&vec![0.0; 4900]);
        assert!(!s.drain().unwrap().silence_warning);
        p.push_slice(&vec![0.0; 200]);
        assert!(s.drain().unwrap().silence_warning);
        p.push_slice(&vec![0.0; 5000]);
        assert!(!s.drain().unwrap().silence_warning, "once per episode");
    }

    struct FullDisk {
        data: Cursor<Vec<u8>>,
        limit: usize,
    }
    impl Write for FullDisk {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if self.data.position() as usize >= 44 && self.data.get_ref().len() + buf.len() > self.limit {
                return Err(std::io::Error::new(std::io::ErrorKind::Other, "No space left on device"));
            }
            self.data.write(buf)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl Seek for FullDisk {
        fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
            self.data.seek(pos)
        }
    }
    impl WavSink for FullDisk {}

    /// C2: the first write failure comes out of `drain` as an error, and the
    /// totals describe only what is in the file.
    #[test]
    fn a_failing_disk_surfaces_from_drain_and_totals_count_only_what_landed() {
        let disk = FullDisk { data: Cursor::new(Vec::new()), limit: 44 + 150_000 };
        let mut s = TrackSink::new(Role::Mic, WavWriter::new(disk, 48_000, 1).unwrap());
        let (mut p, c) = ring(1 << 18);
        s.attach(c, 48_000, 1);

        // 1 s = 96 kB: flushed in full.
        p.push_slice(&vec![0.5; 48_000]);
        assert_eq!(s.drain().unwrap().frames, 48_000);
        // The next second does not fit.
        p.push_slice(&vec![0.5; 48_000]);
        let err = s.drain().unwrap_err();
        assert!(err.contains("No space left"), "{err}");
        assert!(s.write_error().is_some());
        assert!(s.patch_header().is_err(), "the periodic patch keeps reporting it");

        let totals = s.finish();
        assert!(totals.write_error.is_some());
        assert!(totals.finalize.is_ok(), "the header itself was patched");
        assert!(totals.frames >= 32_768 && totals.frames < 96_000, "{}", totals.frames);
        // Duration from samples written: under 2 s although 2 s were captured.
        let secs = super::super::wav::duration_from_samples(totals.frames, 48_000, 1);
        assert!(secs < 1.7, "{secs}");
    }

    #[test]
    fn a_sink_without_input_drains_nothing() {
        let mut s = sink(48_000);
        assert_eq!(s.drain().unwrap(), DrainReport::default());
        assert_eq!(s.dropped_frames(), 0);
        let totals = s.finish();
        assert_eq!((totals.frames, totals.peak, totals.rms), (0, 0.0, 0.0));
        assert!(totals.finalize.is_ok());
    }
}
