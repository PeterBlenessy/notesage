import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriApi, type FileEntry } from '@/lib/tauri';
import { useSettingsStore } from '@/stores/settings-store';
import { useActivityStore, type AgentTask, type AgentTaskStatus } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import { recordingsDir, resolveNotesRoot } from '@/lib/notes-root';
import { cancelTranscriptionJob, startTranscription, takeYielded } from '@/hooks/useTranscriptionJob';
import {
  basename,
  dirname,
  joinPath,
  readRecordingManifest,
  transcriptFileOf,
  updateRecordingManifest,
} from '@/lib/transcription/bundle';
import {
  RECORDING_MANIFEST,
  isPendingTranscription,
  isoWithOffset,
  withTranscriptionStatus,
  type RecordingManifest,
  type TranscriptionStatus,
} from '@/lib/transcription/manifest';
import { TRANSCRIPTION_INTERRUPTED } from '@/lib/transcription/errors';
import { SPEECH_LANGUAGES, pickModelForLanguage } from '@/lib/transcription/languages';
import { log } from '@/lib/logger';

/**
 * The Mac's side of the phone → Mac recording handoff (PRD
 * `2026-09-05-ios-recordings.md`, § "Mac: discovery and the pending-
 * transcription contract"). MUST be mounted in `App.tsx` — a hook that is not
 * mounted never runs, which is why `useTranscriptionJob` lives there too.
 *
 * On `startupReady` it lists `<library root>/Recordings` (the Inbox's root
 * rule: the synced iCloud library when sync is on, else `~/Notesage`),
 * evaluates every bundle folder, and keeps evaluating as the watcher reports
 * changes under that folder. A bundle is *pending* when its `recording.json`
 * exists and its transcript does not; the rules that turn pending into
 * *eligible* — not `done`, not `failed` (Retry in the Recordings view is the
 * retry), not cancelled by the user, not `running` on another device within
 * the hour, not already running here, and the audio on this disk with the
 * byte count the recorder wrote at stop — live in `evaluateBundle`, a pure
 * function.
 *
 * Eligible bundles enter a FIFO in stamp order and are dispatched one at a
 * time: `transcribe_file` serializes on a single Whisper context anyway, and
 * N concurrent jobs would only contend on the mutex. The claim is written
 * into the manifest (`running`, with this Mac's name) BEFORE the job is
 * dispatched, refreshed while the job runs, and re-read shortly after it is
 * written: if another Mac's claim is there instead, this one stops. `done` /
 * `failed` are written from the activity-store transition, which also covers
 * the Mac's own recordings and re-runs so the phone always sees the latest
 * state.
 *
 * A `running` claim by THIS device with no job behind it is what a quit in
 * the middle of a transcription leaves. It is rewritten as failed with the
 * reason `interrupted`, so the Recordings view offers the retry instead of
 * showing "Transcribing…" for ever.
 *
 * Bundles without a `recording.json` are left alone here; the Recordings
 * view lists them as "Not transcribed" and writes the manifest when the user
 * asks for a transcription.
 */

/** A `running` claim by another device older than this is stale and may be taken over. */
export const RUNNING_CLAIM_TTL_MS = 60 * 60 * 1000;
/** A running job re-stamps its claim this often, so a long job never looks stale to another Mac. */
export const CLAIM_REFRESH_MS = 5 * 60 * 1000;
/** How long after claiming to look again: time for another device's claim to arrive. */
export const CLAIM_RECHECK_MS = 8000;
/** iCloud delivers a bundle's files one by one; coalesce their events per bundle. */
export const BUNDLE_REEVALUATE_DEBOUNCE_MS = 2000;
/** Bundle folders are stamped `Recording <YYYY-MM-DD HH-MM-SS>` (the Mac and the phone agree). */
export const BUNDLE_PREFIX = 'Recording ';
/** `import_media` names its bundles `Import <original stem> <stamp>`. */
export const IMPORT_BUNDLE_PREFIX = 'Import ';

export function isRecordingBundleName(name: string): boolean {
  for (const prefix of [BUNDLE_PREFIX, IMPORT_BUNDLE_PREFIX]) {
    if (name.startsWith(prefix) && name.length > prefix.length) return true;
  }
  return false;
}

/**
 * The bundle directory a watcher event belongs to, or `null` when the path is
 * not under `<recordingsDir>/<bundle folder>`. The event may be for the bundle
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
  /**
   * `false` when the file is there in name only: an iCloud "dataless" file
   * reports its full size while holding no data. Absent means "as far as we
   * know, yes" (older callers, older backends).
   */
  audioLocal?: boolean;
}

export interface EvaluationContext {
  now: number;
  /** This Mac's device label, as written into `transcription.device`. */
  device: string;
  /** `audioPath` of every transcription job that is queued or running right now. */
  trackedAudioPaths: ReadonlySet<string>;
}

export type BundleSkipReason =
  | 'no-manifest'
  | 'transcript-exists'
  | 'done'
  | 'failed'
  | 'cancelled-by-user'
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
  /** This device claimed the job and is not running it: the app quit mid-transcription. */
  | { verdict: 'stale-own-claim'; bundleDir: string }
  | {
      verdict: 'wait';
      bundleDir: string;
      reason: 'audio-missing' | 'size-mismatch' | 'not-downloaded';
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
  const audioPath = joinPath(bundleDir, manifest.audio.file);
  const tracked = ctx.trackedAudioPaths.has(audioPath);
  const status = manifest.transcription;
  if (status?.status === 'failed') return { verdict: 'skip', bundleDir, reason: 'failed' };
  if (status?.status === 'running' && status.device === ctx.device && !tracked) {
    return { verdict: 'stale-own-claim', bundleDir };
  }
  if (status?.status === 'running' && status.device !== ctx.device) {
    const age = ctx.now - Date.parse(status.updatedAt);
    // An unparsable stamp is NaN here, and `NaN < ttl` is false: a claim we
    // cannot date is treated as stale rather than as a lock forever.
    if (age < RUNNING_CLAIM_TTL_MS) return { verdict: 'skip', bundleDir, reason: 'running-elsewhere' };
  }
  // Only a job that is queued or running counts. A finished or failed card
  // for the same file says nothing about whether the bundle needs work now:
  // counting it made a recording whose job had been interrupted invisible to
  // the scanner for as long as its card stayed in the list.
  if (tracked) return { verdict: 'skip', bundleDir, reason: 'already-tracked' };
  // The user stopped this one. Starting it again is theirs to decide.
  if (manifest.autoTranscribe === false) return { verdict: 'skip', bundleDir, reason: 'cancelled-by-user' };
  if (facts.audioBytes === null) {
    return { verdict: 'wait', bundleDir, reason: 'audio-missing', audioPath, expectedBytes: manifest.audio.bytes, actualBytes: null };
  }
  if (facts.audioBytes !== manifest.audio.bytes) {
    return { verdict: 'wait', bundleDir, reason: 'size-mismatch', audioPath, expectedBytes: manifest.audio.bytes, actualBytes: facts.audioBytes };
  }
  if (facts.audioLocal === false) {
    return { verdict: 'wait', bundleDir, reason: 'not-downloaded', audioPath, expectedBytes: manifest.audio.bytes, actualBytes: facts.audioBytes };
  }
  return { verdict: 'eligible', bundleDir, audioPath, manifest };
}

/**
 * Is another device's `running` claim in this manifest, recent enough to be
 * believed? The question a job asks after claiming, and each time it
 * refreshes its claim.
 */
export function heldByAnotherDevice(manifest: RecordingManifest | null, device: string, now: number): boolean {
  const status = manifest?.transcription;
  if (!status || status.status !== 'running' || status.device === device) return false;
  return now - Date.parse(status.updatedAt) < RUNNING_CLAIM_TTL_MS;
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
  let unsubscribeModels: (() => void) | null = null;
  let inFlight: InFlight | null = null;
  /** The audio path whose claim is being written / dispatched right now. */
  let claiming: string | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  const queue: EligibleBundle[] = [];
  /** Bundles whose dispatch produced no job (the job hook not mounted) — left alone for the session. */
  const undispatchable = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const recheckTimers = new Set<ReturnType<typeof setTimeout>>();
  const lastStatusById = new Map<string, AgentTaskStatus>();

  function transcriptionTasks(): AgentTask[] {
    return useActivityStore.getState().tasks.filter((t) => t.kind === 'transcription');
  }

  function trackedAudioPaths(): Set<string> {
    const set = new Set<string>();
    for (const t of transcriptionTasks()) if (t.audioPath && t.status === 'running') set.add(t.audioPath);
    if (inFlight) set.add(inFlight.audioPath);
    if (claiming) set.add(claiming);
    return set;
  }

  /**
   * Read-modify-write the bundle's manifest with a new `transcription` block.
   * Serialized per bundle (`updateRecordingManifest`), together with the
   * job's and the view's own writes to the same file.
   */
  function writeStatus(
    bundleDir: string,
    status: TranscriptionStatus | null,
    extra?: (manifest: RecordingManifest) => RecordingManifest,
  ): Promise<void> {
    return updateRecordingManifest(bundleDir, (manifest) => {
      const next = withTranscriptionStatus(manifest, status);
      return extra ? extra(next) : next;
    })
      .then(() => undefined)
      .catch((err) => {
        log.warn('recordings', `Could not write transcription status for ${basename(bundleDir)}`, err);
      });
  }

  function runningStatus(): TranscriptionStatus {
    return { status: 'running', device, updatedAt: isoWithOffset(Date.now()) };
  }

  /**
   * `files` are the bundle's file names when the caller already has them
   * (the startup scan lists one level deep), which saves the existence check.
   */
  async function gatherFacts(bundleDir: string, files?: readonly string[]): Promise<BundleFacts> {
    if (files && !files.includes(RECORDING_MANIFEST)) {
      return { bundleDir, manifest: null, transcriptExists: false, audioBytes: null };
    }
    const manifest = await readRecordingManifest(bundleDir);
    if (!manifest) return { bundleDir, manifest: null, transcriptExists: false, audioBytes: null };
    const transcriptFile = transcriptFileOf(manifest);
    const transcriptExists = files
      ? files.includes(transcriptFile)
      : await tauriApi.pathExists(joinPath(bundleDir, transcriptFile)).catch(() => false);
    // Nothing below matters for a bundle that is finished or not ours to do:
    // `evaluateBundle` decides those before it ever looks at the audio.
    if (
      transcriptExists ||
      !isPendingTranscription(manifest, transcriptExists) ||
      manifest.transcription?.status === 'failed' ||
      manifest.autoTranscribe === false
    ) {
      return { bundleDir, manifest, transcriptExists, audioBytes: null };
    }
    const audioPath = joinPath(bundleDir, manifest.audio.file);
    let status = await tauriApi.audioFileStatus(audioPath);
    if (!status.exists || !status.local) {
      // Evicted by iCloud, or not arrived yet? Ask for it and wait for the
      // watcher event the arriving file produces — no polling.
      const state = await tauriApi.icloudEnsureDownloaded(audioPath).catch(() => 'failed' as const);
      if (state === 'ready') status = await tauriApi.audioFileStatus(audioPath);
      else log.info('recordings', `${basename(bundleDir)}: audio not on disk (${state})`);
    }
    return {
      bundleDir,
      manifest,
      transcriptExists,
      audioBytes: status.exists ? status.size : null,
      audioLocal: status.local,
    };
  }

  async function evaluate(bundleDir: string, files?: readonly string[]): Promise<BundleEvaluation> {
    const facts = await gatherFacts(bundleDir, files);
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

  /**
   * Another Mac's claim is in the manifest where ours should be: both saw the
   * bundle as free and both claimed it, and iCloud kept theirs. Stop here;
   * one transcript is enough, and two would overwrite each other.
   */
  async function yieldIfHeldElsewhere(taskId: string, bundleDir: string): Promise<boolean> {
    const manifest = await readRecordingManifest(bundleDir).catch(() => null);
    if (disposed || !heldByAnotherDevice(manifest, device, Date.now())) return false;
    log.info('recordings', `${basename(bundleDir)} is being transcribed on ${manifest?.transcription?.device}; stopping here`);
    await cancelTranscriptionJob(taskId, { yieldToOtherDevice: true });
    return true;
  }

  function scheduleClaimRecheck(taskId: string, bundleDir: string): void {
    const timer = setTimeout(() => {
      recheckTimers.delete(timer);
      const task = transcriptionTasks().find((t) => t.id === taskId);
      if (disposed || task?.status !== 'running') return;
      void yieldIfHeldElsewhere(taskId, bundleDir);
    }, CLAIM_RECHECK_MS);
    recheckTimers.add(timer);
  }

  /** Re-stamp the claim of every running job, unless another device now holds it. */
  async function refreshClaims(): Promise<void> {
    for (const task of transcriptionTasks()) {
      if (task.status !== 'running' || !task.audioPath) continue;
      const bundleDir = dirname(task.audioPath);
      if (await yieldIfHeldElsewhere(task.id, bundleDir)) continue;
      if (disposed) return;
      await writeStatus(bundleDir, runningStatus());
    }
  }

  function syncRefreshTimer(): void {
    const running = transcriptionTasks().some((t) => t.status === 'running');
    if (running && !refreshTimer && !disposed) {
      refreshTimer = setInterval(() => void refreshClaims(), CLAIM_REFRESH_MS);
    } else if (!running && refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  /**
   * The model an unattended job should use: the default when it is downloaded,
   * else one that is. `null` when the catalogue is known and holds nothing
   * downloaded: starting a job then only produces a failure the user did not
   * ask for, so the bundle waits (it shows as "Not transcribed") until a
   * model arrives. An unknown catalogue (not listed yet) is not a reason to
   * wait; the default is tried, as it always was.
   */
  function modelForUnattendedJob(language: string | undefined): string | null {
    const { availableModels, defaultModel, speechLanguage } = useRecordingStore.getState();
    if (availableModels.length === 0) return defaultModel;
    const downloaded = availableModels.filter((m) => m.downloaded).map((m) => m.name);
    if (downloaded.length === 0) return null;
    const preferred = downloaded.includes(defaultModel) ? defaultModel : downloaded[0];
    return pickModelForLanguage(preferred, language ?? speechLanguage, downloaded);
  }

  async function pump(): Promise<void> {
    if (disposed) return;
    const next = nextEligible(queue, inFlight !== null || claiming !== null);
    if (!next) return;
    const model = modelForUnattendedJob(manifestLanguage(next.manifest));
    if (model === null) return; // stays queued; a model download pumps again
    removeFromQueue(next.bundleDir);
    const { bundleDir, audioPath, manifest } = next;

    // Claim first — another Mac listing the same library sees `running` with
    // this device's name and leaves the bundle alone for the next hour.
    claiming = audioPath;
    await writeStatus(bundleDir, runningStatus());
    if (disposed) { claiming = null; return; }

    inFlight = { bundleDir, audioPath, taskId: null, model };
    const startedAt = Date.parse(manifest.startedAt);
    startTranscription({
      audioPath,
      // Named only when it is not the default, so the job's own fallback
      // stays in charge of the ordinary case.
      ...(model === useRecordingStore.getState().defaultModel ? {} : { model }),
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
    scheduleClaimRecheck(task.id, bundleDir);
    syncRefreshTimer();
    log.info('recordings', `Transcribing ${basename(bundleDir)} from ${manifest.createdBy.device}`);
  }

  function applyEvaluation(result: BundleEvaluation): void {
    const { bundleDir } = result;
    if (result.verdict === 'eligible') enqueue(result);
    else if (result.verdict === 'skip') removeFromQueue(bundleDir);
    else if (result.verdict === 'stale-own-claim') {
      removeFromQueue(bundleDir);
      // Not `null`: a cleared claim would make the bundle eligible, and a job
      // that took the app down once would be started again on every launch.
      void writeStatus(bundleDir, {
        status: 'failed',
        device,
        updatedAt: isoWithOffset(Date.now()),
        error: TRANSCRIPTION_INTERRUPTED,
      });
      log.info('recordings', `${basename(bundleDir)}: transcription was interrupted; marked for retry`);
    } else {
      log.info('recordings', `${basename(bundleDir)}: waiting (${result.reason}, ${result.actualBytes ?? 'no'} of ${result.expectedBytes} bytes)`);
    }
  }

  async function reevaluate(bundleDir: string): Promise<void> {
    try {
      const result = await evaluate(bundleDir);
      if (disposed) return;
      applyEvaluation(result);
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
    // NOT `listFilesShallow`: it omits directories, and a bundle is one, so
    // this scan found nothing and a recording that landed while the app was
    // closed was never transcribed.
    //
    // One level deep and no further: that is the bundle folders AND the file
    // names inside each, in one call. Knowing the names up front means a
    // bundle with no manifest costs nothing more, and a finished one costs a
    // single read instead of a read, an existence check and a stat.
    let entries: FileEntry[] = [];
    try {
      entries = await tauriApi.listDirectory(dir, false, 1);
    } catch (err) {
      // No Recordings folder yet — nothing recorded anywhere. The watcher
      // brings the first bundle when it lands. A folder that IS there and
      // could not be listed is a failed scan, and says so.
      const folderExists = await tauriApi.pathExists(dir).catch(() => true);
      if (folderExists) log.warn('recordings', `Could not scan ${dir} for recordings`, err);
      return;
    }
    if (disposed) return;
    const bundles = entries.filter((e) => e.is_directory && isRecordingBundleName(e.name));
    const results = await Promise.all(
      bundles.map((b) => {
        // An unreadable or unlisted folder gives no names: fall back to asking.
        const files = b.unreadable || b.truncated || !b.children ? undefined : b.children.map((c) => c.name);
        return evaluate(b.path, files).catch(() => null);
      }),
    );
    if (disposed) return;
    for (const r of results) if (r) applyEvaluation(r);
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
          void writeStatus(bundleDir, runningStatus());
          scheduleClaimRecheck(task.id, bundleDir);
        }
        continue;
      }
      if (prev !== 'running') continue; // appeared already finished (rehydrated) — not a transition we saw

      const ours = inFlight?.taskId === task.id;
      if (task.status === 'cancelled') {
        // Stopped to make way for another Mac: the claim in the file is
        // theirs and must stay. Stopped by the user: the recording is "Not
        // transcribed" again, and is not to be started behind their back.
        if (!takeYielded(task.id)) {
          void writeStatus(bundleDir, null, (m) => ({ ...m, autoTranscribe: false }));
        }
      } else {
        const language = task.detectedLanguage ?? (task.language && task.language !== 'auto' ? task.language : undefined);
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
        void writeStatus(bundleDir, status, (m) => {
          if (task.status !== 'done' || m.autoTranscribe === undefined) return m;
          const { autoTranscribe: _dropped, ...rest } = m;
          return rest as RecordingManifest;
        });
      }
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
    syncRefreshTimer();
  }

  async function start(): Promise<void> {
    device = await tauriApi.getDeviceName().catch(() => 'Mac');
    if (disposed) return;
    for (const t of transcriptionTasks()) lastStatusById.set(t.id, t.status);
    unsubscribeActivity = useActivityStore.subscribe(onActivityChange);
    // A bundle that was waiting for a model can go once one is downloaded.
    unsubscribeModels = useRecordingStore.subscribe((state, previous) => {
      if (state.availableModels !== previous.availableModels) void pump();
    });
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
    unsubscribeModels?.();
    unsubscribeModels = null;
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    for (const t of recheckTimers) clearTimeout(t);
    recheckTimers.clear();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    queue.length = 0;
  }

  return { start, dispose, refreshClaims };
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
