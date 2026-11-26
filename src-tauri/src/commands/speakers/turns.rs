//! From labelled windows to speaker turns, per-speaker voice vectors and a
//! sample of each speaker to play back.

use super::engine::{cosine, mean_normalized};

/// Consecutive windows of one speaker are one turn when the pause between
/// them is at most this.
pub const TURN_MERGE_GAP_SECS: f64 = 1.0;
/// A turn shorter than this that touches a neighbour is given to it.
pub const MIN_TURN_SECS: f64 = 0.5;
/// "Touches": at most this far apart.
const ADJACENT_SECS: f64 = 0.3;
/// The sample offered for playback is at most this long…
pub const SAMPLE_MAX_SECS: f64 = 8.0;
/// …and, when the speaker has a turn that long, at least this long.
pub const SAMPLE_MIN_SECS: f64 = 5.0;

/// One embedded window. `own_*` is the part of the recording it speaks for.
#[derive(Debug, Clone, PartialEq)]
pub struct EmbeddedWindow {
    pub own_start: f64,
    pub own_end: f64,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Turn {
    pub start: f64,
    pub end: f64,
    pub speaker: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpeakerSummary {
    pub label: String,
    pub total_secs: f64,
    pub sample_start: f64,
    pub sample_end: f64,
    /// Normalised mean of the speaker's window embeddings.
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Diarization {
    pub turns: Vec<Turn>,
    pub speakers: Vec<SpeakerSummary>,
}

/// A window that disagrees with both of its direct neighbours, which agree
/// with each other, is taken to be theirs: one 0.75 s island inside a turn
/// is far more often a noisy embedding than an interjection.
pub fn smooth_labels(windows: &[EmbeddedWindow], labels: &mut [usize]) {
    for i in 1..labels.len().saturating_sub(1) {
        let touching = windows[i].own_start - windows[i - 1].own_end <= ADJACENT_SECS
            && windows[i + 1].own_start - windows[i].own_end <= ADJACENT_SECS;
        if touching && labels[i - 1] == labels[i + 1] && labels[i] != labels[i - 1] {
            labels[i] = labels[i - 1];
        }
    }
}

/// Merge raw `(start, end, label)` pieces into turns: same label and a pause
/// of at most [`TURN_MERGE_GAP_SECS`] with nobody else in between; then give
/// tiny turns to a touching neighbour.
fn merge_turns(mut pieces: Vec<(f64, f64, usize)>) -> Vec<(f64, f64, usize)> {
    pieces.retain(|p| p.1 > p.0);
    pieces.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut turns: Vec<(f64, f64, usize)> = Vec::new();
    for p in pieces {
        match turns.last_mut() {
            Some(last) if last.2 == p.2 && p.0 - last.1 <= TURN_MERGE_GAP_SECS => last.1 = last.1.max(p.1),
            _ => turns.push(p),
        }
    }
    // Tiny turns: absorbed by the longer touching neighbour.
    loop {
        let Some(i) = (0..turns.len()).find(|i| {
            let t = turns[*i];
            t.1 - t.0 < MIN_TURN_SECS
                && ((*i > 0 && t.0 - turns[*i - 1].1 <= ADJACENT_SECS)
                    || (*i + 1 < turns.len() && turns[*i + 1].0 - t.1 <= ADJACENT_SECS))
        }) else {
            break;
        };
        let t = turns[i];
        let left = (i > 0 && t.0 - turns[i - 1].1 <= ADJACENT_SECS).then(|| turns[i - 1].1 - turns[i - 1].0);
        let right = (i + 1 < turns.len() && turns[i + 1].0 - t.1 <= ADJACENT_SECS)
            .then(|| turns[i + 1].1 - turns[i + 1].0);
        let into_left = match (left, right) {
            (Some(l), Some(r)) => l >= r,
            (Some(_), None) => true,
            _ => false,
        };
        if into_left {
            turns[i - 1].1 = t.1;
        } else {
            turns[i + 1].0 = t.0;
        }
        turns.remove(i);
        // Neighbours of the same speaker may now touch.
        let mut merged: Vec<(f64, f64, usize)> = Vec::new();
        for p in turns.drain(..) {
            match merged.last_mut() {
                Some(last) if last.2 == p.2 && p.0 - last.1 <= TURN_MERGE_GAP_SECS => last.1 = last.1.max(p.1),
                _ => merged.push(p),
            }
        }
        turns = merged;
    }
    turns
}

/// The stretch of a speaker to play as their sample: from their best turn
/// (long, and sounding like the speaker's mean voice), cut to
/// [`SAMPLE_MAX_SECS`] and starting a little into the turn when there is
/// room, since the first half second is often shared with the previous
/// speaker.
fn pick_sample(turns: &[(f64, f64, f32)]) -> (f64, f64) {
    // A turn of at least SAMPLE_MIN_SECS, if the speaker has one.
    let long_enough: Vec<&(f64, f64, f32)> =
        turns.iter().filter(|t| t.1 - t.0 >= SAMPLE_MIN_SECS).collect();
    let pool: Vec<&(f64, f64, f32)> = if long_enough.is_empty() { turns.iter().collect() } else { long_enough };
    let best = pool.into_iter().max_by(|a, b| {
        let score = |t: &&(f64, f64, f32)| (t.1 - t.0).min(SAMPLE_MAX_SECS) * (t.2.max(0.05) as f64);
        score(a).partial_cmp(&score(b)).unwrap_or(std::cmp::Ordering::Equal)
    });
    let Some((start, end, _)) = best.copied() else { return (0.0, 0.0) };
    let len = end - start;
    if len <= SAMPLE_MAX_SECS {
        return (start, end);
    }
    let lead = ((len - SAMPLE_MAX_SECS) / 2.0).min(0.5);
    (start + lead, start + lead + SAMPLE_MAX_SECS)
}

/// Turn `windows` (ascending in time) with one cluster label each into
/// turns and speaker summaries. Speakers are named `<prefix><n>`, numbered
/// from `first_number` in order of first appearance.
pub fn build(
    windows: &[EmbeddedWindow],
    labels: &[usize],
    prefix: &str,
    first_number: usize,
) -> Diarization {
    assert_eq!(windows.len(), labels.len(), "one label per window");
    if windows.is_empty() {
        return Diarization::default();
    }
    let mut labels = labels.to_vec();
    smooth_labels(windows, &mut labels);

    let pieces: Vec<(f64, f64, usize)> =
        windows.iter().zip(&labels).map(|(w, l)| (w.own_start, w.own_end, *l)).collect();
    let merged = merge_turns(pieces);

    // Number speakers by first appearance among the turns that survived.
    let mut order: Vec<usize> = Vec::new();
    for t in &merged {
        if !order.contains(&t.2) {
            order.push(t.2);
        }
    }
    let name = |cluster: usize| {
        let n = order.iter().position(|c| *c == cluster).unwrap_or(0);
        format!("{prefix}{}", first_number + n)
    };

    let turns: Vec<Turn> =
        merged.iter().map(|t| Turn { start: t.0, end: t.1, speaker: name(t.2) }).collect();

    let speakers = order
        .iter()
        .filter_map(|cluster| {
            let members: Vec<&EmbeddedWindow> = windows
                .iter()
                .zip(&labels)
                .filter(|(_, l)| *l == cluster)
                .map(|(w, _)| w)
                .collect();
            let centroid = mean_normalized(members.iter().map(|w| w.embedding.as_slice()))?;
            let own: Vec<(f64, f64, f32)> = merged
                .iter()
                .filter(|t| t.2 == *cluster)
                .map(|t| {
                    // How much the windows inside this turn sound like the speaker.
                    let inside: Vec<f32> = members
                        .iter()
                        .filter(|w| w.own_start >= t.0 - 1e-6 && w.own_end <= t.1 + 1e-6)
                        .map(|w| cosine(&w.embedding, &centroid))
                        .collect();
                    let likeness = if inside.is_empty() {
                        0.0
                    } else {
                        inside.iter().sum::<f32>() / inside.len() as f32
                    };
                    (t.0, t.1, likeness)
                })
                .collect();
            let (sample_start, sample_end) = pick_sample(&own);
            Some(SpeakerSummary {
                label: name(*cluster),
                total_secs: own.iter().map(|t| t.1 - t.0).sum(),
                sample_start,
                sample_end,
                embedding: centroid,
            })
        })
        .collect();

    Diarization { turns, speakers }
}

/// Turns for a track that is one known person (the microphone of a two-track
/// recording): every stretch of speech is theirs.
pub fn single_speaker_turns(speech: &[(f64, f64)], label: &str) -> Vec<Turn> {
    merge_turns(speech.iter().map(|(s, e)| (*s, *e, 0)).collect())
        .into_iter()
        .map(|t| Turn { start: t.0, end: t.1, speaker: label.to_string() })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::speakers::cluster::testing::{near, voice, Rng};

    /// Windows of 0.75 s back to back from `start`, all near `v`.
    fn run(rng: &mut Rng, v: &[f32], start: f64, count: usize) -> Vec<EmbeddedWindow> {
        (0..count)
            .map(|i| EmbeddedWindow {
                own_start: start + i as f64 * 0.75,
                own_end: start + (i + 1) as f64 * 0.75,
                embedding: near(rng, v, 0.5),
            })
            .collect()
    }

    #[test]
    fn windows_become_turns_named_by_first_appearance() {
        let mut rng = Rng(1);
        let (a, b) = (voice(&mut rng, 32), voice(&mut rng, 32));
        let mut w = run(&mut rng, &a, 0.0, 4); // 0..3
        w.extend(run(&mut rng, &b, 3.0, 4)); // 3..6
        w.extend(run(&mut rng, &a, 10.0, 2)); // 10..11.5 (after a long pause)
        // Cluster ids are arbitrary: 5 = a, 2 = b.
        let labels = [5, 5, 5, 5, 2, 2, 2, 2, 5, 5];
        let d = build(&w, &labels, "speaker-", 1);
        assert_eq!(
            d.turns,
            vec![
                Turn { start: 0.0, end: 3.0, speaker: "speaker-1".into() },
                Turn { start: 3.0, end: 6.0, speaker: "speaker-2".into() },
                Turn { start: 10.0, end: 11.5, speaker: "speaker-1".into() },
            ]
        );
        assert_eq!(d.speakers.len(), 2);
        assert_eq!(d.speakers[0].label, "speaker-1");
        assert!((d.speakers[0].total_secs - 4.5).abs() < 1e-9);
        assert!((d.speakers[1].total_secs - 3.0).abs() < 1e-9);
        // The centroid is the speaker's voice.
        assert!(cosine(&d.speakers[0].embedding, &a) > 0.9);
        assert!(cosine(&d.speakers[1].embedding, &b) > 0.9);
        assert!(cosine(&d.speakers[0].embedding, &b) < 0.5);
        // Numbering can continue after another track's speakers.
        let d = build(&w, &labels, "speaker-", 4);
        assert_eq!(d.speakers[0].label, "speaker-4");
        assert_eq!(d.speakers[1].label, "speaker-5");
    }

    #[test]
    fn a_pause_within_the_merge_gap_keeps_one_turn_unless_someone_else_spoke() {
        let mut rng = Rng(2);
        let (a, b) = (voice(&mut rng, 32), voice(&mut rng, 32));
        let mut w = run(&mut rng, &a, 0.0, 2); // 0..1.5
        w.extend(run(&mut rng, &a, 2.3, 2)); // 0.8 s pause -> same turn
        let d = build(&w, &[0, 0, 0, 0], "speaker-", 1);
        assert_eq!(d.turns.len(), 1);
        assert_eq!((d.turns[0].start, d.turns[0].end), (0.0, 3.8));

        let mut w = run(&mut rng, &a, 0.0, 2);
        w.extend(run(&mut rng, &b, 1.5, 2));
        w.extend(run(&mut rng, &a, 3.0, 2));
        let d = build(&w, &[0, 0, 1, 1, 0, 0], "speaker-", 1);
        assert_eq!(d.turns.len(), 3);
    }

    #[test]
    fn a_single_odd_window_inside_a_turn_is_smoothed_away() {
        let mut rng = Rng(3);
        let a = voice(&mut rng, 32);
        let w = run(&mut rng, &a, 0.0, 5);
        let d = build(&w, &[0, 0, 1, 0, 0], "speaker-", 1);
        assert_eq!(d.turns.len(), 1);
        assert_eq!(d.speakers.len(), 1);
        // Two in a row are a real turn.
        let d = build(&w, &[0, 0, 1, 1, 0], "speaker-", 1);
        assert_eq!(d.turns.len(), 3);
        // An odd window at the very start or end is kept (nothing to compare).
        let d = build(&w, &[1, 0, 0, 0, 0], "speaker-", 1);
        assert_eq!(d.turns.len(), 2);
        // Not smoothed across a pause: the neighbours are not adjacent.
        let mut w = run(&mut rng, &a, 0.0, 1);
        w.extend(run(&mut rng, &a, 5.0, 1));
        w.extend(run(&mut rng, &a, 10.0, 1));
        let mut labels = [0, 1, 0];
        smooth_labels(&w, &mut labels);
        assert_eq!(labels, [0, 1, 0]);
    }

    #[test]
    fn tiny_turns_join_the_longer_touching_neighbour() {
        // 0.3 s of speaker 1 between 2 s of speaker 0 and 4 s of speaker 2.
        let merged = merge_turns(vec![(0.0, 2.0, 0), (2.0, 2.3, 1), (2.3, 6.3, 2)]);
        assert_eq!(merged, vec![(0.0, 2.0, 0), (2.0, 6.3, 2)]);
        // Isolated tiny turn: kept (it is all there is of that moment).
        let merged = merge_turns(vec![(0.0, 2.0, 0), (5.0, 5.3, 1), (9.0, 12.0, 0)]);
        assert_eq!(merged.len(), 3);
        // Absorbing it lets the two sides of one speaker join.
        let merged = merge_turns(vec![(0.0, 2.0, 0), (2.0, 2.2, 1), (2.2, 4.0, 0)]);
        assert_eq!(merged, vec![(0.0, 4.0, 0)]);
        // Unsorted and empty pieces are tolerated.
        let merged = merge_turns(vec![(3.0, 4.0, 1), (0.0, 1.0, 0), (2.0, 2.0, 0)]);
        assert_eq!(merged, vec![(0.0, 1.0, 0), (3.0, 4.0, 1)]);
        assert!(merge_turns(vec![]).is_empty());
    }

    #[test]
    fn the_sample_is_the_longest_clean_turn_cut_to_eight_seconds() {
        // Longest turn wins; cut to 8 s, starting half a second in.
        assert_eq!(pick_sample(&[(0.0, 3.0, 0.8), (10.0, 30.0, 0.8), (40.0, 46.0, 0.8)]), (10.5, 18.5));
        // Between 8 and 9 s: the lead shrinks so the cut stays inside.
        let (s, e) = pick_sample(&[(10.0, 18.4, 0.8)]);
        assert!((s - 10.2).abs() < 1e-9 && (e - 18.2).abs() < 1e-9);
        // Short turns only: the longest, whole.
        assert_eq!(pick_sample(&[(0.0, 2.0, 0.8), (5.0, 9.0, 0.8)]), (5.0, 9.0));
        // A clean 6 s turn beats a 7 s turn that does not sound like the speaker.
        assert_eq!(pick_sample(&[(0.0, 7.0, 0.3), (20.0, 26.0, 0.8)]), (20.0, 26.0));
        // A turn of five seconds or more is preferred to a cleaner short one.
        assert_eq!(pick_sample(&[(0.0, 5.5, 0.4), (20.0, 24.0, 0.9)]), (0.0, 5.5));
        assert_eq!(pick_sample(&[]), (0.0, 0.0));
    }

    #[test]
    fn sample_bounds_lie_inside_a_turn_of_that_speaker() {
        let mut rng = Rng(4);
        let (a, b) = (voice(&mut rng, 32), voice(&mut rng, 32));
        let mut w = run(&mut rng, &a, 0.0, 20); // 15 s
        w.extend(run(&mut rng, &b, 15.0, 4)); // 3 s
        let labels: Vec<usize> = (0..24).map(|i| usize::from(i >= 20)).collect();
        let d = build(&w, &labels, "speaker-", 1);
        let s1 = &d.speakers[0];
        assert!(s1.sample_start >= 0.0 && s1.sample_end <= 15.0);
        assert!((s1.sample_end - s1.sample_start - SAMPLE_MAX_SECS).abs() < 1e-9);
        let s2 = &d.speakers[1];
        assert_eq!((s2.sample_start, s2.sample_end), (15.0, 18.0));
    }

    #[test]
    fn empty_input_and_single_speaker_tracks() {
        assert_eq!(build(&[], &[], "speaker-", 1), Diarization::default());
        let turns = single_speaker_turns(&[(0.0, 2.0), (2.5, 4.0), (9.0, 10.0)], "me");
        assert_eq!(
            turns,
            vec![
                Turn { start: 0.0, end: 4.0, speaker: "me".into() },
                Turn { start: 9.0, end: 10.0, speaker: "me".into() },
            ]
        );
        assert!(single_speaker_turns(&[], "me").is_empty());
    }
}
