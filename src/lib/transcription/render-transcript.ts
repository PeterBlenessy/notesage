import type { TranscriptSegment } from '@/lib/tauri';
import {
  parseFrontmatter,
  serializeFrontmatter,
  type Frontmatter,
} from '@/lib/frontmatter';

/**
 * Renders a whole-file transcription (`TranscriptSegment[]`) into the markdown
 * transcript note that lands in the recording bundle (`transcript.md`).
 *
 * v1 rules (PRD `2026-05-30-meeting-recording.md` → "Data model — segments"):
 *
 * - The BODY is readable prose: consecutive segments are grouped into
 *   paragraphs. Timestamps are NOT shown in the body in v1 (hidden metadata).
 * - The raw segment array is persisted verbatim in YAML frontmatter under the
 *   `segments` key, so a future diarization/naming pass can reconstruct the
 *   structure and re-render speaker-grouped (`**Alice:** …`) WITHOUT
 *   re-transcribing the retained audio.
 *
 * The function is pure and deterministic — given identical inputs it produces
 * byte-identical markdown.
 */

/** The frontmatter `type` discriminator for meeting transcript notes. */
export const TRANSCRIPT_NOTE_TYPE = 'meeting-transcript';

export interface RenderTranscriptOptions {
  /** Note title — rendered as the H1 heading. */
  title: string;
  /** Recording duration in seconds (stored in frontmatter, not shown in body). */
  durationSecs?: number;
  /** Detected/declared transcript language (stored in frontmatter). */
  language?: string;
  /**
   * Maximum gap in seconds between two consecutive segments before a new
   * paragraph is started. Defaults to 2s — natural speech pauses longer than
   * this read as a paragraph break.
   */
  paragraphGapSecs?: number;
}

const DEFAULT_PARAGRAPH_GAP_SECS = 2;

/**
 * Group consecutive segments into paragraph strings.
 *
 * A new paragraph begins when:
 * - the speaker changes (by `speaker_id`), or
 * - the silent gap between the previous segment's `end` and the next
 *   segment's `start` exceeds `paragraphGapSecs`.
 *
 * Segment text is trimmed; blank segments are dropped. Within a paragraph,
 * segment texts are joined with a single space.
 */
export function groupSegmentsIntoParagraphs(
  segments: TranscriptSegment[],
  paragraphGapSecs: number = DEFAULT_PARAGRAPH_GAP_SECS,
): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let prev: TranscriptSegment | null = null;

  const flush = () => {
    if (current.length > 0) {
      paragraphs.push(current.join(' '));
      current = [];
    }
  };

  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;

    if (prev) {
      const speakerChanged = prev.speaker_id !== seg.speaker_id;
      const gap = seg.start - prev.end;
      if (speakerChanged || gap > paragraphGapSecs) {
        flush();
      }
    }

    current.push(text);
    prev = seg;
  }
  flush();

  return paragraphs;
}

/**
 * Render `TranscriptSegment[]` into the full transcript note markdown
 * (frontmatter + H1 + paragraphs).
 */
export function renderTranscript(
  segments: TranscriptSegment[],
  options: RenderTranscriptOptions,
): string {
  const { title, durationSecs, language, paragraphGapSecs } = options;

  const frontmatter: Frontmatter = {
    type: TRANSCRIPT_NOTE_TYPE,
    title,
    // Raw segments preserved verbatim for the future diarization/naming pass.
    segments,
  };
  if (durationSecs !== undefined) frontmatter.duration_secs = durationSecs;
  if (language !== undefined) frontmatter.language = language;

  const paragraphs = groupSegmentsIntoParagraphs(segments, paragraphGapSecs);
  const heading = `# ${title}`;
  const body = paragraphs.length > 0
    ? `${heading}\n\n${paragraphs.join('\n\n')}\n`
    : `${heading}\n`;

  return serializeFrontmatter(frontmatter, body);
}

/**
 * Inverse of {@link renderTranscript}: parse a transcript note's frontmatter
 * back into the raw `TranscriptSegment[]`. Returns an empty array when the note
 * has no frontmatter or no valid `segments` key (e.g. a hand-edited note).
 *
 * Only the structural segment fields are reconstructed; unknown extra keys on a
 * persisted segment are dropped. `speaker_id` / `speaker_name` default to
 * `null` when absent so a v1 note (always `null`) round-trips exactly.
 */
export function parseTranscriptSegments(markdown: string): TranscriptSegment[] {
  const { frontmatter } = parseFrontmatter(markdown);
  if (!frontmatter || !Array.isArray(frontmatter.segments)) return [];

  const segments: TranscriptSegment[] = [];
  for (const raw of frontmatter.segments) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.start !== 'number' || typeof r.end !== 'number' || typeof r.text !== 'string') {
      continue;
    }
    segments.push({
      start: r.start,
      end: r.end,
      text: r.text,
      speaker_id: typeof r.speaker_id === 'string' ? r.speaker_id : null,
      speaker_name: typeof r.speaker_name === 'string' ? r.speaker_name : null,
    });
  }
  return segments;
}
