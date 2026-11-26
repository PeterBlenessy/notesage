//! One speaker analysis from audio to turns: find speech, embed windows of
//! it, group the windows into speakers, build turns.
//!
//! Audio arrives as a stream (the same streaming decode transcription uses)
//! and is handled half a minute at a time, so memory does not grow with the
//! length of the recording: what is kept per window is its embedding and
//! two timestamps.
//!
//! Generic over the engine and over where samples come from, so the whole
//! flow runs in tests with the fake engine and synthetic audio.

use super::assign::{assign_speakers, Segment};
use super::cluster::{cluster, ClusterParams, MAX_EXPECTED_SPEAKERS};
use super::engine::{mean_normalized, normalized, VoiceEngine, CANCELLED};
use super::fbank::SAMPLE_RATE;
use super::turns::{build, single_speaker_turns, EmbeddedWindow, Turn};
use super::vad::{plan_windows, speech_regions, LevelTracker, WindowPlan};
use std::sync::atomic::{AtomicBool, Ordering};

/// The label of the user's own voice in a two-track recording.
pub const ME: &str = "me";
/// Other speakers are `speaker-1`, `speaker-2`, … in order of appearance.
pub const SPEAKER_PREFIX: &str = "speaker-";

/// Audio is analysed in blocks of this length (30 s).
const BLOCK_SAMPLES: usize = 30 * SAMPLE_RATE;
/// A stretch of speech still open at the end of a block is carried into the
/// next one, unless it is longer than this (then it is cut at the block).
const MAX_CARRY_SAMPLES: usize = 20 * SAMPLE_RATE;
/// At most this many threads embed windows at once.
const MAX_THREADS: usize = 8;

/// For a track that is one known person, only every n-th window is
/// embedded (enough for that person's voice vector)…
pub const KNOWN_SPEAKER_STRIDE: usize = 6;
/// …and no more than this many in total.
pub const KNOWN_SPEAKER_MAX_WINDOWS: usize = 80;

const RATE: f64 = SAMPLE_RATE as f64;

/// What a track is, which decides how it is analysed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackKind {
    /// Any number of unknown speakers: every window is embedded.
    Unknown,
    /// One known person (the microphone of a two-track recording): speech is
    /// found, and a sparse sample of windows gives their voice vector.
    Known,
}

/// What analysing one track found.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TrackWindows {
    pub windows: Vec<EmbeddedWindow>,
    /// Every stretch of speech, in seconds.
    pub speech: Vec<(f64, f64)>,
    pub duration_secs: f64,
}

/// Receives the 16 kHz mono samples of one track block by block.
pub struct TrackAnalyzer<'a> {
    engine: &'a dyn VoiceEngine,
    kind: TrackKind,
    cancel: &'a AtomicBool,
    threads: usize,
    buf: Vec<f32>,
    /// Sample offset of `buf[0]` in the track.
    offset: usize,
    tracker: LevelTracker,
    planned: usize,
    out: TrackWindows,
}

impl<'a> TrackAnalyzer<'a> {
    pub fn new(engine: &'a dyn VoiceEngine, kind: TrackKind, cancel: &'a AtomicBool) -> Self {
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1).min(MAX_THREADS);
        Self {
            engine,
            kind,
            cancel,
            threads,
            buf: Vec::new(),
            offset: 0,
            tracker: LevelTracker::default(),
            planned: 0,
            out: TrackWindows::default(),
        }
    }

    #[cfg(test)]
    fn with_threads(mut self, threads: usize) -> Self {
        self.threads = threads.max(1);
        self
    }

    /// Feed more samples. Returns `Err(CANCELLED)` once the cancel flag is
    /// set, or the engine's error.
    pub fn push(&mut self, samples: &[f32]) -> Result<(), String> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.to_string());
        }
        self.buf.extend_from_slice(samples);
        while self.buf.len() >= BLOCK_SAMPLES + MAX_CARRY_SAMPLES {
            self.process(BLOCK_SAMPLES, false)?;
        }
        Ok(())
    }

    /// The most samples held at any time is bounded by this.
    #[cfg(test)]
    fn buffered(&self) -> usize {
        self.buf.len()
    }

    /// Analyse the first `len` samples of the buffer and drop them, except
    /// for a stretch of speech that is still open at the cut.
    fn process(&mut self, len: usize, last: bool) -> Result<(), String> {
        let len = len.min(self.buf.len());
        let mut regions = speech_regions(&self.buf[..len], &mut self.tracker);
        let mut consumed = len;
        if !last {
            if let Some((start, end)) = regions.last().copied() {
                // Open at the cut: leave it for the next round, where it is
                // seen whole.
                if end >= len && start > 0 && len - start <= MAX_CARRY_SAMPLES {
                    regions.pop();
                    consumed = start;
                }
            }
        }
        let mut plans: Vec<WindowPlan> = Vec::new();
        for (start, end) in &regions {
            self.out.speech.push(((self.offset + start) as f64 / RATE, (self.offset + end) as f64 / RATE));
            for plan in plan_windows(*start, *end) {
                let take = match self.kind {
                    TrackKind::Unknown => true,
                    TrackKind::Known => {
                        self.planned % KNOWN_SPEAKER_STRIDE == 0
                            && self.out.windows.len() + plans.len() < KNOWN_SPEAKER_MAX_WINDOWS
                    }
                };
                self.planned += 1;
                if take {
                    plans.push(plan);
                }
            }
        }
        let embeddings = self.embed_all(&plans)?;
        for (plan, embedding) in plans.iter().zip(embeddings) {
            self.out.windows.push(EmbeddedWindow {
                own_start: (self.offset + plan.own_start) as f64 / RATE,
                own_end: (self.offset + plan.own_end) as f64 / RATE,
                embedding,
            });
        }
        self.buf.drain(..consumed);
        self.offset += consumed;
        Ok(())
    }

    /// Embed every planned window of the current buffer, on several threads,
    /// in order.
    fn embed_all(&self, plans: &[WindowPlan]) -> Result<Vec<Vec<f32>>, String> {
        if plans.is_empty() {
            return Ok(Vec::new());
        }
        let threads = self.threads.min(plans.len()).max(1);
        let per = plans.len().div_ceil(threads);
        let (engine, cancel, buf) = (self.engine, self.cancel, &self.buf);
        let results: Vec<Result<Vec<Vec<f32>>, String>> = std::thread::scope(|scope| {
            let handles: Vec<_> = plans
                .chunks(per)
                .map(|chunk| {
                    scope.spawn(move || {
                        let mut out = Vec::with_capacity(chunk.len());
                        for plan in chunk {
                            if cancel.load(Ordering::Relaxed) {
                                return Err(CANCELLED.to_string());
                            }
                            out.push(engine.embed(&buf[plan.start..plan.end])?);
                        }
                        Ok(out)
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().unwrap_or_else(|_| Err("The voice model crashed".to_string())))
                .collect()
        });
        let mut all = Vec::with_capacity(plans.len());
        for r in results {
            all.extend(r?);
        }
        Ok(all)
    }

    /// The end of the track.
    pub fn finish(mut self) -> Result<TrackWindows, String> {
        while self.buf.len() > BLOCK_SAMPLES + MAX_CARRY_SAMPLES {
            self.process(BLOCK_SAMPLES, false)?;
        }
        if !self.buf.is_empty() {
            let len = self.buf.len();
            self.process(len, true)?;
        }
        if self.cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.to_string());
        }
        self.out.duration_secs = self.offset as f64 / RATE;
        Ok(self.out)
    }
}

// ---------------------------------------------------------------------------
// A whole recording
// ---------------------------------------------------------------------------

/// One analysed track of a recording.
#[derive(Debug, Clone, PartialEq)]
pub struct AnalyzedTrack {
    /// The path given for the track, passed through to speaker samples.
    pub path: String,
    pub kind: TrackKind,
    pub found: TrackWindows,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SpeakerSample {
    pub track_path: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SpeakerOut {
    pub label: String,
    pub total_secs: f64,
    pub sample: SpeakerSample,
    /// The speaker's voice vector for [`AnalysisOut::model`]. Empty when
    /// there was too little speech to compute one. Never written to a
    /// recording bundle.
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct AnalysisOut {
    pub turns: Vec<Turn>,
    pub speakers: Vec<SpeakerOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segments: Option<Vec<Segment>>,
    pub duration_secs: f64,
    /// The voice model the embeddings belong to.
    pub model: String,
}

/// Check `expected_speakers` as it arrives from the frontend.
pub fn validate_expected(expected: Option<u32>) -> Result<Option<usize>, String> {
    match expected {
        None | Some(0) => Ok(None),
        Some(n) if n as usize > MAX_EXPECTED_SPEAKERS => {
            Err(format!("expected_speakers must be at most {MAX_EXPECTED_SPEAKERS}"))
        }
        Some(n) => Ok(Some(n as usize)),
    }
}

/// The voice of the one person on a [`TrackKind::Known`] track: the mean of
/// the largest group of its windows (other voices leak into a microphone
/// track when the speakers are not headphones).
fn dominant_voice(windows: &[EmbeddedWindow]) -> Option<Vec<f32>> {
    let items: Vec<&[f32]> = windows.iter().map(|w| w.embedding.as_slice()).collect();
    let labels = cluster(&items, &ClusterParams::default());
    let k = labels.iter().copied().max()? + 1;
    let biggest = (0..k).max_by_key(|c| labels.iter().filter(|l| *l == c).count())?;
    mean_normalized(items.iter().zip(&labels).filter(|(_, l)| **l == biggest).map(|(v, _)| *v))
}

/// Turn the analysed tracks of one recording into turns and speakers.
///
/// - A `Known` track is the user: its speech becomes `me` turns.
/// - Every `Unknown` track is diarised on its own; speakers are numbered
///   `speaker-1`, `speaker-2`, … across tracks, in track order.
///
/// `expected_speakers` counts the speakers of the `Unknown` tracks only (not
/// `me`); with more than one such track it applies to the first.
pub fn assemble(
    tracks: &[AnalyzedTrack],
    expected_speakers: Option<usize>,
    segments: Option<&[Segment]>,
    model: &str,
) -> AnalysisOut {
    let mut turns: Vec<Turn> = Vec::new();
    let mut speakers: Vec<SpeakerOut> = Vec::new();
    // Which track each label belongs to, for segment eligibility.
    let mut label_track: Vec<(String, usize)> = Vec::new();
    let mut next_number = 1;
    let mut first_unknown = true;

    for (index, track) in tracks.iter().enumerate() {
        match track.kind {
            TrackKind::Known => {
                let mine = single_speaker_turns(&track.found.speech, ME);
                if mine.is_empty() {
                    continue;
                }
                let total_secs = mine.iter().map(|t| t.end - t.start).sum();
                let longest = mine
                    .iter()
                    .max_by(|a, b| (a.end - a.start).partial_cmp(&(b.end - b.start)).unwrap_or(std::cmp::Ordering::Equal))
                    .expect("non-empty");
                let end = longest.end.min(longest.start + super::turns::SAMPLE_MAX_SECS);
                speakers.push(SpeakerOut {
                    label: ME.to_string(),
                    total_secs,
                    sample: SpeakerSample { track_path: track.path.clone(), start: longest.start, end },
                    embedding: dominant_voice(&track.found.windows).unwrap_or_default(),
                });
                label_track.push((ME.to_string(), index));
                turns.extend(mine);
            }
            TrackKind::Unknown => {
                let items: Vec<&[f32]> =
                    track.found.windows.iter().map(|w| w.embedding.as_slice()).collect();
                let params = ClusterParams {
                    expected: if first_unknown { expected_speakers } else { None },
                    ..Default::default()
                };
                first_unknown = false;
                let labels = cluster(&items, &params);
                let d = build(&track.found.windows, &labels, SPEAKER_PREFIX, next_number);
                next_number += d.speakers.len();
                for s in d.speakers {
                    label_track.push((s.label.clone(), index));
                    speakers.push(SpeakerOut {
                        label: s.label,
                        total_secs: s.total_secs,
                        sample: SpeakerSample {
                            track_path: track.path.clone(),
                            start: s.sample_start,
                            end: s.sample_end,
                        },
                        embedding: s.embedding,
                    });
                }
                turns.extend(d.turns);
            }
        }
    }
    turns.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));

    // `me` first, then speakers by number.
    speakers.sort_by_key(|s| s.label != ME);

    let has_me = label_track.iter().any(|(l, _)| l == ME);
    let multi_track = tracks.len() > 1;
    let segments = segments.map(|segments| {
        let eligible = |segment: Option<&str>, turn: &str| -> bool {
            if !multi_track {
                return true;
            }
            match segment {
                // Transcribed from the microphone track.
                Some(ME) => {
                    if has_me {
                        turn == ME
                    } else {
                        label_track.iter().any(|(l, t)| l == turn && tracks[*t].path == tracks[0].path)
                    }
                }
                // Transcribed from the system-audio track.
                Some("others") => {
                    if has_me {
                        turn != ME
                    } else {
                        label_track.iter().any(|(l, t)| l == turn && tracks[*t].path != tracks[0].path)
                    }
                }
                _ => true,
            }
        };
        assign_speakers(segments, &turns, &eligible)
    });

    AnalysisOut {
        turns,
        speakers,
        segments,
        duration_secs: tracks.iter().map(|t| t.found.duration_secs).fold(0.0, f64::max),
        model: model.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Voice vectors for turns that are already known (Teams transcripts)
// ---------------------------------------------------------------------------

/// A named speaker needs at least this much clean speech for a voice vector.
pub const MIN_CLEAN_SPEECH_SECS: f64 = 6.0;
/// Turns shorter than this are not used.
pub const MIN_NAMED_TURN_SECS: f64 = 1.0;
/// This much is cut off both ends of every turn: turn times from a meeting
/// transcript are approximate, and the edges are where two people overlap.
const TURN_EDGE_SECS: f64 = 0.25;
/// At most this many windows per speaker are embedded.
pub const MAX_WINDOWS_PER_NAMED_SPEAKER: usize = 40;
/// With at least this many windows, the fifth that sound least like the
/// rest are left out (someone else talking over the turn).
const TRIM_FROM_WINDOWS: usize = 5;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct NamedEmbedding {
    pub speaker: String,
    pub embedding: Vec<f32>,
    /// Seconds of clean speech the embedding was computed from.
    pub total_secs: f64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SkippedSpeaker {
    pub speaker: String,
    /// Why there is no embedding. Starts with one of the `SKIP_*` texts.
    pub reason: String,
    pub total_secs: f64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct NamedEmbeddings {
    pub speakers: Vec<NamedEmbedding>,
    pub skipped: Vec<SkippedSpeaker>,
    pub model: String,
}

pub const SKIP_TOO_LITTLE: &str = "Too little clean speech";

/// The parts of each speaker's turns in which nobody else has a turn, with
/// the edges trimmed, as `(speaker, start, end)`; only stretches of at
/// least [`MIN_NAMED_TURN_SECS`]. Speakers in order of first appearance.
pub fn clean_stretches(turns: &[Turn]) -> Vec<(String, f64, f64)> {
    let mut out = Vec::new();
    for (i, t) in turns.iter().enumerate() {
        if !(t.end > t.start) || !t.start.is_finite() || !t.end.is_finite() || t.start < 0.0 {
            continue;
        }
        // Subtract every other speaker's turn.
        let mut pieces = vec![(t.start, t.end)];
        for (j, other) in turns.iter().enumerate() {
            if i == j || other.speaker == t.speaker || !(other.end > other.start) {
                continue;
            }
            pieces = pieces
                .into_iter()
                .flat_map(|(s, e)| {
                    let mut parts = Vec::new();
                    if other.start > s {
                        parts.push((s, e.min(other.start)));
                    }
                    if other.end < e {
                        parts.push((s.max(other.end), e));
                    }
                    parts.into_iter().filter(|(s, e)| e > s)
                })
                .collect();
        }
        for (s, e) in pieces {
            let (s, e) = (s + TURN_EDGE_SECS, e - TURN_EDGE_SECS);
            if e - s >= MIN_NAMED_TURN_SECS {
                out.push((t.speaker.clone(), s, e));
            }
        }
    }
    out.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    out
}

/// Collects the audio of the stretches a set of named turns needs from a
/// stream, then embeds it. Only the wanted stretches are held in memory
/// (capped per speaker).
pub struct NamedTurnCollector {
    /// (speaker, start sample, end sample, samples collected so far)
    wanted: Vec<(String, usize, usize, Vec<f32>)>,
    position: usize,
}

impl NamedTurnCollector {
    pub fn new(turns: &[Turn]) -> Self {
        let per_speaker_cap = MAX_WINDOWS_PER_NAMED_SPEAKER as f64 * 1.5;
        let mut budget: Vec<(String, f64)> = Vec::new();
        let mut wanted = Vec::new();
        for (speaker, start, end) in clean_stretches(turns) {
            let used = match budget.iter_mut().find(|b| b.0 == speaker) {
                Some(b) => b,
                None => {
                    budget.push((speaker.clone(), 0.0));
                    budget.last_mut().expect("just pushed")
                }
            };
            let room = per_speaker_cap - used.1;
            if room < MIN_NAMED_TURN_SECS {
                continue;
            }
            let end = end.min(start + room);
            used.1 += end - start;
            wanted.push((speaker, (start * RATE) as usize, (end * RATE) as usize, Vec::new()));
        }
        Self { wanted, position: 0 }
    }

    /// True when the turns ask for nothing usable.
    pub fn is_empty(&self) -> bool {
        self.wanted.is_empty()
    }

    /// The sample after the last one any stretch needs.
    pub fn last_needed(&self) -> usize {
        self.wanted.iter().map(|w| w.2).max().unwrap_or(0)
    }

    pub fn push(&mut self, samples: &[f32]) {
        let (from, to) = (self.position, self.position + samples.len());
        for (_, start, end, got) in &mut self.wanted {
            let (a, b) = ((*start).max(from), (*end).min(to));
            if a < b {
                got.extend_from_slice(&samples[a - from..b - from]);
            }
        }
        self.position = to;
    }

    /// Embed what was collected. `speaker_order` lists every speaker of the
    /// input turns, so those with nothing usable are reported as skipped.
    pub fn finish(
        self,
        engine: &dyn VoiceEngine,
        speaker_order: &[String],
        cancel: &AtomicBool,
    ) -> Result<NamedEmbeddings, String> {
        let mut speakers = Vec::new();
        let mut skipped = Vec::new();
        for name in speaker_order {
            let mut vectors: Vec<Vec<f32>> = Vec::new();
            let mut total_secs = 0.0;
            for (_, _, _, samples) in self.wanted.iter().filter(|w| &w.0 == name) {
                // The file may have ended before the turn did.
                if (samples.len() as f64) < MIN_NAMED_TURN_SECS * RATE {
                    continue;
                }
                total_secs += samples.len() as f64 / RATE;
                for plan in plan_windows(0, samples.len()) {
                    if cancel.load(Ordering::Relaxed) {
                        return Err(CANCELLED.to_string());
                    }
                    if vectors.len() < MAX_WINDOWS_PER_NAMED_SPEAKER {
                        vectors.push(engine.embed(&samples[plan.start..plan.end])?);
                    }
                }
            }
            if total_secs < MIN_CLEAN_SPEECH_SECS || vectors.is_empty() {
                skipped.push(SkippedSpeaker {
                    speaker: name.clone(),
                    reason: format!(
                        "{SKIP_TOO_LITTLE}: {total_secs:.1} s, need at least {MIN_CLEAN_SPEECH_SECS:.0} s spoken alone"
                    ),
                    total_secs,
                });
                continue;
            }
            match trimmed_mean(&vectors) {
                Some(embedding) => speakers.push(NamedEmbedding { speaker: name.clone(), embedding, total_secs }),
                None => skipped.push(SkippedSpeaker {
                    speaker: name.clone(),
                    reason: "No usable voice embedding".into(),
                    total_secs,
                }),
            }
        }
        Ok(NamedEmbeddings { speakers, skipped, model: engine.model_id().to_string() })
    }
}

/// The mean voice of `vectors` without the fifth that fit it worst.
pub fn trimmed_mean(vectors: &[Vec<f32>]) -> Option<Vec<f32>> {
    let all = mean_normalized(vectors.iter().map(|v| v.as_slice()))?;
    if vectors.len() < TRIM_FROM_WINDOWS {
        return Some(all);
    }
    let mut scored: Vec<(f32, &Vec<f32>)> =
        vectors.iter().map(|v| (super::engine::cosine(v, &all), v)).collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let keep = vectors.len() - vectors.len() / 5;
    mean_normalized(scored[..keep].iter().map(|(_, v)| v.as_slice())).or(Some(all))
}

/// Speakers of `turns` in order of first appearance.
pub fn speaker_order(turns: &[Turn]) -> Vec<String> {
    let mut sorted: Vec<&Turn> = turns.iter().collect();
    sorted.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    let mut order: Vec<String> = Vec::new();
    for t in sorted {
        if !order.contains(&t.speaker) {
            order.push(t.speaker.clone());
        }
    }
    order
}

/// The voice of the one person speaking in `found` (an enrolment sample):
/// the dominant voice, provided there is enough speech.
pub fn enrolment_embedding(found: &TrackWindows) -> Result<Vec<f32>, String> {
    let speech: f64 = found.speech.iter().map(|(s, e)| e - s).sum();
    if speech < MIN_ENROLMENT_SPEECH_SECS || found.windows.is_empty() {
        return Err(format!(
            "{ENROL_TOO_SHORT}: found {speech:.0} s of speech, need at least {MIN_ENROLMENT_SPEECH_SECS:.0} s"
        ));
    }
    dominant_voice(&found.windows)
        .and_then(|v| normalized(v).ok())
        .ok_or_else(|| "No usable voice embedding".to_string())
}

/// Enrolling a voice needs at least this much speech.
pub const MIN_ENROLMENT_SPEECH_SECS: f64 = 8.0;
pub const ENROL_TOO_SHORT: &str = "Not enough speech to learn the voice";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::speakers::engine::cosine;
    use crate::commands::speakers::engine::fake::{silence, voice, SpectralEngine, FAKE_MODEL_ID};

    const A: (f32, f32) = (110.0, 500.0);
    const B: (f32, f32) = (180.0, 1500.0);
    const C: (f32, f32) = (240.0, 3500.0);

    fn say(who: (f32, f32), secs: f64) -> Vec<f32> {
        voice(who.0, who.1, secs)
    }

    fn analyse(audio: &[f32], kind: TrackKind, chunk: usize) -> TrackWindows {
        let engine = SpectralEngine::default();
        let cancel = AtomicBool::new(false);
        let mut a = TrackAnalyzer::new(&engine, kind, &cancel);
        for c in audio.chunks(chunk) {
            a.push(c).unwrap();
        }
        a.finish().unwrap()
    }

    fn track(audio: &[f32], kind: TrackKind, path: &str) -> AnalyzedTrack {
        AnalyzedTrack { path: path.into(), kind, found: analyse(audio, kind, 4096) }
    }

    /// A, pause, B, pause, A, pause, C: 3 speakers.
    fn conversation() -> Vec<f32> {
        let mut audio = silence(1.0);
        audio.extend(say(A, 6.0)); // 1..7
        audio.extend(silence(1.0));
        audio.extend(say(B, 5.0)); // 8..13
        audio.extend(silence(0.6));
        audio.extend(say(A, 4.0)); // 13.6..17.6
        audio.extend(silence(1.0));
        audio.extend(say(C, 6.0)); // 18.6..24.6
        audio.extend(silence(1.0));
        audio
    }

    #[test]
    fn a_single_track_is_diarised_into_speakers_in_order_of_appearance() {
        let out = assemble(&[track(&conversation(), TrackKind::Unknown, "/r/audio.m4a")], None, None, FAKE_MODEL_ID);
        let who: Vec<&str> = out.turns.iter().map(|t| t.speaker.as_str()).collect();
        assert_eq!(who, ["speaker-1", "speaker-2", "speaker-1", "speaker-3"], "{:?}", out.turns);
        let near = |a: f64, b: f64| (a - b).abs() < 0.15;
        assert!(near(out.turns[0].start, 1.0) && near(out.turns[0].end, 7.0), "{:?}", out.turns[0]);
        assert!(near(out.turns[1].start, 8.0) && near(out.turns[1].end, 13.0), "{:?}", out.turns[1]);
        assert!(near(out.turns[3].start, 18.6) && near(out.turns[3].end, 24.6), "{:?}", out.turns[3]);
        assert_eq!(out.speakers.len(), 3);
        assert_eq!(out.speakers[0].label, "speaker-1");
        // Two turns, each widened by the 60 ms of padding on both sides.
        assert!((out.speakers[0].total_secs - 10.24).abs() < 0.1, "{}", out.speakers[0].total_secs);
        assert_eq!(out.speakers[0].sample.track_path, "/r/audio.m4a");
        // The sample lies in one of the speaker's own turns.
        for s in &out.speakers {
            assert!(out.turns.iter().any(|t| t.speaker == s.label
                && s.sample.start >= t.start - 1e-6
                && s.sample.end <= t.end + 1e-6));
            assert!(s.sample.end - s.sample.start >= 4.0);
            assert!((s.embedding.iter().map(|x| x * x).sum::<f32>().sqrt() - 1.0).abs() < 1e-3);
        }
        assert!(near(out.duration_secs, 25.6));
        assert_eq!(out.model, FAKE_MODEL_ID);
        assert!(out.segments.is_none());
    }

    #[test]
    fn the_result_does_not_depend_on_how_the_audio_is_chunked_or_threaded() {
        let audio = conversation();
        let whole = analyse(&audio, TrackKind::Unknown, audio.len());
        let small = analyse(&audio, TrackKind::Unknown, 1000);
        assert_eq!(whole, small);
        let engine = SpectralEngine::default();
        let cancel = AtomicBool::new(false);
        let mut one = TrackAnalyzer::new(&engine, TrackKind::Unknown, &cancel).with_threads(1);
        one.push(&audio).unwrap();
        assert_eq!(one.finish().unwrap(), whole);
        let mut many = TrackAnalyzer::new(&engine, TrackKind::Unknown, &cancel).with_threads(7);
        many.push(&audio).unwrap();
        assert_eq!(many.finish().unwrap(), whole);
    }

    #[test]
    fn a_long_recording_is_analysed_in_blocks_with_bounded_memory() {
        // Four minutes: A and B alternating every 20 s with 1 s pauses.
        let mut audio = Vec::new();
        for i in 0..12 {
            audio.extend(say(if i % 2 == 0 { A } else { B }, 19.0));
            audio.extend(silence(1.0));
        }
        let engine = SpectralEngine::default();
        let cancel = AtomicBool::new(false);
        let mut analyzer = TrackAnalyzer::new(&engine, TrackKind::Unknown, &cancel);
        let mut peak = 0;
        for c in audio.chunks(16_000) {
            analyzer.push(c).unwrap();
            peak = peak.max(analyzer.buffered());
        }
        assert!(peak <= BLOCK_SAMPLES + MAX_CARRY_SAMPLES + 16_000, "held {peak} samples");
        let found = analyzer.finish().unwrap();
        assert!((found.duration_secs - 240.0).abs() < 1e-6);
        let out = assemble(
            &[AnalyzedTrack { path: "p".into(), kind: TrackKind::Unknown, found }],
            None,
            None,
            FAKE_MODEL_ID,
        );
        assert_eq!(out.speakers.len(), 2);
        assert_eq!(out.turns.len(), 12, "{:?}", out.turns);
        // Turns cut at a block boundary were not split or shifted.
        for (i, t) in out.turns.iter().enumerate() {
            assert!((t.start - i as f64 * 20.0).abs() < 0.15, "{t:?}");
            assert!((t.end - (i as f64 * 20.0 + 19.0)).abs() < 0.15, "{t:?}");
        }
    }

    #[test]
    fn expected_speakers_is_honoured() {
        let t = track(&conversation(), TrackKind::Unknown, "p");
        let two = assemble(&[t.clone()], Some(2), None, FAKE_MODEL_ID);
        assert_eq!(two.speakers.len(), 2);
        let one = assemble(&[t], Some(1), None, FAKE_MODEL_ID);
        assert_eq!(one.speakers.len(), 1);
        assert_eq!(validate_expected(None), Ok(None));
        assert_eq!(validate_expected(Some(0)), Ok(None));
        assert_eq!(validate_expected(Some(3)), Ok(Some(3)));
        assert!(validate_expected(Some(31)).is_err());
    }

    #[test]
    fn silence_only_and_very_short_audio_give_no_speakers() {
        for audio in [silence(10.0), Vec::new(), say(A, 0.3), vec![0.0; 10]] {
            let out = assemble(&[track(&audio, TrackKind::Unknown, "p")], None, None, FAKE_MODEL_ID);
            assert!(out.turns.is_empty() && out.speakers.is_empty());
        }
        // Speech too short to embed, with segments: they come back unchanged.
        let segments = [Segment { start: 0.0, end: 0.3, text: "hm".into(), speaker: None }];
        let out = assemble(&[track(&say(A, 0.3), TrackKind::Unknown, "p")], None, Some(&segments), FAKE_MODEL_ID);
        assert_eq!(out.segments.as_deref(), Some(&segments[..]));
    }

    #[test]
    fn one_speaker_only() {
        let mut audio = say(A, 8.0);
        audio.extend(silence(2.0));
        audio.extend(say(A, 5.0));
        let out = assemble(&[track(&audio, TrackKind::Unknown, "p")], None, None, FAKE_MODEL_ID);
        assert_eq!(out.speakers.len(), 1);
        assert_eq!(out.turns.len(), 2);
        assert!(out.turns.iter().all(|t| t.speaker == "speaker-1"));
    }

    #[test]
    fn two_tracks_the_microphone_is_me_and_the_system_track_is_diarised() {
        // System: B then C. Mic: A talks in the gaps.
        let mut system = silence(5.0);
        system.extend(say(B, 6.0)); // 5..11
        system.extend(silence(5.0));
        system.extend(say(C, 6.0)); // 16..22
        system.extend(silence(3.0));
        let mut mic = say(A, 4.5); // 0..4.5
        mic.extend(silence(7.0));
        mic.extend(say(A, 4.0)); // 11.5..15.5
        mic.extend(silence(9.5));

        let segments = [
            Segment { start: 0.2, end: 4.0, text: "hello".into(), speaker: Some("me".into()) },
            Segment { start: 5.2, end: 10.5, text: "hi there".into(), speaker: Some("others".into()) },
            Segment { start: 11.6, end: 15.0, text: "and you".into(), speaker: Some("me".into()) },
            Segment { start: 16.2, end: 21.0, text: "fine".into(), speaker: Some("others".into()) },
        ];
        let tracks = [track(&mic, TrackKind::Known, "/r/mic.m4a"), track(&system, TrackKind::Unknown, "/r/system.m4a")];
        let out = assemble(&tracks, None, Some(&segments), FAKE_MODEL_ID);

        let labels: Vec<&str> = out.speakers.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(labels, ["me", "speaker-1", "speaker-2"]);
        assert_eq!(out.speakers[0].sample.track_path, "/r/mic.m4a");
        assert_eq!(out.speakers[1].sample.track_path, "/r/system.m4a");
        // "me" has a voice vector, and it is A's voice.
        let engine = SpectralEngine::default();
        let a = engine.embed(&say(A, 3.0)).unwrap();
        assert!(cosine(&out.speakers[0].embedding, &a) > 0.95);
        // Turns of all tracks, by time.
        let who: Vec<&str> = out.turns.iter().map(|t| t.speaker.as_str()).collect();
        assert_eq!(who, ["me", "speaker-1", "me", "speaker-2"]);
        let assigned: Vec<&str> =
            out.segments.as_ref().unwrap().iter().map(|s| s.speaker.as_deref().unwrap()).collect();
        assert_eq!(assigned, ["me", "speaker-1", "me", "speaker-2"]);
    }

    #[test]
    fn a_microphone_segment_never_gets_a_remote_speaker_even_when_they_overlap() {
        let system = say(B, 10.0);
        let mut mic = silence(4.0);
        mic.extend(say(A, 2.0)); // talks over B at 4..6
        mic.extend(silence(4.0));
        let segments = [
            Segment { start: 4.1, end: 5.9, text: "sorry".into(), speaker: Some("me".into()) },
            Segment { start: 0.0, end: 10.0, text: "long".into(), speaker: Some("others".into()) },
        ];
        let tracks = [track(&mic, TrackKind::Known, "mic"), track(&system, TrackKind::Unknown, "sys")];
        let out = assemble(&tracks, None, Some(&segments), FAKE_MODEL_ID);
        let s = out.segments.unwrap();
        assert_eq!(s[0].speaker.as_deref(), Some("me"));
        assert_eq!(s[1].speaker.as_deref(), Some("speaker-1"));
    }

    #[test]
    fn a_shared_microphone_is_diarised_too_and_numbering_continues() {
        // Both tracks Unknown: the caller said several people share the mic.
        let mut mic = say(A, 5.0);
        mic.extend(silence(1.0));
        mic.extend(say(C, 5.0));
        let system = {
            let mut s = silence(12.0);
            s.extend(say(B, 5.0));
            s
        };
        let segments = [
            Segment { start: 6.2, end: 10.5, text: "room".into(), speaker: Some("me".into()) },
            Segment { start: 12.2, end: 16.5, text: "remote".into(), speaker: Some("others".into()) },
        ];
        let tracks = [track(&mic, TrackKind::Unknown, "mic"), track(&system, TrackKind::Unknown, "sys")];
        let out = assemble(&tracks, None, Some(&segments), FAKE_MODEL_ID);
        let labels: Vec<&str> = out.speakers.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(labels, ["speaker-1", "speaker-2", "speaker-3"]);
        assert_eq!(out.speakers[2].sample.track_path, "sys");
        let s = out.segments.unwrap();
        assert_eq!(s[0].speaker.as_deref(), Some("speaker-2"));
        assert_eq!(s[1].speaker.as_deref(), Some("speaker-3"));
    }

    #[test]
    fn a_known_track_embeds_only_a_sparse_sample_of_windows() {
        let audio = say(A, 120.0);
        let all = analyse(&audio, TrackKind::Unknown, 8000);
        let sparse = analyse(&audio, TrackKind::Known, 8000);
        assert!(all.windows.len() > 150);
        assert!(sparse.windows.len() * KNOWN_SPEAKER_STRIDE <= all.windows.len() + KNOWN_SPEAKER_STRIDE);
        assert!(sparse.windows.len() >= 20);
        assert_eq!(sparse.speech, all.speech);
        // And never more than the cap, however long the track.
        let long = analyse(&say(A, 900.0), TrackKind::Known, 16_000);
        assert_eq!(long.windows.len(), KNOWN_SPEAKER_MAX_WINDOWS);
    }

    #[test]
    fn a_silent_microphone_track_gives_no_me() {
        let tracks = [track(&silence(20.0), TrackKind::Known, "mic"), track(&say(B, 8.0), TrackKind::Unknown, "sys")];
        let out = assemble(&tracks, None, None, FAKE_MODEL_ID);
        let labels: Vec<&str> = out.speakers.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(labels, ["speaker-1"]);
    }

    #[test]
    fn cancelling_stops_the_analysis() {
        let engine = SpectralEngine::default();
        let cancel = AtomicBool::new(false);
        let audio = say(A, 60.0);
        let mut a = TrackAnalyzer::new(&engine, TrackKind::Unknown, &cancel);
        a.push(&audio[..16_000]).unwrap();
        cancel.store(true, Ordering::Relaxed);
        assert_eq!(a.push(&audio[16_000..]).unwrap_err(), CANCELLED);
        // Cancelled between the last push and the end.
        let cancel = AtomicBool::new(false);
        let mut a = TrackAnalyzer::new(&engine, TrackKind::Unknown, &cancel);
        a.push(&audio[..160_000]).unwrap();
        cancel.store(true, Ordering::Relaxed);
        assert_eq!(a.finish().unwrap_err(), CANCELLED);
    }

    #[test]
    fn an_engine_failure_is_reported_not_swallowed() {
        let mut engine = SpectralEngine::default();
        engine.fail_from_call = 3;
        let cancel = AtomicBool::new(false);
        let mut a = TrackAnalyzer::new(&engine, TrackKind::Unknown, &cancel);
        a.push(&say(A, 20.0)).unwrap();
        assert_eq!(a.finish().unwrap_err(), "the fake engine was told to fail");
    }

    // --- named turns -------------------------------------------------------

    fn turn(start: f64, end: f64, speaker: &str) -> Turn {
        Turn { start, end, speaker: speaker.into() }
    }

    #[test]
    fn clean_stretches_drop_overlaps_edges_and_short_turns() {
        let turns = [
            turn(0.0, 10.0, "Anna"),
            turn(8.0, 14.0, "Björn"), // overlaps Anna 8..10
            turn(14.0, 14.8, "Anna"), // too short
            turn(20.0, 19.0, "Anna"), // reversed
            turn(f64::NAN, 3.0, "Anna"),
            turn(30.0, 40.0, "Cecilia"),
            turn(33.0, 34.0, "Anna"), // inside Cecilia: splits her turn
        ];
        let clean = clean_stretches(&turns);
        assert_eq!(
            clean,
            vec![
                ("Anna".to_string(), 0.25, 7.75),
                ("Björn".to_string(), 10.25, 13.75),
                ("Cecilia".to_string(), 30.25, 32.75),
                ("Cecilia".to_string(), 34.25, 39.75),
            ]
        );
        // Two turns of the SAME speaker overlapping do not cancel each other.
        let same = clean_stretches(&[turn(0.0, 5.0, "Anna"), turn(3.0, 8.0, "Anna")]);
        assert_eq!(same.len(), 2);
        assert!(clean_stretches(&[]).is_empty());
    }

    #[test]
    fn named_turns_give_one_embedding_per_speaker_and_say_who_was_skipped() {
        // Anna = A at 0..10 and 20..26, Björn = B at 10..20, Cecilia = C 26..29.
        let mut audio = say(A, 10.0);
        audio.extend(say(B, 10.0));
        audio.extend(say(A, 6.0));
        audio.extend(say(C, 3.0));
        let turns = [
            turn(0.0, 10.0, "Anna"),
            turn(10.0, 20.0, "Björn"),
            turn(20.0, 26.0, "Anna"),
            turn(26.0, 29.0, "Cecilia"),
            turn(100.0, 120.0, "Ghost"), // beyond the end of the file
        ];
        let mut collector = NamedTurnCollector::new(&turns);
        assert!(!collector.is_empty());
        assert_eq!(collector.last_needed(), (119.75 * RATE) as usize);
        for c in audio.chunks(7000) {
            collector.push(c);
        }
        let engine = SpectralEngine::default();
        let out = collector.finish(&engine, &speaker_order(&turns), &AtomicBool::new(false)).unwrap();
        let names: Vec<&str> = out.speakers.iter().map(|s| s.speaker.as_str()).collect();
        assert_eq!(names, ["Anna", "Björn"]);
        assert!((out.speakers[0].total_secs - 15.0).abs() < 0.01);
        let (a, b) = (engine.embed(&say(A, 3.0)).unwrap(), engine.embed(&say(B, 3.0)).unwrap());
        assert!(cosine(&out.speakers[0].embedding, &a) > 0.95);
        assert!(cosine(&out.speakers[1].embedding, &b) > 0.95);
        assert!(cosine(&out.speakers[0].embedding, &b) < 0.5);
        let skipped: Vec<&str> = out.skipped.iter().map(|s| s.speaker.as_str()).collect();
        assert_eq!(skipped, ["Cecilia", "Ghost"]);
        assert!(out.skipped[0].reason.starts_with(SKIP_TOO_LITTLE), "{}", out.skipped[0].reason);
        assert!((out.skipped[0].total_secs - 2.5).abs() < 0.01);
        assert_eq!(out.skipped[1].total_secs, 0.0);
        assert_eq!(out.model, FAKE_MODEL_ID);
    }

    #[test]
    fn a_long_named_speaker_is_capped() {
        let turns = [turn(0.0, 600.0, "Anna")];
        let collector = NamedTurnCollector::new(&turns);
        // 40 windows of 1.5 s = 60 s of audio at most.
        assert_eq!(collector.last_needed(), ((0.25 + 60.0) * RATE) as usize);
        assert!(NamedTurnCollector::new(&[turn(0.0, 0.5, "x")]).is_empty());
    }

    #[test]
    fn the_trimmed_mean_ignores_a_minority_of_other_voices() {
        let engine = SpectralEngine::default();
        let a = engine.embed(&say(A, 1.5)).unwrap();
        let b = engine.embed(&say(B, 1.5)).unwrap();
        let mut vectors = vec![a.clone(); 9];
        vectors.push(b);
        let trimmed = trimmed_mean(&vectors).unwrap();
        assert!(cosine(&trimmed, &a) > 0.999);
        // Too few to trim: plain mean.
        assert!(trimmed_mean(&vectors[..2]).is_some());
        assert!(trimmed_mean(&[]).is_none());
    }

    #[test]
    fn enrolment_needs_enough_speech_and_returns_the_dominant_voice() {
        let short = analyse(&say(A, 4.0), TrackKind::Unknown, 4096);
        let err = enrolment_embedding(&short).unwrap_err();
        assert!(err.starts_with(ENROL_TOO_SHORT), "{err}");
        assert!(enrolment_embedding(&TrackWindows::default()).unwrap_err().starts_with(ENROL_TOO_SHORT));

        // 20 s of A with 3 s of someone else in the background.
        let mut audio = say(A, 12.0);
        audio.extend(silence(1.0));
        audio.extend(say(B, 3.0));
        audio.extend(silence(1.0));
        audio.extend(say(A, 8.0));
        let found = analyse(&audio, TrackKind::Unknown, 4096);
        let v = enrolment_embedding(&found).unwrap();
        let engine = SpectralEngine::default();
        assert!(cosine(&v, &engine.embed(&say(A, 3.0)).unwrap()) > 0.99);
    }

    #[test]
    fn the_result_serialises_with_the_contract_field_names() {
        let segments = [Segment { start: 1.0, end: 2.0, text: "x".into(), speaker: None }];
        let out = assemble(&[track(&conversation(), TrackKind::Unknown, "p")], None, Some(&segments), FAKE_MODEL_ID);
        let json = serde_json::to_value(&out).unwrap();
        for key in ["turns", "speakers", "segments", "duration_secs", "model"] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
        let s = &json["speakers"][0];
        for key in ["label", "total_secs", "sample", "embedding"] {
            assert!(s.get(key).is_some(), "missing {key}");
        }
        for key in ["track_path", "start", "end"] {
            assert!(s["sample"].get(key).is_some(), "missing {key}");
        }
        assert_eq!(json["turns"][0]["speaker"], "speaker-1");
        assert_eq!(json["segments"][0]["speaker"], "speaker-1");
        // Without segments the key is absent.
        let out = assemble(&[track(&conversation(), TrackKind::Unknown, "p")], None, None, FAKE_MODEL_ID);
        assert!(serde_json::to_value(&out).unwrap().get("segments").is_none());
    }
}
