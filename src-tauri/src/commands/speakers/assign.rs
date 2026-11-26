//! Giving each transcript segment the speaker whose turn it falls in.

use super::turns::Turn;

/// A segment with no overlapping turn takes the nearest turn if it is at
/// most this far away; otherwise it keeps the speaker it came with.
pub const NEAREST_TURN_SECS: f64 = 2.0;
/// A segment is split between two speakers only when each of them holds at
/// least this share of it…
const SPLIT_MIN_SHARE: f64 = 0.3;
/// …and at least this much time…
const SPLIT_MIN_SECS: f64 = 1.0;
/// …and the text has a sentence end within this distance (as a fraction of
/// the segment) of where the speakers change.
const SPLIT_TEXT_TOLERANCE: f64 = 0.2;

/// A transcript segment as it crosses IPC (`segments.json` shape).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
}

fn overlap(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.1.min(b.1) - a.0.max(b.0)).max(0.0)
}

/// Seconds each speaker holds of `[start, end)`, most first (ties: the one
/// who speaks first).
fn shares(start: f64, end: f64, turns: &[&Turn]) -> Vec<(String, f64, f64)> {
    // (label, seconds, first moment inside the segment)
    let mut out: Vec<(String, f64, f64)> = Vec::new();
    for t in turns {
        let o = overlap((start, end), (t.start, t.end));
        if o <= 0.0 {
            continue;
        }
        let first = t.start.max(start);
        match out.iter_mut().find(|x| x.0 == t.speaker) {
            Some(x) => {
                x.1 += o;
                x.2 = x.2.min(first);
            }
            None => out.push((t.speaker.clone(), o, first)),
        }
    }
    out.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
    });
    out
}

/// Byte offsets just after each sentence end inside `text` (not at its very
/// end): the only places a segment may be split, since Whisper segments
/// carry no word times and a sentence end is where a word gap is.
fn sentence_breaks(text: &str) -> Vec<usize> {
    let mut out = Vec::new();
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if matches!(c, '.' | '?' | '!' | '。' | '？' | '！') {
            if let Some((_, next)) = chars.peek() {
                if next.is_whitespace() {
                    let at = i + c.len_utf8();
                    if !text[at..].trim().is_empty() && !text[..at].trim().is_empty() {
                        out.push(at);
                    }
                }
            }
        }
    }
    out
}

/// Try to split `segment` where the speaker changes from `first` to
/// `second` at time `change`.
fn split_at_sentence(segment: &Segment, change: f64, first: &str, second: &str) -> Option<[Segment; 2]> {
    let len = segment.end - segment.start;
    if len <= 0.0 || segment.text.is_empty() {
        return None;
    }
    let wanted = (change - segment.start) / len;
    let total = segment.text.len() as f64;
    let best = sentence_breaks(&segment.text)
        .into_iter()
        .map(|at| (at, (at as f64 / total - wanted).abs()))
        .filter(|(_, off)| *off <= SPLIT_TEXT_TOLERANCE)
        .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))?;
    let (head, tail) = segment.text.split_at(best.0);
    Some([
        Segment { start: segment.start, end: change, text: head.trim().to_string(), speaker: Some(first.to_string()) },
        Segment { start: change, end: segment.end, text: tail.trim().to_string(), speaker: Some(second.to_string()) },
    ])
}

fn assign_one(segment: &Segment, turns: &[&Turn], out: &mut Vec<Segment>) {
    let held = shares(segment.start, segment.end, turns);
    match held.as_slice() {
        [] => {
            // Nobody's turn: the nearest one, if close.
            let mid = (segment.start + segment.end) / 2.0;
            let nearest = turns
                .iter()
                .map(|t| {
                    let d = if mid < t.start {
                        t.start - segment.end.min(t.start)
                    } else {
                        segment.start.max(t.end) - t.end
                    };
                    (d.max(0.0), *t)
                })
                .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
            let mut s = segment.clone();
            if let Some((d, t)) = nearest {
                if d <= NEAREST_TURN_SECS {
                    s.speaker = Some(t.speaker.clone());
                }
            }
            out.push(s);
        }
        [only] => out.push(Segment { speaker: Some(only.0.clone()), ..segment.clone() }),
        [a, b, ..] => {
            let len = (segment.end - segment.start).max(1e-9);
            let both_substantial = [a, b]
                .iter()
                .all(|x| x.1 >= SPLIT_MIN_SECS && x.1 / len >= SPLIT_MIN_SHARE);
            if both_substantial {
                // In speaking order; the change is where the later one starts.
                let (first, second) = if a.2 <= b.2 { (a, b) } else { (b, a) };
                if let Some(parts) = split_at_sentence(segment, second.2, &first.0, &second.0) {
                    out.extend(parts);
                    return;
                }
            }
            out.push(Segment { speaker: Some(a.0.clone()), ..segment.clone() });
        }
    }
}

/// Label every segment with a speaker from `turns`.
///
/// The speaker with the most time in the segment wins. A segment is split
/// in two only when two speakers each hold a substantial part of it AND the
/// text has a sentence end near the change; text is never cut mid-sentence.
///
/// `eligible(segment_speaker, turn_speaker)` restricts which turns a segment
/// may be given (in a two-track recording a segment transcribed from the
/// microphone track must not get a remote speaker). A segment with no
/// eligible turn within [`NEAREST_TURN_SECS`] keeps the speaker it came
/// with.
pub fn assign_speakers(
    segments: &[Segment],
    turns: &[Turn],
    eligible: &dyn Fn(Option<&str>, &str) -> bool,
) -> Vec<Segment> {
    let mut out = Vec::with_capacity(segments.len());
    for segment in segments {
        let candidates: Vec<&Turn> =
            turns.iter().filter(|t| eligible(segment.speaker.as_deref(), &t.speaker)).collect();
        assign_one(segment, &candidates, &mut out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(start: f64, end: f64, speaker: &str) -> Turn {
        Turn { start, end, speaker: speaker.into() }
    }

    fn seg(start: f64, end: f64, text: &str) -> Segment {
        Segment { start, end, text: text.into(), speaker: None }
    }

    fn any(_: Option<&str>, _: &str) -> bool {
        true
    }

    fn speakers(s: &[Segment]) -> Vec<&str> {
        s.iter().map(|x| x.speaker.as_deref().unwrap_or("-")).collect()
    }

    #[test]
    fn the_speaker_with_the_most_time_wins() {
        let turns = [turn(0.0, 5.0, "speaker-1"), turn(5.0, 10.0, "speaker-2")];
        let out = assign_speakers(
            &[seg(0.0, 4.0, "one"), seg(4.0, 7.0, "two"), seg(7.0, 9.0, "three")],
            &turns,
            &any,
        );
        assert_eq!(speakers(&out), ["speaker-1", "speaker-2", "speaker-2"]);
        assert_eq!(out[1].text, "two");
        assert_eq!((out[1].start, out[1].end), (4.0, 7.0));
    }

    #[test]
    fn several_turns_of_one_speaker_add_up() {
        // speaker-1 holds 1.2 + 1.2, speaker-2 holds 2.0 in the middle.
        let turns = [turn(0.0, 1.2, "speaker-1"), turn(1.2, 3.2, "speaker-2"), turn(3.2, 4.4, "speaker-1")];
        let out = assign_speakers(&[seg(0.0, 4.4, "no sentence end here")], &turns, &any);
        assert_eq!(speakers(&out), ["speaker-1"]);
    }

    #[test]
    fn a_segment_is_split_at_a_sentence_end_near_the_change() {
        let turns = [turn(0.0, 4.0, "speaker-1"), turn(4.0, 8.0, "speaker-2")];
        let out = assign_speakers(&[seg(0.0, 8.0, "Shall we start? Yes, let us begin now.")], &turns, &any);
        assert_eq!(out.len(), 2);
        assert_eq!(
            out[0],
            Segment { start: 0.0, end: 4.0, text: "Shall we start?".into(), speaker: Some("speaker-1".into()) }
        );
        assert_eq!(
            out[1],
            Segment { start: 4.0, end: 8.0, text: "Yes, let us begin now.".into(), speaker: Some("speaker-2".into()) }
        );
    }

    #[test]
    fn no_split_without_a_sentence_end_near_the_change() {
        let turns = [turn(0.0, 4.0, "speaker-1"), turn(4.0, 8.0, "speaker-2")];
        // No sentence end at all.
        let out = assign_speakers(&[seg(0.0, 8.0, "one long sentence without any break in it")], &turns, &any);
        assert_eq!(speakers(&out), ["speaker-1"]); // tie -> the first to speak
        // A sentence end, but far from the change (at 10 % of the text).
        let out = assign_speakers(
            &[seg(0.0, 8.0, "Hi. And then a very long stretch of words follows after that")],
            &turns,
            &any,
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "Hi. And then a very long stretch of words follows after that");
    }

    #[test]
    fn no_split_for_a_brief_intrusion() {
        // speaker-2 holds only 0.6 s of a 6 s segment.
        let turns = [turn(0.0, 5.4, "speaker-1"), turn(5.4, 9.0, "speaker-2")];
        let out = assign_speakers(&[seg(0.0, 6.0, "A long statement here. Yes.")], &turns, &any);
        assert_eq!(speakers(&out), ["speaker-1"]);
    }

    #[test]
    fn decimal_points_and_trailing_punctuation_are_not_sentence_ends() {
        assert!(sentence_breaks("It costs 3.5 million").is_empty());
        assert!(sentence_breaks("Done.").is_empty());
        assert!(sentence_breaks("Done. ").is_empty());
        assert_eq!(sentence_breaks("One. Two? Three"), vec![4, 9]);
        assert_eq!(sentence_breaks("Är det så? Ja."), vec!["Är det så?".len()]);
    }

    #[test]
    fn a_segment_outside_every_turn_takes_the_nearest_if_close() {
        let turns = [turn(0.0, 5.0, "speaker-1"), turn(20.0, 25.0, "speaker-2")];
        let out = assign_speakers(
            &[seg(5.5, 6.5, "close after"), seg(18.5, 19.5, "close before"), seg(10.0, 12.0, "far")],
            &turns,
            &any,
        );
        assert_eq!(speakers(&out), ["speaker-1", "speaker-2", "-"]);
        // The speaker it came with is kept when nothing is near.
        let mut far = seg(10.0, 12.0, "far");
        far.speaker = Some("others".into());
        assert_eq!(assign_speakers(&[far], &turns, &any)[0].speaker.as_deref(), Some("others"));
    }

    #[test]
    fn eligibility_keeps_microphone_segments_with_the_microphone_speaker() {
        let turns = [turn(0.0, 10.0, "speaker-1"), turn(2.0, 4.0, "me")];
        let eligible = |segment: Option<&str>, turn: &str| match segment {
            Some("me") => turn == "me",
            Some("others") => turn != "me",
            _ => true,
        };
        let mut mine = seg(2.0, 4.0, "mine");
        mine.speaker = Some("me".into());
        let mut theirs = seg(2.0, 4.0, "theirs");
        theirs.speaker = Some("others".into());
        let out = assign_speakers(&[mine, theirs], &turns, &eligible);
        assert_eq!(speakers(&out), ["me", "speaker-1"]);
    }

    #[test]
    fn no_turns_and_no_segments() {
        assert!(assign_speakers(&[], &[turn(0.0, 1.0, "speaker-1")], &any).is_empty());
        let out = assign_speakers(&[seg(0.0, 1.0, "x")], &[], &any);
        assert_eq!(out, vec![seg(0.0, 1.0, "x")]);
        // Zero-length and reversed segments do not panic.
        let turns = [turn(0.0, 5.0, "speaker-1")];
        let out = assign_speakers(&[seg(2.0, 2.0, "x"), seg(3.0, 1.0, "y")], &turns, &any);
        assert_eq!(speakers(&out), ["speaker-1", "speaker-1"]);
    }

    #[test]
    fn overlapping_turns_in_the_input_are_handled() {
        // Two people talking at once: the one with more time in the segment.
        let turns = [turn(0.0, 6.0, "speaker-1"), turn(1.0, 4.0, "speaker-2")];
        let out = assign_speakers(&[seg(0.0, 6.0, "talking over each other")], &turns, &any);
        assert_eq!(speakers(&out), ["speaker-1"]);
        let out = assign_speakers(&[seg(1.5, 3.5, "inside")], &turns, &any);
        assert_eq!(speakers(&out), ["speaker-1"]); // equal time -> first to speak
    }
}
