import { memo, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CloudDownload,
  FileAudio,
  FolderInput,
  FolderOpen,
  Loader2,
  Mic,
  MonitorSpeaker,
  MoreHorizontal,
  Pencil,
  Trash2,
  Users,
  Captions,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RerunTranscriptionMenu, type RerunChoice } from "@/components/activity/cards/RerunTranscriptionMenu";
import { useActivityStore, type AgentTask } from "@/stores/activity-store";
import type { RecordingBundle } from "@/stores/recordings-store";
import { getFormatLocale, t } from "@/lib/i18n";
import { basename } from "@/lib/transcription/bundle";
import { describeTranscriptionError } from "@/lib/transcription/errors";
import { formatBytes } from "@/lib/transcription/format";
import { isQueuedJob, jobStatusText, jobTimingText } from "@/lib/transcription/job-status";
import { speechLanguageLabel } from "@/lib/transcription/languages";
import { formatRecordingLength } from "@/lib/transcription/segments";
import { useNow } from "./useNow";

export type RowDialog = "rename" | "delete" | "speakers" | "teams";

export interface RecordingRowProps {
  bundle: RecordingBundle;
  projects: ReadonlyArray<{ path: string }>;
  onOpen: (bundle: RecordingBundle) => void;
  onTranscribe: (bundle: RecordingBundle, choice: Partial<RerunChoice>) => void;
  onCancel: (taskId: string) => void;
  onMove: (bundle: RecordingBundle, projectPath: string) => void;
  onReveal: (bundle: RecordingBundle) => void;
  onDialog: (kind: RowDialog, bundle: RecordingBundle) => void;
  /** Called with a sentence when the row's status CHANGES, for the view's live region. */
  onAnnounce: (message: string) => void;
  /** Position among ALL rows, for assistive tech: a windowed list mounts only some of them. */
  posInSet: number;
  setSize: number;
}

/** What this Mac's own job for the recording is doing, as primitives. */
interface LiveJob {
  id: string | null;
  state: "none" | "queued" | "running" | "interrupted" | "failed";
  progress: number;
  stage: AgentTask["transcriptionStage"];
  runStartedAt: number | undefined;
  anchorAt: number | undefined;
  anchorPercent: number | undefined;
  error: string | undefined;
}

const NO_JOB: LiveJob = {
  id: null,
  state: "none",
  progress: 0,
  stage: undefined,
  runStartedAt: undefined,
  anchorAt: undefined,
  anchorPercent: undefined,
  error: undefined,
};

function sourceLabel(bundle: RecordingBundle): string | null {
  switch (bundle.source) {
    case "microphone":
      return t("recordings.sourceMicrophone");
    case "system":
      return t("recordings.sourceSystem");
    case "both":
      return t("recordings.sourceBoth");
    case "import":
      return bundle.originalName
        ? t("recordings.sourceImportedFrom", { name: bundle.originalName })
        : t("recordings.sourceImported");
    default:
      return null;
  }
}

function SourceIcon({ bundle }: { bundle: RecordingBundle }) {
  const Icon = bundle.source === "import" ? FileAudio : bundle.source === "system" ? MonitorSpeaker : Mic;
  return (
    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" strokeWidth={1.5} aria-hidden="true" />
  );
}

/**
 * One recording.
 *
 * The row says what the recording IS (name, when, how long, how big, what was
 * captured, in which language, who speaks) and what state it is honestly in.
 * A job running on this Mac is read live from the activity store through a
 * selector of primitives, so a progress tick re-renders this row and nothing
 * else, and the list does not need to be reloaded to show it.
 *
 * Every action names the recording in its accessible name: "Open transcript:
 * Weekly sync", not forty buttons all called "Open transcript".
 */
export const RecordingRow = memo(function RecordingRow({
  bundle,
  projects,
  onOpen,
  onTranscribe,
  onCancel,
  onMove,
  onReveal,
  onDialog,
  onAnnounce,
  posInSet,
  setSize,
}: RecordingRowProps) {
  const audioPath = bundle.audioPath;
  const job = useActivityStore(
    useShallow((s): LiveJob => {
      if (!audioPath) return NO_JOB;
      const task = s.tasks.find((x) => x.kind === "transcription" && x.audioPath === audioPath);
      if (!task) return NO_JOB;
      if (task.status === "running") {
        return {
          id: task.id,
          state: isQueuedJob(task, s.tasks) ? "queued" : "running",
          progress: task.progress ?? 0,
          stage: task.transcriptionStage,
          runStartedAt: task.runStartedAt,
          anchorAt: task.progressAnchorAt,
          anchorPercent: task.progressAnchorPercent,
          error: undefined,
        };
      }
      if (task.status === "error") {
        return { ...NO_JOB, id: task.id, state: task.interrupted ? "interrupted" : "failed", error: task.errorMessage };
      }
      return { ...NO_JOB, id: task.id };
    }),
  );
  const busy = job.state === "queued" || job.state === "running";
  const now = useNow(job.state === "running");

  const locale = getFormatLocale();
  const title = bundle.title;
  const started = bundle.startedAt ? new Date(bundle.startedAt) : null;
  const when =
    started && !Number.isNaN(started.getTime())
      ? started.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })
      : null;
  const named = (action: string) => t("recordings.actionNamed", { action, title });

  // The honest status, in this order: what this Mac is doing right now wins
  // over what the folder said when it was last listed.
  const status: "queued" | "running" | "elsewhere" | "done" | "failed" | "downloading" | "not-transcribed" = busy
    ? (job.state as "queued" | "running")
    : bundle.status === "done"
      ? "done"
      : bundle.status === "downloading"
        ? "downloading"
        : bundle.status === "running"
          ? "elsewhere"
          : bundle.status === "failed" || job.state === "failed" || job.state === "interrupted"
            ? "failed"
            : "not-transcribed";
  const failure =
    status === "failed"
      ? describeTranscriptionError(job.state === "interrupted" ? "interrupted" : (job.error ?? bundle.error))
      : null;

  const statusText =
    status === "queued" || status === "running"
      ? jobStatusText({ queued: status === "queued", stage: job.stage, progress: job.progress })
      : status === "elsewhere"
        ? t("recordings.statusElsewhere", { device: bundle.transcribedOn ?? "" })
        : status === "done"
          ? t("recordings.statusDone")
          : status === "downloading"
            ? t("recordings.statusDownloading")
            : status === "failed"
              ? t("recordings.statusFailed")
              : t("recordings.statusNotTranscribed");
  // What a screen reader is told when the state changes: the state, never the
  // ticking percent.
  const spoken =
    status === "running" ? t("activity.transcribing") : status === "failed" && failure ? `${statusText}: ${failure}` : statusText;
  const lastSpoken = useRef(spoken);
  useEffect(() => {
    if (lastSpoken.current === spoken) return;
    lastSpoken.current = spoken;
    onAnnounce(`${title}: ${spoken}`);
  }, [spoken, title, onAnnounce]);

  const timing = status === "running" ? jobTimingText({ ...job, progressAnchorAt: job.anchorAt, progressAnchorPercent: job.anchorPercent, now }) : null;
  const length = formatRecordingLength(bundle.durationSecs);
  const size = formatBytes(bundle.sizeBytes, locale);
  const source = sourceLabel(bundle);
  const facts = [
    when,
    length,
    size,
    source,
    bundle.language ? speechLanguageLabel(bundle.language) : null,
    bundle.device ? t("activity.fromDevice", { device: bundle.device }) : null,
  ].filter((x): x is string => Boolean(x));

  const canTranscribe = Boolean(bundle.audioPath) && !busy && status !== "downloading" && status !== "elsewhere";
  const transcribeLabel =
    status === "failed"
      ? t("recordings.retry")
      : status === "done"
        ? t("recordings.transcribeAgain")
        : t("recordings.transcribe");

  return (
    <div
      role="listitem"
      aria-posinset={posInSet}
      aria-setsize={setSize}
      className="rounded-md border border-border px-4 py-3 transition-colors duration-150 hover:bg-muted/30"
      data-testid="recording-row"
      data-status={status}
      data-dir={bundle.dir}
    >
      <div className="flex items-start gap-3">
        <SourceIcon bundle={bundle} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="min-w-0 truncate text-sm font-medium text-foreground" title={title}>
              {title}
            </h3>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
            {facts.map((fact, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true">·</span>}
                {fact}
              </span>
            ))}
          </p>
          {bundle.speakers.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground" data-testid="recording-speakers">
              {t("recordings.speakersList", { names: bundle.speakers.join(", ") })}
            </p>
          )}

          {/* Status on the left, what can be done about it on the right, on
              one line; the actions drop below when the status is a long
              sentence (a failure's reason) or the column is narrow. */}
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="min-w-0 flex-1 basis-56 text-xs" data-testid="recording-status">
              {(status === "queued" || status === "running") && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {status === "running" && job.progress === 0 && (
                      <Loader2
                        className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    )}
                    <span className="shrink-0 tabular-nums">{statusText}</span>
                    {status === "running" && job.progress > 0 && (
                      <Progress
                        value={job.progress}
                        className="h-1.5 max-w-48 flex-1"
                        aria-label={t("transcription.progressLabel", { title })}
                      />
                    )}
                  </div>
                  {timing && <p className="text-[11px] text-muted-foreground tabular-nums">{timing}</p>}
                </div>
              )}
              {status === "elsewhere" && (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  {statusText}
                </span>
              )}
              {status === "done" && (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Check className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  {statusText}
                </span>
              )}
              {status === "downloading" && (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <CloudDownload className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  {statusText}
                </span>
              )}
              {status === "not-transcribed" && <span className="text-muted-foreground">{statusText}</span>}
              {status === "failed" && (
                <span className="inline-flex items-start gap-1.5 text-destructive">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                  <span className="break-words">
                    {statusText}
                    {failure ? `: ${failure}` : ""}
                  </span>
                </span>
              )}
            </div>

            <div className="-mr-2 flex shrink-0 flex-wrap items-center justify-end gap-1">
              {bundle.transcriptPath && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  aria-label={named(t("recordings.openTranscript"))}
                  onClick={() => onOpen(bundle)}
                >
                  {t("recordings.openTranscript")}
                </Button>
              )}
              {busy && job.id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  aria-label={named(t("recordings.cancelTranscription"))}
                  onClick={() => job.id && onCancel(job.id)}
                >
                  {t("common.cancel")}
                </Button>
              )}
              {canTranscribe && (
                <RerunTranscriptionMenu onPick={(choice) => onTranscribe(bundle, choice)}>
                  <Button
                    variant={status === "done" ? "ghost" : "outline"}
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    aria-label={named(transcribeLabel)}
                  >
                    {transcribeLabel}
                    <ChevronDown className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                  </Button>
                </RerunTranscriptionMenu>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7"
                    aria-label={named(t("recordings.moreActions"))}
                  >
                    <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={!bundle.hasManifest} onSelect={() => onDialog("rename", bundle)}>
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                    {t("recordings.rename")}
                  </DropdownMenuItem>
                  {bundle.transcriptPath && (
                    <DropdownMenuItem disabled={busy} onSelect={() => onDialog("speakers", bundle)}>
                      <Users className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      {t("recordings.speakers")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    disabled={busy || !bundle.hasManifest}
                    onSelect={() => onDialog("teams", bundle)}
                  >
                    <Captions className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                    {bundle.hasTeamsTranscript ? t("recordings.replaceTeams") : t("recordings.addTeams")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {/* Moving a folder a job is reading from would pull the audio out
                      from under it, so the action is not there while one runs. */}
                  {!busy && projects.length > 0 && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <FolderInput className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                        {t("activity.moveToProject")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {projects.map((project) => (
                          <DropdownMenuItem key={project.path} onSelect={() => onMove(bundle, project.path)}>
                            {basename(project.path) || project.path}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  <DropdownMenuItem onSelect={() => onReveal(bundle)}>
                    <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                    {t("activity.revealInFinder")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={busy}
                    onSelect={() => onDialog("delete", bundle)}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                    {busy ? t("recordings.deleteDisabledBusy") : t("recordings.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

/** Gap between rows, and a first guess at a row's height for the windowed list. */
export const ROW_GAP_PX = 8;
export const ROW_ESTIMATE_PX = 118;
