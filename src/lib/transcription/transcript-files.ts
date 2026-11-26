import { tauriApi } from '@/lib/tauri';
import { t } from '@/lib/i18n';
import { appVersion } from '@/lib/version';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/frontmatter';
import {
  TRANSCRIPT_FILENAME,
  basename,
  findAudioFile,
  joinPath,
  readRecordingManifest,
  recordingTitle,
  transcriptFileOf,
  updateRecordingManifest,
  writeRecordingManifest,
} from '@/lib/transcription/bundle';
import {
  createMacRecordingManifest,
  isoWithOffset,
  type RecordingManifest,
  type RecordingManifestTrack,
} from '@/lib/transcription/manifest';
import { parseTranscriptSegments } from '@/lib/transcription/render-transcript';
import {
  SEGMENTS_FILENAME,
  SPEAKERS_FILENAME,
  SPEAKER_ME,
  SPEAKER_OTHERS,
  freeTranscriptFileName,
  hashTranscript,
  parseSegmentsFile,
  parseSpeakersFile,
  renderTranscriptBody,
  renderTranscriptNote,
  replaceSpeakerNameInText,
  segmentsFromBackend,
  serializeSegmentsFile,
  serializeSpeakersFile,
  speakerDisplayName,
  speakerLabels,
  type Segment,
  type SpeakerNames,
} from '@/lib/transcription/segments';
import {
  assignSpeakers,
  cuesToSegments,
  parseTeamsDocxText,
  parseTeamsVtt,
  type Cue,
} from '@/lib/transcription/teams-transcript';

/**
 * Reading and writing what a recording bundle holds besides its audio: the
 * transcript note, `segments.json`, `speakers.json`, an attached Teams
 * transcript. The pure halves are in `segments.ts` and `teams-transcript.ts`;
 * this file is the part that touches the disk.
 *
 * The rule every write here follows: **a transcript a person may have edited
 * is never replaced without that person saying so.** A caller that has not
 * asked gets a second file beside the first.
 */

/** What an attached Teams transcript is stored as, by extension. */
export const TEAMS_TRANSCRIPT_STEM = 'teams-transcript';

/** "Me" / "Others" in the app's language, for the two labels a two-track recording produces. */
export function defaultSpeakerNames(): SpeakerNames {
  return {
    [SPEAKER_ME]: t('transcription.speakerMe'),
    [SPEAKER_OTHERS]: t('transcription.speakerOthers'),
  };
}

/** File names directly inside a bundle. One shallow listing. */
export async function listBundleFiles(bundleDir: string): Promise<string[]> {
  const entries = await tauriApi.listDirectory(bundleDir, false, 0);
  return entries.filter((e) => !e.is_directory).map((e) => e.name);
}

export async function readSpeakers(bundleDir: string): Promise<SpeakerNames> {
  try {
    return parseSpeakersFile(await tauriApi.readFile(joinPath(bundleDir, SPEAKERS_FILENAME)));
  } catch {
    return {};
  }
}

export async function writeSpeakers(bundleDir: string, names: SpeakerNames): Promise<void> {
  await tauriApi.writeFile(joinPath(bundleDir, SPEAKERS_FILENAME), serializeSpeakersFile(names));
}

/**
 * A recording's timed segments: `segments.json`, or, for a bundle from before
 * that file existed, the array in the transcript note's frontmatter.
 *
 * Reads only. A legacy transcript is never converted just because something
 * looked at it: `legacy` tells the caller where the segments came from.
 */
export async function readSegments(
  bundleDir: string,
  transcriptFile: string = TRANSCRIPT_FILENAME,
): Promise<{ segments: Segment[]; legacy: boolean }> {
  try {
    const parsed = parseSegmentsFile(await tauriApi.readFile(joinPath(bundleDir, SEGMENTS_FILENAME)));
    if (parsed) return { segments: parsed, legacy: false };
  } catch {
    // No sidecar: fall through to the legacy location.
  }
  try {
    const markdown = await tauriApi.readFile(joinPath(bundleDir, transcriptFile));
    const legacy = segmentsFromBackend(parseTranscriptSegments(markdown));
    return { segments: legacy, legacy: legacy.length > 0 };
  } catch {
    return { segments: [], legacy: false };
  }
}

export interface ExistingTranscript {
  file: string;
  path: string;
  /**
   * Has a person changed it since it was generated? `null` when that cannot
   * be known (a transcript from before the hash was recorded), which callers
   * must treat as "possibly".
   */
  edited: boolean | null;
  content: string;
}

/** The bundle's current transcript, if there is one on disk. */
export async function inspectTranscript(
  bundleDir: string,
  manifest?: RecordingManifest | null,
): Promise<ExistingTranscript | null> {
  const m = manifest === undefined ? await readRecordingManifest(bundleDir) : manifest;
  const file = transcriptFileOf(m);
  const path = joinPath(bundleDir, file);
  let content: string;
  try {
    if (!(await tauriApi.pathExists(path))) return null;
    content = await tauriApi.readFile(path);
  } catch {
    return null;
  }
  const hash = m?.transcript?.file === file ? m.transcript.hash : undefined;
  return { file, path, content, edited: hash ? hashTranscript(content) !== hash : null };
}

/** `replace` overwrites the current transcript; `keep-both` writes a new file beside it. */
export type TranscriptWriteMode = 'replace' | 'keep-both';

export interface WriteTranscriptOptions {
  bundleDir: string;
  segments: readonly Segment[];
  /** Read from `speakers.json` when omitted. */
  speakers?: SpeakerNames;
  language?: string;
  model?: string;
  /** Used when the manifest does not know the length (an adopted orphan). */
  durationSecs?: number;
  /**
   * What to do when the bundle already has a transcript. Omitted means the
   * caller did not ask the user, so nothing is overwritten: `keep-both`.
   */
  mode?: TranscriptWriteMode;
}

export interface WrittenTranscript {
  path: string;
  file: string;
  /** `true` when an existing transcript was left in place and a new file written beside it. */
  keptBoth: boolean;
}

function displayNamesFor(segments: readonly Segment[], speakers: SpeakerNames): string[] {
  const defaults = defaultSpeakerNames();
  return speakerLabels(segments).map((label) => speakerDisplayName(label, speakers, defaults));
}

/**
 * Write `segments.json` and the transcript note, and record in the manifest
 * which file the transcript is and what it hashed to.
 *
 * A NEW transcript is named after the recording (`<title>.md`), not
 * `transcript.md`, so two open transcripts are two different tabs. Replacing
 * keeps the existing file's name, whatever it is, so links to it survive.
 */
export async function writeTranscript(options: WriteTranscriptOptions): Promise<WrittenTranscript> {
  const { bundleDir, segments } = options;
  const [manifest, files] = await Promise.all([
    readRecordingManifest(bundleDir),
    listBundleFiles(bundleDir).catch((): string[] => []),
  ]);
  const title = recordingTitle(bundleDir, manifest);
  const current = transcriptFileOf(manifest);
  const exists = files.some((f) => f.toLowerCase() === current.toLowerCase());
  const replace = exists && options.mode === 'replace';
  const file = replace ? current : freeTranscriptFileName(title, files);
  const speakers = options.speakers ?? (await readSpeakers(bundleDir));

  const body = renderTranscriptBody(segments, speakers, { defaultNames: defaultSpeakerNames() });
  const duration = manifest && manifest.durationSecs > 0 ? manifest.durationSecs : options.durationSecs;
  const markdown = renderTranscriptNote(
    {
      title,
      date: manifest?.startedAt,
      durationSecs: duration,
      language: options.language,
      model: options.model,
      source: manifest?.source,
      speakers: displayNamesFor(segments, speakers),
    },
    body,
  );

  // Segments first: a transcript without its sidecar cannot be re-rendered,
  // while a sidecar without its transcript is merely unused.
  await tauriApi.writeFile(joinPath(bundleDir, SEGMENTS_FILENAME), serializeSegmentsFile(segments));
  const path = joinPath(bundleDir, file);
  await tauriApi.writeFile(path, markdown);
  await updateRecordingManifest(bundleDir, (m) => ({
    ...m,
    durationSecs: m.durationSecs > 0 || !options.durationSecs ? m.durationSecs : options.durationSecs,
    transcript: { file, hash: hashTranscript(markdown), generatedAt: isoWithOffset(Date.now()) },
  }));
  return { path, file, keptBoth: exists && !replace };
}

/** Swap a note's body and its `speakers` frontmatter, keeping every other key. */
function rerender(existing: string, title: string, body: string, speakers: string[]): string {
  const { frontmatter } = parseFrontmatter(existing);
  const next = { ...(frontmatter ?? {}) };
  if (speakers.length > 0) next.speakers = speakers;
  else delete next.speakers;
  next.title = title;
  return serializeFrontmatter(next, body ? `# ${title}\n\n${body}` : `# ${title}\n`);
}

export interface SpeakerRenameResult {
  /** The transcript was regenerated with the new names. */
  rewritten: boolean;
  /**
   * The transcript has been edited by hand (or might have been), so it was
   * left alone. The caller offers `replaceNamesInTranscript` instead.
   */
  edited: boolean;
  transcriptPath: string | null;
}

/**
 * Save new display names for a recording's speakers and, when that is safe,
 * regenerate the transcript body from `segments.json` so every turn shows
 * them. "Safe" means the note still hashes to what was generated: nobody has
 * typed in it.
 */
export async function renameSpeakers(bundleDir: string, names: SpeakerNames): Promise<SpeakerRenameResult> {
  await writeSpeakers(bundleDir, names);
  const manifest = await readRecordingManifest(bundleDir);
  const transcript = await inspectTranscript(bundleDir, manifest);
  if (!transcript) return { rewritten: false, edited: false, transcriptPath: null };
  if (transcript.edited !== false) return { rewritten: false, edited: true, transcriptPath: transcript.path };

  const { segments } = await readSegments(bundleDir, transcript.file);
  if (segments.length === 0) return { rewritten: false, edited: false, transcriptPath: transcript.path };
  const body = renderTranscriptBody(segments, names, { defaultNames: defaultSpeakerNames() });
  const markdown = rerender(
    transcript.content,
    recordingTitle(bundleDir, manifest),
    body,
    displayNamesFor(segments, names),
  );
  await tauriApi.writeFile(transcript.path, markdown);
  await updateRecordingManifest(bundleDir, (m) => ({
    ...m,
    transcript: { ...(m.transcript ?? { file: transcript.file }), file: transcript.file, hash: hashTranscript(markdown) },
  }));
  return { rewritten: true, edited: false, transcriptPath: transcript.path };
}

/**
 * The fallback for an edited transcript: swap old display names for new ones
 * at the start of turns only, leaving every other character as the person
 * wrote it. Resolves with how many turn headers changed.
 */
export async function replaceNamesInTranscript(
  bundleDir: string,
  changes: ReadonlyArray<{ from: string; to: string }>,
): Promise<number> {
  const transcript = await inspectTranscript(bundleDir);
  if (!transcript) return 0;
  let text = transcript.content;
  let total = 0;
  // Two passes through placeholders, so swapping two names with each other
  // (A→B and B→A) does not collapse both into one.
  const staged = changes.map((change, i) => ({ ...change, token: `\u0000speaker-${i}\u0000` }));
  for (const change of staged) {
    const result = replaceSpeakerNameInText(text, change.from, change.token);
    text = result.text;
    total += result.count;
  }
  for (const change of staged) text = text.split(change.token).join(change.to.replace(/[*_`[\]\\]/g, '').trim());
  if (total > 0) await tauriApi.writeFile(transcript.path, text);
  return total;
}

export interface RenameRecordingOptions {
  /** Is this path open in the editor? An open note's file is not renamed under it. */
  isOpen?: (path: string) => boolean;
}

/**
 * Give a recording a name. The name is stored as `title` in the manifest (the
 * bundle FOLDER keeps its stamp, so nothing that points at it breaks) and is
 * what the transcript note is called from then on.
 *
 * An existing transcript follows when it can: its file is renamed unless it
 * is the legacy `transcript.md` or open in the editor, and its heading and
 * frontmatter title are updated only if nobody has edited the note.
 */
export async function renameRecording(
  bundleDir: string,
  title: string,
  options: RenameRecordingOptions = {},
): Promise<{ transcriptPath: string | null }> {
  const clean = title.replace(/\s+/g, ' ').trim();
  const manifest = await updateRecordingManifest(bundleDir, (m) => {
    const next = { ...m };
    if (clean && clean !== basename(bundleDir)) next.title = clean;
    else delete next.title;
    return next;
  });
  if (!manifest) throw new Error(t('recordings.noManifest'));

  const transcript = await inspectTranscript(bundleDir, manifest);
  if (!transcript) return { transcriptPath: null };
  const newTitle = recordingTitle(bundleDir, manifest);
  let path = transcript.path;
  let file = transcript.file;

  if (file !== TRANSCRIPT_FILENAME && !options.isOpen?.(path)) {
    const others = (await listBundleFiles(bundleDir).catch((): string[] => [])).filter(
      (f) => f.toLowerCase() !== file.toLowerCase(),
    );
    const wanted = freeTranscriptFileName(newTitle, others);
    if (wanted !== file) {
      await tauriApi.renamePath(path, joinPath(bundleDir, wanted));
      file = wanted;
      path = joinPath(bundleDir, wanted);
    }
  }

  let hash = manifest.transcript?.hash;
  if (transcript.edited === false) {
    const { frontmatter, content } = parseFrontmatter(transcript.content);
    const body = content.replace(/^# .*\n?/, `# ${newTitle}\n`);
    const markdown = serializeFrontmatter({ ...(frontmatter ?? {}), title: newTitle }, body);
    await tauriApi.writeFile(path, markdown);
    hash = hashTranscript(markdown);
  }
  if (file !== transcript.file || hash !== manifest.transcript?.hash) {
    await updateRecordingManifest(bundleDir, (m) => ({
      ...m,
      transcript: { ...(m.transcript ?? {}), file, ...(hash ? { hash } : {}) },
    }));
  }
  return { transcriptPath: path };
}

/** `Recording 2026-09-05 14-02-11` → ms-epoch, local time. `null` when the name carries no stamp. */
export function startFromBundleName(name: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2})[-:.]?(\d{2})[-:.]?(\d{2})/.exec(name);
  if (!m) return null;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
  return Number.isNaN(at) ? null : at;
}

/**
 * Adopt a bundle that has audio and no `recording.json`: the leftover of a
 * quit or crash before the manifest was written, or a folder from before
 * manifests existed. Probes the audio file and writes a manifest, so the
 * recording can be transcribed, named and managed like any other.
 *
 * Throws when the folder holds no audio, or the audio is not on this disk
 * yet: a manifest with a wrong byte count would make the scanner wait for
 * ever for a file that is already complete.
 */
export async function adoptOrphanBundle(bundleDir: string): Promise<{ manifest: RecordingManifest; audioPath: string }> {
  const files = await listBundleFiles(bundleDir);
  const audioFile = findAudioFile(files);
  if (!audioFile) throw new Error(t('recordings.noAudio'));
  const audioPath = joinPath(bundleDir, audioFile);
  const status = await tauriApi.audioFileStatus(audioPath);
  if (!status.exists || !status.local || status.size <= 0) throw new Error(t('recordings.audioNotLocal'));

  const find = (stem: string) => files.find((f) => new RegExp(`^${stem}\\.(m4a|wav)$`, 'i').test(f));
  const mic = find('mic');
  const system = find('system');
  const tracks: RecordingManifestTrack[] | undefined =
    mic && system
      ? [
          { role: 'mic', file: mic },
          { role: 'system', file: system },
        ]
      : undefined;

  const manifest = createMacRecordingManifest({
    startedAtMs: startFromBundleName(basename(bundleDir)) ?? Date.now(),
    // Unknown until something decodes the file; the transcription result
    // fills it in (`writeTranscript`).
    durationSecs: 0,
    bytes: status.size,
    // Nominal. Nothing decides anything on it, and the true rate is only
    // known to the decoder.
    sampleRate: 48_000,
    audioFile,
    device: await tauriApi.getDeviceName().catch(() => 'Mac'),
    appVersion: appVersion(),
    source: tracks ? 'both' : 'microphone',
    tracks,
  });
  await writeRecordingManifest(bundleDir, manifest);
  return { manifest, audioPath };
}

/** Read a Teams transcript the user picked: WebVTT as text, Word through the document reader. */
export async function readTeamsTranscript(path: string): Promise<Cue[]> {
  if (/\.docx$/i.test(path)) {
    const bytes = await tauriApi.readBinaryFile(path);
    const mammoth = (await import('mammoth')).default;
    const data = new Uint8Array(bytes);
    const result = await mammoth.extractRawText({ arrayBuffer: data.buffer as ArrayBuffer });
    return parseTeamsDocxText(result.value);
  }
  return parseTeamsVtt(await tauriApi.readFile(path));
}

export interface AttachTeamsOptions {
  bundleDir: string;
  /** The file the user picked, copied into the bundle unchanged. */
  sourcePath: string;
  cues: readonly Cue[];
  offsetSecs: number;
  /** `names`: our text, Teams' speaker names. `text`: Teams' transcript as it is. */
  use: 'names' | 'text';
  mode?: TranscriptWriteMode;
}

/**
 * Attach a Teams transcript to a recording: keep the original in the bundle,
 * then rewrite `segments.json`, `speakers.json` and the transcript with real
 * speaker names. A recording we have not transcribed ourselves can only take
 * Teams' text.
 */
export async function attachTeamsTranscript(options: AttachTeamsOptions): Promise<WrittenTranscript> {
  const { bundleDir, sourcePath, cues, offsetSecs } = options;
  const manifest = await readRecordingManifest(bundleDir);
  const ext = /\.docx$/i.test(sourcePath) ? 'docx' : 'vtt';
  await tauriApi.copyFileInto(sourcePath, joinPath(bundleDir, `${TEAMS_TRANSCRIPT_STEM}.${ext}`));

  const ours = (await readSegments(bundleDir, transcriptFileOf(manifest))).segments;
  const useNames = options.use === 'names' && ours.length > 0;
  const segments = useNames ? assignSpeakers(ours, cues, offsetSecs) : cuesToSegments(cues, offsetSecs);

  // Teams' labels are names already. Keep any name the user gave before, and
  // list every speaker so the Speakers dialog has them all to rename.
  const names: SpeakerNames = { ...(await readSpeakers(bundleDir)) };
  for (const label of speakerLabels(segments)) {
    // `me` / `others` have translated defaults; writing them here would
    // freeze the label itself as the name.
    if (!(label in names) && label !== SPEAKER_ME && label !== SPEAKER_OTHERS) names[label] = label;
  }
  await writeSpeakers(bundleDir, names);

  // The text is still ours in `names` mode, so the note keeps saying which
  // model and language produced it: the existing note knows, the manifest may.
  const existing = await inspectTranscript(bundleDir, manifest);
  const previous = existing ? (parseFrontmatter(existing.content).frontmatter ?? {}) : {};
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

  return writeTranscript({
    bundleDir,
    segments,
    speakers: names,
    language: text(previous.language) ?? manifest?.transcription?.language ?? manifest?.language,
    model: useNames ? (text(previous.model) ?? manifest?.transcription?.model) : 'Microsoft Teams',
    mode: options.mode,
  });
}
