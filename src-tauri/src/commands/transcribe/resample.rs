//! Band-limited, streaming conversion to the 16 kHz mono Whisper consumes.
//!
//! Replaces a linear interpolator with no low-pass: at 48 kHz → 16 kHz that
//! folded everything between 8 and 24 kHz back into the speech band (a 10 kHz
//! tone came out as a 6 kHz one at nearly full level).
//!
//! This is a polyphase windowed-sinc resampler (Kaiser window). The ratio is
//! kept as an exact fraction, so the output never drifts against the input
//! however long the recording is, and the filter bank holds one set of taps
//! per distinct fractional position (1 for 48 kHz, 160 for 44.1 kHz).
//!
//! It is fed block by block: only the filter's own history is retained, so
//! memory does not depend on the length of the recording.

/// The rate Whisper expects.
pub const TARGET_RATE: u32 = 16_000;

/// Sinc zero crossings kept on each side of the centre tap, measured at the
/// filter's cutoff. 24 gives a transition band of about 1.7 kHz at 48 kHz.
const ZERO_CROSSINGS: f64 = 24.0;
/// Kaiser window shape; 8.6 puts the stopband about 90 dB down.
const KAISER_BETA: f64 = 8.6;
/// The -6 dB point as a fraction of the lower of the two Nyquist frequencies.
const CUTOFF: f64 = 0.925;
/// Upper bound on stored phases. Rates whose exact fraction needs more are
/// served from the nearest of this many (an error below 1/4000 of a sample).
const MAX_PHASES: u64 = 2048;

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

/// Zeroth-order modified Bessel function of the first kind (power series).
fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let half = x / 2.0;
    for k in 1..64 {
        term *= (half / k as f64) * (half / k as f64);
        sum += term;
        if term < sum * 1e-17 {
            break;
        }
    }
    sum
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-12 {
        1.0
    } else {
        let px = std::f64::consts::PI * x;
        px.sin() / px
    }
}

/// Average interleaved frames down to one channel, appending to `mono`.
/// A trailing partial frame is ignored.
pub fn downmix_into(interleaved: &[f32], channels: u16, mono: &mut Vec<f32>) {
    let ch = channels.max(1) as usize;
    if ch == 1 {
        mono.extend_from_slice(interleaved);
        return;
    }
    let scale = 1.0 / ch as f32;
    mono.reserve(interleaved.len() / ch);
    for frame in interleaved.chunks_exact(ch) {
        mono.push(frame.iter().sum::<f32>() * scale);
    }
}

/// Streaming mono resampler from `from_rate` to [`TARGET_RATE`].
pub struct StreamResampler {
    from_rate: u32,
    passthrough: bool,
    /// Input samples advanced per output sample, as the fraction `num / den`.
    num: u64,
    den: u64,
    phases: u64,
    /// Taps on each side of the centre.
    half: usize,
    /// `phases` rows of `2 * half` coefficients.
    taps: Vec<f32>,
    /// Pending input. `buf[0]` is input sample number `buf_start`.
    buf: Vec<f32>,
    buf_start: i64,
    /// Position of the next output sample: `pos_int + pos_frac / den`.
    pos_int: i64,
    pos_frac: u64,
    /// Input samples received so far.
    received: u64,
    /// Output samples produced so far.
    produced: u64,
}

impl StreamResampler {
    pub fn new(from_rate: u32) -> Self {
        let from_rate = from_rate.max(1);
        let passthrough = from_rate == TARGET_RATE;
        let g = gcd(from_rate as u64, TARGET_RATE as u64);
        let num = from_rate as u64 / g;
        let den = TARGET_RATE as u64 / g;
        let phases = den.min(MAX_PHASES);

        // Cutoff as a fraction of the INPUT Nyquist: below the output Nyquist
        // when decimating, below the input Nyquist when interpolating.
        let lower = from_rate.min(TARGET_RATE) as f64;
        let c = (CUTOFF * lower / from_rate as f64).min(1.0);
        let half = (ZERO_CROSSINGS / c).ceil() as usize;

        let mut taps = Vec::new();
        if !passthrough {
            let width = 2 * half;
            taps.reserve(phases as usize * width);
            let i0_beta = bessel_i0(KAISER_BETA);
            for p in 0..phases {
                let frac = p as f64 / phases as f64;
                let mut row = vec![0f64; width];
                let mut sum = 0.0;
                for (j, slot) in row.iter_mut().enumerate() {
                    // Tap j multiplies input sample `base - half + 1 + j`.
                    let offset = j as f64 - (half as f64 - 1.0);
                    let tau = frac - offset;
                    let x = tau / half as f64;
                    let window = if x.abs() >= 1.0 {
                        0.0
                    } else {
                        bessel_i0(KAISER_BETA * (1.0 - x * x).sqrt()) / i0_beta
                    };
                    let v = c * sinc(c * tau) * window;
                    *slot = v;
                    sum += v;
                }
                // Unity gain at DC for every phase, so a constant input does
                // not come out with a ripple at the phase-repeat frequency.
                for v in row {
                    taps.push((v / sum) as f32);
                }
            }
        }

        Self {
            from_rate,
            passthrough,
            num,
            den,
            phases,
            half,
            taps,
            // Zeros stand in for the samples before the start of the stream.
            buf: if passthrough { Vec::new() } else { vec![0.0; half] },
            buf_start: -(half as i64),
            pos_int: 0,
            pos_frac: 0,
            received: 0,
            produced: 0,
        }
    }

    pub fn from_rate(&self) -> u32 {
        self.from_rate
    }

    /// Feed mono input; resampled output is appended to `out`.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        self.received += input.len() as u64;
        if self.passthrough {
            out.extend_from_slice(input);
            self.produced += input.len() as u64;
            return;
        }
        self.buf.extend_from_slice(input);
        self.drain(out, None);
    }

    /// End of stream: emit the samples that were waiting for look-ahead.
    /// After this the resampler must not be fed again.
    pub fn flush(&mut self, out: &mut Vec<f32>) {
        if self.passthrough {
            return;
        }
        // Zeros stand in for the samples after the end of the stream; output
        // stops at the last position that still falls inside the input.
        let end = self.received as i64;
        self.buf.extend(std::iter::repeat(0.0).take(self.half + 1));
        self.drain(out, Some(end));
    }

    fn drain(&mut self, out: &mut Vec<f32>, stop_before: Option<i64>) {
        let half = self.half as i64;
        let width = 2 * self.half;
        let available_end = self.buf_start + self.buf.len() as i64;
        loop {
            if let Some(end) = stop_before {
                if self.pos_int >= end {
                    break;
                }
            }
            // Needs input samples pos_int-half+1 ..= pos_int+half.
            if self.pos_int + half >= available_end {
                break;
            }
            let first = (self.pos_int - half + 1 - self.buf_start) as usize;
            let phase = if self.phases == self.den {
                self.pos_frac
            } else {
                self.pos_frac * self.phases / self.den
            } as usize;
            let row = &self.taps[phase * width..(phase + 1) * width];
            let window = &self.buf[first..first + width];
            let mut acc = 0f32;
            for (x, h) in window.iter().zip(row.iter()) {
                acc += x * h;
            }
            out.push(acc);
            self.produced += 1;

            self.pos_frac += self.num;
            self.pos_int += (self.pos_frac / self.den) as i64;
            self.pos_frac %= self.den;
        }
        // Drop history no future output can reach.
        let keep_from = (self.pos_int - half + 1 - self.buf_start).max(0) as usize;
        if keep_from > 0 {
            let keep_from = keep_from.min(self.buf.len());
            self.buf.drain(..keep_from);
            self.buf_start += keep_from as i64;
        }
    }
}

/// Downmix and resample a whole interleaved buffer in one call.
///
/// The streaming path does not use this (it never holds a whole file); it is
/// for short buffers and tests.
pub fn resample_all(data: &[f32], from_rate: u32, channels: u16) -> Vec<f32> {
    let mut mono = Vec::new();
    downmix_into(data, channels, &mut mono);
    if from_rate == TARGET_RATE {
        return mono;
    }
    let mut resampler = StreamResampler::new(from_rate);
    let mut out =
        Vec::with_capacity((mono.len() as u64 * TARGET_RATE as u64 / from_rate.max(1) as u64) as usize + 16);
    resampler.process(&mono, &mut out);
    resampler.flush(&mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::TAU;

    fn tone(freq: f64, rate: u32, secs: f64, amp: f32) -> Vec<f32> {
        let n = (rate as f64 * secs) as usize;
        (0..n)
            .map(|i| ((i as f64 * freq * TAU / rate as f64).sin() as f32) * amp)
            .collect()
    }

    fn rms(x: &[f32]) -> f64 {
        (x.iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>() / x.len().max(1) as f64).sqrt()
    }

    /// Amplitude of the `freq` component (Goertzel-style correlation).
    fn amplitude_at(x: &[f32], freq: f64, rate: u32) -> f64 {
        let (mut re, mut im) = (0.0, 0.0);
        for (i, v) in x.iter().enumerate() {
            let ph = i as f64 * freq * TAU / rate as f64;
            re += *v as f64 * ph.cos();
            im += *v as f64 * ph.sin();
        }
        2.0 * (re * re + im * im).sqrt() / x.len() as f64
    }

    /// The defect this replaces: a 10 kHz tone at 48 kHz has no place in a
    /// 16 kHz signal. Linear interpolation left it at 6 kHz, in the middle of
    /// the speech band, nearly at full level.
    #[test]
    fn a_tone_above_the_new_nyquist_is_removed_not_aliased() {
        let input = tone(10_000.0, 48_000, 1.0, 0.8);
        let out = resample_all(&input, 48_000, 1);
        let body = &out[800..out.len() - 800];
        let alias = amplitude_at(body, 6_000.0, 16_000);
        assert!(alias < 0.8 * 1e-3, "10 kHz aliased to 6 kHz at amplitude {alias}");
        assert!(rms(body) < 1e-3, "residual rms {}", rms(body));
    }

    #[test]
    fn a_speech_band_tone_keeps_its_frequency_level_and_length() {
        for rate in [48_000u32, 44_100, 24_000, 8_000, 22_050, 32_000, 96_000] {
            let input = tone(1_000.0, rate, 1.0, 0.5);
            let out = resample_all(&input, rate, 1);
            let expected = (input.len() as u64 * 16_000 / rate as u64) as i64;
            assert!(
                (out.len() as i64 - expected).abs() <= 1,
                "{rate} Hz: {} samples, expected {expected}",
                out.len()
            );
            let body = &out[800..out.len() - 800];
            let a = amplitude_at(body, 1_000.0, 16_000);
            assert!((a - 0.5).abs() < 0.005, "{rate} Hz: 1 kHz amplitude {a}");
            // Nothing else of note: total energy is the tone's energy.
            let total = rms(body) * std::f64::consts::SQRT_2;
            assert!((total - 0.5).abs() < 0.005, "{rate} Hz: total amplitude {total}");
        }
    }

    #[test]
    fn sixteen_k_input_passes_through_untouched() {
        let data = vec![0.1, 0.2, 0.3, 0.4];
        assert_eq!(resample_all(&data, 16_000, 1), data);
    }

    #[test]
    fn stereo_is_averaged_to_mono() {
        // Left +0.6, right -0.2 → 0.2 mono.
        let mut data = Vec::new();
        for _ in 0..1600 {
            data.push(0.6);
            data.push(-0.2);
        }
        let out = resample_all(&data, 16_000, 2);
        assert_eq!(out.len(), 1600);
        assert!(out.iter().all(|v| (v - 0.2).abs() < 1e-6));

        // Opposite-phase channels cancel; a trailing half frame is ignored.
        let mut mono = Vec::new();
        downmix_into(&[0.5, -0.5, 0.25, -0.25, 0.9], 2, &mut mono);
        assert_eq!(mono, vec![0.0, 0.0]);
    }

    #[test]
    fn stereo_48k_downmixes_then_resamples() {
        let left = tone(1_000.0, 48_000, 0.5, 0.8);
        let mut data = Vec::with_capacity(left.len() * 2);
        for v in &left {
            data.push(*v);
            data.push(0.0);
        }
        let out = resample_all(&data, 48_000, 2);
        assert!((out.len() as i64 - 8_000).abs() <= 1);
        let a = amplitude_at(&out[800..out.len() - 800], 1_000.0, 16_000);
        assert!((a - 0.4).abs() < 0.005, "amplitude {a}");
    }

    /// Feeding in uneven blocks must give exactly what one call gives:
    /// decoders hand over packets of whatever size they like.
    #[test]
    fn streaming_in_blocks_matches_one_shot() {
        for rate in [48_000u32, 44_100, 8_000] {
            let input = tone(440.0, rate, 0.7, 0.5);
            let whole = resample_all(&input, rate, 1);

            let mut r = StreamResampler::new(rate);
            let mut out = Vec::new();
            let mut i = 0;
            let mut step = 1;
            while i < input.len() {
                let end = (i + step).min(input.len());
                r.process(&input[i..end], &mut out);
                i = end;
                step = step * 3 % 1021 + 1;
            }
            r.flush(&mut out);
            assert_eq!(out.len(), whole.len(), "{rate} Hz length");
            for (a, b) in out.iter().zip(whole.iter()) {
                assert!((a - b).abs() < 1e-6, "{rate} Hz: {a} vs {b}");
            }
        }
    }

    /// The resampler keeps only its filter history, whatever it has been fed.
    #[test]
    fn retained_input_is_bounded_by_the_filter_length() {
        let mut r = StreamResampler::new(48_000);
        let block = vec![0.1f32; 4800];
        let mut out = Vec::new();
        for _ in 0..200 {
            r.process(&block, &mut out);
            out.clear();
            assert!(r.buf.len() <= 2 * r.half + 8, "history grew to {}", r.buf.len());
        }
    }

    #[test]
    fn a_constant_stays_constant_at_an_awkward_ratio() {
        let input = vec![0.25f32; 44_100];
        let out = resample_all(&input, 44_100, 1);
        for v in &out[400..out.len() - 400] {
            assert!((v - 0.25).abs() < 1e-5, "ripple: {v}");
        }
    }

    #[test]
    fn empty_and_tiny_inputs_do_not_panic() {
        assert!(resample_all(&[], 48_000, 1).is_empty());
        assert_eq!(resample_all(&[0.5], 48_000, 1).len(), 1);
        assert_eq!(resample_all(&[0.5, 0.5, 0.5], 48_000, 1).len(), 1);
        // A rate with a huge exact fraction falls back to quantised phases.
        let out = resample_all(&vec![0.1; 12_345], 12_345, 1);
        assert!((out.len() as i64 - 16_000).abs() <= 1);
    }
}
