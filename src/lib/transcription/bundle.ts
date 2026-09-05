import { tauriApi } from '@/lib/tauri';
import {
  RECORDING_MANIFEST,
  parseRecordingManifest,
  serializeRecordingManifest,
  type RecordingManifest,
} from '@/lib/transcription/manifest';

/**
 * Artifact-bundle helpers for the meeting-recording feature.
 *
 * A recording bundle is a FOLDER (PRD `2026-05-30-meeting-recording.md` →
 * "The artifact bundle"):
 *
 *   <library root>/Recordings/Recording <YYYY-MM-DD HH-MM-SS>/
 *     ├── audio.wav        # finalized capture (audio.m4a when the phone recorded it)
 *     ├── recording.json   # manifest — see `manifest.ts` (PRD 2026-09-05-ios-recordings)
 *     └── transcript.md    # rendered from segments (written here)
 *
 * The bundle directory is always `dirname(audioPath)` — capture wrote the
 * audio into the folder, so the folder already exists. These helpers are
 * container-agnostic: they only ever take `dirname` / `basename` of the audio
 * path, so a phone bundle's `audio.m4a` and the Mac's `audio.wav` behave the
 * same. They add the transcript note and relocate the whole folder (audio +
 * manifest + transcript) into a chosen project.
 */

/** The transcript note filename inside every bundle. */
export const TRANSCRIPT_FILENAME = 'transcript.md';

const SEP = '/';

/**
 * Directory portion of a POSIX-style absolute path. Trailing slashes are
 * ignored; a path with no separator returns ''.
 */
export function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf(SEP);
  if (idx <= 0) return idx === 0 ? SEP : '';
  return trimmed.slice(0, idx);
}

/**
 * Final path component (file or folder name), ignoring trailing slashes.
 */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf(SEP);
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/** Join path segments with a single separator, collapsing duplicate slashes. */
export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .join(SEP)
    .replace(/\/{2,}/g, SEP);
}

/** Absolute path of the transcript note for a given audio file. */
export function transcriptPathForAudio(audioPath: string): string {
  return joinPath(dirname(audioPath), TRANSCRIPT_FILENAME);
}

/** Absolute path of the `recording.json` manifest for a given audio file. */
export function manifestPathForAudio(audioPath: string): string {
  return joinPath(dirname(audioPath), RECORDING_MANIFEST);
}

/**
 * Read and parse a bundle's `recording.json`. `null` when the bundle has no
 * manifest (a Mac bundle from before the manifest existed) or the file does
 * not parse — the caller treats both as "not a manifest bundle".
 */
export async function readRecordingManifest(bundleDir: string): Promise<RecordingManifest | null> {
  try {
    return parseRecordingManifest(await tauriApi.readFile(joinPath(bundleDir, RECORDING_MANIFEST)));
  } catch {
    return null;
  }
}

/** Write a bundle's `recording.json` in the contract's canonical form. */
export async function writeRecordingManifest(
  bundleDir: string,
  manifest: RecordingManifest,
): Promise<void> {
  await tauriApi.writeFile(joinPath(bundleDir, RECORDING_MANIFEST), serializeRecordingManifest(manifest));
}

/**
 * Target bundle directory when moving a bundle into a project:
 * `<projectRoot>/<bundleFolderName>`.
 */
export function bundleTargetPath(bundleDir: string, projectRoot: string): string {
  return joinPath(projectRoot, basename(bundleDir));
}

/**
 * Write the rendered transcript markdown to `transcript.md` next to the audio
 * file. Returns the absolute transcript path.
 */
export async function writeTranscriptToBundle(
  audioPath: string,
  markdown: string,
): Promise<string> {
  const transcriptPath = transcriptPathForAudio(audioPath);
  await tauriApi.writeFile(transcriptPath, markdown);
  return transcriptPath;
}

/**
 * Relocate the whole bundle folder (audio + transcript) into a project.
 *
 * Tries an atomic same-volume rename first (`rename_path`); on failure (e.g. a
 * cross-volume move where `rename` raises `EXDEV`) it falls back to a recursive
 * `copy_directory` followed by deleting the source. Returns the new bundle dir.
 */
export async function moveBundleToProject(
  bundleDir: string,
  projectRoot: string,
): Promise<string> {
  const target = bundleTargetPath(bundleDir, projectRoot);

  try {
    await tauriApi.renamePath(bundleDir, target);
  } catch {
    // Cross-volume (or otherwise non-atomic) move — copy then delete source.
    await tauriApi.copyDirectory(bundleDir, target);
    await tauriApi.deletePath(bundleDir);
  }

  return target;
}
