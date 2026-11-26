//! Grouping voice embeddings into speakers when the number of speakers is
//! not known: agglomerative clustering with average linkage on cosine
//! distance, cut at a threshold (or at a given number of speakers).

use super::engine::{cosine, mean_normalized};

/// Two groups of windows are the same speaker when their average cosine
/// DISTANCE (1 - similarity) is at most this. Calibrated on real speech with
/// the WeSpeaker ResNet34 model and 1.5 s windows (numbers in
/// `docs/features/speakers.md`): two windows of one speaker are typically
/// 0.35 to 0.65 apart, windows of two different speakers 0.8 to 1.1. The
/// margin is not wide: of four sample conversations, values from 0.60 to
/// 0.70 gave the same speakers, 0.75 merged two similar-sounding people.
pub const CLUSTER_THRESHOLD: f32 = 0.70;

/// Never report more speakers than this unless the caller asks for more.
pub const MAX_SPEAKERS: usize = 12;

/// The largest `expected_speakers` accepted.
pub const MAX_EXPECTED_SPEAKERS: usize = 30;

/// A cluster with fewer windows than this is not a speaker of its own (a
/// cough, a door, a window that straddled two people): it joins the nearest
/// real one.
pub const MIN_CLUSTER_WINDOWS: usize = 2;

/// Two groups of windows whose mean embeddings have at least this cosine
/// similarity are the same speaker. Deliberately high: two different people
/// in one recording (same room, same microphone) have been measured at 0.49.
pub const CENTROID_MERGE: f32 = 0.6;

/// At most this many embeddings are clustered directly (the distance matrix
/// is quadratic). With more, an evenly spread subset is clustered and every
/// window is then given to the nearest speaker.
pub const MAX_CLUSTER_ITEMS: usize = 3000;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClusterParams {
    pub threshold: f32,
    /// Cut at exactly this many speakers (when there are that many items).
    pub expected: Option<usize>,
    pub max_speakers: usize,
    pub min_cluster_windows: usize,
    /// After the cut, two groups whose mean voices are at least this alike
    /// (cosine) are one speaker.
    pub centroid_merge: f32,
}

impl Default for ClusterParams {
    fn default() -> Self {
        Self {
            threshold: CLUSTER_THRESHOLD,
            expected: None,
            max_speakers: MAX_SPEAKERS,
            min_cluster_windows: MIN_CLUSTER_WINDOWS,
            centroid_merge: CENTROID_MERGE,
        }
    }
}

/// Condensed symmetric matrix of pairwise distances.
struct Distances {
    n: usize,
    d: Vec<f32>,
}

impl Distances {
    fn new(items: &[&[f32]]) -> Self {
        let n = items.len();
        let mut d = vec![0f32; n * n.saturating_sub(1) / 2];
        let mut k = 0;
        for i in 0..n {
            for j in i + 1..n {
                d[k] = 1.0 - cosine(items[i], items[j]);
                k += 1;
            }
        }
        Self { n, d }
    }

    fn index(&self, i: usize, j: usize) -> usize {
        let (i, j) = if i < j { (i, j) } else { (j, i) };
        i * (2 * self.n - i - 1) / 2 + (j - i - 1)
    }

    fn get(&self, i: usize, j: usize) -> f32 {
        self.d[self.index(i, j)]
    }

    fn set(&mut self, i: usize, j: usize, v: f32) {
        let k = self.index(i, j);
        self.d[k] = v;
    }
}

/// The full merge history of average-linkage clustering, by the
/// nearest-neighbour-chain algorithm (quadratic time). Each entry is
/// `(item in one cluster, item in the other, distance)`.
fn dendrogram(items: &[&[f32]]) -> Vec<(usize, usize, f32)> {
    let n = items.len();
    let mut dist = Distances::new(items);
    let mut size = vec![1usize; n];
    let mut active = vec![true; n];
    let mut merges = Vec::with_capacity(n.saturating_sub(1));
    let mut chain: Vec<usize> = Vec::new();
    let mut remaining = n;
    while remaining > 1 {
        if chain.is_empty() {
            chain.push((0..n).find(|i| active[*i]).expect("an active cluster"));
        }
        loop {
            let a = *chain.last().expect("non-empty chain");
            let prev = if chain.len() >= 2 { Some(chain[chain.len() - 2]) } else { None };
            // Nearest active cluster; on a tie, the one we came from.
            let mut best = prev;
            let mut best_d = prev.map(|p| dist.get(a, p)).unwrap_or(f32::INFINITY);
            for b in 0..n {
                if b != a && active[b] {
                    let d = dist.get(a, b);
                    if d < best_d {
                        best = Some(b);
                        best_d = d;
                    }
                }
            }
            let b = best.expect("at least two active clusters");
            if Some(b) == prev {
                chain.pop();
                chain.pop();
                merges.push((a, b, best_d));
                // `a` becomes the merged cluster, `b` goes.
                let (sa, sb) = (size[a] as f32, size[b] as f32);
                for k in 0..n {
                    if k != a && k != b && active[k] {
                        let v = (sa * dist.get(a, k) + sb * dist.get(b, k)) / (sa + sb);
                        dist.set(a, k, v);
                    }
                }
                active[b] = false;
                size[a] += size[b];
                remaining -= 1;
                break;
            }
            chain.push(b);
        }
    }
    merges
}

fn find(parent: &mut [usize], mut x: usize) -> usize {
    while parent[x] != x {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    x
}

/// Labels `0..k` in order of first appearance.
fn compact(raw: &[usize]) -> Vec<usize> {
    let mut seen: Vec<usize> = Vec::new();
    raw.iter()
        .map(|r| match seen.iter().position(|s| s == r) {
            Some(i) => i,
            None => {
                seen.push(*r);
                seen.len() - 1
            }
        })
        .collect()
}

/// Normalised mean embedding of each label (`None` for a label without
/// members or whose members cancel out).
pub fn centroids(items: &[&[f32]], labels: &[usize]) -> Vec<Option<Vec<f32>>> {
    let k = labels.iter().copied().max().map(|m| m + 1).unwrap_or(0);
    (0..k)
        .map(|c| mean_normalized(items.iter().zip(labels).filter(|(_, l)| **l == c).map(|(v, _)| *v)))
        .collect()
}

fn nearest(item: &[f32], centres: &[Option<Vec<f32>>], allowed: &dyn Fn(usize) -> bool) -> Option<usize> {
    let mut best: Option<(usize, f32)> = None;
    for (c, centre) in centres.iter().enumerate() {
        if let (true, Some(centre)) = (allowed(c), centre) {
            let s = cosine(item, centre);
            if best.map(|(_, b)| s > b).unwrap_or(true) {
                best = Some((c, s));
            }
        }
    }
    best.map(|(c, _)| c)
}

fn cluster_direct(items: &[&[f32]], params: &ClusterParams) -> Vec<usize> {
    let n = items.len();
    if n == 0 {
        return Vec::new();
    }
    let mut merges = dendrogram(items);
    merges.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));

    let expected = params.expected.filter(|k| *k >= 1);
    let cap = params.max_speakers.max(1);
    let mut parent: Vec<usize> = (0..n).collect();
    let mut count = n;
    for (a, b, height) in &merges {
        let stop = match expected {
            Some(k) => count <= k,
            None => *height > params.threshold && count <= cap,
        };
        if stop {
            break;
        }
        let (ra, rb) = (find(&mut parent, *a), find(&mut parent, *b));
        if ra != rb {
            parent[rb] = ra;
            count -= 1;
        }
    }
    let raw: Vec<usize> = (0..n).map(|i| find(&mut parent, i)).collect();
    let mut labels = compact(&raw);

    if expected.is_none() {
        // The cut above is deliberately cautious: single windows are noisy,
        // so it tends to split one speaker rather than join two. The mean of
        // a group is far less noisy than its members, so groups are now
        // joined when their means are alike.
        loop {
            let centres = centroids(items, &labels);
            let mut best: Option<(usize, usize, f32)> = None;
            for a in 0..centres.len() {
                for b in a + 1..centres.len() {
                    if let (Some(ca), Some(cb)) = (&centres[a], &centres[b]) {
                        let s = cosine(ca, cb);
                        if s >= params.centroid_merge && best.map(|(_, _, m)| s > m).unwrap_or(true) {
                            best = Some((a, b, s));
                        }
                    }
                }
            }
            let Some((a, b, _)) = best else { break };
            for l in &mut labels {
                if *l == b {
                    *l = a;
                }
            }
            labels = compact(&labels);
        }
        // Clusters too small to be a speaker join the nearest real one.
        let k = labels.iter().copied().max().unwrap_or(0) + 1;
        let mut sizes = vec![0usize; k];
        for l in &labels {
            sizes[*l] += 1;
        }
        let big = |c: usize| sizes[c] >= params.min_cluster_windows;
        if (0..k).any(big) && !(0..k).all(big) {
            let centres = centroids(items, &labels);
            for (i, item) in items.iter().enumerate() {
                if !big(labels[i]) {
                    if let Some(c) = nearest(item, &centres, &big) {
                        labels[i] = c;
                    }
                }
            }
            labels = compact(&labels);
        }
        // One round of "every window to the speaker it sounds most like":
        // repairs windows that an early merge put on the wrong side.
        let centres = centroids(items, &labels);
        if centres.len() > 1 {
            let moved: Vec<usize> = items
                .iter()
                .enumerate()
                .map(|(i, item)| nearest(item, &centres, &|_| true).unwrap_or(labels[i]))
                .collect();
            // Only if no speaker is emptied by it.
            let mut sizes = vec![0usize; centres.len()];
            for l in &moved {
                sizes[*l] += 1;
            }
            if sizes.iter().all(|s| *s >= 1) {
                labels = compact(&moved);
            }
        }
    }
    labels
}

/// Group `items` (embeddings of equal length) into speakers. Returns one
/// label per item, numbered `0..k` in order of first appearance.
pub fn cluster(items: &[&[f32]], params: &ClusterParams) -> Vec<usize> {
    if items.len() <= MAX_CLUSTER_ITEMS {
        return cluster_direct(items, params);
    }
    let stride = items.len().div_ceil(MAX_CLUSTER_ITEMS);
    let subset: Vec<&[f32]> = items.iter().step_by(stride).copied().collect();
    let sub_labels = cluster_direct(&subset, params);
    let centres = centroids(&subset, &sub_labels);
    let labels: Vec<usize> = items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            nearest(item, &centres, &|_| true).unwrap_or_else(|| sub_labels[(i / stride).min(sub_labels.len() - 1)])
        })
        .collect();
    compact(&labels)
}

#[cfg(test)]
pub mod testing {
    /// Small deterministic generator (xorshift), so tests need no crate.
    pub struct Rng(pub u64);

    impl Rng {
        pub fn next_f32(&mut self) -> f32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            ((self.0 >> 40) as f32 / (1u64 << 24) as f32) * 2.0 - 1.0
        }

        /// Roughly normal, unit variance.
        pub fn gauss(&mut self) -> f32 {
            (0..6).map(|_| self.next_f32()).sum::<f32>() * (0.5f32).sqrt()
        }
    }

    /// A random unit vector: a synthetic "voice".
    pub fn voice(rng: &mut Rng, dim: usize) -> Vec<f32> {
        let v: Vec<f32> = (0..dim).map(|_| rng.gauss()).collect();
        crate::commands::speakers::engine::normalized(v).unwrap()
    }

    /// `centre` plus noise of relative size `noise` (per-vector norm of the
    /// noise relative to the unit centre), normalised.
    pub fn near(rng: &mut Rng, centre: &[f32], noise: f32) -> Vec<f32> {
        let scale = noise / (centre.len() as f32).sqrt();
        let v: Vec<f32> = centre.iter().map(|c| c + scale * rng.gauss()).collect();
        crate::commands::speakers::engine::normalized(v).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;

    const DIM: usize = 64;

    fn refs(v: &[Vec<f32>]) -> Vec<&[f32]> {
        v.iter().map(|x| x.as_slice()).collect()
    }

    /// `per` noisy copies of each of `k` voices, interleaved in turns of 5.
    fn meeting(k: usize, per: usize, noise: f32, seed: u64) -> (Vec<Vec<f32>>, Vec<usize>) {
        let mut rng = Rng(seed);
        let voices: Vec<Vec<f32>> = (0..k).map(|_| voice(&mut rng, DIM)).collect();
        let mut items = Vec::new();
        let mut truth = Vec::new();
        let mut left = vec![per; k];
        let mut s = 0;
        while left.iter().any(|l| *l > 0) {
            let take = left[s].min(5);
            for _ in 0..take {
                items.push(near(&mut rng, &voices[s], noise));
                truth.push(s);
            }
            left[s] -= take;
            s = (s + 1) % k;
        }
        (items, truth)
    }

    #[test]
    fn noise_levels_used_in_these_tests_resemble_real_windows() {
        // With noise 0.9 two windows of one voice have a cosine near 0.55,
        // the lower end of what the real model gives for one speaker.
        let mut rng = Rng(7);
        let v = voice(&mut rng, DIM);
        let sims: Vec<f32> =
            (0..200).map(|_| cosine(&near(&mut rng, &v, 0.9), &near(&mut rng, &v, 0.9))).collect();
        let mean = sims.iter().sum::<f32>() / sims.len() as f32;
        assert!((0.45..0.65).contains(&mean), "{mean}");
    }

    #[test]
    fn one_speaker_stays_one() {
        let (items, _) = meeting(1, 40, 0.9, 1);
        let labels = cluster(&refs(&items), &ClusterParams::default());
        assert!(labels.iter().all(|l| *l == 0), "{labels:?}");
    }

    #[test]
    fn finds_the_number_of_speakers_without_being_told() {
        for (k, seed) in [(2usize, 11u64), (3, 12), (5, 13), (8, 14)] {
            let (items, truth) = meeting(k, 30, 0.9, seed);
            let labels = cluster(&refs(&items), &ClusterParams::default());
            assert_eq!(labels.iter().max().unwrap() + 1, k, "k={k}");
            // First-appearance numbering makes labels equal the truth here.
            assert_eq!(labels, truth, "k={k}");
        }
    }

    #[test]
    fn labels_are_numbered_by_first_appearance() {
        assert_eq!(compact(&[7, 7, 2, 7, 9, 2]), vec![0, 0, 1, 0, 2, 1]);
        assert!(compact(&[]).is_empty());
    }

    #[test]
    fn expected_speakers_overrides_the_threshold() {
        // Two voices so alike that the threshold merges them…
        let mut rng = Rng(21);
        let a = voice(&mut rng, DIM);
        let b = near(&mut rng, &a, 0.7);
        let mut items = Vec::new();
        for i in 0..40 {
            items.push(near(&mut rng, if i % 2 == 0 { &a } else { &b }, 0.3));
        }
        let free = cluster(&refs(&items), &ClusterParams::default());
        assert_eq!(free.iter().max().unwrap() + 1, 1);
        // …are kept apart when the caller says there are two.
        let two = cluster(&refs(&items), &ClusterParams { expected: Some(2), ..Default::default() });
        assert_eq!(two, (0..40).map(|i| i % 2).collect::<Vec<_>>());
        // And five distinct voices are folded to three when asked.
        let (items, _) = meeting(5, 20, 0.9, 22);
        let three = cluster(&refs(&items), &ClusterParams { expected: Some(3), ..Default::default() });
        assert_eq!(three.iter().max().unwrap() + 1, 3);
        // More expected than items: every item its own speaker, no panic.
        let few = cluster(&refs(&items[..3]), &ClusterParams { expected: Some(10), ..Default::default() });
        assert_eq!(few.len(), 3);
    }

    #[test]
    fn the_cap_limits_the_number_of_speakers() {
        let (items, _) = meeting(6, 20, 0.9, 31);
        let capped = cluster(&refs(&items), &ClusterParams { max_speakers: 4, ..Default::default() });
        assert_eq!(capped.iter().max().unwrap() + 1, 4);
        // The default cap does not get in the way of six.
        let free = cluster(&refs(&items), &ClusterParams::default());
        assert_eq!(free.iter().max().unwrap() + 1, 6);
    }

    #[test]
    fn a_stray_window_joins_the_nearest_speaker() {
        let (mut items, _) = meeting(2, 20, 0.9, 41);
        let mut rng = Rng(42);
        items.insert(7, voice(&mut rng, DIM)); // unlike anyone
        let labels = cluster(&refs(&items), &ClusterParams::default());
        assert_eq!(labels.iter().max().unwrap() + 1, 2, "{labels:?}");
    }

    #[test]
    fn tiny_inputs() {
        let p = ClusterParams::default();
        assert!(cluster(&[], &p).is_empty());
        let mut rng = Rng(51);
        let a = voice(&mut rng, DIM);
        assert_eq!(cluster(&[&a], &p), vec![0]);
        let b = voice(&mut rng, DIM);
        // Two unlike windows: nothing is big enough to absorb the other.
        assert_eq!(cluster(&[&a, &b], &p), vec![0, 1]);
        assert_eq!(cluster(&[&a, &a], &p), vec![0, 0]);
    }

    #[test]
    fn more_items_than_the_matrix_limit_are_still_all_labelled() {
        let (items, truth) = meeting(3, 1200, 0.9, 61); // 3600 > MAX_CLUSTER_ITEMS
        assert!(items.len() > MAX_CLUSTER_ITEMS);
        let labels = cluster(&refs(&items), &ClusterParams::default());
        assert_eq!(labels.len(), items.len());
        let wrong = labels.iter().zip(&truth).filter(|(a, b)| a != b).count();
        assert!(wrong * 100 < items.len(), "{wrong} of {} wrong", items.len());
    }

    #[test]
    fn the_dendrogram_has_one_merge_less_than_items_and_rising_heights() {
        let (items, _) = meeting(4, 10, 0.9, 71);
        let mut merges = dendrogram(&refs(&items));
        assert_eq!(merges.len(), items.len() - 1);
        merges.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap());
        // The last three merges join the four voices: far above the rest.
        let n = merges.len();
        assert!(merges[n - 3].2 > CLUSTER_THRESHOLD, "{}", merges[n - 3].2);
        assert!(merges[n - 4].2 < CLUSTER_THRESHOLD, "{}", merges[n - 4].2);
    }

    #[test]
    fn centroids_are_unit_vectors_per_label() {
        let (items, truth) = meeting(2, 10, 0.5, 81);
        let c = centroids(&refs(&items), &truth);
        assert_eq!(c.len(), 2);
        for v in c.iter().flatten() {
            assert!((v.iter().map(|x| x * x).sum::<f32>().sqrt() - 1.0).abs() < 1e-4);
        }
        assert!(cosine(c[0].as_ref().unwrap(), c[1].as_ref().unwrap()) < 0.4);
    }
}
