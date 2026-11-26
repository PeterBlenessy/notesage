import type { SpeakerAnalysisResult, VoiceMatch } from '@/lib/tauri';

/**
 * The results of voice analyses, held IN MEMORY ONLY.
 *
 * An analysis result carries a voiceprint (`embedding`) for every voice it
 * found. Voiceprints are biometric data about other people, so the result
 * never goes anywhere that outlives the app: not a persisted store, not the
 * bundle, not a log. This plain module-level map is the one place it lives,
 * deliberately outside the zustand store (which has a `persist` middleware),
 * so no change to what that store saves can ever sweep an embedding to disk.
 * It is gone when the app quits.
 */

export interface PreparedAnalysis {
  result: SpeakerAnalysisResult;
  /**
   * `segmentsFingerprint` of the transcript segments the analysis was SENT.
   * A held result whose fingerprint is not the transcript's any more was made
   * for a transcript that has since been replaced (transcribed again, here or
   * on another Mac); saving it would put the old words back.
   */
  source: string;
  /**
   * Remembered voices each found voice might be, or `null` when voices are
   * not remembered (the question was not asked).
   */
  matches: VoiceMatch[] | null;
  /** What the analysis was run with, to show and to run again. */
  participants: string[];
  expectedSpeakers: number | null;
  sharedMicrophone: boolean;
  /** Epoch ms. */
  at: number;
}

/**
 * A short fingerprint of a transcript's words and timings: enough to tell one
 * transcription of a recording from another. Not a voiceprint, not secret.
 */
export function segmentsFingerprint(segments: ReadonlyArray<{ start: number; end: number; text: string }>): string {
  let hash = 0x811c9dc5;
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  for (const segment of segments) {
    feed(`${Math.round(segment.start * 100)}|${Math.round(segment.end * 100)}|`);
    feed(segment.text.replace(/\s+/g, ' ').trim());
    feed('\n');
  }
  return `${segments.length}:${(hash >>> 0).toString(16)}`;
}

/** Recordings whose results are kept at once; the oldest goes first. */
export const MAX_PREPARED = 8;

const prepared = new Map<string, PreparedAnalysis>();

export function getPreparedAnalysis(bundleDir: string): PreparedAnalysis | undefined {
  return prepared.get(bundleDir);
}

export function setPreparedAnalysis(bundleDir: string, analysis: PreparedAnalysis): void {
  prepared.delete(bundleDir);
  prepared.set(bundleDir, analysis);
  while (prepared.size > MAX_PREPARED) {
    const oldest = prepared.keys().next().value;
    if (oldest === undefined) break;
    prepared.delete(oldest);
  }
}

export function clearPreparedAnalysis(bundleDir: string): void {
  prepared.delete(bundleDir);
}

/** Every held result is dropped: used when stored voices are deleted, and by tests. */
export function clearAllPreparedAnalyses(): void {
  prepared.clear();
}

export function preparedAnalysisDirs(): string[] {
  return [...prepared.keys()];
}
