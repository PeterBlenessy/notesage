import { useEffect } from "react";
import { AlertTriangle, Check, FolderInput, Loader2, Mic, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { tauriApi } from "@/lib/tauri";
import { getFormatLocale } from "@/lib/i18n";
import { moveBundleToProject } from "@/lib/transcription/bundle";
import { startTranscription } from "@/hooks/useTranscriptionJob";
import { useRecordingsStore, type RecordingBundle } from "@/stores/recordings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The Recordings list — a mode of the document column, like the Inbox.
 *
 * The agent orb narrates a transcription WHILE it runs and then forgets it.
 * That is the right behaviour for an orb and the wrong one for the artifact:
 * a bundle whose run failed had no surface at all, so the one action that
 * fixes it (re-run, usually with the right language) could only be reached
 * while the card happened to still be there. This is the place it lives
 * afterwards.
 *
 * Read-only over the folder: the scanner owns dispatch and every manifest
 * write. The buttons here call the same two entry points the orb does.
 */

function formatDuration(secs: number | null): string | null {
  if (secs === null || !Number.isFinite(secs) || secs <= 0) return null;
  const total = Math.round(secs);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} min ${s.toString().padStart(2, "0")} s` : `${s} s`;
}

function StatusBadge({ bundle }: { bundle: RecordingBundle }) {
  const common = "inline-flex items-center gap-1.5 text-xs";
  switch (bundle.status) {
    case "running":
      return (
        <span className={cn(common, "text-muted-foreground")}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} aria-hidden="true" />
          Transcribing
          {bundle.transcribedOn ? ` on ${bundle.transcribedOn}` : null}…
        </span>
      );
    case "done":
      return (
        <span className={cn(common, "text-muted-foreground")}>
          <Check className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          Transcribed
        </span>
      );
    case "failed":
      return (
        <span className={cn(common, "text-destructive")}>
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          {bundle.error || "Transcription failed"}
        </span>
      );
    default:
      return <span className={cn(common, "text-muted-foreground")}>Waiting to be transcribed</span>;
  }
}

function FileToProject({ bundle }: { bundle: RecordingBundle }) {
  const projects = useWorkspaceStore((s) => s.projects);
  const load = useRecordingsStore((s) => s.load);

  if (projects.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
          <FolderInput className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          Move to project
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {projects.map((project) => {
          const name = project.path.slice(project.path.lastIndexOf("/") + 1);
          return (
            <DropdownMenuItem
              key={project.path}
              onSelect={() => {
                void (async () => {
                  try {
                    await moveBundleToProject(bundle.dir, project.path);
                    toast.success(`Moved to ${name}`);
                    await load();
                  } catch (err) {
                    toast.error(`Could not move the recording: ${String(err)}`);
                  }
                })();
              }}
            >
              {name}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BundleRow({ bundle }: { bundle: RecordingBundle }) {
  const { openFile } = useFileOperations();
  const locale = getFormatLocale();
  const duration = formatDuration(bundle.durationSecs);
  const started = bundle.startedAt ? new Date(bundle.startedAt) : null;
  const startedMs = started && !Number.isNaN(started.getTime()) ? started.getTime() : null;
  const when =
    started && !Number.isNaN(started.getTime())
      ? started.toLocaleString(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : bundle.name;

  return (
    <li className="rounded-md border border-border px-4 py-3">
      <div className="flex items-start gap-3">
        <Mic
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{when}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {bundle.device && <span>from {bundle.device}</span>}
            {duration && <span>{duration}</span>}
          </div>
          <div className="mt-1.5">
            <StatusBadge bundle={bundle} />
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
        {bundle.transcriptPath && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              const path = bundle.transcriptPath as string;
              void openFile(path, path.slice(path.lastIndexOf("/") + 1)).catch((err) =>
                toast.error(`Could not open the transcript: ${String(err)}`),
              );
            }}
          >
            Open transcript
          </Button>
        )}
        {bundle.audioPath && bundle.status !== "running" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => {
              // The same dispatcher the orb's card uses; the job hook owns the
              // run and the scanner writes the manifest when it settles.
              startTranscription({
                audioPath: bundle.audioPath as string,
                // ms-epoch, not the manifest's RFC3339 string.
                recordingStartedAt: startedMs ?? undefined,
                recordingDurationSecs: bundle.durationSecs ?? undefined,
                language: bundle.language ?? undefined,
                sourceDevice: bundle.device ?? undefined,
              });
              toast.success("Transcribing…");
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            {bundle.status === "failed" ? "Try again" : "Transcribe again"}
          </Button>
        )}
        <FileToProject bundle={bundle} />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => void tauriApi.revealInFinder(bundle.dir).catch(() => {})}
        >
          Reveal
        </Button>
      </div>
    </li>
  );
}

export function RecordingsView() {
  const bundles = useRecordingsStore((s) => s.bundles);
  const loading = useRecordingsStore((s) => s.loading);
  const dir = useRecordingsStore((s) => s.dir);
  const load = useRecordingsStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-5" data-testid="recordings-view">
      <h1 className="text-lg font-semibold text-foreground">Recordings</h1>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Meetings recorded here and on your phone. Transcription runs on this Mac.
      </p>

      {bundles.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <Mic className="h-6 w-6 text-muted-foreground/50" strokeWidth={1.5} aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {loading ? "Looking…" : "No recordings yet"}
          </p>
          {!loading && dir && (
            <p className="max-w-sm text-xs text-muted-foreground/80">
              A recording made here, or one your phone finishes, lands in {dir} and is transcribed
              automatically.
            </p>
          )}
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2" data-testid="recordings-list">
          {bundles.map((bundle) => (
            <BundleRow key={bundle.dir} bundle={bundle} />
          ))}
        </ul>
      )}
    </div>
  );
}
