import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriApi } from '@/lib/tauri';
import { useSettingsStore } from '@/stores/settings-store';
import { useActivityStore, type AgentTask, type AgentTaskStatus } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import { recordingsDir, resolveNotesRoot } from '@/lib/notes-root';
import { startTranscription } from '@/hooks/useTranscriptionJob';
import {
  TRANSCRIPT_FILENAME,
  basename,
  dirname,
  joinPath,
  readRecordingManifest,
  writeRecordingManifest,
} from '@/lib/transcription/bundle';
import {
  isPendingTranscription,
  isoWithOffset,
  withTranscriptionStatus,
  type RecordingManifest,
  type TranscriptionStatus,
} from '@/lib/transcription/manifest';
import { SPEECH_LANGUAGES } from '@/lib/transcription/languages';
import { log } from '@/lib/logger';

/**
 * The Mac's side of the phone → Mac recording handoff (PRD
 * `2026-09-05-ios-recordings.md`, § "Mac: discovery and the pending-
 * transcription contract"). MUST be mounted in `App.tsx` — a hook that is not
 * mounted never runs, which is why `useTranscriptionJob` lives there too.
 *
 * On `startupReady` it lists `<library root>/Recordings` (the Inbox's root
 * rule: the synced iCloud library when sync is on, else `~/Notesage`),
 * evaluates every `Recording *` bundle, and keeps evaluating as the watcher
 * reports changes under that folder. A bundle is *pending* when its
 * `recording.json` exists and `transcript.md` does not; the rules that turn
 * pending into *eligible* — not `done`, not `failed` (the card's Re-run is the
 * retry), not `running` on another device within the hour, not already
 * tracked in `activity-store`, and the audio's size on disk equal to the byte
 * count the phone wrote at stop — live in `evaluateBundle`, a pure function.
 *
 * Eligible bundles enter a FIFO in stamp order and are dispatched one at a
 * time: `transcribe_file` serializes on a single Whisper context anyway, and
 * N concurrent jobs would only contend on the mutex. The claim is written
 * into the manifest (`running`, with this Mac's name) BEFORE the job is
 * dispatched; `done` / `failed` are written from the activity-store
 * transition, which also covers the Mac's own recordings and Re-runs so the
 * phone always sees the latest state.
 *
 * Mac-recorded bundles from before the manifest existed have no
 * `recording.json` and are ignored — the desktop recorder's behaviour is
 * unchanged for them.
 */

/** A `running` claim by another device older than this is stale and may be taken over. */
export const RUNNING_CLAIM_TTL_MS = 60 * 60 * 1000;
/** iCloud delivers a bundle's files one by one; coalesce their events per bundle. */
export const BUNDLE_REEVALUATE_DEBOUNCE_MS = 2000;
/** Bundle folders are stamped `Recording <YYYY-MM-DD HH-MM-SS>` (the Mac and the phone agree). */
export const BUNDLE_PREFIX = 'Recording ';

export function isRecordingBundleName(name: string): boolean {
  return name.startsWith(BUNDLE_PREFIX) && name.length > BUNDLE_PREFIX.length;
}

/**
 * The bundle directory a watcher event belongs to, or `null` when the path is
 * not under `<recordingsDir>/Recording *`. The event may be for the bundle
 * folder itself (its creation) or for any file inside it.
 */
export function bundleDirForEvent(recordingsDirPath: string, eventPath: string): string | null {
  const root = recordingsDirPath.replace(/\/+$/, '');
  if (!eventPath.startsWith(`${root}/`)) return null;
  const name = eventPath.slice(root.length + 1).split('/')[0] ?? '';
  return isRecordingBundleName(name) ? `${root}/${name}` : null;
}

/**
 * The manifest's language when it is one the Mac's picker knows (and not
 * `auto`); otherwise `undefined`, and the job falls back to the Mac's own
 * `speechLanguage`.
 */
export function manifestLanguage(manifest: RecordingManifest): string | undefined {
  const code = manifest.language;
  if (!code || code === 'auto') return undefined;
  return SPEECH_LANGUAGES.some((l) => l.value === code) ? code : undefined;
}

export interface BundleFacts {
  bundleDir: string;
  /** `null` = no `recording.json`, or one that does not parse. */
  manifest: RecordingManifest | null;
  transcriptExists: boolean;
  /** Size of the audio file on disk; `null` when it is missing (not synced yet, or an evicted placeholder). */
  audioBytes: number | null;
}

export interface EvaluationContext {
  now: number;
  /** This Mac's device label, as written into `transcription.device`. */
  device: string;
  /** `audioPath` of every transcription task the activity store knows about. */
  trackedAudioPaths: ReadonlySet<string>;
}

export type BundleSkipReason =
  | 'no-manifest'
  | 'transcript-exists'
  | 'done'
  | 'failed'
  | 'running-elsewhere'
  | 'already-tracked';

export interface EligibleBundle {
  verdict: 'eligible';
  bundleDir: string;
  audioPath: string;
  manifest: RecordingManifest;
}

export type BundleEvaluation =
  | EligibleBundle
  | { verdict: 'skip'; bundleDir: string; reason: BundleSkipReason }
  | {
      verdict: 'wait';
      bundleDir: string;
      reason: 'audio-missing' | 'size-mismatch';
      audioPath: string;
      expectedBytes: number;
      actualBytes: number | null;
    };

/**
 * The eligibility rules, in the order they are checked. Pure: everything it
 * needs is in `facts` and `ctx`, so every rule has a test.
 */
export function evaluateBundle(facts: BundleFacts, ctx: EvaluationContext): BundleEvaluation {
  const { bundleDir, manifest } = facts;
  if (!manifest) return { verdict: 'skip', bundleDir, reason: 'no-manifest' };
  if (facts.transcriptExists) return { verdict: 'skip', bundleDir, reason: 'transcript-exists' };
  // `isPendingTranscription` is the contract's own rule; the ones after it
  // need the clock and this device's name.
  if (!isPendingTranscription(manifest, facts.transcriptExists)) {
    return { verdict: 'skip', bundleDir, reason: 'done' };
  }
  const status = manifest.transcription;
  if (status?.status === 'failed') return { verdict: 'skip', bundleDir, reason: 'failed' };
  if (status?.status === 'running' && status.device !== ctx.device) {
    const age = ctx.now - Date.parse(status.updatedAt);
    // An unparsable stamp is NaN here, and `NaN < ttl` is false: a claim we
    // cannot date is treated as stale rather than as a lock forever.
    if (age < RUNNING_CLAIM_TTL_MS) return { verdict: 'skip', bundleDir, reason: 'running-elsewhere' };
  }
  const audioPath = joinPath(bundleDir, manifest.audio.file);
  if (ctx.trackedAudioPaths.has(audioPath)) return { verdict: 'skip', bundleDir, reason: 'already-tracked' };
  if (facts.audioBytes === null) {
    return { verdict: 'wait', bundleDir, reason: 'audio-missing', audioPath, expectedBytes: manifest.audio.bytes, actualBytes: null };
  }
  if (facts.audioBytes !== manifest.audio.bytes) {
    return { verdict: 'wait', bundleDir, reason: 'size-mismatch', audioPath, expectedBytes: manifest.audio.bytes, actualBytes: facts.audioBytes };
  }
  return { verdict: 'eligible', bundleDir, audioPath, manifest };
}

/**
 * FIFO in stamp order — the bundle folder names sort chronologically — and
 * strictly one at a time: nothing is picked while a job is in flight.
 */
export function nextEligible(
  queue: readonly EligibleBundle[],
  inFlight: boolean,
): EligibleBundle | null {
  if (inFlight || queue.length === 0) return null;
  return [...queue].sort((a, b) => basename(a.bundleDir).localeCompare(basename(b.bundleDir)))[0] ?? null;
}

interface InFlight {
  bundleDir: string;
  audioPath: string;
  taskId: string | null;
  model: string;
}

/**
 * The scanner's runtime, kept out of the React hook so its lifecycle is one
 * `start()` / `dispose()` pair. Exported for tests that want to drive it
 * without a settings store.
 */
export function createRecordingsInbox(dir: string) {
  let disposed = false;
  let device = 'Mac';
  let unlisten: UnlistenFn | null = null;
  let unsubscribeActivity: (() => void) | null = null;
  let inFlight: InFlight | null = null;
  /** The audio path whose claim is being written / dispatched right now. */
  let claiming: string | null = null;
  const queue: EligibleBundle[] = [];
  /** Bundles whose dispatch produced no job (the job hook not mounted) — left alone for the session. */
  const undispatchable = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Per-bundle write chain so a claim and a completion never interleave. */
  const writes = new Map<string, Promise<void>>();
  const lastStatusById = new Map<string, AgentTaskStatus>();

  function transcriptionTasks(): AgentTask[] {
    return useActivityStore.getState().tasks.filter((t) => t.kind === 'transcription');
  }

  function trackedAudioPaths(): Set<string> {
    const set = new Set<string>();
    for (const t of transcriptionTasks()) if (t.audioPath) set.add(t.audioPath);
    if (inFlight) set.add(inFlight.audioPath);
    if (claiming) set.add(claiming);
    return set;
  }

  /** Read-modify-write the bundle's manifest with a new `transcription` block. Serialized per bundle. */
  function writeStatus(bundleDir: string, status: TranscriptionStatus): Promise<void> {
    const chain = (writes.get(bundleDir) ?? Promise.resolve())
      .then(async () => {
        const manifest = await readRecordingManifest(bundleDir);
        if (!manifest) return;
        await writeRecordingManifest(bundleDir, withTranscriptionStatus(manifest, status));
      })
      .catch((err) => {
        log.warn('recordings', `Could not write transcription status for ${basename(bundleDir)}`, err);
      });
    writes.set(bundleDir, chain);
    return chain;
  }

  async function gatherFacts(bundleDir: string): Promise<BundleFacts> {
    const manifest = await readRecordingManifest(bundleDir);
    if (!manifest) return { bundleDir, manifest: null, transcriptExists: false, audioBytes: null };
    const transcriptExists = await tauriApi.pathExists(joinPath(bundleDir, TRANSCRIPT_FILENAME)).catch(() => false);
    const audioPath = joinPath(bundleDir, manifest.audio.file);
    let audioBytes = await tauriApi.fileSize(audioPath).catch(() => null);
    if (audioBytes === null && !transcriptExists) {
      // Evicted by iCloud? Ask for it and wait for the watcher event the
      // arriving file produces — no polling.
      const state = await tauriApi.icloudEnsureDownloaded(audioPath).catch(() => 'failed' as const);
      if (state === 'ready') audioBytes = await tauriApi.fileSize(audioPath).catch(() => null);
      else log.info('recordings', `${basename(bundleDir)}: audio not on disk (${state})`);
    }
    return { bundleDir, manifest, transcriptExists, audioBytes };
  }

  async function evaluate(bundleDir: string): Promise<BundleEvaluation> {
    const facts = await gatherFacts(bundleDir);
    return evaluateBundle(facts, { now: Date.now(), device, trackedAudioPaths: trackedAudioPaths() });
  }

  function enqueue(bundle: EligibleBundle): void {
    if (undispatchable.has(bundle.bundleDir)) return;
    if (inFlight?.bundleDir === bundle.bundleDir) return;
    if (queue.some((q) => q.bundleDir === bundle.bundleDir)) return;
    queue.push(bundle);
  }

  function removeFromQueue(bundleDir: string): void {
    const idx = queue.findIndex((q) => q.bundleDir === bundleDir);
    if (idx !== -1) queue.splice(idx, 1);
  }

  async function pump(): Promise<void> {
    if (disposed) return;
    const next = nextEligible(queue, inFlight !== null || claiming !== null);
    if (!next) return;
    removeFromQueue(next.bundleDir);
    const { bundleDir, audioPath, manifest } = next;

    // Claim first — another Mac listing the same library sees `running` with
    // this device's name and leaves the bundle alone for the next hour.
    claiming = audioPath;
    await writeStatus(bundleDir, { status: 'running', device, updatedAt: isoWithOffset(Date.now()) });
    if (disposed) { claiming = null; return; }

    const model = useRecordingStore.getState().defaultModel;
    inFlight = { bundleDir, audioPath, taskId: null, model };
    const startedAt = Date.parse(manifest.startedAt);
    startTranscription({
      audioPath,
      recordingStartedAt: Number.isNaN(startedAt) ? undefined : startedAt,
      recordingStoppedAt: Number.isNaN(startedAt) ? undefined : startedAt + manifest.durationSecs * 1000,
      recordingDurationSecs: manifest.durationSecs,
      language: manifestLanguage(manifest),
      // A bundle this Mac recorded itself carries no provenance caption.
      sourceDevice: manifest.createdBy.device === device ? undefined : manifest.createdBy.device,
    });
    claiming = null;

    // `useTranscriptionJob` adds the task synchronously on the event; if it
    // is not there, nobody is listening and waiting would wedge the queue.
    const task = transcriptionTasks().find((t) => t.audioPath === audioPath && t.status === 'running');
    if (!task) {
      log.warn('recordings', `No transcription job appeared for ${basename(bundleDir)} — is useTranscriptionJob mounted?`);
      undispatchable.add(bundleDir);
      inFlight = null;
      void pump();
      return;
    }
    inFlight.taskId = task.id;
    lastStatusById.set(task.id, 'running');
    log.info('recordings', `Transcribing ${basename(bundleDir)} from ${manifest.createdBy.device}`);
  }

  async function reevaluate(bundleDir: string): Promise<void> {
    try {
      const result = await evaluate(bundleDir);
      if (disposed) return;
      if (result.verdict === 'eligible') enqueue(result);
      else if (result.verdict === 'skip') removeFromQueue(bundleDir);
      else log.info('recordings', `${basename(bundleDir)}: waiting (${result.reason}, ${result.actualBytes ?? 'no'} of ${result.expectedBytes} bytes)`);
    } catch (err) {
      log.warn('recordings', `Could not evaluate ${basename(bundleDir)}`, err);
    }
    void pump();
  }

  function scheduleReevaluate(bundleDir: string): void {
    clearTimeout(timers.get(bundleDir));
    timers.set(
      bundleDir,
      setTimeout(() => {
        timers.delete(bundleDir);
        void reevaluate(bundleDir);
      }, BUNDLE_REEVALUATE_DEBOUNCE_MS),
    );
  }

  async function scanAll(): Promise<void> {
    let entries: Awaited<ReturnType<typeof tauriApi.listFilesShallow>> = [];
    try {
      entries = await tauriApi.listFilesShallow(dir);
    } catch {
      // No Recordings folder yet — nothing recorded anywhere. The watcher
      // brings the first bundle when it lands.
      return;
    }
    if (disposed) return;
    const bundles = entries.filter((e) => e.is_directory && isRecordingBundleName(e.name));
    const results = await Promise.all(bundles.map((b) => evaluate(b.path).catch(() => null)));
    if (disposed) return;
    for (const r of results) if (r?.verdict === 'eligible') enqueue(r);
    void pump();
  }

  /** `done` / `failed` write-back for every transcription task, not only the ones this scanner dispatched. */
  function onActivityChange(): void {
    const tasks = transcriptionTasks();
    const seen = new Set<string>();
    for (const task of tasks) {
      seen.add(task.id);
      const prev = lastStatusById.get(task.id);
      if (prev === task.status) continue;
      lastStatusById.set(task.id, task.status);
      if (!task.audioPath) continue;
      const bundleDir = dirname(task.audioPath);

      if (task.status === 'running') {
        // The scanner's own dispatch already wrote its claim; a Mac-own
        // recording or a Re-run has not.
        if (task.audioPath !== claiming && task.audioPath !== inFlight?.audioPath) {
          void writeStatus(bundleDir, { status: 'running', device, updatedAt: isoWithOffset(Date.now()) });
        }
        continue;
      }
      if (prev !== 'running') continue; // appeared already finished (rehydrated) — not a transition we saw

      const language = task.detectedLanguage ?? (task.language && task.language !== 'auto' ? task.language : undefined);
      const ours = inFlight?.taskId === task.id;
      const status: TranscriptionStatus =
        task.status === 'done'
          ? {
              status: 'done',
              device,
              updatedAt: isoWithOffset(Date.now()),
              // Known for jobs dispatched without a model override; a Re-run
              // may have picked another model, so it is not guessed there.
              ...(ours ? { model: inFlight!.model } : {}),
              ...(language ? { language } : {}),
            }
          : {
              status: 'failed',
              device,
              updatedAt: isoWithOffset(Date.now()),
              ...(task.errorMessage ? { error: task.errorMessage } : {}),
            };
      void writeStatus(bundleDir, status);
      if (ours) {
        inFlight = null;
        void pump();
      }
    }
    for (const id of [...lastStatusById.keys()]) if (!seen.has(id)) lastStatusById.delete(id);
    if (inFlight?.taskId && !seen.has(inFlight.taskId)) {
      // The card was removed mid-run; do not hold the queue for it.
      inFlight = null;
      void pump();
    }
  }

  async function start(): Promise<void> {
    device = await tauriApi.getDeviceName().catch(() => 'Mac');
    if (disposed) return;
    for (const t of transcriptionTasks()) lastStatusById.set(t.id, t.status);
    unsubscribeActivity = useActivityStore.subscribe(onActivityChange);
    try {
      const fn = await listen<Array<{ path: string; kind: 'create' | 'modify' | 'delete' }>>(
        'file-changed-batch',
        (event) => {
          if (disposed) return;
          for (const { path, kind } of event.payload ?? []) {
            const bundleDir = bundleDirForEvent(dir, path);
            if (!bundleDir) continue;
            if (kind === 'delete' && path.replace(/\/+$/, '') === bundleDir) {
              clearTimeout(timers.get(bundleDir));
              timers.delete(bundleDir);
              removeFromQueue(bundleDir);
              continue;
            }
            scheduleReevaluate(bundleDir);
          }
        },
      );
      if (disposed) fn();
      else unlisten = fn;
    } catch (err) {
      log.warn('recordings', 'Could not subscribe to file-changed-batch', err);
    }
    if (disposed) return;
    await scanAll();
  }

  function dispose(): void {
    disposed = true;
    unlisten?.();
    unlisten = null;
    unsubscribeActivity?.();
    unsubscribeActivity = null;
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    queue.length = 0;
  }

  return { start, dispose };
}

export function useRecordingsInbox(): void {
  const startupReady = useSettingsStore((s) => s.startupReady);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const icloudNotesagePath = useSettingsStore((s) => s.icloudNotesagePath);
  const homeDir = useSettingsStore((s) => s.homeDir);

  useEffect(() => {
    if (!startupReady) return;
    // The Inbox's root rule (`inbox-store`): the synced library when sync is on.
    const root = icloudNotesagePath ?? resolveNotesRoot(notesRootPath, homeDir);
    if (!root) return;
    const inbox = createRecordingsInbox(recordingsDir(root));
    void inbox.start();
    return () => inbox.dispose();
  }, [startupReady, notesRootPath, icloudNotesagePath, homeDir]);
}
