//! The seam between the speaker pipeline and the voice model.
//!
//! A voice model turns a short stretch of speech into a fixed-length vector
//! (an "embedding") such that the same voice gives nearby vectors. Everything
//! around it (finding speech, windows, clustering, turns, profiles, matching)
//! is plain logic and is tested with the deterministic engine at the bottom
//! of this file. The real one is `tract_engine`.

use super::fbank::SAMPLE_RATE;

/// The exact rejection for a cancelled analysis. The frontend matches on it.
pub const CANCELLED: &str = "Speaker analysis cancelled";

/// Length of the stretch of audio one embedding is computed from: 1.5 s.
/// Long enough for a usable voice vector, short enough that a window rarely
/// spans two speakers. The model is specialised to exactly this length.
pub const WINDOW_SAMPLES: usize = SAMPLE_RATE * 3 / 2;

/// Anything shorter than this (0.5 s) is not embedded at all: the vector of
/// a single syllable says little about whose voice it is.
pub const MIN_EMBED_SAMPLES: usize = SAMPLE_RATE / 2;

pub trait VoiceEngine: Sync {
    /// Identifies the model. Embeddings from different models cannot be
    /// compared, so every stored voice profile carries this.
    fn model_id(&self) -> &str;

    /// Length of the vectors this engine returns.
    fn dim(&self) -> usize;

    /// Embed exactly [`WINDOW_SAMPLES`] samples of 16 kHz mono audio.
    /// The result need not be normalised.
    fn embed_window(&self, window: &[f32]) -> Result<Vec<f32>, String>;

    /// Embed speech of any length from [`MIN_EMBED_SAMPLES`] up. Returns an
    /// L2-normalised vector.
    ///
    /// Shorter than a window: the speech is repeated to fill one (the usual
    /// treatment of short utterances in speaker verification; zero padding
    /// would put silence into the statistics). Longer: the mean over
    /// half-overlapping windows.
    fn embed(&self, samples_16k_mono: &[f32]) -> Result<Vec<f32>, String> {
        let s = samples_16k_mono;
        if s.len() < MIN_EMBED_SAMPLES {
            return Err(format!(
                "Too little audio for a voice embedding: {:.2} s, need at least {:.1} s",
                s.len() as f64 / SAMPLE_RATE as f64,
                MIN_EMBED_SAMPLES as f64 / SAMPLE_RATE as f64
            ));
        }
        if s.len() <= WINDOW_SAMPLES {
            let window: Vec<f32> = s.iter().copied().cycle().take(WINDOW_SAMPLES).collect();
            return normalized(self.embed_window(&window)?);
        }
        let hop = WINDOW_SAMPLES / 2;
        let mut starts: Vec<usize> = (0..=s.len() - WINDOW_SAMPLES).step_by(hop).collect();
        let last = s.len() - WINDOW_SAMPLES;
        if starts.last() != Some(&last) {
            starts.push(last);
        }
        let mut vectors = Vec::with_capacity(starts.len());
        for start in starts {
            vectors.push(normalized(self.embed_window(&s[start..start + WINDOW_SAMPLES])?)?);
        }
        mean_normalized(vectors.iter().map(|v| v.as_slice()))
            .ok_or_else(|| "The voice model returned an empty embedding".to_string())
    }
}

/// `v` scaled to unit length. `Err` for an empty, non-finite or zero vector.
pub fn normalized(mut v: Vec<f32>) -> Result<Vec<f32>, String> {
    if v.is_empty() || v.iter().any(|x| !x.is_finite()) {
        return Err("The voice embedding is empty or not a number".into());
    }
    let norm = v.iter().map(|x| (*x as f64) * (*x as f64)).sum::<f64>().sqrt();
    if norm < 1e-12 {
        return Err("The voice embedding is all zeros".into());
    }
    for x in &mut v {
        *x = (*x as f64 / norm) as f32;
    }
    Ok(v)
}

/// Cosine similarity, -1..=1. 0 for mismatched lengths or a zero vector.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let (mut dot, mut na, mut nb) = (0f64, 0f64, 0f64);
    for (x, y) in a.iter().zip(b) {
        dot += *x as f64 * *y as f64;
        na += *x as f64 * *x as f64;
        nb += *y as f64 * *y as f64;
    }
    if na < 1e-24 || nb < 1e-24 {
        return 0.0;
    }
    (dot / (na.sqrt() * nb.sqrt())).clamp(-1.0, 1.0) as f32
}

/// The normalised mean of `vectors` (all the same length). `None` when there
/// are none or they cancel out.
pub fn mean_normalized<'a>(vectors: impl Iterator<Item = &'a [f32]>) -> Option<Vec<f32>> {
    let mut sum: Vec<f64> = Vec::new();
    for v in vectors {
        if sum.is_empty() {
            sum = vec![0.0; v.len()];
        }
        if v.len() != sum.len() {
            return None;
        }
        for (s, x) in sum.iter_mut().zip(v) {
            *s += *x as f64;
        }
    }
    normalized(sum.into_iter().map(|x| x as f32).collect()).ok()
}

// ---------------------------------------------------------------------------
// A deterministic engine for tests
// ---------------------------------------------------------------------------

/// **Test and development only. Not a voice model.**
///
/// The embedding is the shape of the long-term spectrum of the window (root
/// mean mel energy per bin; the level goes when it is normalised). It tells apart
/// synthetic "voices" with different spectra (harmonic tones with different
/// fundamentals, noise in different bands), which is all the pipeline tests
/// need. On real speech it mostly measures the microphone and the room, and
/// it confuses any two people with similar pitch: it must never be shipped
/// as the quality path. It is compiled into tests only.
#[cfg(test)]
pub mod fake {
    use super::*;
    use crate::commands::speakers::fbank::{Fbank, NUM_MELS};
    use std::sync::atomic::{AtomicUsize, Ordering};

    pub const FAKE_MODEL_ID: &str = "spectral-baseline-test-only";

    pub struct SpectralEngine {
        fbank: Fbank,
        pub calls: AtomicUsize,
        /// Fail every call from this one on (0 = never), to test error paths.
        pub fail_from_call: usize,
    }

    impl Default for SpectralEngine {
        fn default() -> Self {
            Self { fbank: Fbank::new(), calls: AtomicUsize::new(0), fail_from_call: 0 }
        }
    }

    impl VoiceEngine for SpectralEngine {
        fn model_id(&self) -> &str {
            FAKE_MODEL_ID
        }

        fn dim(&self) -> usize {
            NUM_MELS
        }

        fn embed_window(&self, window: &[f32]) -> Result<Vec<f32>, String> {
            let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            if self.fail_from_call != 0 && call >= self.fail_from_call {
                return Err("the fake engine was told to fail".into());
            }
            if window.len() != WINDOW_SAMPLES {
                return Err(format!("window of {} samples", window.len()));
            }
            let raw = self.fbank.compute_raw(window);
            let frames = raw.len() / NUM_MELS;
            let mut v = vec![0f32; NUM_MELS];
            for f in 0..frames {
                for (bin, x) in v.iter_mut().enumerate() {
                    *x += raw[f * NUM_MELS + bin].exp() / frames as f32;
                }
            }
            for x in &mut v {
                *x = x.sqrt();
            }
            Ok(v)
        }
    }

    /// A synthetic "voice": a harmonic tone with fundamental `f0` whose
    /// harmonics are loudest around `formant` Hz (one resonance, an octave
    /// or so wide), with a slow vibrato so it is not perfectly stationary.
    /// Deterministic.
    pub fn voice(f0: f32, formant: f32, secs: f64) -> Vec<f32> {
        let n = (secs * SAMPLE_RATE as f64) as usize;
        (0..n)
            .map(|i| {
                let t = i as f64 / SAMPLE_RATE as f64;
                // Phase of the fundamental in cycles; the vibrato moves the
                // pitch by about one percent, five times a second.
                let cycles = f0 as f64 * t
                    + 0.01 * f0 as f64 / (2.0 * std::f64::consts::PI * 5.0)
                        * (2.0 * std::f64::consts::PI * 5.0 * t).sin();
                let mut s = 0f64;
                let mut k = 1;
                while f0 * (k as f32) < 7000.0 && k <= 60 {
                    let octaves = (f0 * k as f32 / formant).log2() as f64;
                    let gain = (-octaves * octaves / 0.25).exp() + 0.002;
                    s += gain * (2.0 * std::f64::consts::PI * cycles * k as f64).sin();
                    k += 1;
                }
                (0.2 * s) as f32
            })
            .collect()
    }

    pub fn silence(secs: f64) -> Vec<f32> {
        vec![0.0; (secs * SAMPLE_RATE as f64) as usize]
    }
}

#[cfg(test)]
mod tests {
    use super::fake::*;
    use super::*;

    #[test]
    fn normalising_and_cosine() {
        let v = normalized(vec![3.0, 4.0]).unwrap();
        assert!((v[0] - 0.6).abs() < 1e-6 && (v[1] - 0.8).abs() < 1e-6);
        assert!(normalized(vec![]).is_err());
        assert!(normalized(vec![0.0, 0.0]).is_err());
        assert!(normalized(vec![1.0, f32::NAN]).is_err());
        assert!((cosine(&[1.0, 0.0], &[2.0, 0.0]) - 1.0).abs() < 1e-6);
        assert!(cosine(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
        assert!((cosine(&[1.0, 0.0], &[-1.0, 0.0]) + 1.0).abs() < 1e-6);
        assert_eq!(cosine(&[1.0], &[1.0, 2.0]), 0.0);
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 2.0]), 0.0);
        let m = mean_normalized([[1.0f32, 0.0], [0.0, 1.0]].iter().map(|v| v.as_slice())).unwrap();
        assert!((m[0] - m[1]).abs() < 1e-6);
        assert!(mean_normalized(std::iter::empty()).is_none());
        assert!(mean_normalized([[1.0f32, 0.0], [-1.0, 0.0]].iter().map(|v| v.as_slice())).is_none());
    }

    #[test]
    fn embed_handles_every_length() {
        let e = SpectralEngine::default();
        let v = voice(120.0, 600.0, 6.0);
        // Too short.
        let err = e.embed(&v[..MIN_EMBED_SAMPLES - 1]).unwrap_err();
        assert!(err.starts_with("Too little audio for a voice embedding"), "{err}");
        // Short: one call, on a filled window.
        e.calls.store(0, std::sync::atomic::Ordering::SeqCst);
        let short = e.embed(&v[..MIN_EMBED_SAMPLES]).unwrap();
        assert_eq!(e.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        // Exactly a window: one call.
        e.calls.store(0, std::sync::atomic::Ordering::SeqCst);
        let exact = e.embed(&v[..WINDOW_SAMPLES]).unwrap();
        assert_eq!(e.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        // 6 s: windows at 0, 0.75, … 4.5 = 7 calls.
        e.calls.store(0, std::sync::atomic::Ordering::SeqCst);
        let long = e.embed(&v).unwrap();
        assert_eq!(e.calls.load(std::sync::atomic::Ordering::SeqCst), 7);
        // A length that is not a multiple of the hop still covers the tail.
        e.calls.store(0, std::sync::atomic::Ordering::SeqCst);
        e.embed(&v[..WINDOW_SAMPLES + 100]).unwrap();
        assert_eq!(e.calls.load(std::sync::atomic::Ordering::SeqCst), 2);
        for x in [&short, &exact, &long] {
            let norm: f32 = x.iter().map(|a| a * a).sum::<f32>().sqrt();
            assert!((norm - 1.0).abs() < 1e-4);
            assert_eq!(x.len(), e.dim());
        }
        assert!(cosine(&exact, &long) > 0.9, "{}", cosine(&exact, &long));
        assert!(cosine(&short, &long) > 0.5, "{}", cosine(&short, &long));
    }

    #[test]
    fn the_fake_engine_separates_synthetic_voices_and_is_deterministic() {
        let e = SpectralEngine::default();
        let a1 = e.embed(&voice(110.0, 500.0, 3.0)).unwrap();
        let a2 = e.embed(&voice(110.0, 500.0, 4.0)).unwrap();
        let b = e.embed(&voice(180.0, 1500.0, 3.0)).unwrap();
        let c = e.embed(&voice(240.0, 3500.0, 3.0)).unwrap();
        assert_eq!(a1, e.embed(&voice(110.0, 500.0, 3.0)).unwrap());
        assert!(cosine(&a1, &a2) > 0.95, "same voice {}", cosine(&a1, &a2));
        for (name, other) in [("b", &b), ("c", &c)] {
            assert!(cosine(&a1, other) < 0.5, "a vs {name}: {}", cosine(&a1, other));
        }
        assert!(cosine(&b, &c) < 0.5, "b vs c: {}", cosine(&b, &c));
    }

    #[test]
    fn an_engine_error_is_passed_on() {
        let mut e = SpectralEngine::default();
        e.fail_from_call = 2;
        assert!(e.embed(&voice(110.0, 500.0, 1.0)).is_ok());
        assert_eq!(e.embed(&voice(110.0, 500.0, 4.0)).unwrap_err(), "the fake engine was told to fail");
    }
}
