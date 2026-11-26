//! Sample-level plumbing for the capture thread and the stop path: downmix to
//! mono, a streaming sample-rate converter, and the mono mix of two tracks.
//!
//! None of this runs on the real-time thread. Pure `std` plus [`super::wav`].

use super::wav::{WavReader, WavWriter};
use std::path::Path;

/// Append the mono average of each interleaved frame to `out`. A trailing
/// partial frame (never produced by cpal, which delivers whole frames) is
/// ignored.
pub fn downmix_into(interleaved: &[f32], channels: usize, out: &mut Vec<f32>) {
    match channels {
        0 => {}
        1 => out.extend_from_slice(interleaved),
        2 => out.extend(interleaved.chunks_exact(2).map(|f| (f[0] + f[1]) * 0.5)),
        n => {
            let scale = 1.0 / n as f32;
            out.extend(interleaved.chunks_exact(n).map(|f| f.iter().sum::<f32>() * scale));
        }
    }
}

/// Streaming mono sample-rate converter.
///
/// Used in two places only: when a device is replaced mid-recording by one
/// with a different rate (so one track stays one file at one rate), and when
/// the system track is brought to the microphone's rate for the mix. The
/// normal path, same device start to stop, never resamples.
///
/// Upsampling interpolates linearly. Downsampling averages the source span
/// each output sample covers (a box filter), which attenuates what would
/// otherwise alias into the speech band (about -6 dB just above the new
/// Nyquist, more further up); plain linear interpolation does not filter at
/// all. Neither is studio
/// grade and neither needs to be: the consumer is a speech recogniser that
/// goes on to resample to 16 kHz with a proper filter.
///
/// Output positions are computed from integer counters, not accumulated
/// floats, so an hours-long stream does not drift.
pub struct StreamResampler {
    from: u32,
    to: u32,
    /// Source samples per output sample.
    step: f64,
    /// Source samples consumed before the current block.
    consumed: u64,
    /// Output samples produced so far.
    produced: u64,
    /// Last source sample of the previous block (upsampling).
    last: f32,
    have_last: bool,
    /// Running box sum and weight (downsampling).
    acc: f64,
    acc_weight: f64,
}

impl StreamResampler {
    pub fn new(from: u32, to: u32) -> Self {
        Self {
            from,
            to,
            step: from.max(1) as f64 / to.max(1) as f64,
            consumed: 0,
            produced: 0,
            last: 0.0,
            have_last: false,
            acc: 0.0,
            acc_weight: 0.0,
        }
    }

    pub fn is_identity(&self) -> bool {
        self.from == self.to
    }

    /// Convert one block, appending to `out`.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if self.is_identity() {
            out.extend_from_slice(input);
            return;
        }
        if self.to > self.from {
            self.upsample(input, out);
        } else {
            self.downsample(input, out);
        }
        self.consumed += input.len() as u64;
    }

    fn upsample(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if input.is_empty() {
            return;
        }
        let base = self.consumed;
        let end = base + input.len() as u64; // one past the last index we hold
        // Sample at a global source index within [base - 1, end).
        let last = self.last;
        let at = |idx: u64| -> f32 {
            if idx < base {
                last
            } else {
                input[(idx - base) as usize]
            }
        };
        loop {
            let pos = self.produced as f64 * self.step;
            let i = pos.floor() as u64;
            // Interpolating between i and i + 1 needs both in hand.
            if i + 1 >= end {
                break;
            }
            // Index base - 1 is available only if a previous block existed.
            if i + 1 < base || (i < base && !self.have_last) {
                // Cannot happen for a monotonic stream; skip defensively.
                self.produced += 1;
                continue;
            }
            let frac = (pos - i as f64) as f32;
            let a = at(i);
            let b = at(i + 1);
            out.push(a + frac * (b - a));
            self.produced += 1;
        }
        self.last = input[input.len() - 1];
        self.have_last = true;
    }

    fn downsample(&mut self, input: &[f32], out: &mut Vec<f32>) {
        const EPS: f64 = 1e-9;
        let mut idx = self.consumed;
        for &x in input {
            let boundary = (self.produced + 1) as f64 * self.step;
            let end = (idx + 1) as f64;
            if end < boundary - EPS {
                self.acc += x as f64;
                self.acc_weight += 1.0;
            } else {
                // This sample straddles (or ends exactly on) the boundary:
                // split it between the output it finishes and the next one.
                let part = (boundary - idx as f64).clamp(0.0, 1.0);
                self.acc += x as f64 * part;
                self.acc_weight += part;
                out.push(if self.acc_weight > 0.0 { (self.acc / self.acc_weight) as f32 } else { 0.0 });
                self.produced += 1;
                let rest = 1.0 - part;
                self.acc = x as f64 * rest;
                self.acc_weight = rest;
            }
            idx += 1;
        }
    }
}

/// Gain applied to the sum of two tracks: 3 dB of headroom. Both people
/// talking at full scale at once still clips (and is clamped), but that is
/// rare, and halving both tracks instead would make every recording 6 dB
/// quieter to protect against it.
pub const MIX_GAIN: f32 = 0.707_106_77;

/// Mix two aligned mono blocks into `out`. The shorter block is treated as
/// followed by silence, so the mix is as long as the longer one.
pub fn mix_samples(a: &[f32], b: &[f32], out: &mut Vec<f32>) {
    let n = a.len().max(b.len());
    out.reserve(n);
    for i in 0..n {
        let x = a.get(i).copied().unwrap_or(0.0);
        let y = b.get(i).copied().unwrap_or(0.0);
        out.push(((x + y) * MIX_GAIN).clamp(-1.0, 1.0));
    }
}

/// What [`mix_tracks`] wrote.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MixInfo {
    pub sample_rate: u32,
    pub frames: u64,
    pub peak: f32,
}

/// Write the mono mix of two track files to `out_path` (owner-only), at the
/// first track's sample rate. Both tracks start at the same instant (the
/// capture thread pads the later one), so mixing is sample `i` with sample
/// `i`; the mix is as long as the longer track. Streams in bounded chunks: an
/// hour of audio never sits in memory.
pub fn mix_tracks(first: &Path, second: &Path, out_path: &Path) -> Result<MixInfo, String> {
    const CHUNK: usize = 16_384;
    let mut a = WavReader::open(first)?;
    let mut b = WavReader::open(second)?;
    let rate = a.sample_rate;
    let mut resampler = StreamResampler::new(b.sample_rate, rate);
    let mut writer = WavWriter::create(out_path, rate, 1)?;

    let mut a_buf: Vec<f32> = Vec::with_capacity(CHUNK);
    let mut b_raw: Vec<f32> = Vec::with_capacity(CHUNK);
    // Second-track samples already at `rate`, waiting to be mixed.
    let mut b_ready: Vec<f32> = Vec::with_capacity(CHUNK * 2);
    let mut mixed: Vec<f32> = Vec::with_capacity(CHUNK);
    let mut peak = 0.0f32;
    let mut b_done = false;

    loop {
        a_buf.clear();
        let got_a = a.read_mono(&mut a_buf, CHUNK)?;
        // Top up the second track to cover this chunk (or one chunk of its
        // own tail once the first track has ended).
        let want = if got_a > 0 { got_a } else { CHUNK };
        while !b_done && b_ready.len() < want {
            b_raw.clear();
            if b.read_mono(&mut b_raw, CHUNK)? == 0 {
                b_done = true;
            } else {
                resampler.process(&b_raw, &mut b_ready);
            }
        }
        let take_b = b_ready.len().min(want);
        if got_a == 0 && take_b == 0 {
            break;
        }
        mixed.clear();
        mix_samples(&a_buf, &b_ready[..take_b], &mut mixed);
        b_ready.drain(..take_b);
        for &s in &mixed {
            let m = s.abs();
            if m > peak {
                peak = m;
            }
        }
        writer.write_f32(&mixed)?;
    }

    if let Some(e) = writer.failure() {
        return Err(e.to_string());
    }
    let frames = writer.finalize()?;
    Ok(MixInfo { sample_rate: rate, frames, peak })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmix_averages_frames() {
        let mut out = Vec::new();
        downmix_into(&[0.2, 0.4, -1.0, 1.0], 2, &mut out);
        assert_eq!(out, vec![0.3, 0.0]);
        out.clear();
        downmix_into(&[0.1, 0.2, 0.3], 1, &mut out);
        assert_eq!(out, vec![0.1, 0.2, 0.3]);
        out.clear();
        downmix_into(&[0.3, 0.3, 0.3, 0.9, 0.9, 0.9, 0.5], 3, &mut out);
        assert_eq!(out.len(), 2, "a torn trailing frame is ignored");
        assert!((out[0] - 0.3).abs() < 1e-6 && (out[1] - 0.9).abs() < 1e-6);
        out.clear();
        downmix_into(&[1.0, 2.0], 0, &mut out);
        assert!(out.is_empty());
    }

    fn sine(rate: u32, hz: f64, frames: usize) -> Vec<f32> {
        (0..frames)
            .map(|i| (2.0 * std::f64::consts::PI * hz * i as f64 / rate as f64).sin() as f32 * 0.5)
            .collect()
    }

    /// Feed `input` in blocks of `block` and collect the output.
    fn run(from: u32, to: u32, input: &[f32], block: usize) -> Vec<f32> {
        let mut r = StreamResampler::new(from, to);
        let mut out = Vec::new();
        for chunk in input.chunks(block) {
            r.process(chunk, &mut out);
        }
        out
    }

    #[test]
    fn identity_rate_passes_samples_through() {
        let input = sine(48_000, 440.0, 1000);
        assert_eq!(run(48_000, 48_000, &input, 128), input);
    }

    #[test]
    fn output_length_matches_the_rate_ratio() {
        let one_sec_48 = sine(48_000, 300.0, 48_000);
        for (from, to) in [(48_000u32, 44_100u32), (48_000, 16_000), (48_000, 24_000)] {
            let out = run(from, to, &one_sec_48, 480);
            assert!(
                (out.len() as i64 - to as i64).abs() <= 1,
                "{from}->{to}: {} samples",
                out.len()
            );
        }
        let one_sec_441 = sine(44_100, 300.0, 44_100);
        let out = run(44_100, 48_000, &one_sec_441, 441);
        assert!((out.len() as i64 - 48_000).abs() <= 2, "{}", out.len());
        let one_sec_16 = sine(16_000, 300.0, 16_000);
        let out = run(16_000, 48_000, &one_sec_16, 160);
        assert!((out.len() as i64 - 48_000).abs() <= 3, "{}", out.len());
    }

    /// The block size the audio arrives in must not change the result.
    #[test]
    fn result_does_not_depend_on_block_boundaries() {
        let input = sine(44_100, 500.0, 10_000);
        for (from, to) in [(44_100u32, 48_000u32), (48_000, 44_100), (48_000, 16_000)] {
            let whole = run(from, to, &input, input.len());
            for block in [1usize, 7, 64, 441, 4096] {
                let parts = run(from, to, &input, block);
                assert_eq!(parts.len(), whole.len(), "{from}->{to} block {block}");
                for (a, b) in parts.iter().zip(whole.iter()) {
                    assert!((a - b).abs() < 1e-5, "{from}->{to} block {block}: {a} vs {b}");
                }
            }
        }
    }

    #[test]
    fn a_constant_signal_stays_constant_and_a_tone_keeps_its_pitch() {
        for (from, to) in [(44_100u32, 48_000u32), (48_000, 16_000), (48_000, 44_100)] {
            let out = run(from, to, &vec![0.25f32; 5000], 333);
            assert!(out.iter().all(|s| (s - 0.25).abs() < 1e-5), "{from}->{to}");
        }
        // A 300 Hz tone resampled 48k -> 44.1k still crosses zero 600 times a second.
        let out = run(48_000, 44_100, &sine(48_000, 300.0, 48_000), 480);
        let crossings = out.windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count();
        assert!((598..=602).contains(&crossings), "{crossings}");
        // And keeps its level (the box filter costs little at 300 Hz).
        let peak = out.iter().fold(0.0f32, |p, s| p.max(s.abs()));
        assert!((peak - 0.5).abs() < 0.02, "{peak}");
    }

    /// Downsampling 48 -> 16 kHz: a 10 kHz tone is above the new Nyquist
    /// (8 kHz) and would alias to 6 kHz at full level with plain
    /// interpolation. The three-sample box roughly halves it (-6 dB): a
    /// modest filter, but not none.
    #[test]
    fn downsampling_attenuates_what_would_alias() {
        let out = run(48_000, 16_000, &sine(48_000, 10_000.0, 48_000), 480);
        let peak = out.iter().fold(0.0f32, |p, s| p.max(s.abs()));
        assert!(peak < 0.3, "aliased tone at {peak} (input 0.5)");
    }

    #[test]
    fn mix_sums_with_headroom_pads_the_shorter_and_clamps() {
        let mut out = Vec::new();
        mix_samples(&[0.5, 0.5, 0.5], &[0.5], &mut out);
        assert_eq!(out.len(), 3);
        assert!((out[0] - 0.707_106_77).abs() < 1e-6);
        assert!((out[1] - 0.353_553_38).abs() < 1e-6);
        out.clear();
        mix_samples(&[1.0], &[1.0, -1.0], &mut out);
        assert_eq!(out, vec![1.0, -MIX_GAIN], "clamped, and the tail is the longer track alone");
        out.clear();
        mix_samples(&[], &[], &mut out);
        assert!(out.is_empty());
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "notesage-mix-{}-{}-{:?}",
            tag,
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_wav(path: &Path, rate: u32, samples: &[f32]) {
        let mut w = WavWriter::create(path, rate, 1).unwrap();
        w.write_f32(samples).unwrap();
        w.finalize().unwrap();
    }

    fn read_all(path: &Path) -> (u32, Vec<f32>) {
        let mut r = WavReader::open(path).unwrap();
        let mut out = Vec::new();
        while r.read_mono(&mut out, 5000).unwrap() > 0 {}
        (r.sample_rate, out)
    }

    /// N1: `audio.*` for "both" is mic + system, mono, as long as the longer
    /// track, sample-aligned from the start.
    #[test]
    fn mix_tracks_aligns_from_the_start_and_keeps_the_longer_tail() {
        let dir = temp_dir("same-rate");
        let mic = dir.join("mic.wav");
        let sys = dir.join("system.wav");
        let out = dir.join("audio.wav");
        // Mic: 0.4 for 40 000 frames. System: 30 000 frames of silence (its
        // start padding), then 0.2 for 30 000.
        write_wav(&mic, 48_000, &vec![0.4; 40_000]);
        let mut s = vec![0.0f32; 30_000];
        s.extend(vec![0.2f32; 30_000]);
        write_wav(&sys, 48_000, &s);

        let info = mix_tracks(&mic, &sys, &out).unwrap();
        assert_eq!(info.sample_rate, 48_000);
        assert_eq!(info.frames, 60_000, "as long as the longer track");
        let (rate, mixed) = read_all(&out);
        assert_eq!(rate, 48_000);
        assert_eq!(mixed.len(), 60_000);
        let near = |v: f32, want: f32| (v - want).abs() < 2e-3;
        assert!(near(mixed[100], 0.4 * MIX_GAIN), "mic alone: {}", mixed[100]);
        assert!(near(mixed[35_000], 0.6 * MIX_GAIN), "both: {}", mixed[35_000]);
        assert!(near(mixed[50_000], 0.2 * MIX_GAIN), "system tail: {}", mixed[50_000]);
        assert!(near(info.peak, 0.6 * MIX_GAIN));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mix_tracks_brings_the_second_track_to_the_first_tracks_rate() {
        let dir = temp_dir("two-rates");
        let mic = dir.join("mic.wav");
        let sys = dir.join("system.wav");
        let out = dir.join("audio.wav");
        // One second each: mic silent at 48 kHz, system 0.5 at 44.1 kHz.
        write_wav(&mic, 48_000, &vec![0.0; 48_000]);
        write_wav(&sys, 44_100, &vec![0.5; 44_100]);
        let info = mix_tracks(&mic, &sys, &out).unwrap();
        assert_eq!(info.sample_rate, 48_000);
        assert!((info.frames as i64 - 48_000).abs() <= 2, "{}", info.frames);
        let (_, mixed) = read_all(&out);
        assert!((mixed[24_000] - 0.5 * MIX_GAIN).abs() < 2e-3);

        // The other way round the mix is longer than the (short) mic track.
        write_wav(&mic, 48_000, &vec![0.0; 4_800]);
        let info = mix_tracks(&mic, &sys, &out).unwrap();
        assert!((info.frames as i64 - 48_000).abs() <= 2, "{}", info.frames);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mix_tracks_fails_cleanly_on_a_missing_track() {
        let dir = temp_dir("missing");
        let mic = dir.join("mic.wav");
        write_wav(&mic, 48_000, &[0.1; 10]);
        assert!(mix_tracks(&mic, &dir.join("nope.wav"), &dir.join("audio.wav")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
