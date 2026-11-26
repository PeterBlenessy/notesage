import type { Segment } from '@/lib/transcription/segments';

/**
 * Merging the transcript Microsoft Teams produced for a meeting with our own.
 *
 * Teams knows WHO spoke (each cue carries the participant's name) and we have
 * our own text from the recording. The two clocks differ: Teams' transcription
 * is often switched on some time after the recording began, and an imported
 * video may have been trimmed. So the work is in three pure steps:
 *
 *   1. `parseTeamsVtt`    the file → cues `{ start, end, speaker, text }`
 *   2. `estimateOffset`   find the shift that makes the two texts agree
 *   3. `assignSpeakers`   give each of our segments the name of the cue it
 *                         overlaps most, splitting a segment that spans a
 *                         change of speaker when that can be done cleanly
 *
 * Nothing here touches the disk or the UI.
 *
 * Offset convention, everywhere in this file: `ourTime = cueTime + offsetSecs`.
 * A positive offset means Teams started transcribing AFTER our recording
 * began (the usual case); a negative one means our audio starts later than
 * Teams' transcript (a trimmed import).
 */

export interface Cue {
  /** Seconds on the Teams transcript's own clock. */
  start: number;
  end: number;
  /** The participant's display name; `null` for a cue without a voice tag. */
  speaker: string | null;
  text: string;
}

/** A cue longer than this is a broken timestamp, not a five-minute sentence. */
export const MAX_CUE_SECS = 300;
/** Anything past this is not a meeting. Cues beyond it are dropped. */
const MAX_TIMELINE_SECS = 48 * 3600;
/** A file with more cues than this is truncated: no meeting has this many. */
const MAX_CUES = 200_000;

const TIMESTAMP = /(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/;
const TIMING_LINE = new RegExp(`^\\s*(${TIMESTAMP.source})\\s*-->\\s*(${TIMESTAMP.source})`);

/** `1:02:03.5`, `02:03,500`, `0:0:3.53` → seconds. `null` when not a timestamp. */
export function parseTimestamp(text: string): number | null {
  const m = TIMESTAMP.exec(text.trim());
  if (!m || m.index !== 0 || m[0].length !== text.trim().length) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const s = Number(m[3]);
  // `.5` is half a second, `.050` fifty milliseconds: a decimal fraction.
  const frac = m[4] ? Number(`0.${m[4]}`) : 0;
  // Whole milliseconds: `3 + 0.53` is not `3.53` in binary floating point.
  const total = Math.round((h * 3600 + min * 60 + s + frac) * 1000) / 1000;
  return Number.isFinite(total) ? total : null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lrm: '',
  rlm: '',
};

/** Decode the handful of entities WebVTT allows, and numeric ones. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/** Cue text without markup: tags removed, entities decoded, whitespace collapsed. */
function plainText(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Split a cue payload into `(speaker, text)` parts by its `<v Name>` voice
 * tags. Text before the first tag, or a payload with none, has no speaker.
 */
function splitVoices(payload: string): Array<{ speaker: string | null; text: string }> {
  const parts: Array<{ speaker: string | null; text: string }> = [];
  const voice = /<v(?:\.[^\s>]*)?(?:\s+([^>]*))?>/gi;
  let speaker: string | null = null;
  let from = 0;
  const push = (to: number) => {
    const text = plainText(payload.slice(from, to));
    if (text) parts.push({ speaker, text });
  };
  for (let m = voice.exec(payload); m !== null; m = voice.exec(payload)) {
    push(m.index);
    const name = decodeEntities(m[1] ?? '').replace(/\s+/g, ' ').trim();
    speaker = name || null;
    from = m.index + m[0].length;
  }
  push(payload.length);
  return parts;
}

function finishCues(cues: Cue[]): Cue[] {
  const clean: Cue[] = [];
  for (const cue of cues) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)) continue;
    if (cue.start < 0 || cue.start > MAX_TIMELINE_SECS) continue;
    if (!cue.text) continue;
    let end = cue.end;
    // An end before the start, or hours after it, is a damaged timestamp. The
    // start is the half that matters for alignment, so the cue is kept.
    if (end < cue.start) end = cue.start;
    if (end - cue.start > MAX_CUE_SECS) end = cue.start + MAX_CUE_SECS;
    clean.push({ ...cue, end });
    if (clean.length >= MAX_CUES) break;
  }
  // Stable for equal starts, so two voices in one cue keep their order.
  return clean
    .map((cue, i) => ({ cue, i }))
    .sort((a, b) => a.cue.start - b.cue.start || a.i - b.i)
    .map((x) => x.cue);
}

/**
 * A tolerant WebVTT reader for what Teams (and Stream, and Zoom) export.
 *
 * Accepts: an optional `WEBVTT` header with trailing text, `NOTE` / `STYLE` /
 * `REGION` blocks (skipped), cue identifiers, hours present or absent, `.` or
 * `,` before the milliseconds, cue settings after the timing, multi-line
 * payloads, `<v Name>` voice tags with or without the closing tag, several
 * voices in one cue, other inline tags, entities. Never throws: anything it
 * cannot read is skipped, and an empty or foreign file gives `[]`.
 */
export function parseTeamsVtt(text: string): Cue[] {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues: Cue[] = [];
  let i = 0;
  const blank = (line: string | undefined) => line === undefined || line.trim() === '';

  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      i += 1;
      continue;
    }
    const timing = TIMING_LINE.exec(line);
    if (!timing) {
      // A comment or style block runs to the next blank line. Everything
      // else (the header, a cue identifier) is a single line to step over.
      if (/^(NOTE|STYLE|REGION)(\s|$)/.test(line.trim())) {
        while (i < lines.length && !blank(lines[i])) i += 1;
      } else {
        i += 1;
      }
      continue;
    }
    // Two timestamps, each with up to four groups; find them by position.
    const [startText, endText] = line.split('-->');
    const start = parseTimestamp((TIMESTAMP.exec(startText ?? '') ?? [''])[0]);
    const end = parseTimestamp((TIMESTAMP.exec(endText ?? '') ?? [''])[0]);
    i += 1;
    const payload: string[] = [];
    while (i < lines.length && !blank(lines[i]) && !TIMING_LINE.test(lines[i])) {
      payload.push(lines[i]);
      i += 1;
    }
    // A cue identifier directly above the next timing line was swallowed as
    // payload when there was no blank line between cues. Give it back.
    if (i < lines.length && TIMING_LINE.test(lines[i]) && payload.length > 1) {
      const last = payload[payload.length - 1];
      if (!/[<>]/.test(last) && /^[\w./-]+$/.test(last.trim())) payload.pop();
    }
    if (start === null || end === null) continue;
    for (const part of splitVoices(payload.join('\n'))) {
      cues.push({ start, end, speaker: part.speaker, text: part.text });
    }
  }
  return finishCues(cues);
}

/**
 * The text of a Teams transcript saved as Word (`.docx`), once extracted to
 * plain text. Two layouts are in circulation:
 *
 *   0:0:0.0 --> 0:0:3.530            Anna Svensson   0:03
 *   Anna Svensson                    Then we start.
 *   Then we start.
 *
 * In the second there is no end time, so a cue ends where the next begins.
 */
export function parseTeamsDocxText(text: string): Cue[] {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  const cues: Cue[] = [];
  const header = /^(.+?)(?:\s{2,}|\t+)(\d{1,3}:\d{1,2}(?::\d{1,2})?)$/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const timing = TIMING_LINE.exec(line);
    if (timing) {
      const [startText, endText] = line.split('-->');
      const start = parseTimestamp((TIMESTAMP.exec(startText ?? '') ?? [''])[0]);
      const end = parseTimestamp((TIMESTAMP.exec(endText ?? '') ?? [''])[0]);
      i += 1;
      while (i < lines.length && lines[i] === '') i += 1;
      const speaker = i < lines.length && !TIMING_LINE.test(lines[i]) ? lines[i] : null;
      if (speaker !== null) i += 1;
      const body: string[] = [];
      while (i < lines.length && !TIMING_LINE.test(lines[i])) {
        if (lines[i]) body.push(lines[i]);
        i += 1;
      }
      if (start !== null && end !== null) {
        cues.push({ start, end, speaker: speaker || null, text: plainText(body.join(' ')) });
      }
      continue;
    }
    const head = header.exec(line);
    const at = head ? parseTimestamp(head[2]) : null;
    if (head && at !== null) {
      i += 1;
      const body: string[] = [];
      while (i < lines.length && !header.test(lines[i]) && !TIMING_LINE.test(lines[i])) {
        if (lines[i]) body.push(lines[i]);
        i += 1;
      }
      cues.push({ start: at, end: Number.NaN, speaker: head[1].trim() || null, text: plainText(body.join(' ')) });
      continue;
    }
    i += 1;
  }
  // The second layout has no end times: a cue lasts until the next one
  // starts, or a few seconds if it is the last.
  for (let k = 0; k < cues.length; k++) {
    if (Number.isNaN(cues[k].end)) {
      const next = cues[k + 1];
      cues[k].end = next && next.start > cues[k].start ? next.start : cues[k].start + 5;
    }
  }
  return finishCues(cues);
}

/** The distinct speaker names, in order of first appearance. */
export function cueSpeakers(cues: readonly Cue[]): string[] {
  const seen = new Set<string>();
  for (const cue of cues) if (cue.speaker) seen.add(cue.speaker);
  return [...seen];
}

// ── Offset estimation ─────────────────────────────────────────────────────

/**
 * Words reduced to what two transcribers of the same speech agree on: lower
 * case, no punctuation, no diacritics. Removing diacritics is deliberately
 * the only folding done ("å" and "a" become one letter, which costs a little
 * precision in Swedish and buys agreement when one side wrote "cafe" and the
 * other "café"); there is no stemming and no transliteration.
 */
export function normaliseTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((token) => token.length > 0);
}

interface TimedText {
  start: number;
  end: number;
  text: string;
}

/**
 * Where each distinctive token occurs. Single words of four letters or more
 * and every pair of adjacent words are tokens; a word's time is interpolated
 * across its segment by position.
 */
function tokenTimes(items: readonly TimedText[], maxItems: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const add = (token: string, at: number) => {
    const list = out.get(token);
    if (list) list.push(at);
    else out.set(token, [at]);
  };
  // A very long transcript is sampled evenly rather than read in full: the
  // offset is one number, and a few thousand segments pin it down.
  const step = items.length > maxItems ? items.length / maxItems : 1;
  for (let f = 0; f < items.length; f += step) {
    const item = items[Math.floor(f)];
    const words = normaliseTokens(item.text);
    const span = Math.max(0, item.end - item.start);
    for (let w = 0; w < words.length; w++) {
      const at = item.start + ((w + 0.5) / words.length) * span;
      if (words[w].length >= 4) add(words[w], at);
      if (w + 1 < words.length) add(`${words[w]} ${words[w + 1]}`, at);
    }
  }
  return out;
}

export interface OffsetEstimate {
  /** `ourTime = cueTime + offsetSecs`, to a tenth of a second. */
  offsetSecs: number;
  /** 0..1. Below about 0.5 the UI asks the user to check. */
  confidence: number;
}

export interface EstimateOffsetOptions {
  /** Search this far either side of zero. Default 900 s (15 minutes). */
  maxOffsetSecs?: number;
}

/** A token that occurs more often than this on either side says little about time. */
const MAX_TOKEN_OCCURRENCES = 6;
/** At most this many segments or cues are read from each side. */
const MAX_ITEMS_PER_SIDE = 4000;
/** Speech-to-text timing jitter: votes this close together are one opinion. */
const COARSE_WINDOW_SECS = 2;

/**
 * Estimate the shift between our segments and the Teams cues from the text.
 *
 * Every distinctive token that both transcripts contain votes for the time
 * difference between its two occurrences. Agreement shows as a peak in the
 * histogram of those votes: first at one-second resolution across the whole
 * search range, then at a tenth of a second around the winner. That is the
 * offset maximising token agreement, found without scoring every candidate
 * offset against every pair of segments.
 *
 * The work is bounded: both sides are sampled to a fixed number of segments,
 * frequent tokens are ignored, so a three-hour meeting costs about what a
 * thirty-minute one does.
 *
 * Confidence combines how many DIFFERENT tokens support the peak with how far
 * it stands above the best rival elsewhere. Two unrelated texts give a low
 * value; `{ offsetSecs: 0, confidence: 0 }` when there is nothing to compare.
 */
export function estimateOffset(
  ourSegments: readonly Segment[],
  cues: readonly Cue[],
  options: EstimateOffsetOptions = {},
): OffsetEstimate {
  const range = Math.max(1, Math.round(options.maxOffsetSecs ?? 900));
  if (ourSegments.length === 0 || cues.length === 0) return { offsetSecs: 0, confidence: 0 };

  const ours = tokenTimes(ourSegments, MAX_ITEMS_PER_SIDE);
  const theirs = tokenTimes(cues, MAX_ITEMS_PER_SIDE);

  // One-second bins over [-range, +range].
  const bins = new Float64Array(2 * range + 1);
  const votes: Array<{ delta: number; weight: number; token: string }> = [];
  for (const [token, ourTimes] of ours) {
    if (ourTimes.length > MAX_TOKEN_OCCURRENCES) continue;
    const theirTimes = theirs.get(token);
    if (!theirTimes || theirTimes.length > MAX_TOKEN_OCCURRENCES) continue;
    // A token said three times on each side casts nine votes, at most three
    // of which are right: each is worth a ninth.
    const weight = 1 / (ourTimes.length * theirTimes.length);
    for (const a of ourTimes) {
      for (const b of theirTimes) {
        const delta = a - b;
        if (delta < -range || delta > range) continue;
        bins[Math.round(delta) + range] += weight;
        votes.push({ delta, weight, token });
      }
    }
  }
  if (votes.length === 0) return { offsetSecs: 0, confidence: 0 };

  // Coarse: the best window of ±COARSE_WINDOW_SECS bins.
  const windowSum = (centre: number) => {
    let sum = 0;
    for (let k = centre - COARSE_WINDOW_SECS; k <= centre + COARSE_WINDOW_SECS; k++) {
      if (k >= 0 && k < bins.length) sum += bins[k];
    }
    return sum;
  };
  let best = 0;
  let bestSum = -1;
  for (let k = 0; k < bins.length; k++) {
    const sum = windowSum(k);
    if (sum > bestSum) {
      bestSum = sum;
      best = k;
    }
  }
  const coarse = best - range;

  // The best rival: a window that does not touch the winner's.
  let rival = 0;
  for (let k = 0; k < bins.length; k++) {
    if (Math.abs(k - best) <= 3 * COARSE_WINDOW_SECS) continue;
    const sum = windowSum(k);
    if (sum > rival) rival = sum;
  }

  // Fine: the weighted median of the votes around the coarse peak, which is
  // not thrown by the odd coincidental match the way a mean would be.
  const near = votes
    .filter((v) => Math.abs(v.delta - coarse) <= COARSE_WINDOW_SECS + 0.5)
    .sort((a, b) => a.delta - b.delta);
  let total = 0;
  for (const v of near) total += v.weight;
  let acc = 0;
  let fine = coarse;
  for (const v of near) {
    acc += v.weight;
    if (acc >= total / 2) {
      fine = v.delta;
      break;
    }
  }
  const support = new Set(near.map((v) => v.token)).size;

  // Enough different words agreeing, and no other shift nearly as good.
  const enough = Math.min(1, support / 12);
  const distinct = bestSum > 0 ? Math.max(0, 1 - rival / bestSum) : 0;
  const confidence = Math.round(enough * distinct * 100) / 100;

  return { offsetSecs: Math.round(fine * 10) / 10, confidence };
}

// ── Speaker assignment ────────────────────────────────────────────────────

/** A speaker must hold at least this much of a segment to earn part of it. */
const MIN_RUN_SECS = 0.8;
/** Cues may overlap by this much at a hand-over and still be one speaker after another. */
const OVERLAP_TOLERANCE_SECS = 0.3;
/** How far from the proportional position a word boundary may be and still count as clean. */
const SPLIT_TOLERANCE = 0.18;

interface Run {
  speaker: string;
  start: number;
  end: number;
  overlap: number;
}

/**
 * The speakers heard during `[start, end)`, in time order, with adjacent cues
 * of one speaker joined. `cues` are already shifted onto our clock and sorted
 * by start; `from` is where to begin looking.
 */
function runsWithin(start: number, end: number, cues: readonly Cue[], from: number): Run[] {
  const runs: Run[] = [];
  for (let k = from; k < cues.length; k++) {
    const cue = cues[k];
    if (cue.start >= end) break;
    if (!cue.speaker) continue;
    const lo = Math.max(start, cue.start);
    const hi = Math.min(end, cue.end);
    if (hi <= lo) continue;
    const last = runs[runs.length - 1];
    if (last && last.speaker === cue.speaker) {
      last.end = Math.max(last.end, hi);
      last.overlap += hi - lo;
    } else {
      runs.push({ speaker: cue.speaker, start: lo, end: hi, overlap: hi - lo });
    }
  }
  return runs;
}

function majority(runs: readonly Run[]): string | null {
  const totals = new Map<string, number>();
  for (const run of runs) totals.set(run.speaker, (totals.get(run.speaker) ?? 0) + run.overlap);
  let best: string | null = null;
  let bestOverlap = 0;
  for (const [speaker, overlap] of totals) {
    if (overlap > bestOverlap) {
      best = speaker;
      bestOverlap = overlap;
    }
  }
  return best;
}

/**
 * The index in `text` to cut at for a change of speaker `fraction` of the way
 * through, or `-1` when no word boundary is close enough to that position to
 * trust. A boundary after sentence punctuation is preferred to a nearer one
 * in the middle of a clause.
 */
function cleanSplitIndex(text: string, fraction: number): number {
  const target = fraction * text.length;
  const tolerance = Math.max(8, SPLIT_TOLERANCE * text.length);
  let best = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let i = 1; i < text.length - 1; i++) {
    if (text[i] !== ' ') continue;
    const distance = Math.abs(i - target);
    if (distance > tolerance) continue;
    const afterSentence = /[.!?…]["')\]]?$/.test(text.slice(Math.max(0, i - 2), i));
    const cost = distance - (afterSentence ? tolerance * 0.6 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }
  return best;
}

/**
 * Give each of our segments the Teams speaker it overlaps most, once the cues
 * are shifted by `offsetSecs` onto our clock.
 *
 * - A segment no cue overlaps keeps the label it had (or none).
 * - A segment during which the speaker changes is split at the change, but
 *   only where the proportional position falls near a word boundary; if not,
 *   the whole segment goes to whoever held most of it. Our text is never
 *   reworded and never reordered: the output's texts, joined, equal the
 *   input's.
 * - Cues without a speaker assign nothing.
 *
 * Linear in segments plus cues (cues are bounded in length by the parser).
 */
export function assignSpeakers(
  ourSegments: readonly Segment[],
  cues: readonly Cue[],
  offsetSecs: number,
): Segment[] {
  const shifted = cues
    .map((cue) => ({ ...cue, start: cue.start + offsetSecs, end: cue.end + offsetSecs }))
    .sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  // Cues are at most MAX_CUE_SECS long, so nothing starting earlier than that
  // before a segment can still overlap it. `from` only ever moves forward.
  let from = 0;

  for (const seg of ourSegments) {
    while (from < shifted.length && shifted[from].start < seg.start - MAX_CUE_SECS) from += 1;
    const heard = runsWithin(seg.start, seg.end, shifted, from);
    if (heard.length === 0) {
      out.push({ ...seg });
      continue;
    }
    // A sliver of a neighbour's cue at either edge is timing jitter, not a
    // change of speaker. If slivers are all there is, the largest one wins.
    const runs = heard.filter((run) => run.overlap >= MIN_RUN_SECS);
    if (runs.length === 0) {
      out.push({ ...seg, speaker: majority(heard) ?? seg.speaker });
      continue;
    }
    // Merge runs that became neighbours once the slivers were dropped.
    const merged: Run[] = [];
    for (const run of runs) {
      const last = merged[merged.length - 1];
      if (last && last.speaker === run.speaker) {
        last.end = run.end;
        last.overlap += run.overlap;
      } else {
        merged.push({ ...run });
      }
    }
    const whole = (): void => {
      out.push({ ...seg, speaker: majority(merged) ?? seg.speaker });
    };
    if (merged.length === 1 || seg.end <= seg.start) {
      whole();
      continue;
    }

    // Try to cut at every change; one unclean cut and the segment stays whole.
    const text = seg.text.trim();
    const pieces: Segment[] = [];
    let textFrom = 0;
    let timeFrom = seg.start;
    let clean = true;
    for (let r = 0; r < merged.length - 1; r++) {
      // Two people talking at once is not a hand-over: there is no moment to
      // cut at, so the segment goes to whoever held more of it.
      if (merged[r + 1].start < merged[r].end - OVERLAP_TOLERANCE_SECS) {
        clean = false;
        break;
      }
      const boundary = (merged[r].end + merged[r + 1].start) / 2;
      const fraction = (boundary - seg.start) / (seg.end - seg.start);
      const cut = cleanSplitIndex(text, fraction);
      if (cut <= textFrom) {
        clean = false;
        break;
      }
      pieces.push({ start: timeFrom, end: boundary, text: text.slice(textFrom, cut).trim(), speaker: merged[r].speaker });
      textFrom = cut + 1;
      timeFrom = boundary;
    }
    if (!clean) {
      whole();
      continue;
    }
    pieces.push({
      start: timeFrom,
      end: seg.end,
      text: text.slice(textFrom).trim(),
      speaker: merged[merged.length - 1].speaker,
    });
    if (pieces.some((p) => p.text.length === 0)) whole();
    else out.push(...pieces);
  }
  return out;
}

/**
 * The Teams transcript itself as segments on our clock ("Use Teams' text").
 * Cues that would start before our audio does are clamped to zero.
 */
export function cuesToSegments(cues: readonly Cue[], offsetSecs: number): Segment[] {
  return cues.map((cue) => {
    const segment: Segment = {
      start: Math.max(0, Math.round((cue.start + offsetSecs) * 1000) / 1000),
      end: Math.max(0, Math.round((cue.end + offsetSecs) * 1000) / 1000),
      text: cue.text,
    };
    if (cue.speaker) segment.speaker = cue.speaker;
    return segment;
  });
}

export interface AlignedLine {
  /** Seconds on our clock. */
  at: number;
  speaker: string | null;
  teams: string;
  /** What we transcribed at that moment; empty when nothing overlaps. */
  ours: string;
}

/**
 * A few cues spread across the meeting, each beside what we heard at the same
 * moment under `offsetSecs`: the preview a person uses to judge the alignment
 * by eye while nudging the offset.
 */
export function previewAlignment(
  ourSegments: readonly Segment[],
  cues: readonly Cue[],
  offsetSecs: number,
  count = 4,
): AlignedLine[] {
  const candidates = cues.filter((cue) => normaliseTokens(cue.text).length >= 3);
  const pool = candidates.length > 0 ? candidates : cues;
  if (pool.length === 0) return [];
  const lines: AlignedLine[] = [];
  const n = Math.min(count, pool.length);
  for (let k = 0; k < n; k++) {
    const cue = pool[Math.floor(((k + 0.5) / n) * pool.length)];
    const start = cue.start + offsetSecs;
    const end = cue.end + offsetSecs;
    let ours = '';
    let bestOverlap = 0;
    for (const seg of ourSegments) {
      if (seg.start >= end) break;
      const overlap = Math.min(end, seg.end) - Math.max(start, seg.start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        ours = seg.text.trim();
      }
    }
    lines.push({ at: Math.max(0, start), speaker: cue.speaker, teams: cue.text, ours });
  }
  return lines;
}
