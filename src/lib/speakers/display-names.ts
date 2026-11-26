import { SPEAKER_ME, SPEAKER_NUMBERED, SPEAKER_OTHERS, type SpeakerNames } from '@/lib/transcription/segments';

/**
 * What a speaker LABEL is, and what to call it until a person has named it.
 *
 * Voice analysis numbers the voices it finds: `speaker-1`, `speaker-2`, …
 * Those are labels, not names. They are stored as they are (in
 * `segments.json`), and shown as "Speaker 1" in the app's language until the
 * user gives the voice a name in `speakers.json`. Pure: the translated words
 * come in through `defaults`, the way `me` / `others` already do.
 */

const ANALYSIS_LABEL = /^speaker-(\d+)$/;

/** `3` for `speaker-3`; `null` for anything else. */
export function speakerNumber(label: string): number | null {
  const match = ANALYSIS_LABEL.exec(label);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** A label voice analysis made (`speaker-N`), as opposed to `me`, `others` or a Teams name. */
export function isAnalysisLabel(label: string): boolean {
  return speakerNumber(label) !== null;
}

/** A label that is not a person's name: `me`, `others`, `speaker-N`. */
export function isGenericLabel(label: string): boolean {
  return label === SPEAKER_ME || label === SPEAKER_OTHERS || isAnalysisLabel(label);
}

/**
 * What a label is called before anyone has named it: the translated "Me" /
 * "Others" / "Speaker 2", else the label itself (a Teams label is a name).
 * `defaults` is `defaultSpeakerNames()`.
 */
export function unnamedSpeakerName(label: string, defaults: SpeakerNames): string {
  if (label === SPEAKER_NUMBERED) return label;
  const fixed = defaults[label];
  if (fixed) return fixed;
  const n = speakerNumber(label);
  const template = defaults[SPEAKER_NUMBERED];
  if (n !== null && template) return template.replace('{n}', String(n));
  return label;
}

/** Collapse runs of whitespace and trim: what a typed name is stored as. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Two names are the same person's when they differ only in case and spacing. */
export function sameName(a: string, b: string): boolean {
  return cleanName(a).toLocaleLowerCase() === cleanName(b).toLocaleLowerCase();
}

/**
 * The names to store for a set of typed fields: a blank field, or one that
 * still says the built-in default ("Speaker 2", "Me"), stores nothing, so the
 * default keeps following the app's language.
 */
export function namesToStore(
  fields: ReadonlyArray<{ label: string; value: string }>,
  defaults: SpeakerNames,
): SpeakerNames {
  const names: SpeakerNames = {};
  for (const field of fields) {
    const value = cleanName(field.value);
    if (value && value !== unnamedSpeakerName(field.label, defaults)) names[field.label] = value;
  }
  return names;
}

/** Sort key that keeps `me` first, then `speaker-1`, `speaker-2`, … `speaker-10`, then names. */
export function compareLabels(a: string, b: string): number {
  const rank = (label: string): [number, number] => {
    if (label === SPEAKER_ME) return [0, 0];
    const n = speakerNumber(label);
    if (n !== null) return [1, n];
    return [2, 0];
  };
  const [ra, na] = rank(a);
  const [rb, nb] = rank(b);
  return ra - rb || na - nb || a.localeCompare(b);
}
