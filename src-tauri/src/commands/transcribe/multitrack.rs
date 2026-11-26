//! Putting separately transcribed tracks back together.
//!
//! A recording of "both" has a microphone track and a system-audio track on
//! a common clock. Each is transcribed on its own, which labels speech
//! without any voice analysis: the microphone is "me", system audio is
//! "others".
//!
//! One complication: with loudspeakers rather than headphones the microphone
//! also hears the others, so their words come out twice. A "me" segment whose
//! words are the same as what the others said at the same moment is that
//! echo and is dropped. This errs on the side of keeping: a short "me"
//! segment, or one that merely shares some words, stays.

use super::engine::EngineSegment;

pub const SPEAKER_ME: &str = "me";
pub const SPEAKER_OTHERS: &str = "others";

/// Slack when looking for what the others said "at the same time": the two
/// tracks are segmented independently, so boundaries differ.
const ECHO_WINDOW_SECS: f64 = 2.0;
/// Shorter "me" segments are never treated as echo: "Yes." said by both
/// sides at once is two people agreeing.
const ECHO_MIN_WORDS: usize = 3;
/// Share of a "me" segment's words that must appear, in order, in a
/// same-sized run of the others' words.
const ECHO_MATCH: f64 = 0.8;
/// Below this many words every word must match.
const ECHO_STRICT_BELOW: usize = 5;

/// The speaker label for a track role from the recorder.
pub fn speaker_for_role(role: &str) -> Result<&'static str, String> {
    match role {
        "mic" => Ok(SPEAKER_ME),
        "system" => Ok(SPEAKER_OTHERS),
        other => Err(format!("Unknown track role: {other}")),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpeakerSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,
}

/// Lowercased words with punctuation removed.
fn words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| w.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect::<String>())
        .filter(|w| !w.is_empty())
        .collect()
}

/// Length of the longest common subsequence.
fn lcs(a: &[String], b: &[String]) -> usize {
    let mut prev = vec![0usize; b.len() + 1];
    let mut cur = vec![0usize; b.len() + 1];
    for x in a {
        for (j, y) in b.iter().enumerate() {
            cur[j + 1] = if x == y { prev[j] + 1 } else { cur[j].max(prev[j + 1]) };
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// True when `me` repeats what `others` said around the same time.
fn is_echo(me: &EngineSegment, others: &[EngineSegment]) -> bool {
    let mine = words(&me.text);
    if mine.len() < ECHO_MIN_WORDS {
        return false;
    }
    let (from, to) = (me.start - ECHO_WINDOW_SECS, me.end + ECHO_WINDOW_SECS);
    let theirs: Vec<String> = others
        .iter()
        .filter(|o| o.end >= from && o.start <= to)
        .flat_map(|o| words(&o.text))
        .collect();
    if theirs.len() < mine.len().min(ECHO_MIN_WORDS) {
        return false;
    }
    let needed = if mine.len() < ECHO_STRICT_BELOW {
        mine.len()
    } else {
        (mine.len() as f64 * ECHO_MATCH).ceil() as usize
    };
    // An echo is a contiguous run of the others' words, so compare against
    // runs about as long as the segment, not against everything said nearby
    // (a long stretch of speech contains most common words in some order).
    let run = (mine.len() + mine.len() / 4 + 1).min(theirs.len());
    (0..=theirs.len() - run).any(|i| lcs(&mine, &theirs[i..i + run]) >= needed)
}

/// Remove from `me` the segments that are an echo of `others`.
pub fn dedupe_echo(me: Vec<EngineSegment>, others: &[EngineSegment]) -> Vec<EngineSegment> {
    if others.is_empty() {
        return me;
    }
    me.into_iter().filter(|seg| !is_echo(seg, others)).collect()
}

/// One list ordered by start time. Segments starting at the same instant
/// keep the order of `tracks`.
pub fn merge_tracks(tracks: Vec<(Option<&str>, Vec<EngineSegment>)>) -> Vec<SpeakerSegment> {
    let mut all: Vec<SpeakerSegment> = Vec::with_capacity(tracks.iter().map(|(_, s)| s.len()).sum());
    for (speaker, segments) in tracks {
        for s in segments {
            all.push(SpeakerSegment {
                start: s.start,
                end: s.end,
                text: s.text,
                speaker: speaker.map(|v| v.to_string()),
            });
        }
    }
    // Stable, so equal starts keep track order.
    all.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    all
}

/// Label, de-duplicate and merge tracks given as `(speaker, segments)`.
pub fn combine_tracks(mut tracks: Vec<(&'static str, Vec<EngineSegment>)>) -> Vec<SpeakerSegment> {
    let others: Vec<EngineSegment> = tracks
        .iter()
        .filter(|(speaker, _)| *speaker == SPEAKER_OTHERS)
        .flat_map(|(_, s)| s.iter().cloned())
        .collect();
    for (speaker, segments) in tracks.iter_mut() {
        if *speaker == SPEAKER_ME {
            *segments = dedupe_echo(std::mem::take(segments), &others);
        }
    }
    merge_tracks(tracks.into_iter().map(|(speaker, s)| (Some(speaker), s)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start: f64, end: f64, text: &str) -> EngineSegment {
        EngineSegment { start, end, text: text.to_string() }
    }

    #[test]
    fn roles_map_to_speakers() {
        assert_eq!(speaker_for_role("mic").unwrap(), "me");
        assert_eq!(speaker_for_role("system").unwrap(), "others");
        assert_eq!(speaker_for_role("mix").unwrap_err(), "Unknown track role: mix");
    }

    #[test]
    fn tracks_are_interleaved_by_start_time_with_speakers() {
        let me = vec![seg(0.0, 2.0, "Hello everyone."), seg(10.0, 12.0, "I agree with that.")];
        let others = vec![seg(3.0, 9.0, "Thanks for joining us today."), seg(13.0, 15.0, "Good.")];
        let merged = combine_tracks(vec![(SPEAKER_ME, me), (SPEAKER_OTHERS, others)]);
        let order: Vec<(&str, f64)> =
            merged.iter().map(|s| (s.speaker.as_deref().unwrap(), s.start)).collect();
        assert_eq!(order, vec![("me", 0.0), ("others", 3.0), ("me", 10.0), ("others", 13.0)]);
    }

    #[test]
    fn equal_starts_keep_track_order() {
        let merged = merge_tracks(vec![
            (Some("me"), vec![seg(5.0, 6.0, "a")]),
            (Some("others"), vec![seg(5.0, 6.0, "b")]),
        ]);
        assert_eq!(merged[0].speaker.as_deref(), Some("me"));
        assert_eq!(merged[1].speaker.as_deref(), Some("others"));
        // No speaker when there are no tracks.
        let single = merge_tracks(vec![(None, vec![seg(1.0, 2.0, "x")])]);
        assert_eq!(single[0].speaker, None);
    }

    #[test]
    fn the_microphone_copy_of_what_the_others_said_is_dropped() {
        let others = vec![seg(10.0, 15.0, "So the release is planned for next Thursday, right?")];
        // Same words, different punctuation and casing, shifted by a second.
        let me = vec![
            seg(10.8, 15.6, "so the release is planned for next thursday right"),
            seg(16.5, 18.0, "Yes, Thursday works for me."),
        ];
        let kept = dedupe_echo(me, &others);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].text, "Yes, Thursday works for me.");
    }

    #[test]
    fn an_echo_split_differently_from_the_original_is_still_found() {
        // The others' sentence is one long segment; the microphone heard it
        // as two, with one word misrecognised.
        let others = vec![seg(
            20.0,
            32.0,
            "We looked at the numbers from last quarter and the trend is clearly going up in every region",
        )];
        let me = vec![
            seg(20.5, 26.0, "We looked at the numbers from last quarter and the trend"),
            seg(26.0, 32.4, "is clearly going up in every reason"),
        ];
        assert!(dedupe_echo(me, &others).is_empty());
    }

    #[test]
    fn my_own_speech_is_kept_even_when_it_overlaps_and_shares_words() {
        let others = vec![seg(10.0, 20.0, "I think we should move the release to the week after and tell the customers")];
        let me = vec![
            // Talking over them about the same topic, different sentence.
            seg(12.0, 16.0, "No I think the release should stay where it is"),
            // Same words but a minute later: not "at the same time".
            seg(80.0, 90.0, "I think we should move the release to the week after and tell the customers"),
        ];
        assert_eq!(dedupe_echo(me.clone(), &others), me);
    }

    #[test]
    fn short_agreement_from_both_sides_is_kept() {
        let others = vec![seg(5.0, 6.0, "Yes."), seg(8.0, 9.0, "Okay, good.")];
        let me = vec![seg(5.2, 6.0, "Yes."), seg(8.1, 9.0, "Okay, good.")];
        assert_eq!(dedupe_echo(me.clone(), &others), me);
    }

    #[test]
    fn a_short_segment_must_match_completely() {
        let others = vec![seg(5.0, 8.0, "Can you hear me now?")];
        // Four words, three in common: kept.
        let me = vec![seg(5.5, 8.0, "Can you see me")];
        assert_eq!(dedupe_echo(me.clone(), &others), me);
        // Four words, all four echoed: dropped.
        let echo = vec![seg(5.5, 8.0, "can you hear me")];
        assert!(dedupe_echo(echo, &others).is_empty());
    }

    #[test]
    fn common_words_scattered_through_long_speech_are_not_an_echo() {
        // Every word of "me" occurs in order somewhere in a long monologue,
        // but never together.
        let others = vec![seg(
            0.0,
            30.0,
            "I went there yesterday and we talked for a while about what to do next and nobody could think \
of anything useful so in the end the meeting was over before it started",
        )];
        let me = vec![seg(10.0, 14.0, "I talked about the meeting")];
        assert_eq!(dedupe_echo(me.clone(), &others), me);
    }

    #[test]
    fn nothing_is_dropped_without_an_others_track_and_others_are_never_dropped() {
        let me = vec![seg(0.0, 3.0, "one two three four five")];
        assert_eq!(dedupe_echo(me.clone(), &[]), me);
        let merged = combine_tracks(vec![
            (SPEAKER_OTHERS, vec![seg(0.0, 3.0, "one two three four five")]),
            (SPEAKER_ME, vec![seg(0.2, 3.1, "one two three four five")]),
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].speaker.as_deref(), Some("others"));
    }

    #[test]
    fn words_ignore_case_punctuation_and_keep_swedish_letters() {
        assert_eq!(words("Hej, ÅSA! Går det bra?"), vec!["hej", "åsa", "går", "det", "bra"]);
        assert!(words(" ... ").is_empty());
    }
}
