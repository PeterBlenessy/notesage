//! Where there is speech, and which windows of it to embed.
//!
//! Speech is found with an energy gate, like the silence skipping in
//! `transcribe::preprocess` but tuned for the opposite purpose: that one only
//! removes silences of two seconds and more (dropping speech would lose
//! words), this one must not hand the voice model stretches of room noise, so
//! it closes much shorter gaps and uses a higher threshold. A window of noise
//! that still gets through ends up in a cluster of its own, which is dropped
//! or absorbed later.

use super::engine::{MIN_EMBED_SAMPLES, WINDOW_SAMPLES};

/// Analysis frame: 20 ms at 16 kHz.
pub const FRAME: usize = 320;

/// A frame is speech at or above this fraction of the loud level (22 dB
/// below it).
const GATE_RELATIVE: f32 = 0.08;
/// The threshold never drops below this (about -68 dBFS)…
const GATE_FLOOR: f32 = 4e-4;
/// …and never rises above this (about -42 dBFS), so a quiet speaker next to a
/// loud one is kept.
const GATE_CEILING: f32 = 8e-3;
/// Below this loud level a block holds no speech at all (-80 dBFS).
const SILENT_BLOCK: f32 = 1e-4;
/// Pauses up to this long inside speech do not end a region (0.3 s).
const CLOSE_GAP_FRAMES: usize = 15;
/// Bursts shorter than this are not speech (0.2 s): clicks, key presses.
const MIN_SPEECH_FRAMES: usize = 10;
/// Regions are widened by this much on both sides (60 ms) to keep onsets.
const PAD_FRAMES: usize = 3;
/// How much of the loud level of earlier audio carries over to a later
/// block, so that a block of pure background noise is not judged against
/// itself.
const LEVEL_MEMORY: f32 = 0.5;

/// Distance between the starts of consecutive windows in a long stretch of
/// speech: 0.75 s (half a window).
pub const HOP_SAMPLES: usize = WINDOW_SAMPLES / 2;

/// Remembers how loud speech has been so far in a track.
#[derive(Debug, Default, Clone)]
pub struct LevelTracker {
    reference: f32,
}

fn frame_rms(samples: &[f32]) -> Vec<f32> {
    samples
        .chunks(FRAME)
        .map(|f| (f.iter().map(|s| s * s).sum::<f32>() / f.len() as f32).sqrt())
        .collect()
}

/// Stretches of speech in `samples` as `(start, end)` sample offsets,
/// ascending and non-overlapping.
pub fn speech_regions(samples: &[f32], tracker: &mut LevelTracker) -> Vec<(usize, usize)> {
    let rms = frame_rms(samples);
    if rms.is_empty() {
        return Vec::new();
    }
    let mut sorted = rms.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let loud = sorted[(sorted.len() * 95 / 100).min(sorted.len() - 1)];
    let reference = loud.max(tracker.reference * LEVEL_MEMORY);
    tracker.reference = tracker.reference.max(loud);
    if !reference.is_finite() || reference < SILENT_BLOCK {
        return Vec::new();
    }
    let threshold = (reference * GATE_RELATIVE).clamp(GATE_FLOOR, GATE_CEILING);

    // Runs of active frames.
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut start = None;
    for (i, level) in rms.iter().enumerate() {
        match (start, *level >= threshold) {
            (None, true) => start = Some(i),
            (Some(s), false) => {
                runs.push((s, i));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        runs.push((s, rms.len()));
    }
    // Close short pauses, then drop short bursts.
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for run in runs {
        match merged.last_mut() {
            Some(last) if run.0 - last.1 <= CLOSE_GAP_FRAMES => last.1 = run.1,
            _ => merged.push(run),
        }
    }
    merged.retain(|(s, e)| e - s >= MIN_SPEECH_FRAMES);
    // Pad, without running into the neighbours.
    let mut out: Vec<(usize, usize)> = Vec::new();
    for (s, e) in merged {
        let s = s.saturating_sub(PAD_FRAMES) * FRAME;
        let e = ((e + PAD_FRAMES) * FRAME).min(samples.len());
        match out.last_mut() {
            Some(last) if s <= last.1 => last.1 = e,
            _ => out.push((s, e)),
        }
    }
    out
}

/// One stretch of audio to embed, and the part of the recording it speaks
/// for when windows are turned into turns. Sample offsets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowPlan {
    pub start: usize,
    pub end: usize,
    pub own_start: usize,
    pub own_end: usize,
}

/// Windows for one speech region `[start, end)`.
///
/// - shorter than [`MIN_EMBED_SAMPLES`]: none;
/// - up to one window long: the region itself;
/// - longer: windows every [`HOP_SAMPLES`], the last one ending exactly at
///   the end of the region. Each window owns the time closest to its centre.
pub fn plan_windows(start: usize, end: usize) -> Vec<WindowPlan> {
    let len = end.saturating_sub(start);
    if len < MIN_EMBED_SAMPLES {
        return Vec::new();
    }
    if len <= WINDOW_SAMPLES {
        return vec![WindowPlan { start, end, own_start: start, own_end: end }];
    }
    let last = end - WINDOW_SAMPLES;
    let mut starts: Vec<usize> = (start..=last).step_by(HOP_SAMPLES).collect();
    match starts.last() {
        // A final window less than a quarter hop after the previous one adds
        // nothing: move the previous one instead.
        Some(prev) if last - prev < HOP_SAMPLES / 4 => *starts.last_mut().unwrap() = last,
        Some(_) => starts.push(last),
        None => starts.push(last),
    }
    starts.dedup();
    let centre = |s: usize| s + WINDOW_SAMPLES / 2;
    (0..starts.len())
        .map(|i| {
            let own_start =
                if i == 0 { start } else { (centre(starts[i - 1]) + centre(starts[i])) / 2 };
            let own_end = if i + 1 == starts.len() {
                end
            } else {
                (centre(starts[i]) + centre(starts[i + 1])) / 2
            };
            WindowPlan { start: starts[i], end: starts[i] + WINDOW_SAMPLES, own_start, own_end }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::speakers::engine::fake::{silence, voice};

    const SR: usize = 16_000;

    fn secs(regions: &[(usize, usize)]) -> Vec<(f64, f64)> {
        regions.iter().map(|(s, e)| (*s as f64 / SR as f64, *e as f64 / SR as f64)).collect()
    }

    #[test]
    fn finds_speech_between_silences() {
        let mut audio = silence(1.0);
        audio.extend(voice(120.0, 600.0, 2.0));
        audio.extend(silence(1.5));
        audio.extend(voice(200.0, 1500.0, 3.0));
        audio.extend(silence(0.5));
        let regions = secs(&speech_regions(&audio, &mut LevelTracker::default()));
        assert_eq!(regions.len(), 2, "{regions:?}");
        assert!((regions[0].0 - 0.94).abs() < 0.05 && (regions[0].1 - 3.06).abs() < 0.05, "{regions:?}");
        assert!((regions[1].0 - 4.44).abs() < 0.05 && (regions[1].1 - 7.56).abs() < 0.05, "{regions:?}");
    }

    #[test]
    fn short_pauses_are_closed_and_clicks_dropped() {
        let mut audio = voice(120.0, 600.0, 1.0);
        audio.extend(silence(0.2)); // a breath
        audio.extend(voice(120.0, 600.0, 1.0));
        audio.extend(silence(2.0));
        audio.extend(voice(120.0, 600.0, 0.1)); // a click
        audio.extend(silence(1.0));
        let regions = secs(&speech_regions(&audio, &mut LevelTracker::default()));
        assert_eq!(regions.len(), 1, "{regions:?}");
        assert!(regions[0].1 > 2.1 && regions[0].1 < 2.4);
    }

    #[test]
    fn silence_and_empty_input_have_no_speech() {
        assert!(speech_regions(&[], &mut LevelTracker::default()).is_empty());
        assert!(speech_regions(&silence(5.0), &mut LevelTracker::default()).is_empty());
        // Faint digital noise far below any speech level.
        let hiss: Vec<f32> = (0..SR * 3).map(|i| if i % 2 == 0 { 2e-5 } else { -2e-5 }).collect();
        assert!(speech_regions(&hiss, &mut LevelTracker::default()).is_empty());
    }

    #[test]
    fn a_block_of_background_noise_is_judged_against_earlier_speech() {
        let mut tracker = LevelTracker::default();
        let speech = voice(120.0, 600.0, 5.0);
        assert_eq!(speech_regions(&speech, &mut tracker).len(), 1);
        // The same thing 40 dB quieter (room tone), as a block of its own.
        let noise: Vec<f32> = speech.iter().map(|s| s * 0.01).collect();
        assert!(speech_regions(&noise, &mut tracker).is_empty());
        // Without the memory it would have been taken for speech.
        assert_eq!(speech_regions(&noise, &mut LevelTracker::default()).len(), 1);
    }

    #[test]
    fn a_quiet_speaker_next_to_a_loud_one_is_kept() {
        let mut audio = voice(120.0, 600.0, 2.0);
        audio.extend(silence(1.0));
        audio.extend(voice(200.0, 1500.0, 2.0).iter().map(|s| s * 0.1)); // 20 dB quieter
        let regions = speech_regions(&audio, &mut LevelTracker::default());
        assert_eq!(regions.len(), 2);
    }

    #[test]
    fn window_plans() {
        // Too short.
        assert!(plan_windows(0, MIN_EMBED_SAMPLES - 1).is_empty());
        assert!(plan_windows(10, 5).is_empty());
        // Short: the region itself.
        let short = plan_windows(100, 100 + SR);
        assert_eq!(short, vec![WindowPlan { start: 100, end: 100 + SR, own_start: 100, own_end: 100 + SR }]);
        // Exactly one window.
        assert_eq!(plan_windows(0, WINDOW_SAMPLES).len(), 1);
        // 6 s: starts at 0, 0.75 … 4.5 s.
        let w = plan_windows(1000, 1000 + 6 * SR);
        assert_eq!(w.len(), 7);
        assert_eq!(w[0].start, 1000);
        assert_eq!(w.last().unwrap().end, 1000 + 6 * SR);
        assert!(w.iter().all(|p| p.end - p.start == WINDOW_SAMPLES));
        // Owned spans tile the region exactly.
        assert_eq!(w[0].own_start, 1000);
        assert_eq!(w.last().unwrap().own_end, 1000 + 6 * SR);
        assert!(w.windows(2).all(|p| p[0].own_end == p[1].own_start));
        assert!(w.iter().all(|p| p.own_start >= p.start && p.own_end <= p.end && p.own_start < p.own_end));
        // A length that is not a multiple of the hop: the tail is covered.
        let w = plan_windows(0, 2 * SR + 4321);
        assert_eq!(w.last().unwrap().end, 2 * SR + 4321);
        assert!(w.windows(2).all(|p| p[0].own_end == p[1].own_start && p[0].start < p[1].start));
        // A tail of a few samples does not add a near-duplicate window.
        let w = plan_windows(0, WINDOW_SAMPLES + HOP_SAMPLES + 10);
        assert_eq!(w.len(), 2);
        assert_eq!(w[1].end, WINDOW_SAMPLES + HOP_SAMPLES + 10);
    }
}
