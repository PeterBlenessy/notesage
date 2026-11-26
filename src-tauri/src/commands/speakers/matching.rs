//! Suggesting who a speaker might be, from the remembered voices.
//!
//! This only ever SUGGESTS. Nothing here names a speaker; the frontend shows
//! the candidates and the user confirms or rejects them.

use super::engine::cosine;
use super::profiles::{normalize_name, VoiceProfile};
use serde::Serialize;

/// Cosine similarity between a speaker's voice vector and a profile from
/// which the match is called "likely".
///
/// Measured with the WeSpeaker ResNet34 model on clean speech (numbers in
/// `docs/features/speakers.md`): the same person in two different recordings
/// scored 0.60 to 0.71, two different people -0.23 to 0.39.
pub const LIKELY_SCORE: f32 = 0.55;
/// From here a match is "possible"; below it, it is not offered at all.
pub const POSSIBLE_SCORE: f32 = 0.42;
/// "Likely" also needs this much distance to the next best OTHER person;
/// two remembered voices that both fit are not a confident match.
pub const LIKELY_MARGIN: f32 = 0.08;
/// When the caller names the participants, the pool of candidates is small
/// and a wrong match less probable, so both thresholds drop by this much
/// for the people on the list.
pub const PARTICIPANT_BONUS: f32 = 0.05;
/// At most this many candidates per speaker.
pub const MAX_CANDIDATES: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Likely,
    Possible,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Candidate {
    pub profile_id: String,
    pub name: String,
    pub is_me: bool,
    /// Cosine similarity, -1..=1.
    pub score: f32,
    pub confidence: Confidence,
    /// Whether the person is on the participant list (always true when no
    /// list was given).
    pub participant: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SpeakerMatch {
    pub label: String,
    /// Best first. Empty when nobody fits.
    pub candidates: Vec<Candidate>,
}

/// Whether profile `name` is one of `participants`: the same name, or one is
/// the other's first name ("Anna" matches "Anna Berg"; "Anna B" does not
/// match "Anna Berg").
pub fn is_participant(name: &str, participants: &[String]) -> bool {
    let name = normalize_name(name);
    if name.is_empty() {
        return false;
    }
    participants.iter().map(|p| normalize_name(p)).any(|p| {
        if p.is_empty() {
            return false;
        }
        let first = |s: &str| s.split(' ').next().unwrap_or("").to_string();
        p == name
            || (!name.contains(' ') && first(&p) == name)
            || (!p.contains(' ') && first(&name) == p)
    })
}

/// How well `embedding` fits `profile`: the similarity to its mean voice.
fn score(embedding: &[f32], profile: &VoiceProfile) -> f32 {
    cosine(embedding, &profile.centroid)
}

/// Rank the remembered voices for each speaker.
///
/// - `participants`: when given (and not empty), only people on the list
///   are offered, plus the user's own profile (the user is in their own
///   meetings); thresholds are relaxed by [`PARTICIPANT_BONUS`] for them.
/// - One person is "likely" for at most one speaker of a recording: the
///   speaker they fit best. For the others they are at most "possible".
pub fn match_speakers(
    speakers: &[(String, Vec<f32>)],
    profiles: &[VoiceProfile],
    participants: Option<&[String]>,
) -> Vec<SpeakerMatch> {
    let participants = participants.filter(|p| p.iter().any(|x| !x.trim().is_empty()));
    let mut out: Vec<SpeakerMatch> = speakers
        .iter()
        .map(|(label, embedding)| {
            let mut scored: Vec<(f32, &VoiceProfile, bool)> = profiles
                .iter()
                .filter(|p| p.centroid.len() == embedding.len() && !embedding.is_empty())
                .filter_map(|p| {
                    let listed = participants.map(|list| is_participant(&p.name, list));
                    match listed {
                        // Restricted to the list (and the user).
                        Some(false) if !p.is_me => None,
                        _ => Some((score(embedding, p), p, listed.unwrap_or(true))),
                    }
                })
                .collect();
            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            let runner_up = scored.get(1).map(|s| s.0);
            let candidates = scored
                .iter()
                .enumerate()
                .filter_map(|(rank, (s, p, listed))| {
                    let bonus = if participants.is_some() && *listed { PARTICIPANT_BONUS } else { 0.0 };
                    let clear = rank == 0 && runner_up.map(|r| s - r >= LIKELY_MARGIN).unwrap_or(true);
                    let confidence = if *s >= LIKELY_SCORE - bonus && clear {
                        Confidence::Likely
                    } else if *s >= POSSIBLE_SCORE - bonus {
                        Confidence::Possible
                    } else {
                        return None;
                    };
                    Some(Candidate {
                        profile_id: p.id.clone(),
                        name: p.name.clone(),
                        is_me: p.is_me,
                        score: *s,
                        confidence,
                        participant: *listed,
                    })
                })
                .take(MAX_CANDIDATES)
                .collect();
            SpeakerMatch { label: label.clone(), candidates }
        })
        .collect();

    // One person cannot be two speakers: keep "likely" where they fit best.
    let mut best: Vec<(String, usize, f32)> = Vec::new(); // (profile, speaker index, score)
    for (i, m) in out.iter().enumerate() {
        if let Some(c) = m.candidates.first().filter(|c| c.confidence == Confidence::Likely) {
            match best.iter_mut().find(|b| b.0 == c.profile_id) {
                Some(b) if c.score > b.2 => *b = (c.profile_id.clone(), i, c.score),
                Some(_) => {}
                None => best.push((c.profile_id.clone(), i, c.score)),
            }
        }
    }
    for (i, m) in out.iter_mut().enumerate() {
        if let Some(c) = m.candidates.first_mut() {
            if c.confidence == Confidence::Likely && best.iter().any(|b| b.0 == c.profile_id && b.1 != i) {
                c.confidence = Confidence::Possible;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::speakers::cluster::testing::{near, voice, Rng};
    use crate::commands::speakers::engine::mean_normalized;

    const DIM: usize = 64;

    fn profile(id: &str, name: &str, examples: Vec<Vec<f32>>, is_me: bool) -> VoiceProfile {
        let centroid = mean_normalized(examples.iter().map(|v| v.as_slice())).unwrap();
        VoiceProfile {
            version: 1,
            id: id.into(),
            name: name.into(),
            is_me,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            sources: vec![],
            model: "m".into(),
            embeddings: examples,
            centroid,
        }
    }

    /// A speaker's vector as an analysis gives it: the mean of `n` windows.
    fn centroid_of(rng: &mut Rng, v: &[f32], n: usize, noise: f32) -> Vec<f32> {
        let windows: Vec<Vec<f32>> = (0..n).map(|_| near(rng, v, noise)).collect();
        mean_normalized(windows.iter().map(|w| w.as_slice())).unwrap()
    }

    fn top(m: &SpeakerMatch) -> Option<(&str, Confidence)> {
        m.candidates.first().map(|c| (c.name.as_str(), c.confidence))
    }

    #[test]
    fn thresholds_separate_same_and_different_voices_on_synthetic_clusters() {
        // Session-to-session variation is modelled as noise 0.7 on the mean
        // voice, which puts same-speaker scores where the real model has
        // them (0.6 to 0.7). Fifty people, each matched against everyone.
        const DIM: usize = 128;
        let mut rng = Rng(100);
        let people: Vec<Vec<f32>> = (0..50).map(|_| voice(&mut rng, DIM)).collect();
        let profiles: Vec<VoiceProfile> = people
            .iter()
            .enumerate()
            .map(|(i, v)| profile(&format!("p{i}"), &format!("Person {i}"), vec![near(&mut rng, v, 0.7)], false))
            .collect();
        let (mut same, mut different) = (Vec::new(), Vec::new());
        for (i, v) in people.iter().enumerate() {
            let heard = near(&mut rng, v, 0.7);
            for (j, p) in profiles.iter().enumerate() {
                if i == j { same.push(score(&heard, p)) } else { different.push(score(&heard, p)) }
            }
        }
        let min_same = same.iter().copied().fold(f32::INFINITY, f32::min);
        let max_diff = different.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let mean_same = same.iter().sum::<f32>() / same.len() as f32;
        assert!((0.5..0.75).contains(&mean_same), "the synthetic noise no longer resembles the model: {mean_same}");
        assert!(max_diff < POSSIBLE_SCORE, "a stranger would be offered: {max_diff}");
        // No same-speaker pair falls below "possible"; most are "likely".
        assert!(min_same >= POSSIBLE_SCORE, "a known voice would be missed: {min_same}");
        let likely = same.iter().filter(|s| **s >= LIKELY_SCORE).count();
        assert!(likely * 10 >= same.len() * 8, "only {likely} of {} likely", same.len());
        assert!(POSSIBLE_SCORE < LIKELY_SCORE && LIKELY_MARGIN > 0.0 && PARTICIPANT_BONUS < POSSIBLE_SCORE);
    }

    #[test]
    fn known_voices_are_suggested_and_strangers_are_not() {
        let mut rng = Rng(1);
        let (anna, bjorn, stranger) = (voice(&mut rng, DIM), voice(&mut rng, DIM), voice(&mut rng, DIM));
        let profiles = vec![
            profile("a", "Anna Berg", vec![near(&mut rng, &anna, 0.5), near(&mut rng, &anna, 0.5)], false),
            profile("b", "Björn Ek", vec![near(&mut rng, &bjorn, 0.5)], false),
        ];
        let speakers = vec![
            ("speaker-1".to_string(), centroid_of(&mut rng, &bjorn, 20, 0.9)),
            ("speaker-2".to_string(), centroid_of(&mut rng, &stranger, 20, 0.9)),
            ("speaker-3".to_string(), centroid_of(&mut rng, &anna, 20, 0.9)),
        ];
        let out = match_speakers(&speakers, &profiles, None);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].label, "speaker-1");
        assert_eq!(top(&out[0]), Some(("Björn Ek", Confidence::Likely)));
        assert!(out[1].candidates.is_empty(), "{:?}", out[1]);
        assert_eq!(top(&out[2]), Some(("Anna Berg", Confidence::Likely)));
        let c = &out[2].candidates[0];
        assert_eq!(c.profile_id, "a");
        assert!(c.participant && !c.is_me);
        assert!(c.score > LIKELY_SCORE && c.score <= 1.0);
    }

    /// A unit vector with cosine `c` to the unit vector `v`.
    fn at_cosine(rng: &mut Rng, v: &[f32], c: f32) -> Vec<f32> {
        // Orthogonalise a random vector against v, then mix.
        let r = voice(rng, v.len());
        let dot: f32 = r.iter().zip(v).map(|(a, b)| a * b).sum();
        let ortho: Vec<f32> = r.iter().zip(v).map(|(a, b)| a - dot * b).collect();
        let norm = ortho.iter().map(|x| x * x).sum::<f32>().sqrt();
        v.iter().zip(&ortho).map(|(a, o)| c * a + (1.0 - c * c).sqrt() * o / norm).collect()
    }

    #[test]
    fn the_bands_follow_the_named_thresholds() {
        let mut rng = Rng(2);
        let v = voice(&mut rng, DIM);
        let profiles = vec![profile("a", "Anna", vec![v.clone()], false)];
        let band = |c: f32, rng: &mut Rng| {
            let s = vec![("s".to_string(), at_cosine(rng, &v, c))];
            match_speakers(&s, &profiles, None)[0].candidates.first().map(|c| c.confidence)
        };
        assert_eq!(band(LIKELY_SCORE + 0.02, &mut rng), Some(Confidence::Likely));
        assert_eq!(band(LIKELY_SCORE - 0.02, &mut rng), Some(Confidence::Possible));
        assert_eq!(band(POSSIBLE_SCORE + 0.02, &mut rng), Some(Confidence::Possible));
        assert_eq!(band(POSSIBLE_SCORE - 0.02, &mut rng), None);
        assert_eq!(band(-0.5, &mut rng), None);
    }

    #[test]
    fn two_remembered_voices_that_both_fit_are_only_possible() {
        let mut rng = Rng(3);
        let v = voice(&mut rng, DIM);
        // Two profiles of nearly the same voice (twins, or one person saved twice).
        let profiles = vec![
            profile("a", "Anna", vec![near(&mut rng, &v, 0.2)], false),
            profile("b", "Anna (old)", vec![near(&mut rng, &v, 0.2)], false),
        ];
        let out = match_speakers(&[("s".to_string(), near(&mut rng, &v, 0.2))], &profiles, None);
        assert_eq!(out[0].candidates.len(), 2);
        assert!(out[0].candidates.iter().all(|c| c.confidence == Confidence::Possible), "{:?}", out[0]);
        assert!(out[0].candidates[0].score >= out[0].candidates[1].score);
    }

    #[test]
    fn one_person_is_likely_for_one_speaker_only() {
        let mut rng = Rng(4);
        let v = voice(&mut rng, DIM);
        let profiles = vec![profile("a", "Anna", vec![v.clone()], false)];
        // A speaker split in two by the analysis: both halves fit Anna.
        let speakers = vec![
            ("speaker-1".to_string(), at_cosine(&mut rng, &v, 0.70)),
            ("speaker-2".to_string(), at_cosine(&mut rng, &v, 0.85)),
        ];
        let out = match_speakers(&speakers, &profiles, None);
        assert_eq!(top(&out[0]), Some(("Anna", Confidence::Possible)));
        assert_eq!(top(&out[1]), Some(("Anna", Confidence::Likely)));
    }

    #[test]
    fn participants_restrict_and_relax() {
        let mut rng = Rng(5);
        let (anna, bjorn, me) = (voice(&mut rng, DIM), voice(&mut rng, DIM), voice(&mut rng, DIM));
        let profiles = vec![
            profile("a", "Anna Berg", vec![anna.clone()], false),
            profile("b", "Björn Ek", vec![bjorn.clone()], false),
            profile("m", "Peter", vec![me.clone()], true),
        ];
        let speakers = vec![
            ("speaker-1".to_string(), at_cosine(&mut rng, &anna, 0.9)),
            ("speaker-2".to_string(), at_cosine(&mut rng, &bjorn, 0.9)),
            ("speaker-3".to_string(), at_cosine(&mut rng, &me, 0.9)),
            // Just under "possible", inside the participant bonus.
            ("speaker-4".to_string(), at_cosine(&mut rng, &anna, POSSIBLE_SCORE - 0.02)),
        ];
        // Only Anna is in this meeting (given by first name only).
        let list = vec!["anna".to_string()];
        let out = match_speakers(&speakers, &profiles, Some(&list));
        assert_eq!(top(&out[0]), Some(("Anna Berg", Confidence::Likely)));
        assert!(out[1].candidates.is_empty(), "Björn is not a participant: {:?}", out[1]);
        // The user's own profile is always considered.
        assert_eq!(top(&out[2]), Some(("Peter", Confidence::Likely)));
        assert!(!out[2].candidates[0].participant);
        assert_eq!(top(&out[3]), Some(("Anna Berg", Confidence::Possible)));
        // Without the list that weak match is not offered, and Björn is.
        let free = match_speakers(&speakers, &profiles, None);
        assert!(free[3].candidates.is_empty());
        assert_eq!(top(&free[1]), Some(("Björn Ek", Confidence::Likely)));
        // An empty or blank list is no list.
        assert_eq!(match_speakers(&speakers, &profiles, Some(&[])), free);
        assert_eq!(match_speakers(&speakers, &profiles, Some(&[" ".to_string()])), free);
    }

    #[test]
    fn participant_names_match_on_full_name_or_first_name_only() {
        let list = |names: &[&str]| names.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(is_participant("Anna Berg", &list(&["anna  berg"])));
        assert!(is_participant("Anna Berg", &list(&["Björn", "ANNA"])));
        assert!(is_participant("Anna", &list(&["Anna Berg"])));
        assert!(!is_participant("Anna Berg", &list(&["Anna Ek"])));
        assert!(!is_participant("Anna B", &list(&["Anna Berg"])));
        assert!(!is_participant("Ann", &list(&["Anna Berg"])));
        assert!(!is_participant("", &list(&["Anna"])));
        assert!(!is_participant("Anna", &list(&["", " "])));
        assert!(!is_participant("Anna", &[]));
    }

    #[test]
    fn mismatched_sizes_empty_input_and_the_candidate_cap() {
        let mut rng = Rng(6);
        let v = voice(&mut rng, DIM);
        let profiles = vec![profile("a", "Anna", vec![v.clone()], false)];
        // An embedding of another size (another model) matches nothing.
        let out = match_speakers(&[("s".to_string(), vec![1.0; 8])], &profiles, None);
        assert!(out[0].candidates.is_empty());
        let out = match_speakers(&[("s".to_string(), vec![])], &profiles, None);
        assert!(out[0].candidates.is_empty());
        assert!(match_speakers(&[], &profiles, None).is_empty());
        assert!(match_speakers(&[("s".to_string(), v.clone())], &[], None)[0].candidates.is_empty());
        // Many near-identical profiles: at most MAX_CANDIDATES come back.
        let many: Vec<VoiceProfile> =
            (0..6).map(|i| profile(&format!("p{i}"), &format!("P{i}"), vec![near(&mut rng, &v, 0.1)], false)).collect();
        let out = match_speakers(&[("s".to_string(), v)], &many, None);
        assert_eq!(out[0].candidates.len(), MAX_CANDIDATES);
    }

    #[test]
    fn the_result_serialises_with_the_contract_field_names() {
        let mut rng = Rng(7);
        let v = voice(&mut rng, DIM);
        let profiles = vec![profile("a", "Anna", vec![v.clone()], true)];
        let json = serde_json::to_value(match_speakers(&[("me".to_string(), v)], &profiles, None)).unwrap();
        assert_eq!(json[0]["label"], "me");
        let c = &json[0]["candidates"][0];
        assert_eq!(c["profile_id"], "a");
        assert_eq!(c["name"], "Anna");
        assert_eq!(c["is_me"], true);
        assert_eq!(c["confidence"], "likely");
        assert_eq!(c["participant"], true);
        assert!(c["score"].as_f64().unwrap() > 0.99);
        assert_eq!(serde_json::to_string(&Confidence::Possible).unwrap(), "\"possible\"");
    }
}
