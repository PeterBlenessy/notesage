import type { TranscriptSegment } from '@/lib/tauri';
import { parseFrontmatter, serializeFrontmatter, type Frontmatter } from '@/lib/frontmatter';
import { TRANSCRIPT_NOTE_TYPE } from '@/lib/transcription/render-transcript';

/**
 * The timed transcript of a recording, kept BESIDE the note instead of in it.
 *
 * A transcript note used to carry every segment in its YAML frontmatter: about
 * 246 KB per recorded hour, rendered by the frontmatter block into one input,
 * and never read back. The timestamps live here instead, in `segments.json`,
 * and the note keeps a small frontmatter and a body a person can read. The
 * names shown for speakers live in `speakers.json`, so renaming one speaker is
 * one small write followed by a re-render of the body.
 *
 * Everything in this file is pure. Reading and writing the files is in
 * `bundle.ts`.
 */

export const SEGMENTS_FILENAME = 'segments.json';
export const SPEAKERS_FILENAME = 'speakers.json';
export const SIDECAR_VERSION = 1 as const;

/** One timed piece of speech. Seconds are relative to the start of the audio. */
export interface Segment {
  start: number;
  end: number;
  text: string;
  /**
   * Who spoke, as a LABEL, not a name: `me` / `others` from a two-track
   * recording, a display name from a Teams transcript. Absent when unknown.
   */
  speaker?: string;
}

/** Label to display name. A label without an entry is shown as itself. */
export type SpeakerNames = Record<string, string>;

/** The two labels a microphone + system-audio recording produces. */
export const SPEAKER_ME = 'me';
export const SPEAKER_OTHERS = 'others';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toSegment(raw: unknown): Segment | null {
  if (!isRecord(raw)) return null;
  const { start, end, text } = raw;
  if (typeof start !== 'number' || typeof end !== 'number' || typeof text !== 'string') return null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const segment: Segment = { start, end, text };
  // `speaker` is the contract's field; `speaker_id` is what the Rust struct
  // and the legacy frontmatter called it.
  const speaker = typeof raw.speaker === 'string' ? raw.speaker : raw.speaker_id;
  if (typeof speaker === 'string' && speaker.trim().length > 0) segment.speaker = speaker.trim();
  return segment;
}

/** `transcribe_file`'s segments in the sidecar's shape. Invalid entries are dropped. */
export function segmentsFromBackend(raw: readonly TranscriptSegment[]): Segment[] {
  const out: Segment[] = [];
  for (const r of raw) {
    const s = toSegment(r);
    if (s) out.push(s);
  }
  return out;
}

/** `null` when the text is not a segments file (wrong version, not JSON). */
export function parseSegmentsFile(json: string): Segment[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.version !== SIDECAR_VERSION || !Array.isArray(raw.segments)) return null;
  const out: Segment[] = [];
  for (const r of raw.segments) {
    const s = toSegment(r);
    if (s) out.push(s);
  }
  return out;
}

export function serializeSegmentsFile(segments: readonly Segment[]): string {
  const clean = segments.map((s) => {
    const out: Segment = { start: s.start, end: s.end, text: s.text };
    if (s.speaker) out.speaker = s.speaker;
    return out;
  });
  return `${JSON.stringify({ version: SIDECAR_VERSION, segments: clean }, null, 2)}\n`;
}

/** An unreadable or missing file is "no names", never an error. */
export function parseSpeakersFile(json: string): SpeakerNames {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (!isRecord(raw) || !isRecord(raw.names)) return {};
  const names: SpeakerNames = {};
  for (const [label, name] of Object.entries(raw.names)) {
    if (typeof name === 'string' && name.trim().length > 0) names[label] = name.trim();
  }
  return names;
}

export function serializeSpeakersFile(names: SpeakerNames): string {
  return `${JSON.stringify({ version: SIDECAR_VERSION, names }, null, 2)}\n`;
}

/** The labels that occur, in order of first appearance. */
export function speakerLabels(segments: readonly Segment[]): string[] {
  const seen = new Set<string>();
  for (const s of segments) if (s.speaker) seen.add(s.speaker);
  return [...seen];
}

/**
 * The name to show for a label: the user's, else the translated default for
 * `me` / `others` (passed in, so this file stays free of the i18n table),
 * else the label itself, which for a Teams transcript already is a name.
 */
export function speakerDisplayName(
  label: string,
  names: SpeakerNames,
  defaults: SpeakerNames = {},
): string {
  return names[label] ?? defaults[label] ?? label;
}

/** `hh:mm:ss`, always three fields, so every marker in a note has one width. */
export function formatTimestamp(secs: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(secs) ? secs : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * The one way a recording's length is written in the app: `h:mm:ss`
 * (`0:05:13`, `1:15:03`). `null` when the length is unknown.
 */
export function formatRecordingLength(secs: number | null | undefined): string | null {
  if (secs === null || secs === undefined || !Number.isFinite(secs) || secs <= 0) return null;
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface RenderBodyOptions {
  /** Translated names for `me` / `others`, used when `speakers` has no entry. */
  defaultNames?: SpeakerNames;
  /** A timestamp marker at least this often. Default 60 s. */
  markerEverySecs?: number;
  /** A silence longer than this starts a new paragraph. Default 2 s. */
  paragraphGapSecs?: number;
}

const DEFAULT_MARKER_EVERY_SECS = 60;
const DEFAULT_PARAGRAPH_GAP_SECS = 2;

/** Characters that would turn a name into markup inside `**…**`. */
function plainName(name: string): string {
  return name.replace(/[*_`[\]\\]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The readable body of a transcript.
 *
 * With speakers, the text is grouped into turns, and each turn begins
 * `**Name** [hh:mm:ss]`. A long turn is broken into paragraphs, each new one
 * led by its own `[hh:mm:ss]`, so an hour of one person talking still has a
 * time reference about every minute. Without speakers it is paragraphs with
 * the same marker about every minute.
 *
 * A marker is only ever placed at the start of a paragraph and only at a
 * segment boundary, so the text itself is never cut mid-sentence by one.
 * Deterministic: the same input gives the same bytes.
 */
export function renderTranscriptBody(
  segments: readonly Segment[],
  speakers: SpeakerNames = {},
  opts: RenderBodyOptions = {},
): string {
  const markerEvery = opts.markerEverySecs ?? DEFAULT_MARKER_EVERY_SECS;
  const gap = opts.paragraphGapSecs ?? DEFAULT_PARAGRAPH_GAP_SECS;
  const defaults = opts.defaultNames ?? {};
  const spoken = segments.filter((s) => s.text.trim().length > 0);
  const withSpeakers = spoken.some((s) => s.speaker);

  const paragraphs: string[] = [];
  let lead = '';
  let texts: string[] = [];
  let prev: Segment | null = null;
  let lastMarkerAt = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (texts.length > 0) paragraphs.push(`${lead}${texts.join(' ')}`);
    texts = [];
    lead = '';
  };

  for (const seg of spoken) {
    const speakerChanged = prev !== null && withSpeakers && prev.speaker !== seg.speaker;
    const paused = prev !== null && seg.start - prev.end > gap;
    const markerDue = seg.start - lastMarkerAt >= markerEvery;
    const startTurn = prev === null || speakerChanged;

    if (startTurn || markerDue || (paused && !withSpeakers)) {
      flush();
      const stamp = `[${formatTimestamp(seg.start)}]`;
      if (withSpeakers && startTurn) {
        // A stretch nobody is credited with (no overlapping Teams cue) still
        // gets its time, just no name.
        const name = seg.speaker ? plainName(speakerDisplayName(seg.speaker, speakers, defaults)) : '';
        lead = name ? `**${name}** ${stamp} ` : `${stamp} `;
        lastMarkerAt = seg.start;
      } else if (markerDue) {
        lead = `${stamp} `;
        lastMarkerAt = seg.start;
      }
    }
    texts.push(seg.text.trim());
    prev = seg;
  }
  flush();

  return paragraphs.length > 0 ? `${paragraphs.join('\n\n')}\n` : '';
}

export interface TranscriptNoteMeta {
  title: string;
  /** ISO-8601 the recording started. */
  date?: string;
  durationSecs?: number;
  language?: string;
  model?: string;
  source?: string;
  /** Display names, in order of first appearance. */
  speakers?: string[];
}

/**
 * The whole transcript note: a SMALL frontmatter, the title, the body. No
 * segments in the frontmatter: those are in `segments.json`.
 */
export function renderTranscriptNote(meta: TranscriptNoteMeta, body: string): string {
  const frontmatter: Frontmatter = { type: TRANSCRIPT_NOTE_TYPE, title: meta.title };
  if (meta.date) frontmatter.date = meta.date;
  const duration = formatRecordingLength(meta.durationSecs);
  if (duration) frontmatter.duration = duration;
  if (meta.language) frontmatter.language = meta.language;
  if (meta.model) frontmatter.model = meta.model;
  if (meta.source) frontmatter.source = meta.source;
  if (meta.speakers && meta.speakers.length > 0) frontmatter.speakers = meta.speakers;
  const heading = `# ${meta.title}`;
  return serializeFrontmatter(frontmatter, body ? `${heading}\n\n${body}` : `${heading}\n`);
}

/**
 * A short, stable fingerprint of a transcript's text, stored in the manifest
 * when the transcript is generated. If the file no longer matches it, a
 * person has edited the note, and nothing may regenerate it without asking.
 *
 * Only the BODY counts, and only what a reader could see: the frontmatter is
 * left out (the app itself adds keys to it, such as a document id, when a
 * note is opened), whitespace is collapsed, and the backslashes the editor
 * puts before `[`, `]`, `*` and `_` when it saves are ignored. So a transcript
 * that was merely opened and saved is not "edited". Not cryptographic: it
 * guards against overwriting work, not against an adversary.
 */
export function hashTranscript(text: string): string {
  const normalised = parseFrontmatter(text.replace(/\r\n?/g, '\n'))
    .content.replace(/\\([[\]*_~`\\])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  // cyrb53: two 32-bit lanes, 53 bits out.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < normalised.length; i++) {
    const ch = normalised.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `c53-${value.toString(16).padStart(14, '0')}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rename a speaker in a transcript a person has edited, touching ONLY the
 * places this app wrote the name: the start of a turn, `**Old name** [` at the
 * beginning of a line. A mention of the same name inside what somebody said
 * is left alone, and so is everything else in the note.
 *
 * The editor escapes square brackets when it saves (`\[00:01:02\]`), so both
 * spellings of the marker are recognised.
 */
export function replaceSpeakerNameInText(
  markdown: string,
  oldName: string,
  newName: string,
): { text: string; count: number } {
  const from = plainName(oldName);
  const to = plainName(newName);
  if (!from || !to || from === to) return { text: markdown, count: 0 };
  const pattern = new RegExp(`^(\\*\\*)${escapeRegExp(from)}(\\*\\*[ \\t]+\\\\?\\[\\d{1,2}:\\d{2}:\\d{2})`, 'gm');
  let count = 0;
  const text = markdown.replace(pattern, (_match, open: string, rest: string) => {
    count += 1;
    return `${open}${to}${rest}`;
  });
  return { text, count };
}

/**
 * A title as a file name: no path separators, no characters Finder or iCloud
 * dislike, no leading dot, a sane length. Falls back to `Transcript`.
 */
export function sanitizeFileStem(title: string): string {
  const cleaned = title
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[/\\:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  const clipped = cleaned.length > 120 ? cleaned.slice(0, 120).trim() : cleaned;
  return clipped || 'Transcript';
}

/** Names in a bundle a transcript must never take. */
const RESERVED_FILES = new Set(['recording.json', SEGMENTS_FILENAME, SPEAKERS_FILENAME]);

/**
 * `<stem>.md`, or `<stem> (2).md`, `(3)`… when that name is taken. Comparison
 * ignores case: the library usually lives on a case-insensitive volume.
 */
export function freeTranscriptFileName(title: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const name of taken) used.add(name.toLowerCase());
  for (const name of RESERVED_FILES) used.add(name);
  const stem = sanitizeFileStem(title);
  let candidate = `${stem}.md`;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n}).md`;
  return candidate;
}
