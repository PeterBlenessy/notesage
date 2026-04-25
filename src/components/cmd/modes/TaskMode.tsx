import { useEffect, useMemo, useRef, useState } from "react";
import { Square } from "lucide-react";
import { tauriApi, type IndexedTask } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";
import type { AttachmentChip } from "@/components/cmd/AttachmentChips";

/**
 * TaskMode — picker for the `!` prefix in the FloatingCommandBar
 * (PRD `2026-04-21-ui-refresh`, Phase 1, task #17).
 *
 * Reads open (unchecked) tasks from the SQLite document index. The picker is
 * pure presentation: it surfaces tasks and emits a discriminated `TaskAction`
 * via `onPick`. The parent decides whether to navigate to the task's source
 * location or attach a chip to the chat composer based on `isComposing`.
 *
 * Why `onPick` is the only output: the FloatingCommandBar parent owns
 * dispatch — it knows whether there's an active chat with composing text and
 * whether to attach vs navigate. Keeping that decision in the parent means
 * the picker stays a leaf component and the dispatch path is trivial to test
 * independently.
 *
 * NOTE: The picker emits both navigate AND attach variants. The `isComposing`
 * prop only controls the *default* shape emitted on click/Enter — the parent
 * is the source of truth at dispatch time.
 *
 * NOTE on data source: we reuse the existing `index_tasks` Tauri command via
 * `tauriApi.indexTasks(...)`. That query orders by file name + position, not
 * recency — adding a true recency index is a separate backend task and not
 * required for this picker. (See `src-tauri/src/index/queries.rs::query_tasks`.)
 */

export type TaskAction =
  | { kind: "navigate"; filePath: string; line: number }
  | { kind: "attach"; chip: AttachmentChip };

interface TaskModeProps {
  /** Text typed after the `!` prefix. Empty string shows top tasks. */
  filter: string;
  /**
   * Caller decides which action to take based on its own state. The picker
   * emits BOTH a navigation hint AND a chip — the parent picks one based on
   * chat state at dispatch time.
   */
  onPick: (action: TaskAction) => void;
  /**
   * Whether there's an active chat with composing text. Determines the
   * default action (navigate vs attach). The picker still emits the
   * appropriate variant; this prop just controls the default Enter behaviour.
   */
  isComposing: boolean;
  onDismiss?: () => void;
  /**
   * DOM id used as the listbox's `id` attribute and as the prefix for option
   * ids. Enables the parent `FloatingCommandBar` to wire `aria-controls` and
   * `aria-activedescendant` on its combobox input.
   */
  listboxId?: string;
  /**
   * Fires whenever the active option / result count changes. Lets the parent
   * FloatingCommandBar keep `aria-activedescendant` in sync without the
   * picker moving DOM focus away from the input.
   */
  onActiveOptionChange?: (info: {
    listboxId: string;
    activeOptionId: string | null;
    count: number;
  }) => void;
}

/** Maximum number of rows shown — keeps the popover scannable. */
const MAX_RESULTS = 10;

/** Truncate task text to this many chars for the chip name (and visual cap). */
const NAME_TRUNCATE = 80;

/** Lightweight row shape — only what we render. */
interface TaskRow {
  id: string;
  text: string;
  filePath: string;
  fileName: string;
  line: number;
  projectName?: string;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function indexedTaskToRow(t: IndexedTask): TaskRow {
  return {
    id: `${t.path}:${t.position}`,
    text: t.text,
    filePath: t.path,
    // Prefer the indexed `file_name`; fall back to the path basename so
    // callers that synthesize tasks (or older index rows) still display.
    fileName: t.file_name && t.file_name.length > 0 ? t.file_name : basename(t.path),
    // The SQLite index stores `position` as a 0-based offset into the
    // document. We surface it as the navigation target — callers translate
    // this into a line number / cursor position when opening the file.
    line: t.position,
    projectName: t.project_name,
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function TaskMode({
  filter,
  onPick,
  isComposing,
  onDismiss,
  listboxId = 'cmd-task-listbox',
  onActiveOptionChange,
}: TaskModeProps) {
  // Pull scan paths from the workspace + library root. Mirrors the subset of
  // `getAllScanPaths()` from action-store but keeps the picker self-contained.
  //
  // Select the RAW arrays (stable references — Zustand holds the same object
  // identity until the underlying data changes) and derive the path-only
  // lists with useMemo. Calling `.map()` inside the selector would return
  // a new array on every render and trigger "getSnapshot should be cached"
  // errors under React 19 / throw a "Maximum update depth exceeded"
  // infinite-loop exception. This is the pattern flagged in
  // `feedback_perf_store_selectors.md` and was the root cause of the
  // 2026-04-24 ⌘1 crash that live-tested #114.
  const projects = useWorkspaceStore((s) => s.projects);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const projectPaths = useMemo(() => projects.map((p) => p.path), [projects]);
  const explorerFolderPaths = useMemo(
    () => explorerFolders.map((f) => f.path),
    [explorerFolders],
  );

  const scanPaths = useMemo(() => {
    const paths: string[] = [...projectPaths, ...explorerFolderPaths];
    if (notesRootPath) paths.push(notesRootPath);
    return [...new Set(paths)];
  }, [projectPaths, explorerFolderPaths, notesRootPath]);

  const [rows, setRows] = useState<TaskRow[]>([]);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fire the index query whenever the filter or scan-path set changes. We
  // pass `done: false` so only open tasks come back, and `query` for
  // server-side substring matching when there's a filter.
  //
  // The current `query_tasks` SQL filter is case-sensitive (`LIKE %q%`), so
  // we keep an additional client-side case-insensitive filter as a belt &
  // suspenders pass — it's also what makes the picker feel fast for small
  // local refinements without bouncing through IPC again.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const trimmed = filter.trim();
        const tasks = await tauriApi.indexTasks(
          scanPaths,
          /* done */ false,
          trimmed.length > 0 ? trimmed : undefined,
          /* limit */ MAX_RESULTS * 4,
        );
        if (cancelled) return;
        const mapped = tasks.map(indexedTaskToRow);
        const filtered =
          trimmed.length > 0
            ? mapped.filter((r) =>
                r.text.toLowerCase().includes(trimmed.toLowerCase()),
              )
            : mapped;
        setRows(filtered.slice(0, MAX_RESULTS));
        setHighlight(0);
      } catch {
        // Index not yet built or query failed — show empty state.
        if (!cancelled) {
          setRows([]);
          setHighlight(0);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [filter, scanPaths]);

  // Report active option state upward so the parent can mirror it on its
  // combobox input via aria-activedescendant.
  useEffect(() => {
    if (!onActiveOptionChange) return;
    const activeOptionId =
      rows.length > 0 ? `${listboxId}-opt-${highlight}` : null;
    onActiveOptionChange({
      listboxId,
      activeOptionId,
      count: rows.length,
    });
  }, [onActiveOptionChange, listboxId, highlight, rows.length]);

  // Keyboard navigation. The picker is typically mounted in a popover whose
  // text input lives elsewhere (the FloatingCommandBar input field), so we
  // attach to `window` rather than the picker root — that way ↑/↓/Enter
  // reach us regardless of which DOM node has focus. The listener cleans up
  // on unmount.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (rows.length === 0 ? 0 : (h + 1) % rows.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) =>
          rows.length === 0 ? 0 : (h - 1 + rows.length) % rows.length,
        );
      } else if (e.key === "Enter") {
        if (rows[highlight]) {
          e.preventDefault();
          dispatch(rows[highlight]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [rows, highlight, onDismiss, isComposing]);

  function dispatch(row: TaskRow) {
    if (isComposing) {
      const chip: AttachmentChip = {
        id: row.id,
        kind: "task",
        name: truncate(row.text, NAME_TRUNCATE),
      };
      onPick({ kind: "attach", chip });
    } else {
      onPick({ kind: "navigate", filePath: row.filePath, line: row.line });
    }
  }

  return (
    <div
      ref={containerRef}
      id={listboxId}
      tabIndex={-1}
      className={cn(
        "flex flex-col py-1 outline-none",
        "min-w-[320px] max-w-[480px]",
      )}
      role="listbox"
      aria-label="Open tasks"
    >
      {rows.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          No open tasks match
        </div>
      ) : (
        rows.map((row, index) => {
          const active = index === highlight;
          return (
            <button
              key={row.id}
              id={`${listboxId}-opt-${index}`}
              type="button"
              data-task-row
              data-active={active ? "true" : undefined}
              role="option"
              aria-selected={active}
              onClick={() => dispatch(row)}
              onMouseEnter={() => setHighlight(index)}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-1.5 text-left",
                "text-sm transition-colors",
                "hover:bg-muted/60",
                active && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              )}
            >
              <Square
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-foreground">
                  {truncate(row.text, NAME_TRUNCATE)}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {row.fileName}:{row.line}
                </span>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}

export default TaskMode;
