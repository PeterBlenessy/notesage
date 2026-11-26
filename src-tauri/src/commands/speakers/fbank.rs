//! Log mel filterbank features, the input of the speaker embedding model.
//!
//! This reproduces Kaldi's `fbank` as WeSpeaker configures it (80 bins,
//! 25 ms frames every 10 ms, Povey window, pre-emphasis 0.97, no dither,
//! `snip_edges`), followed by the per-utterance mean subtraction the model
//! was trained with. The model is only as good as the match between these
//! features and the ones it saw in training, so the constants are not free
//! parameters.
//!
//! Pure arithmetic: no model, no I/O.

/// Sample rate the features (and the model) expect.
pub const SAMPLE_RATE: usize = 16_000;
/// Mel bins per frame.
pub const NUM_MELS: usize = 80;
/// 25 ms.
pub const FRAME_LEN: usize = 400;
/// 10 ms.
pub const FRAME_SHIFT: usize = 160;

const FFT_LEN: usize = 512;
const PREEMPHASIS: f32 = 0.97;
const LOW_FREQ: f32 = 20.0;
/// Kaldi works on 16-bit sample values; the model was trained on those.
const SAMPLE_SCALE: f32 = 32_768.0;

/// Number of frames `samples` samples give (`snip_edges`: only whole frames).
pub fn frame_count(samples: usize) -> usize {
    if samples < FRAME_LEN {
        0
    } else {
        1 + (samples - FRAME_LEN) / FRAME_SHIFT
    }
}

fn mel(hz: f32) -> f32 {
    1127.0 * (1.0 + hz / 700.0).ln()
}

/// Everything that can be computed once: window, FFT tables, mel weights.
pub struct Fbank {
    window: Vec<f32>,
    /// Bit-reversal permutation for the FFT.
    rev: Vec<usize>,
    /// `cos`/`sin` of `-2*pi*k/FFT_LEN` for k in 0..FFT_LEN/2.
    twiddle: Vec<(f32, f32)>,
    /// For each mel bin: first FFT bin and the weights from there on.
    filters: Vec<(usize, Vec<f32>)>,
}

impl Default for Fbank {
    fn default() -> Self {
        Self::new()
    }
}

impl Fbank {
    pub fn new() -> Self {
        // Povey window: a Hann window raised to 0.85.
        let window = (0..FRAME_LEN)
            .map(|i| {
                let a = 2.0 * std::f64::consts::PI * i as f64 / (FRAME_LEN as f64 - 1.0);
                (0.5 - 0.5 * a.cos()).powf(0.85) as f32
            })
            .collect();

        let bits = FFT_LEN.trailing_zeros();
        let rev = (0..FFT_LEN).map(|i| i.reverse_bits() >> (usize::BITS - bits)).collect();
        let twiddle = (0..FFT_LEN / 2)
            .map(|k| {
                let a = -2.0 * std::f64::consts::PI * k as f64 / FFT_LEN as f64;
                (a.cos() as f32, a.sin() as f32)
            })
            .collect();

        // Triangles that are evenly spaced on the mel scale, as Kaldi builds
        // them: weights are linear in mel, not in Hz.
        let nyquist = SAMPLE_RATE as f32 / 2.0;
        let (mel_low, mel_high) = (mel(LOW_FREQ), mel(nyquist));
        let delta = (mel_high - mel_low) / (NUM_MELS as f32 + 1.0);
        let bin_hz = SAMPLE_RATE as f32 / FFT_LEN as f32;
        let filters = (0..NUM_MELS)
            .map(|m| {
                let left = mel_low + m as f32 * delta;
                let centre = left + delta;
                let right = centre + delta;
                let mut first = None;
                let mut weights = Vec::new();
                for i in 0..FFT_LEN / 2 {
                    let x = mel(bin_hz * i as f32);
                    if x > left && x < right {
                        let w = if x <= centre {
                            (x - left) / (centre - left)
                        } else {
                            (right - x) / (right - centre)
                        };
                        first.get_or_insert(i);
                        weights.push(w);
                    }
                }
                (first.unwrap_or(0), weights)
            })
            .collect();

        Self { window, rev, twiddle, filters }
    }

    /// In-place radix-2 FFT of `FFT_LEN` complex points.
    fn fft(&self, re: &mut [f32; FFT_LEN], im: &mut [f32; FFT_LEN]) {
        for i in 0..FFT_LEN {
            let j = self.rev[i];
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut len = 2;
        while len <= FFT_LEN {
            let half = len / 2;
            let step = FFT_LEN / len;
            for start in (0..FFT_LEN).step_by(len) {
                for k in 0..half {
                    let (wr, wi) = self.twiddle[k * step];
                    let (a, b) = (start + k, start + k + half);
                    let tr = re[b] * wr - im[b] * wi;
                    let ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
            len *= 2;
        }
    }

    /// Features of `samples` (16 kHz mono, -1..1), row-major:
    /// `frame_count(samples.len())` rows of [`NUM_MELS`] values, with the
    /// mean over time removed from every bin.
    pub fn compute(&self, samples: &[f32]) -> Vec<f32> {
        let mut out = self.compute_raw(samples);
        let frames = out.len() / NUM_MELS;
        if frames == 0 {
            return out;
        }
        for bin in 0..NUM_MELS {
            let mean =
                (0..frames).map(|f| out[f * NUM_MELS + bin] as f64).sum::<f64>() / frames as f64;
            for f in 0..frames {
                out[f * NUM_MELS + bin] -= mean as f32;
            }
        }
        out
    }

    /// Log mel energies without the mean subtraction.
    pub fn compute_raw(&self, samples: &[f32]) -> Vec<f32> {
        let frames = frame_count(samples.len());
        let mut out = Vec::with_capacity(frames * NUM_MELS);
        let mut re = [0f32; FFT_LEN];
        let mut im = [0f32; FFT_LEN];
        let mut power = [0f32; FFT_LEN / 2];
        for f in 0..frames {
            let frame = &samples[f * FRAME_SHIFT..f * FRAME_SHIFT + FRAME_LEN];
            let dc = frame.iter().sum::<f32>() / FRAME_LEN as f32;
            re.fill(0.0);
            im.fill(0.0);
            for (i, s) in frame.iter().enumerate() {
                re[i] = (s - dc) * SAMPLE_SCALE;
            }
            for i in (1..FRAME_LEN).rev() {
                re[i] -= PREEMPHASIS * re[i - 1];
            }
            re[0] -= PREEMPHASIS * re[0];
            for i in 0..FRAME_LEN {
                re[i] *= self.window[i];
            }
            self.fft(&mut re, &mut im);
            for i in 0..FFT_LEN / 2 {
                power[i] = re[i] * re[i] + im[i] * im[i];
            }
            for (first, weights) in &self.filters {
                let e: f32 =
                    weights.iter().zip(&power[*first..]).map(|(w, p)| w * p).sum();
                out.push(e.max(f32::EPSILON).ln());
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(hz: f32, secs: f32) -> Vec<f32> {
        (0..(secs * SAMPLE_RATE as f32) as usize)
            .map(|i| 0.5 * (2.0 * std::f32::consts::PI * hz * i as f32 / SAMPLE_RATE as f32).sin())
            .collect()
    }

    #[test]
    fn frame_count_follows_snip_edges() {
        assert_eq!(frame_count(0), 0);
        assert_eq!(frame_count(399), 0);
        assert_eq!(frame_count(400), 1);
        assert_eq!(frame_count(559), 1);
        assert_eq!(frame_count(560), 2);
        assert_eq!(frame_count(24_000), 148);
        let fb = Fbank::new();
        assert_eq!(fb.compute(&tone(440.0, 1.5)).len(), 148 * NUM_MELS);
        assert!(fb.compute(&[0.0; 100]).is_empty());
    }

    #[test]
    fn the_fft_matches_a_direct_transform() {
        let fb = Fbank::new();
        let mut re = [0f32; FFT_LEN];
        let mut im = [0f32; FFT_LEN];
        for (i, v) in re.iter_mut().enumerate() {
            *v = ((i * 7 % 13) as f32 - 6.0) / 6.0;
        }
        let input = re;
        fb.fft(&mut re, &mut im);
        for k in [0usize, 1, 5, 100, 255, 256, 400] {
            let (mut r, mut i) = (0f64, 0f64);
            for (n, x) in input.iter().enumerate() {
                let a = -2.0 * std::f64::consts::PI * (k * n) as f64 / FFT_LEN as f64;
                r += *x as f64 * a.cos();
                i += *x as f64 * a.sin();
            }
            assert!((re[k] as f64 - r).abs() < 1e-2, "re[{k}] {} vs {r}", re[k]);
            assert!((im[k] as f64 - i).abs() < 1e-2, "im[{k}] {} vs {i}", im[k]);
        }
    }

    #[test]
    fn a_tone_lights_up_the_bin_at_its_frequency() {
        let fb = Fbank::new();
        for (hz, lo, hi) in [(300.0, 5usize, 14usize), (1000.0, 22, 32), (4000.0, 56, 66)] {
            let raw = fb.compute_raw(&tone(hz, 0.5));
            let frame = &raw[10 * NUM_MELS..11 * NUM_MELS];
            let peak = (0..NUM_MELS)
                .max_by(|a, b| frame[*a].partial_cmp(&frame[*b]).unwrap())
                .unwrap();
            assert!((lo..=hi).contains(&peak), "{hz} Hz peaked in bin {peak}");
        }
    }

    #[test]
    fn filters_cover_the_band_and_are_triangles() {
        let fb = Fbank::new();
        assert_eq!(fb.filters.len(), NUM_MELS);
        for (first, weights) in &fb.filters {
            assert!(!weights.is_empty());
            assert!(first + weights.len() <= FFT_LEN / 2);
            assert!(weights.iter().all(|w| (0.0..=1.0).contains(w)));
        }
        // Ascending centres.
        assert!(fb.filters.windows(2).all(|w| w[0].0 <= w[1].0));
    }

    #[test]
    fn mean_normalised_features_do_not_depend_on_level() {
        let fb = Fbank::new();
        let loud: Vec<f32> = (0..16_000)
            .map(|i| {
                let t = i as f32 / 16_000.0;
                0.4 * (2.0 * std::f32::consts::PI * (200.0 + 300.0 * t) * t).sin()
            })
            .collect();
        let quiet: Vec<f32> = loud.iter().map(|s| s * 0.05).collect();
        let (a, b) = (fb.compute(&loud), fb.compute(&quiet));
        // (Bins that hold next to no energy sit near the floor of the
        // logarithm in the quiet copy, so the mean is compared, not the worst.)
        let mean = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).sum::<f32>() / a.len() as f32;
        assert!(mean < 0.01, "level changed the features by {mean} on average");
        // And every bin has zero mean over time.
        let frames = a.len() / NUM_MELS;
        for bin in [0, 40, 79] {
            let mean: f32 = (0..frames).map(|f| a[f * NUM_MELS + bin]).sum::<f32>() / frames as f32;
            assert!(mean.abs() < 1e-3);
        }
    }

    #[test]
    fn silence_gives_finite_features() {
        let fb = Fbank::new();
        assert!(fb.compute(&[0.0; 8000]).iter().all(|v| v.is_finite()));
        assert!(fb.compute_raw(&[0.0; 8000]).iter().all(|v| v.is_finite()));
    }
}
