import type { SpeakerNames } from '@/lib/transcription/segments';
import { isGenericLabel } from '@/lib/speakers/display-names';

/**
 * Carrying a user's names across a second analysis of the same recording.
 *
 * Analysing again may number the voices differently: last time's `speaker-1`
 * can come back as `speaker-2`. The names the user gave must follow the VOICE,
 * not the number, so the two runs are matched by when each label was speaking:
 * a new label that talks during the same stretches as an old one is the same
 * voice. Pure.
 */

export interface LabelledInterval {
  start: number;
  end: number;
  speaker?: string | null;
}

/**
 * A new label takes over an old one only when their shared speaking time is at
 * least this share of the LARGER of the two totals: each must be most of the
 * other. Measured against the smaller total, one of three voices found inside
 * a two-track recording's "Others" would count as being "Others".
 */
export const MIN_OVERLAP_SHARE = 0.5;
/**
 * The stricter bar for changing text in a transcript without regenerating it:
 * the old speaker and the found voice must be very nearly the same stretches.
 */
export const SAME_SPEAKER_SHARE = 0.8;

function totals(intervals: readonly LabelledInterval[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const interval of intervals) {
    const speaker = interval.speaker;
    if (!speaker) continue;
    out.set(speaker, (out.get(speaker) ?? 0) + Math.max(0, interval.end - interval.start));
  }
  return out;
}

/** Seconds each (new label, old label) pair was speaking at the same time. */
export function overlapSeconds(
  previous: readonly LabelledInterval[],
  next: readonly LabelledInterval[],
): Map<string, Map<string, number>> {
  const old = previous
    .filter((i): i is LabelledInterval & { speaker: string } => Boolean(i.speaker) && i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const out = new Map<string, Map<string, number>>();
  // `old` is sorted by start; segments of one transcript barely overlap each
  // other, so the ones that can touch a new interval sit in a short window.
  let from = 0;
  const sortedNext = next
    .filter((i): i is LabelledInterval & { speaker: string } => Boolean(i.speaker) && i.end > i.start)
    .sort((a, b) => a.start - b.start);
  let longestOld = 0;
  for (const o of old) longestOld = Math.max(longestOld, o.end - o.start);
  for (const n of sortedNext) {
    while (from < old.length && old[from].start + longestOld < n.start) from += 1;
    for (let i = from; i < old.length && old[i].start < n.end; i++) {
      const shared = Math.min(n.end, old[i].end) - Math.max(n.start, old[i].start);
      if (shared <= 0) continue;
      let row = out.get(n.speaker);
      if (!row) {
        row = new Map();
        out.set(n.speaker, row);
      }
      row.set(old[i].speaker, (row.get(old[i].speaker) ?? 0) + shared);
    }
  }
  return out;
}

/**
 * Which old label each new label is: `{ "speaker-2": "speaker-1" }`.
 *
 * One to one: the pair with the most shared time is settled first, and neither
 * label is used again. A new label with no convincing counterpart is absent.
 */
export function matchLabels(
  previous: readonly LabelledInterval[],
  next: readonly LabelledInterval[],
  minShare: number = MIN_OVERLAP_SHARE,
): Record<string, string> {
  const overlaps = overlapSeconds(previous, next);
  const oldTotals = totals(previous);
  const newTotals = totals(next);
  const pairs: Array<{ next: string; previous: string; shared: number }> = [];
  for (const [nextLabel, row] of overlaps) {
    for (const [previousLabel, shared] of row) pairs.push({ next: nextLabel, previous: previousLabel, shared });
  }
  pairs.sort((a, b) => b.shared - a.shared || a.next.localeCompare(b.next) || a.previous.localeCompare(b.previous));

  const result: Record<string, string> = {};
  const usedOld = new Set<string>();
  for (const pair of pairs) {
    if (pair.next in result || usedOld.has(pair.previous)) continue;
    const larger = Math.max(newTotals.get(pair.next) ?? 0, oldTotals.get(pair.previous) ?? 0);
    if (larger <= 0 || pair.shared / larger < minShare) continue;
    result[pair.next] = pair.previous;
    usedOld.add(pair.previous);
  }
  return result;
}

/**
 * The names to keep for the new labels: for each new label matched to an old
 * one, the name the user gave that old label, or the old label itself when it
 * already is a person's name (a Teams transcript's labels are).
 */
export function keptNames(matches: Readonly<Record<string, string>>, previousNames: SpeakerNames): SpeakerNames {
  const kept: SpeakerNames = {};
  for (const [nextLabel, previousLabel] of Object.entries(matches)) {
    const name = previousNames[previousLabel] ?? (isGenericLabel(previousLabel) ? undefined : previousLabel);
    if (name) kept[nextLabel] = name;
  }
  return kept;
}
