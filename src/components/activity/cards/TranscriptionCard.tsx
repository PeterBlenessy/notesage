import { useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Check,
  X,
  ScrollText,
  FolderInput,
  FolderOpen,
  RotateCcw,
  CircleSlash,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useActivityStore } from '@/stores/activity-store';
import type { AgentTask } from '@/stores/activity-store';
import { useRecordingsStore } from '@/stores/recordings-store';
import { dirname, basename as pathBasename, moveBundleToProject } from '@/lib/transcription/bundle';
import { useFileOperations } from '@/hooks/useFileOperations';
import { cancelTranscriptionJob, startTranscription } from '@/hooks/useTranscriptionJob';
import { tauriApi } from '@/lib/tauri';
import { IconActionButton, basename, formatClock } from './shared';
import { t } from "@/lib/i18n";
import { speechLanguageLabel } from '@/lib/transcription/languages';
import { formatRecordingLength } from '@/lib/transcription/segments';
import { describeTranscriptionError, isModelMissingError } from '@/lib/transcription/errors';
import { isQueuedJob, jobStatusText, jobTimingText } from '@/lib/transcription/job-status';
import { useFormatLocale } from "@/lib/useLocale";
import { RerunTranscriptionMenu, openTranscriptionSettings, type RerunChoice } from './RerunTranscriptionMenu';
import {
  ReplaceTranscriptDialog,
  guardTranscriptWrite,
  type PendingTranscriptWrite,
} from '@/components/recordings/ReplaceTranscriptDialog';
import { useNow } from '@/components/recordings/useNow';

/**
 * The card's corner actions: 24px targets that are always visible. They were
 * 16px icons that only appeared on hover, which is neither findable nor
 * hittable, and invisible to anyone not using a mouse.
 */
const CORNER_ACTION =
  'shrink-0 h-6 w-6 text-muted-foreground hover:text-foreground transition-colors duration-150';

/** Display name for a project root — the trailing path component. */
function projectDisplayName(projectRoot: string): string {
  return pathBasename(projectRoot) || projectRoot;
}

/**
 * Recover a recording's start time from its bundle folder name when the live
 * metadata is missing (e.g. a job created before start/stop were plumbed
 * through, or a recording restored from disk). Folders are stamped
 * `Recording YYYY-MM-DD HH-MM-SS` (older ones used `Meeting`).
 */
function parseStartFromPath(path?: string): number | undefined {
  if (!path) return undefined;
  const m = path.match(/(?:Recording|Meeting) (\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const t = date.getTime();
  return Number.isNaN(t) ? undefined : t;
}

/**
 * "start – stop · length" summary for a recording. Falls back to the start time
 * encoded in the bundle folder name when the live metadata is absent, so even
 * legacy / disk-restored items show what they can. Returns null only when
 * nothing at all can be derived. The length is `h:mm:ss`, the one format a
 * recording's length is written in.
 */
function recordingSummary(task: AgentTask): string | null {
  const startMs =
    task.recordingStartedAt ?? parseStartFromPath(task.transcriptPath ?? task.audioPath);
  const start = formatClock(startMs);
  const stop = formatClock(task.recordingStoppedAt);
  const length = formatRecordingLength(task.recordingDurationSecs);
  const span = start && stop ? `${start} – ${stop}` : start ?? stop ?? null;
  return [span, length].filter(Boolean).join('  ·  ') || null;
}

/**
 * t("activity.moveToProject") action shown on a completed transcription job.
 * Lists the open projects from `workspace-store`; picking one relocates the
 * whole bundle (audio + transcript) into that project via
 * `moveBundleToProject`, toasts success, and records the move in the store
 * (which hides this action).
 */
function MoveToProjectMenu({ task }: { task: AgentTask }) {
  const projects = useWorkspaceStore((s) => s.projects);
  const setTranscriptionMoved = useActivityStore((s) => s.setTranscriptionMoved);
  const [moving, setMoving] = useState(false);

  // The bundle dir is the folder holding the transcript/audio.
  const anchorPath = task.transcriptPath ?? task.audioPath;
  if (!anchorPath) return null;
  const bundleDir = dirname(anchorPath);

  const handleMove = async (projectRoot: string) => {
    setMoving(true);
    try {
      const newBundleDir = await moveBundleToProject(bundleDir, projectRoot);
      // Every file keeps its name inside the relocated folder. The transcript
      // is named after the recording now, so its name is taken from the path
      // the job recorded rather than assumed to be `transcript.md`.
      const movedAudio = `${newBundleDir}/${basename(task.audioPath ?? '')}`;
      const newTranscriptPath = `${newBundleDir}/${basename(task.transcriptPath ?? '')}`;
      // Repoint audioPath too — it moved along with the transcript, and a
      // stale audioPath would break "re-run transcription" and "reveal in
      // Finder" after the move.
      setTranscriptionMoved(task.id, newTranscriptPath, task.audioPath ? movedAudio : undefined);
      toast.success(t('recordings.moved', { project: projectDisplayName(projectRoot) }));
      useRecordingsStore.getState().refresh();
    } catch (err) {
      toast.error(t('recordings.moveFailed', { error: String(err) }));
    } finally {
      setMoving(false);
    }
  };

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={moving || projects.length === 0}
                onClick={(e) => e.stopPropagation()}
                aria-label={t("activity.moveToProject")}
                className={CORNER_ACTION}
              >
                {moving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={1.5} />
                ) : (
                  <FolderInput className="h-3.5 w-3.5" strokeWidth={1.5} />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            <p className="text-xs">{t("activity.moveToProject")}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {projects.length === 0 ? (
          <DropdownMenuItem disabled>{t("activity.noOpenProjects")}</DropdownMenuItem>
        ) : (
          projects.map((p) => (
            <DropdownMenuItem
              key={p.path}
              onSelect={() => { void handleMove(p.path); }}
            >
              {projectDisplayName(p.path)}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Transcription-job card (kind === 'transcription').
 *
 * - **Running**: what the backend is doing (queued, loading the model,
 *   reading the audio, transcribing N%), a progress bar, the time spent and
 *   an estimate of the time left, and a Cancel button.
 * - **Done**: the card is clickable and opens the transcript.
 * - **Failed**: WHY, in words; where to retry; and, when the cause is a
 *   missing model, a button that goes to where models are downloaded.
 * - **Interrupted** (the app quit mid-job) and **cancelled** are not
 *   failures and are not drawn as one.
 *
 * Transcribing again is offered on every finished card and never overwrites
 * an existing transcript without asking.
 */
export function TranscriptionCard({ task, onRemove }: { task: AgentTask; onRemove?: (id: string) => void }) {
  // Subscribe to language changes: the formatting helpers below read the
  // i18n module directly, so without this the rendered dates/numbers would
  // keep their old locale until some unrelated state forced a re-render.
  useFormatLocale();

  const { openFile } = useFileOperations();
  const [pendingWrite, setPendingWrite] = useState<PendingTranscriptWrite | null>(null);
  const isRunning = task.status === 'running';
  const isCancelled = task.status === 'cancelled';
  const isInterrupted = task.status === 'error' && task.interrupted === true;
  const isFailed = task.status === 'error' && !isInterrupted;
  const progress = task.progress ?? 0;
  // A boolean, so another job's progress does not re-render this card.
  const queued = useActivityStore((s) => (isRunning ? isQueuedJob(task, s.tasks) : false));
  const now = useNow(isRunning && !queued);

  const transcriptPath = task.transcriptPath;
  const canOpen = task.status === 'done' && !!transcriptPath;
  // Anything we can point Finder at: the transcript note, or the raw audio if
  // transcription failed before a note was written.
  const revealTarget = (task.status === 'done' ? transcriptPath : undefined) ?? task.audioPath ?? transcriptPath;
  const canReveal = !isRunning && !!revealTarget;
  const summary = recordingSummary(task);
  // Always say which language the transcript was made in.
  //
  // This used to be shown only for auto-detected runs, on the reasoning that
  // echoing the user's own choice back is noise. That no longer holds: the
  // language now defaults to the DEVICE language, so it is not a choice the
  // user made and may well be wrong for this particular recording. Seeing
  // "Language: Swedish" above a page of nonsense is what turns a dead end into
  // "re-run in English" — the menu beside it offers exactly that.
  const autoDetected = !task.language || task.language === 'auto';
  const languageUsed =
    task.status === 'done'
      ? autoDetected
        ? task.detectedLanguage
        : task.language
      : undefined;
  // The bundle folder holding the audio and the transcript — "where did my
  // recording go" should never be a question (#698).
  const bundlePath = revealTarget ? dirname(revealTarget) : undefined;
  const modelMissing = isFailed && isModelMissingError(task.errorMessage);

  const handleOpen = async () => {
    if (!canOpen || !transcriptPath) return;
    try {
      await openFile(transcriptPath, pathBasename(transcriptPath));
    } catch (err) {
      toast.error(t('recordings.openFailed', { error: String(err) }));
    }
  };

  const handleReveal = async () => {
    if (!revealTarget) return;
    try {
      await tauriApi.revealInFinder(revealTarget);
    } catch (err) {
      toast.error(t('recordings.revealFailed', { error: String(err) }));
    }
  };

  const rerun = (choice: Partial<RerunChoice>) => {
    const audioPath = task.audioPath;
    if (!audioPath) return;
    void guardTranscriptWrite(dirname(audioPath), task.label, (mode) =>
      startTranscription({
        audioPath,
        documentId: task.documentId,
        recordingStartedAt: task.recordingStartedAt,
        recordingStoppedAt: task.recordingStoppedAt,
        recordingDurationSecs: task.recordingDurationSecs,
        jobId: task.id,
        model: choice.model,
        language: choice.language ?? task.language,
        transcriptMode: mode,
      }),
    ).then(setPendingWrite);
  };

  const statusLine =
    task.status === 'done'
      ? canOpen
        ? t("activity.transcriptReadyOpen")
        : t("activity.transcriptReady")
      : isRunning
        ? jobStatusText({ queued, stage: task.transcriptionStage, progress })
        : isCancelled
          ? t('transcription.cancelled')
          : isInterrupted
            ? t('transcription.errorInterrupted')
            : t('transcription.failed');
  const timing = isRunning && !queued ? jobTimingText({ ...task, now }) : null;

  return (
    <div
      className={`group/card px-3 py-2.5 space-y-1.5 min-w-0 overflow-hidden transition-colors duration-150 ${
        canOpen ? 'cursor-pointer hover:bg-muted/50 active:bg-muted/70' : ''
      }`}
      onClick={canOpen ? () => { void handleOpen(); } : undefined}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onKeyDown={canOpen ? (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void handleOpen();
        }
      } : undefined}
    >
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5">
          {isFailed ? (
            <X className="h-3.5 w-3.5 text-destructive" strokeWidth={1.5} aria-hidden="true" />
          ) : task.status === 'done' ? (
            <Check className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          ) : isCancelled || isInterrupted ? (
            <CircleSlash className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <ScrollText className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground truncate">
            {task.label}
          </p>
          {/* Announced when it CHANGES (queued → transcribing → ready). The
              percent is not part of it once it is ticking: see below. */}
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite" data-testid="transcription-status">
            {isRunning && !queued && task.transcriptionStage !== 'finishing' && (task.transcriptionStage === 'transcribing' || progress > 0)
              ? t('activity.transcribing')
              : statusLine}
          </p>
          {isFailed && (
            <p className="mt-0.5 text-xs text-destructive break-words" data-testid="transcription-error">
              {describeTranscriptionError(task.errorMessage)}
            </p>
          )}
          {summary && (
            <p className="text-[11px] text-muted-foreground tabular-nums">{summary}</p>
          )}
          {/* Provenance — a bundle the phone recorded says so, so three cards
              after a Mac wakes up are not a mystery. */}
          {task.sourceDevice && (
            <p className="text-[11px] text-muted-foreground" data-testid="transcription-source-device">
              {t("activity.fromDevice", { device: task.sourceDevice })}
            </p>
          )}
          {languageUsed && (
            <p className="text-[11px] text-muted-foreground">
              {autoDetected ? t('activity.detectedLanguage') : t('activity.language')}:{' '}
              {speechLanguageLabel(languageUsed)}
            </p>
          )}
        </div>
        {/* Top-right action cluster: [Transcribe again] [Move to project]
            [Reveal in Finder] [Remove]. */}
        {!isRunning && (
          <div className="flex shrink-0 items-center gap-0.5">
            {task.audioPath && (
              <RerunTranscriptionMenu onPick={rerun}>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={t("activity.rerunTranscription")}
                  title={t("activity.rerunTranscription")}
                  className={CORNER_ACTION}
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                </Button>
              </RerunTranscriptionMenu>
            )}
            {task.status === 'done' && !task.moved && <MoveToProjectMenu task={task} />}
            {canReveal && (
              <IconActionButton
                label={t("activity.revealInFinder")}
                onClick={(e) => { e.stopPropagation(); void handleReveal(); }}
                className={CORNER_ACTION}
              >
                <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
              </IconActionButton>
            )}
            {onRemove && (
              <IconActionButton
                label={t('transcription.removeFromList')}
                onClick={(e) => { e.stopPropagation(); onRemove(task.id); }}
                className={CORNER_ACTION}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </IconActionButton>
            )}
          </div>
        )}
      </div>

      {/* What to do about a job that did not finish. Real buttons, with words. */}
      {(isFailed || isInterrupted) && (
        <div className="pl-5 flex flex-wrap items-center gap-1.5">
          {isInterrupted && task.audioPath && (
            <Button
              variant="outline"
              size="xs"
              onClick={(e) => { e.stopPropagation(); rerun({}); }}
            >
              {t('recordings.retry')}
            </Button>
          )}
          <Button
            variant={isInterrupted ? 'ghost' : 'outline'}
            size="xs"
            onClick={(e) => { e.stopPropagation(); useRecordingsStore.getState().openRecordings(); }}
          >
            {t('transcription.retryFromRecordings')}
          </Button>
          {modelMissing && (
            <Button
              variant="outline"
              size="xs"
              onClick={(e) => { e.stopPropagation(); openTranscriptionSettings(); }}
            >
              {t('transcription.downloadModel')}
            </Button>
          )}
        </div>
      )}

      {/* Bundle path — "where did my recording go" should never be a question. */}
      {!isRunning && bundlePath && (
        <p className="pl-5 text-[11px] text-muted-foreground truncate" title={bundlePath}>
          {bundlePath}
        </p>
      )}

      {/* Progress affordance while running */}
      {isRunning && (
        <div className="pl-5 space-y-1">
          <div className="flex items-center gap-2">
            {task.transcriptionStage === 'transcribing' || progress > 0 ? (
              <>
                <Progress
                  value={progress}
                  className="h-1.5 flex-1"
                  aria-label={t('transcription.progressLabel', { title: task.label })}
                />
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {Math.round(progress)}%
                </span>
              </>
            ) : (
              <span className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
                {!queued && (
                  <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={1.5} aria-hidden="true" />
                )}
              </span>
            )}
            <Button
              variant="outline"
              size="xs"
              className="shrink-0"
              aria-label={t('transcription.cancelNamed', { title: task.label })}
              onClick={(e) => { e.stopPropagation(); void cancelTranscriptionJob(task.id); }}
            >
              {t('common.cancel')}
            </Button>
          </div>
          {timing && (
            <p className="text-[11px] text-muted-foreground tabular-nums" data-testid="transcription-timing">
              {timing}
            </p>
          )}
        </div>
      )}

      {/* Portalled, but React events still bubble to the card: without this a
          click on "Replace" would also open the transcript. */}
      <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <ReplaceTranscriptDialog pending={pendingWrite} onClose={() => setPendingWrite(null)} />
      </div>
    </div>
  );
}
