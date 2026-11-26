//! What happens to 16 kHz mono audio between the decoder and Whisper:
//! skipping long silences (with a map back to original time), raising quiet
//! input, and choosing where a long recording may be cut into parts.
//!
//! Whisper's own VAD (`set_vad_model_path`) needs a separate Silero model
//! file, which the app does not ship, so silence is found with an energy gate
//! instead. The gate is deliberately conservative: it only removes stretches
//! that are far below the level of the speech around them AND at least two
//! seconds long, because removing speech is worse than keeping silence.

use super::resample::TARGET_RATE;

/// Analysis frame: 20 ms at 16 kHz.
pub const FRAME: usize = 320;

const RATE: f64 = TARGET_RATE as f64;

/// A frame is "sound" at or above this fraction of the loud-frame level
/// (95th percentile): 30 dB below it.
const GATE_RELATIVE: f32 = 0.03;
/// The threshold never drops below this (about -74 dBFS)…
const GATE_FLOOR: f32 = 2e-4;
/// …and never rises above this (about -50 dBFS), so a quiet speaker in a
/// recording that also has a loud one is not gated out.
const GATE_CEILING: f32 = 3e-3;
/// Below this loud-frame level the whole block is treated as silence
/// (-80 dBFS: a muted microphone or a system-audio track nobody spoke on).
const SILENT_BLOCK: f32 = 1e-4;
/// Sound is extended by this much on both sides before silence is measured,
/// so word onsets and tails survive.
const MARGIN_FRAMES: usize = 15; // 0.3 s
/// Only silences at least this long (after the margins) are removed.
const MIN_SILENCE_FRAMES: usize = 100; // 2.0 s

/// Target RMS for quiet input (-20 dBFS).
const TARGET_RMS: f32 = 0.1;
/// Never amplify by more than this (20 dB): beyond it the noise floor is what
/// gets raised.
const MAX_GAIN: f32 = 10.0;
/// Peak ceiling after gain, so normalisation can never clip.
const PEAK_CEILING: f32 = 0.97;

/// Root-mean-square level of each whole [`FRAME`] (a trailing partial frame
/// counts as a frame of its own).
pub fn frame_rms(samples: &[f32]) -> Vec<f32> {
    samples
        .chunks(FRAME)
        .map(|f| (f.iter().map(|s| s * s).sum::<f32>() / f.len() as f32).sqrt())
        .collect()
}

/// Maps a time in the silence-trimmed audio back to the original audio.
#[derive(Debug, Clone, PartialEq)]
pub struct TimeMap {
    /// Kept stretches as `(original_start, original_end)` in samples,
    /// ascending and non-overlapping. Trimmed audio is their concatenation.
    kept: Vec<(usize, usize)>,
}

impl TimeMap {
    /// Nothing removed.
    pub fn identity(len: usize) -> Self {
        Self { kept: if len == 0 { Vec::new() } else { vec![(0, len)] } }
    }

    #[cfg(test)]
    pub fn kept_ranges(&self) -> &[(usize, usize)] {
        &self.kept
    }

    /// Length of the trimmed audio in samples.
    #[cfg(test)]
    pub fn trimmed_len(&self) -> usize {
        self.kept.iter().map(|(a, b)| b - a).sum()
    }

    /// Original time (seconds) of a segment START given in trimmed time. A
    /// time exactly on a cut belongs to the stretch that begins there.
    pub fn start_to_original(&self, trimmed_secs: f64) -> f64 {
        self.map(trimmed_secs, true)
    }

    /// Original time (seconds) of a segment END given in trimmed time. A time
    /// exactly on a cut belongs to the stretch that ends there, so a segment
    /// ending at a cut does not swallow the removed silence.
    pub fn end_to_original(&self, trimmed_secs: f64) -> f64 {
        self.map(trimmed_secs, false)
    }

    fn map(&self, trimmed_secs: f64, prefer_next: bool) -> f64 {
        let Some(last) = self.kept.last() else {
            return 0.0;
        };
        let t = (trimmed_secs.max(0.0) * RATE).round() as usize;
        let mut passed = 0usize;
        for (i, (a, b)) in self.kept.iter().enumerate() {
            let len = b - a;
            let is_last = i + 1 == self.kept.len();
            let inside = if prefer_next && !is_last { t < passed + len } else { t <= passed + len };
            if inside {
                return (a + (t - passed)) as f64 / RATE;
            }
            passed += len;
        }
        // Past the end (Whisper can overshoot by a frame): clamp.
        last.1 as f64 / RATE
    }
}

/// Remove long silences. Returns the trimmed audio and the map back.
///
/// A block with no sound at all returns an empty buffer and an empty map.
pub fn gate_silence(samples: &[f32]) -> (Vec<f32>, TimeMap) {
    if samples.is_empty() {
        return (Vec::new(), TimeMap { kept: Vec::new() });
    }
    let rms = frame_rms(samples);

    let mut sorted = rms.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let loud = sorted[((sorted.len() - 1) as f32 * 0.95) as usize];
    // The loudest frame decides "is there anything here": a block that is
    // silent for more than 95 % of its length still has its few words kept.
    let peak_frame = *sorted.last().unwrap_or(&0.0);
    if peak_frame < SILENT_BLOCK {
        return (Vec::new(), TimeMap { kept: Vec::new() });
    }
    let threshold = (loud * GATE_RELATIVE).clamp(GATE_FLOOR, GATE_CEILING);

    // Sound frames, widened by the margin on both sides.
    let n = rms.len();
    let mut sound = vec![false; n];
    for (i, level) in rms.iter().enumerate() {
        if *level >= threshold {
            let lo = i.saturating_sub(MARGIN_FRAMES);
            let hi = (i + MARGIN_FRAMES + 1).min(n);
            for flag in &mut sound[lo..hi] {
                *flag = true;
            }
        }
    }

    // Keep everything except silent runs of at least MIN_SILENCE_FRAMES.
    let mut kept: Vec<(usize, usize)> = Vec::new();
    let mut keep_start: Option<usize> = Some(0);
    let mut i = 0;
    while i < n {
        if sound[i] {
            if keep_start.is_none() {
                keep_start = Some(i);
            }
            i += 1;
            continue;
        }
        let run_start = i;
        while i < n && !sound[i] {
            i += 1;
        }
        if i - run_start >= MIN_SILENCE_FRAMES {
            if let Some(start) = keep_start.take() {
                if run_start > start {
                    kept.push((start * FRAME, run_start * FRAME));
                }
            }
        } else if keep_start.is_none() {
            keep_start = Some(run_start);
        }
    }
    if let Some(start) = keep_start {
        if n > start {
            kept.push((start * FRAME, samples.len()));
        }
    }
    if let Some(last) = kept.last_mut() {
        last.1 = last.1.min(samples.len());
    }

    if kept.len() == 1 && kept[0] == (0, samples.len()) {
        return (samples.to_vec(), TimeMap::identity(samples.len()));
    }
    let mut out = Vec::with_capacity(kept.iter().map(|(a, b)| b - a).sum());
    for (a, b) in &kept {
        out.extend_from_slice(&samples[*a..*b]);
    }
    (out, TimeMap { kept })
}

/// Gain that brings quiet audio up to a usable level: never below 1 (loud
/// input is left alone), never more than [`MAX_GAIN`], and never enough to
/// push the peak past [`PEAK_CEILING`].
pub fn normalisation_gain(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 1.0;
    }
    let mut peak = 0f32;
    let mut sum_sq = 0f64;
    for s in samples {
        peak = peak.max(s.abs());
        sum_sq += (*s as f64) * (*s as f64);
    }
    let rms = (sum_sq / samples.len() as f64).sqrt() as f32;
    if !peak.is_finite() || !rms.is_finite() || peak < SILENT_BLOCK || rms <= 0.0 {
        return 1.0;
    }
    let wanted = TARGET_RMS / rms;
    let ceiling = PEAK_CEILING / peak;
    wanted.min(ceiling).min(MAX_GAIN).max(1.0)
}

/// Apply [`normalisation_gain`] in place. Returns the gain used.
pub fn normalise(samples: &mut [f32]) -> f32 {
    let gain = normalisation_gain(samples);
    if gain > 1.02 {
        for s in samples.iter_mut() {
            *s *= gain;
        }
        gain
    } else {
        1.0
    }
}

/// Where to cut `samples` between `lo` and `hi` (sample indices): the middle
/// of the quietest half second in that range, so a part boundary falls in a
/// pause rather than through a word.
pub fn find_seam(samples: &[f32], lo: usize, hi: usize) -> usize {
    const WINDOW_FRAMES: usize = 25; // 0.5 s
    let hi = hi.min(samples.len());
    let lo = lo.min(hi);
    let frames = (hi - lo) / FRAME;
    if frames < WINDOW_FRAMES {
        return hi;
    }
    let energy: Vec<f64> = samples[lo..lo + frames * FRAME]
        .chunks_exact(FRAME)
        .map(|f| f.iter().map(|s| (*s as f64) * (*s as f64)).sum::<f64>())
        .collect();
    let mut window: f64 = energy[..WINDOW_FRAMES].iter().sum();
    let mut best = window;
    let mut best_at = 0usize;
    for i in WINDOW_FRAMES..frames {
        window += energy[i] - energy[i - WINDOW_FRAMES];
        // `<=`: among equally quiet places take the latest, for longer parts.
        if window <= best {
            best = window;
            best_at = i + 1 - WINDOW_FRAMES;
        }
    }
    lo + (best_at + WINDOW_FRAMES / 2) * FRAME
}

#[cfg(test)]
mod tests {
    use super::*;

    fn speech(secs: f64, amp: f32) -> Vec<f32> {
        let n = (secs * RATE) as usize;
        (0..n).map(|i| ((i as f32 * 0.05).sin()) * amp).collect()
    }

    fn silence(secs: f64) -> Vec<f32> {
        vec![0.0; (secs * RATE) as usize]
    }

    fn noise(secs: f64, amp: f32) -> Vec<f32> {
        // Deterministic low-level hiss.
        let mut state = 0x2545_F491u32;
        (0..(secs * RATE) as usize)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                ((state as f32 / u32::MAX as f32) - 0.5) * 2.0 * amp
            })
            .collect()
    }

    #[test]
    fn audio_without_long_silence_is_left_exactly_as_it_was() {
        let mut a = speech(3.0, 0.3);
        a.extend(silence(1.0)); // a pause, not a gap
        a.extend(speech(2.0, 0.3));
        let (out, map) = gate_silence(&a);
        assert_eq!(out, a);
        assert_eq!(map, TimeMap::identity(a.len()));
        assert_eq!(map.start_to_original(4.5), 4.5);
    }

    #[test]
    fn a_long_silence_is_removed_and_times_map_back() {
        // 5 s speech, 60 s silence, 5 s speech.
        let mut a = speech(5.0, 0.3);
        a.extend(silence(60.0));
        a.extend(speech(5.0, 0.3));
        let (out, map) = gate_silence(&a);

        // Kept: speech + 0.3 s margin each side of the gap.
        let trimmed_secs = out.len() as f64 / RATE;
        assert!((trimmed_secs - 10.6).abs() < 0.05, "trimmed to {trimmed_secs}s");
        assert_eq!(map.trimmed_len(), out.len());
        assert_eq!(map.kept_ranges().len(), 2);

        // 2 s into the trimmed audio is 2 s into the original.
        assert!((map.start_to_original(2.0) - 2.0).abs() < 1e-9);
        // 1 s after the cut is 1 s after the second stretch began (64.7 s).
        let cut = map.kept_ranges()[0].1 as f64 / RATE;
        let resume = map.kept_ranges()[1].0 as f64 / RATE;
        assert!((cut - 5.3).abs() < 0.03, "cut at {cut}");
        assert!((resume - 64.7).abs() < 0.03, "resumes at {resume}");
        assert!((map.start_to_original(cut + 1.0) - (resume + 1.0)).abs() < 1e-6);
        // Exactly on the cut: a start belongs after the gap, an end before it.
        assert!((map.start_to_original(cut) - resume).abs() < 1e-6);
        assert!((map.end_to_original(cut) - cut).abs() < 1e-6);
        // Past the end clamps to the end of the original.
        assert!((map.end_to_original(999.0) - 70.0).abs() < 1e-6);
    }

    #[test]
    fn leading_and_trailing_silence_are_removed_too() {
        let mut a = silence(30.0);
        a.extend(speech(4.0, 0.2));
        a.extend(silence(30.0));
        let (out, map) = gate_silence(&a);
        let secs = out.len() as f64 / RATE;
        assert!((secs - 4.6).abs() < 0.05, "kept {secs}s");
        assert!((map.start_to_original(0.3) - 30.0).abs() < 0.03);
    }

    #[test]
    fn a_silent_block_yields_nothing() {
        let (out, map) = gate_silence(&silence(20.0));
        assert!(out.is_empty());
        assert_eq!(map.trimmed_len(), 0);
        assert_eq!(map.start_to_original(3.0), 0.0);
        let (out, _) = gate_silence(&[]);
        assert!(out.is_empty());
    }

    #[test]
    fn a_few_words_in_a_mostly_silent_block_are_kept() {
        // 2 s of speech in 10 minutes of digital silence: far less than 5 %.
        let mut a = silence(300.0);
        a.extend(speech(2.0, 0.2));
        a.extend(silence(298.0));
        let (out, map) = gate_silence(&a);
        let secs = out.len() as f64 / RATE;
        assert!((secs - 2.6).abs() < 0.05, "kept {secs}s");
        assert!((map.start_to_original(0.3) - 300.0).abs() < 0.03);
    }

    #[test]
    fn quiet_speech_beside_loud_speech_is_not_gated() {
        // Loud speaker at 0.5, quiet one 40 dB down at 0.005 (rms 0.0035,
        // above the -50 dBFS ceiling of the threshold).
        let mut a = speech(5.0, 0.5);
        a.extend(speech(10.0, 0.005));
        a.extend(speech(5.0, 0.5));
        let (out, _) = gate_silence(&a);
        assert_eq!(out.len(), a.len(), "quiet speech was removed");
    }

    #[test]
    fn room_noise_between_speech_counts_as_silence_only_when_far_below_it() {
        // Hiss 46 dB below speech for 20 s: removed.
        let mut a = speech(5.0, 0.4);
        a.extend(noise(20.0, 0.002));
        a.extend(speech(5.0, 0.4));
        let (out, _) = gate_silence(&a);
        assert!(out.len() < a.len() / 2, "low hiss should be skipped");

        // Noise only 20 dB below speech: kept (it may be someone far away).
        let mut b = speech(5.0, 0.4);
        b.extend(noise(20.0, 0.07));
        b.extend(speech(5.0, 0.4));
        let (out, _) = gate_silence(&b);
        assert_eq!(out.len(), b.len());
    }

    #[test]
    fn quiet_input_is_raised_within_bounds_and_never_clips() {
        // rms ~0.0035 → wants 28x, capped at 10x.
        let mut quiet = speech(2.0, 0.005);
        let g = normalise(&mut quiet);
        assert!((g - MAX_GAIN).abs() < 1e-6, "gain {g}");

        // Moderately quiet: reaches the target rms.
        let mut mid = speech(2.0, 0.05);
        let g = normalise(&mut mid);
        assert!(g > 2.0 && g < 4.0, "gain {g}");
        let rms = (mid.iter().map(|s| s * s).sum::<f32>() / mid.len() as f32).sqrt();
        assert!((rms - TARGET_RMS).abs() < 0.005, "rms {rms}");

        // A click limits the gain: the peak never passes the ceiling.
        let mut clicky = speech(2.0, 0.02);
        clicky[100] = 0.9;
        let g = normalise(&mut clicky);
        assert!(g <= PEAK_CEILING / 0.9 + 1e-6, "gain {g}");
        assert!(clicky.iter().all(|s| s.abs() <= 1.0));

        // Loud input is not turned down, silence is not amplified.
        let mut loud = speech(1.0, 0.8);
        assert_eq!(normalise(&mut loud), 1.0);
        let mut nothing = silence(1.0);
        assert_eq!(normalise(&mut nothing), 1.0);
        assert_eq!(normalisation_gain(&[]), 1.0);
    }

    #[test]
    fn the_seam_lands_in_the_pause() {
        // Speech, a 1 s pause at 20..21 s, speech. Search 10..30 s.
        let mut a = speech(20.0, 0.3);
        a.extend(silence(1.0));
        a.extend(speech(9.0, 0.3));
        let seam = find_seam(&a, 10 * 16_000, 30 * 16_000);
        let secs = seam as f64 / RATE;
        assert!(secs > 20.1 && secs < 20.9, "seam at {secs}s");
    }

    #[test]
    fn the_seam_falls_back_to_the_end_of_a_too_short_range() {
        let a = speech(1.0, 0.3);
        assert_eq!(find_seam(&a, 15_000, 16_000), 16_000);
        assert_eq!(find_seam(&a, 20_000, 30_000), 16_000);
    }
}
