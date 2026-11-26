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

/**
 * Write a bundle's `recording.json` in the contract's canonical form.
 *
 * `manifest` may carry the optional fields added for system audio, import and
 * naming (`source`, `tracks`, `originalFile`, `title`, …): they are part of
 * `RecordingManifest`, and `createMacRecordingManifest` accepts them as facts.
 */
export async function writeRecordingManifest(
  bundleDir: string,
  manifest: RecordingManifest,
): Promise<void> {
  await tauriApi.writeFile(joinPath(bundleDir, RECORDING_MANIFEST), serializeRecordingManifest(manifest));
}

/** Per-bundle chain, so two read-modify-writes of one manifest never interleave. */
const manifestWrites = new Map<string, Promise<unknown>>();

/**
 * Read a bundle's manifest, change it, write it back, serialised per bundle.
 *
 * The scanner (transcription status), the job (which file is the transcript)
 * and the Recordings view (title) all change the same small file. Each used
 * to read and write on its own, and the slower one silently undid the other.
 * `change` returns the new manifest, or `null` to leave the file alone.
 * Resolves with what is on disk afterwards; `null` when there is no manifest.
 */
export function updateRecordingManifest(
  bundleDir: string,
  change: (manifest: RecordingManifest) => RecordingManifest | null,
): Promise<RecordingManifest | null> {
  const run = async (): Promise<RecordingManifest | null> => {
    const current = await readRecordingManifest(bundleDir);
    if (!current) return null;
    const next = change(current);
    if (!next) return current;
    await writeRecordingManifest(bundleDir, next);
    return next;
  };
  const chained = (manifestWrites.get(bundleDir) ?? Promise.resolve()).then(run, run);
  const settled = chained.catch(() => undefined);
  manifestWrites.set(bundleDir, settled);
  void settled.then(() => {
    if (manifestWrites.get(bundleDir) === settled) manifestWrites.delete(bundleDir);
  });
  return chained;
}

/**
 * The transcript's file name in a bundle: the one the manifest names, else
 * the legacy `transcript.md` every bundle used before transcripts were named
 * after the recording.
 */
export function transcriptFileOf(manifest: RecordingManifest | null): string {
  return manifest?.transcript?.file ?? TRANSCRIPT_FILENAME;
}

/** What a recording is called: the user's title, else its folder name. */
export function recordingTitle(bundleDir: string, manifest: RecordingManifest | null): string {
  return manifest?.title?.trim() || basename(bundleDir);
}

/** Audio containers a bundle's primary file may be in, by preference. */
const AUDIO_FILE_PATTERN = /^audio\.(m4a|wav|mp3|aac|flac|ogg)$/i;

/**
 * The primary audio file among a bundle's file names, for a bundle with no
 * manifest to say: `audio.m4a` before `audio.wav` (the encoder removes the
 * WAV only once the AAC is verified, so when both exist the AAC is good).
 */
export function findAudioFile(names: readonly string[]): string | null {
  const audio = names.filter((n) => AUDIO_FILE_PATTERN.test(n));
  return audio.find((n) => /\.m4a$/i.test(n)) ?? audio.find((n) => /\.wav$/i.test(n)) ?? audio[0] ?? null;
}

/**
 * Target bundle directory when moving a bundle into a project:
 * `<projectRoot>/<bundleFolderName>`.
 */
export function bundleTargetPath(bundleDir: string, projectRoot: string): string {
  return joinPath(projectRoot, basename(bundleDir));
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
