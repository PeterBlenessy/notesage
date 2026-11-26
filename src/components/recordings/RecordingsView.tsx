import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, Circle, FileUp, Mic, Search, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { RerunChoice } from "@/components/activity/cards/RerunTranscriptionMenu";
import { tauriApi } from "@/lib/tauri";
import { getFormatLocale, t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";
import { RECORDINGS_FOLDER_NAME } from "@/lib/notes-root";
import { basename } from "@/lib/transcription/bundle";
import { describeTranscriptionError } from "@/lib/transcription/errors";
import { cancelTranscriptionJob } from "@/hooks/useTranscriptionJob";
import { toggleMeetingRecording } from "@/hooks/useMeetingRecording";
import { useFileOperations } from "@/hooks/useFileOperations";
import {
  IMPORT_EXTENSIONS,
  isImportableFile,
  isUnsupportedContainer,
  useRecordingsStore,
  type RecordingBundle,
} from "@/stores/recordings-store";
import { useRecordingStore } from "@/stores/recording-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { RecordingRow, ROW_ESTIMATE_PX, ROW_GAP_PX, type RowDialog } from "./RecordingRow";
import { DeleteRecordingDialog, RenameRecordingDialog, SpeakersDialog } from "./RecordingDialogs";
import { TeamsTranscriptDialog, type TeamsRequest } from "./TeamsTranscriptDialog";
import {
  ReplaceTranscriptDialog,
  guardTranscriptWrite,
  type PendingTranscriptWrite,
} from "./ReplaceTranscriptDialog";

/**
 * The Recordings list — a mode of the document column, like the Inbox.
 *
 * The agent orb narrates a transcription WHILE it runs and then forgets it.
 * That is the right behaviour for an orb and the wrong one for the artifact:
 * a bundle whose run failed had no surface at all, so the one action that
 * fixes it (re-run, usually with the right language) could only be reached
 * while the card happened to still be there. This is the place it lives
 * afterwards, and the place a recording is started, imported, named,
 * transcribed again, given its speakers' names, moved and deleted.
 *
 * Leaving it works the way leaving the Inbox does (opening any document, a
 * new note), plus Esc and a second click on the sidebar row.
 */

/** Above this many rows only the ones on screen are mounted. */
export const WINDOW_THRESHOLD = 60;
const OVERSCAN = 6;

function errorText(err: unknown): string {
  return describeTranscriptionError(String(err).replace(/^Error:\s*/, ""));
}

/** Does `query` occur in what the row shows for the recording's name or date? */
export function matchesRecording(bundle: RecordingBundle, query: string, locale?: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const started = bundle.startedAt ? new Date(bundle.startedAt) : null;
  const dates =
    started && !Number.isNaN(started.getTime())
      ? [
          started.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }),
          started.toLocaleDateString(locale, { dateStyle: "long" }),
          // The folder's own stamp format, which people type from memory.
          bundle.startedAt?.slice(0, 10) ?? "",
        ]
      : [];
  return [bundle.title, bundle.name, bundle.originalName ?? "", ...dates].some((text) =>
    text.toLowerCase().includes(q),
  );
}

interface RowHandlers {
  projects: ReadonlyArray<{ path: string }>;
  onOpen: (bundle: RecordingBundle) => void;
  onTranscribe: (bundle: RecordingBundle, choice: Partial<RerunChoice>) => void;
  onCancel: (taskId: string) => void;
  onMove: (bundle: RecordingBundle, projectPath: string) => void;
  onReveal: (bundle: RecordingBundle) => void;
  onDialog: (kind: RowDialog, bundle: RecordingBundle) => void;
  onAnnounce: (message: string) => void;
}

function PlainList({ bundles, handlers }: { bundles: RecordingBundle[]; handlers: RowHandlers }) {
  return (
    <div role="list" aria-label={RECORDINGS_FOLDER_NAME} className="flex flex-col gap-2" data-testid="recordings-list">
      {bundles.map((bundle, index) => (
        <RecordingRow key={bundle.dir} bundle={bundle} posInSet={index + 1} setSize={bundles.length} {...handlers} />
      ))}
    </div>
  );
}

/**
 * The same rows, with only the ones near the viewport mounted — the Inbox's
 * approach (`@tanstack/react-virtual`, measured rows, the scroll container
 * the view already has). A year of daily meetings is several hundred rows,
 * each with two menus.
 */
function WindowedList({
  bundles,
  handlers,
  scrollRef,
}: {
  bundles: RecordingBundle[];
  handlers: RowHandlers;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const margin = listRef.current?.offsetTop ?? 0;
    setScrollMargin((current) => (current === margin ? current : margin));
  });
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: bundles.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX + ROW_GAP_PX,
    getItemKey: (index) => bundles[index]?.dir ?? index,
    overscan: OVERSCAN,
    scrollMargin,
  });
  return (
    <div
      ref={listRef}
      role="list"
      aria-label={RECORDINGS_FOLDER_NAME}
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
      data-testid="recordings-list"
      data-windowed="true"
    >
      {virtualizer.getVirtualItems().map((item) => {
        const bundle = bundles[item.index];
        if (!bundle) return null;
        return (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            role="presentation"
            className="absolute inset-x-0"
            style={{ top: item.start - scrollMargin, paddingBottom: ROW_GAP_PX }}
          >
            <RecordingRow bundle={bundle} posInSet={item.index + 1} setSize={bundles.length} {...handlers} />
          </div>
        );
      })}
    </div>
  );
}

export function RecordingsView() {
  // Re-render translated text and dates when the app language changes.
  useLocale();
  const bundles = useRecordingsStore((s) => s.bundles);
  const loading = useRecordingsStore((s) => s.loading);
  const dir = useRecordingsStore((s) => s.dir);
  const error = useRecordingsStore((s) => s.error);
  const imports = useRecordingsStore((s) => s.imports);
  const load = useRecordingsStore((s) => s.load);
  const isRecording = useRecordingStore((s) => s.isRecording);
  const projects = useWorkspaceStore((s) => s.projects);
  const { openFile } = useFileOperations();

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const [viewport, setViewport] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [live, setLive] = useState("");
  const [renaming, setRenaming] = useState<RecordingBundle | null>(null);
  const [deleting, setDeleting] = useState<RecordingBundle | null>(null);
  const [naming, setNaming] = useState<RecordingBundle | null>(null);
  const [teams, setTeams] = useState<TeamsRequest | null>(null);
  const [pendingWrite, setPendingWrite] = useState<PendingTranscriptWrite | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // Whether there is a layout to window against (there is none in jsdom).
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () => setViewport(scroller.offsetHeight);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Esc leaves the view, unless something on top of it (a dialog, a menu, the
  // search box with text in it) has a better claim to the key, or the key was
  // pressed somewhere else entirely (the command bar).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Node ? event.target : null;
      const inView = target === document.body || (target !== null && rootRef.current?.contains(target) === true);
      if (!inView) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      if (target instanceof HTMLInputElement && target.value !== "") {
        setFilter("");
        return;
      }
      useRecordingsStore.getState().closeRecordings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const locale = getFormatLocale();
  const visible = useMemo(
    () => (filter.trim() ? bundles.filter((b) => matchesRecording(b, filter, locale)) : bundles),
    [bundles, filter, locale],
  );

  const importPath = useCallback((path: string) => {
    void useRecordingsStore
      .getState()
      .importFile(path)
      .catch((err) => toast.error(t("recordings.importFailed", { name: basename(path), error: errorText(err) })));
  }, []);

  const pickImport = useCallback(async () => {
    try {
      const path = await tauriApi.openFileDialog(t("recordings.importFilter"), [...IMPORT_EXTENSIONS]);
      if (path) importPath(path);
    } catch (err) {
      toast.error(t("recordings.importFailed", { name: "", error: errorText(err) }));
    }
  }, [importPath]);

  const record = useCallback(() => {
    void toggleMeetingRecording().catch((err) => toast.error(String(err)));
  }, []);

  const onOpen = useCallback(
    (bundle: RecordingBundle) => {
      const path = bundle.transcriptPath;
      if (!path) return;
      void openFile(path, basename(path)).catch((err) =>
        toast.error(t("recordings.openFailed", { error: String(err) })),
      );
    },
    [openFile],
  );

  const onTranscribe = useCallback((bundle: RecordingBundle, choice: Partial<RerunChoice>) => {
    // No "Transcribing…" toast here: nothing has run yet, and the row itself
    // shows the job the moment there is one.
    const run = (mode?: "replace" | "keep-both") => {
      void useRecordingsStore
        .getState()
        .transcribe(bundle.dir, { ...choice, mode })
        .catch((err) => toast.error(t("recordings.transcribeFailed", { error: errorText(err) })));
    };
    if (!bundle.transcriptPath) {
      run();
      return;
    }
    void guardTranscriptWrite(bundle.dir, bundle.title, run).then(setPendingWrite);
  }, []);

  const onCancel = useCallback((taskId: string) => void cancelTranscriptionJob(taskId), []);

  const onMove = useCallback((bundle: RecordingBundle, projectPath: string) => {
    const project = basename(projectPath) || projectPath;
    void useRecordingsStore
      .getState()
      .moveToProject(bundle.dir, projectPath)
      .then(() => toast.success(t("recordings.moved", { project })))
      .catch((err) => toast.error(t("recordings.moveFailed", { error: String(err).replace(/^Error:\s*/, "") })));
  }, []);

  const onReveal = useCallback((bundle: RecordingBundle) => {
    void tauriApi
      .revealInFinder(bundle.dir)
      .catch((err) => toast.error(t("recordings.revealFailed", { error: String(err) })));
  }, []);

  const onDialog = useCallback((kind: RowDialog, bundle: RecordingBundle) => {
    if (kind === "rename") setRenaming(bundle);
    else if (kind === "delete") setDeleting(bundle);
    else if (kind === "speakers") setNaming(bundle);
    else {
      void tauriApi
        .openFileDialog(t("recordings.teamsFilter"), ["vtt", "docx"])
        .then((sourcePath) => {
          if (sourcePath) setTeams({ bundle, sourcePath });
        })
        .catch((err) => toast.error(t("recordings.teamsFailed", { error: String(err) })));
    }
  }, []);

  const handlers = useMemo<RowHandlers>(
    () => ({ projects, onOpen, onTranscribe, onCancel, onMove, onReveal, onDialog, onAnnounce: setLive }),
    [projects, onOpen, onTranscribe, onCancel, onMove, onReveal, onDialog],
  );

  // Files dragged in from Finder. Only OS files count: a sidebar row being
  // dragged carries no `Files` type and is none of this view's business.
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const onDragEnter = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    for (const file of files) {
      if (!isImportableFile(file.name)) {
        toast.error(
          isUnsupportedContainer(file.name)
            ? t("recordings.dropWebm", { name: file.name })
            : t("recordings.dropUnsupported", { name: file.name }),
        );
        continue;
      }
      // The webview hands over a file's CONTENT, not where it lives, and a
      // meeting video is far too large to pass through as content. A path is
      // only present when the shell provides one.
      const path = (file as File & { path?: unknown }).path;
      if (typeof path === "string" && path.length > 0) {
        importPath(path);
      } else {
        toast.error(t("recordings.dropNoPath", { name: file.name }), {
          action: { label: t("recordings.import"), onClick: () => void pickImport() },
        });
      }
    }
  };

  const windowed = visible.length > WINDOW_THRESHOLD && viewport > 0;
  const actions = (
    <>
      <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void pickImport()} data-testid="recordings-import">
        <FileUp className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        {t("recordings.import")}
      </Button>
      <Button
        variant={isRecording ? "destructive" : "default"}
        size="sm"
        className="h-8 gap-1.5"
        aria-pressed={isRecording}
        onClick={record}
        data-testid="recordings-record"
      >
        {isRecording ? (
          <Square className="h-3 w-3 fill-current" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Circle className="h-3 w-3 fill-current" strokeWidth={1.5} aria-hidden="true" />
        )}
        {isRecording ? t("recordings.stopRecording") : t("recordings.record")}
      </Button>
    </>
  );

  return (
    <div
      ref={rootRef}
      className="relative flex h-full flex-col"
      data-testid="recordings-view"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* One polite live region for the whole list: a row reports when its
          state changes, never the ticking percent. */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="recordings-live">
        {live}
      </p>

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto" data-doc-scroll="">
        {/* The bottom padding is what keeps the last row's buttons clear of
            the floating command bar and the orb, which sit over this column. */}
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-6 pb-36 pt-6">
          <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            {/* Takes the room that is left and gives way down to 16rem before
                the buttons wrap under it, so they stay top right on any but
                the narrowest column. */}
            <div className="min-w-0 flex-1 basis-64">
              <div className="flex items-baseline gap-3">
                <h1 className="font-serif text-[22px] font-semibold text-foreground">{RECORDINGS_FOLDER_NAME}</h1>
                {bundles.length > 0 && (
                  <span className="text-[12.5px] text-muted-foreground tabular-nums">
                    {t("recordings.count", { count: bundles.length })}
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t("recordings.subtitle")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          </header>

          {bundles.length > 0 && (
            <label className="mt-4 flex h-8 max-w-xs items-center gap-2 rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors duration-150 focus-within:border-foreground/40">
              <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t("recordings.filter")}
                aria-label={t("recordings.filter")}
                className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                data-testid="recordings-filter"
              />
            </label>
          )}

          {imports.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2" aria-label={t("recordings.importing")} data-testid="recordings-imports">
              {imports.map((item) => (
                <li key={item.sourcePath} className="rounded-md border border-dashed border-border px-4 py-3">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <FileUp className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      {t("recordings.importingNamed", { name: item.name })}
                    </span>
                    <span className="shrink-0 tabular-nums">{item.percent === null ? "" : `${item.percent}%`}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 text-xs"
                      aria-label={t("recordings.cancelImportNamed", { name: item.name })}
                      onClick={() =>
                        void useRecordingsStore
                          .getState()
                          .cancelImport(item.sourcePath)
                          .catch((err) => toast.error(String(err)))
                      }
                    >
                      {t("common.cancel")}
                    </Button>
                  </div>
                  <Progress
                    value={item.percent ?? 0}
                    className="mt-2 h-1.5"
                    aria-label={t("recordings.importingNamed", { name: item.name })}
                  />
                </li>
              ))}
            </ul>
          )}

          {error ? (
            // A failed read is not an empty folder: say so, and offer the retry.
            <div
              role="alert"
              data-testid="recordings-error"
              className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center"
            >
              <AlertTriangle className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">{t("recordings.loadFailed")}</p>
              <p className="max-w-sm break-words text-xs text-muted-foreground">
                {error === "library-root-unknown" ? t("recordings.rootUnknown") : error}
              </p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
                {t("recordings.retry")}
              </Button>
            </div>
          ) : bundles.length === 0 ? (
            <div
              className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center"
              data-testid="recordings-empty"
            >
              <Mic className="h-6 w-6 text-muted-foreground/50" strokeWidth={1.5} aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">
                {loading ? t("recordings.looking") : t("recordings.empty")}
              </p>
              {!loading && (
                <>
                  <p className="max-w-sm text-xs text-muted-foreground">{t("recordings.emptyHint")}</p>
                  <div className="mt-3 flex items-center gap-2">{actions}</div>
                  {dir && (
                    <p className="mt-3 max-w-md break-all text-[11px] text-muted-foreground">
                      {t("recordings.savedIn", { dir })}
                    </p>
                  )}
                </>
              )}
            </div>
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground" data-testid="recordings-no-matches">
              {t("recordings.noMatches", { query: filter })}
            </p>
          ) : (
            <div className="mt-4">
              {windowed ? (
                <WindowedList bundles={visible} handlers={handlers} scrollRef={scrollRef} />
              ) : (
                <PlainList bundles={visible} handlers={handlers} />
              )}
            </div>
          )}
        </div>
      </div>

      {dragging && (
        <div
          className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-lg border border-dashed border-[var(--color-accent-primary)] bg-background/85 backdrop-blur-sm"
          data-testid="recordings-drop-target"
        >
          <p className="text-sm font-medium text-foreground">{t("recordings.dropHere")}</p>
        </div>
      )}

      <RenameRecordingDialog bundle={renaming} onClose={() => setRenaming(null)} />
      <DeleteRecordingDialog bundle={deleting} onClose={() => setDeleting(null)} />
      <SpeakersDialog bundle={naming} onClose={() => setNaming(null)} />
      <TeamsTranscriptDialog request={teams} onClose={() => setTeams(null)} />
      <ReplaceTranscriptDialog pending={pendingWrite} onClose={() => setPendingWrite(null)} />
    </div>
  );
}
