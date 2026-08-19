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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useActivityStore } from '@/stores/activity-store';
import type { AgentTask } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import { dirname, basename as pathBasename, moveBundleToProject, transcriptPathForAudio } from '@/lib/transcription/bundle';
import { useFileOperations } from '@/hooks/useFileOperations';
import { startTranscription } from '@/hooks/useTranscriptionJob';
import { tauriApi } from '@/lib/tauri';
import { IconActionButton, basename, formatClock } from './shared';
import { getFormatLocale, t } from "@/lib/i18n";
import {
  SPEECH_LANGUAGES,
  speechLanguageLabel,
  pickModelForLanguage,
} from '@/lib/transcription/languages';
import { useFormatLocale } from "@/lib/useLocale";

/** Display name for a project root — the trailing path component. */
function projectDisplayName(projectRoot: string): string {
  return pathBasename(projectRoot) || projectRoot;
}

/**
 * Friendly name for an ISO 639-1 code (`"sv"` → `"Swedish"`), via the built-in
 * `Intl.DisplayNames`. Whisper detects ~99 languages, far more than the curated
 * picker list, so a lookup table here would fall short of what it can return.
 * Falls back to the raw code when the runtime lacks the API or the code is
 * unrecognized — a bare `"sv"` still tells the user more than nothing.
 *
 * Follows the app language once the user picks one (#705), so a Swedish UI
 * reads "svenska"; with no choice made it stays English, as it always was.
 */
function languageDisplayName(code: string): string {
  try {
    // Falls back to English rather than `undefined`: this hardcoded `['en']`
    // before, so passing `undefined` (which resolves to the RUNTIME's locale)
    // would silently change "Swedish" to "svenska" on a Swedish machine for a
    // user who never touched the language picker. The choice is honoured; the
    // absence of one keeps the previous behaviour.
    return new Intl.DisplayNames([getFormatLocale() ?? 'en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "large-v3" -> "Large V3" — mirrors `TranscriptionSettings`' model label. */
function modelDisplayName(name: string): string {
  return name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
 * Compact recorded length: `M:SS` under an hour, `H:MM:SS` over.
 */
function formatLength(secs?: number): string | null {
  if (secs == null || !Number.isFinite(secs)) return null;
  const total = Math.max(0, Math.round(secs));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * "start – stop · length" summary for a recording. Falls back to the start time
 * encoded in the bundle folder name when the live metadata is absent, so even
 * legacy / disk-restored items show what they can. Returns null only when
 * nothing at all can be derived.
 */
function recordingSummary(task: AgentTask): string | null {
  const startMs =
    task.recordingStartedAt ?? parseStartFromPath(task.transcriptPath ?? task.audioPath);
  const start = formatClock(startMs);
  const stop = formatClock(task.recordingStoppedAt);
  const length = formatLength(task.recordingDurationSecs);
  const span = start && stop ? `${start} – ${stop}` : start ?? stop ?? null;
  return [span, length].filter(Boolean).join('  ·  ') || null;
}

/**
 * t("activity.moveToProject") action shown on a completed transcription job — an
 * icon-only, hover-revealed control in the card's top-right cluster. Lists the
 * open projects from `workspace-store`; picking one relocates the whole bundle
 * (audio + transcript) into that project via `moveBundleToProject`, toasts
 * success, and records the move in the store (which hides this action). The
 * trigger stays visible while its menu is open (`data-[state=open]`).
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
      // The transcript keeps its filename inside the relocated bundle folder;
      // derive the new note path from the audio filename convention.
      const movedAudio = `${newBundleDir}/${basename(task.audioPath ?? '')}`;
      const newTranscriptPath = task.audioPath
        ? transcriptPathForAudio(movedAudio)
        : `${newBundleDir}/${basename(task.transcriptPath ?? '')}`;
      // Repoint audioPath too — it moved along with the transcript, and a
      // stale audioPath would break "re-run transcription" and "reveal in
      // Finder" after the move.
      setTranscriptionMoved(task.id, newTranscriptPath, task.audioPath ? movedAudio : undefined);
      toast.success(`Moved to ${projectDisplayName(projectRoot)}`);
    } catch (err) {
      toast.error(`Failed to move recording: ${err}`);
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
                className="shrink-0 h-4 w-4 opacity-0 group-hover/card:opacity-100 data-[state=open]:opacity-100 transition-[opacity,color] duration-150 text-muted-foreground hover:text-foreground"
              >
                {moving ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
                ) : (
                  <FolderInput className="h-3 w-3" strokeWidth={1.5} />
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
 * t("activity.rerunTranscription") action shown on a finished (done or errored)
 * transcription job — an icon-only, hover-revealed control listing every
 * downloaded Whisper model. Picking one re-transcribes the retained
 * `audio.wav` and replaces the displayed transcript — the fix for "wrong
 * model, bad result."
 *
 * The language can be changed here too. A wrong language is the more common
 * failure and the more destructive one: the model hears the words correctly
 * and writes them in another language's spelling, so the output looks like
 * confident nonsense rather than a bad transcript. Re-running with the right
 * language fixes it outright, so it belongs beside the model choice rather
 * than buried in Settings.
 * Reuses the job's own id (`jobId`) so `useTranscriptionJob` updates this
 * same card in place instead of adding a new list entry.
 */
function RerunTranscriptionMenu({ task }: { task: AgentTask }) {
  const models = useRecordingStore((s) => s.availableModels);
  const defaultModel = useRecordingStore((s) => s.defaultModel);
  const refreshModels = useRecordingStore((s) => s.refreshModels);
  const downloadedModels = models.filter((m) => m.downloaded);
  const audioPath = task.audioPath;

  if (!audioPath) return null;

  const handleRerun = (model: string, language?: string) => {
    startTranscription({
      audioPath,
      documentId: task.documentId,
      recordingStartedAt: task.recordingStartedAt,
      recordingStoppedAt: task.recordingStoppedAt,
      recordingDurationSecs: task.recordingDurationSecs,
      jobId: task.id,
      model,
      language: language ?? task.language,
    });
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && models.length === 0) void refreshModels();
      }}
    >
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => e.stopPropagation()}
                aria-label={t("activity.rerunTranscription")}
                className="shrink-0 h-4 w-4 opacity-0 group-hover/card:opacity-100 data-[state=open]:opacity-100 transition-[opacity,color] duration-150 text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            <p className="text-xs">{t("activity.rerunTranscription")}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("activity.rerunWithModel")}
        </DropdownMenuLabel>
        {downloadedModels.length === 0 ? (
          <DropdownMenuItem disabled>{t("activity.noModelsDownloaded")}</DropdownMenuItem>
        ) : (
          downloadedModels.map((m) => (
            <DropdownMenuItem key={m.name} onSelect={() => handleRerun(m.name)}>
              {modelDisplayName(m.name)}
            </DropdownMenuItem>
          ))
        )}
        {downloadedModels.length > 0 && (
          <>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-xs">
            {t("activity.rerunInLanguage")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {SPEECH_LANGUAGES.map((lang) => (
              <DropdownMenuItem
                key={lang.value}
                onSelect={() =>
                  handleRerun(
                    // Not simply `defaultModel`: re-running to FIX a wrong
                    // language must not hand the job to an English-only model.
                    pickModelForLanguage(
                      defaultModel,
                      lang.value,
                      downloadedModels.map((m) => m.name),
                    ),
                    lang.value,
                  )
                }
              >
                {lang.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Transcription-job card (kind === 'transcription'). Distinct ScrollText icon
 * + label; a shadcn `Progress` bar while running (a spinner stands in when
 * progress is 0/unknown); a t("activity.moveToProject") action on completion; the shared
 * error treatment on failure. Once the transcript is ready the card itself is
 * clickable and opens the transcript note in the editor.
 */
export function TranscriptionCard({ task, onRemove }: { task: AgentTask; onRemove?: (id: string) => void }) {
  // Subscribe to language changes: the formatting helpers below read the
  // i18n module directly, so without this the rendered dates/numbers would
  // keep their old locale until some unrelated state forced a re-render.
  useFormatLocale();

  const { openFile } = useFileOperations();
  const isRunning = task.status === 'running';
  const progress = task.progress ?? 0;
  const showSpinner = isRunning && progress === 0;

  const transcriptPath = task.transcriptPath;
  const canOpen = task.status === 'done' && !!transcriptPath;
  // Anything we can point Finder at: the transcript note, or the raw audio if
  // transcription failed before a note was written.
  const revealTarget = transcriptPath ?? task.audioPath;
  const canReveal = task.status !== 'running' && !!revealTarget;
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
  // The bundle folder holding audio.wav + transcript.md — "where did my
  // recording go" should never be a question (#698).
  const bundlePath = revealTarget ? dirname(revealTarget) : undefined;

  const handleOpen = async () => {
    if (!canOpen || !transcriptPath) return;
    try {
      await openFile(transcriptPath, pathBasename(transcriptPath));
    } catch (err) {
      toast.error(`Failed to open transcript: ${err}`);
    }
  };

  const handleReveal = async () => {
    if (!revealTarget) return;
    try {
      await tauriApi.revealInFinder(revealTarget);
    } catch (err) {
      toast.error(`Failed to reveal: ${err}`);
    }
  };

  return (
    <div
      className={`group/card px-3 py-2.5 space-y-1.5 min-w-0 overflow-hidden transition-colors duration-150 ${
        canOpen ? 'cursor-pointer hover:bg-muted/50 active:bg-muted/70' : ''
      }`}
      onClick={canOpen ? () => { void handleOpen(); } : undefined}
    >
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5">
          {task.status === 'error' ? (
            <X className="h-3.5 w-3.5 text-destructive" strokeWidth={1.5} />
          ) : task.status === 'done' ? (
            <Check className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
          ) : (
            <ScrollText className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground truncate">
            {task.label}
          </p>
          <p className="text-xs text-muted-foreground">
            {task.status === 'error'
              ? t("activity.transcriptionFailed")
              : task.status === 'done'
                ? canOpen
                  ? t("activity.transcriptReadyOpen")
                  : t("activity.transcriptReady")
                : t("activity.transcribing")}
          </p>
          {summary && (
            <p className="text-[11px] text-muted-foreground/80 tabular-nums">{summary}</p>
          )}
          {languageUsed && (
            <p className="text-[11px] text-muted-foreground/80">
              {autoDetected ? 'Detected language' : 'Language'}:{' '}
              {autoDetected
                ? languageDisplayName(languageUsed)
                : speechLanguageLabel(languageUsed)}
            </p>
          )}
        </div>
        {/* Top-right action cluster — icon-only, hover-revealed, left of the
            remove ✕: [Re-run] [Move to project] [Reveal in Finder] [✕]. */}
        {!isRunning && (
          <div className="flex shrink-0 items-center gap-0.5">
            <RerunTranscriptionMenu task={task} />
            {task.status === 'done' && !task.moved && <MoveToProjectMenu task={task} />}
            {canReveal && (
              <IconActionButton
                label={t("activity.revealInFinder")}
                onClick={(e) => { e.stopPropagation(); void handleReveal(); }}
                className="shrink-0 h-4 w-4 opacity-0 group-hover/card:opacity-100 transition-[opacity,color] duration-150 text-muted-foreground hover:text-foreground"
              >
                <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
              </IconActionButton>
            )}
            {onRemove && (
              <IconActionButton
                label="Remove from this list — the audio and transcript stay on disk (use Reveal in Finder to delete them)"
                onClick={(e) => { e.stopPropagation(); onRemove(task.id); }}
                className="shrink-0 h-4 w-4 opacity-0 group-hover/card:opacity-100 transition-[opacity,color] duration-150 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" strokeWidth={1.5} />
              </IconActionButton>
            )}
          </div>
        )}
      </div>

      {/* Bundle path — "where did my recording go" should never be a question. */}
      {!isRunning && bundlePath && (
        <p className="pl-5 text-[11px] text-muted-foreground/70 truncate" title={bundlePath}>
          {bundlePath}
        </p>
      )}

      {/* Progress affordance while running */}
      {isRunning && (
        <div className="pl-5">
          {showSpinner ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
              <span>{t("activity.starting")}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Progress value={progress} className="h-1.5 flex-1" />
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {Math.round(progress)}%
              </span>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
