import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckSquare2,
  FolderKanban,
  FolderOpen,
  Layers,
  List,
  ListChecks,
  MessageSquare,
  Square,
  StickyNote,
  Target,
} from "lucide-react";
import {
  useActionStore,
  type ActionItem,
  type ActionSourceType,
  type ActionStatus,
} from "@/stores/action-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AttachmentChip } from "@/components/cmd/AttachmentChips";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

/**
 * TaskMode — picker for the `!` prefix in the FloatingCommandBar
 * (PRD `2026-04-21-ui-refresh`, Phase 1, task #17).
 *
 * Rebuilt 2026-04-26 to reach ActionsDialog parity: tasks, comments,
 * agent tasks, and goals are all surfaced through the same picker, with the
 * same Type / Status / Project filters as the dashboard. Source of truth is
 * the existing `useActionStore` — we DON'T re-implement scanning, status
 * toggling, or filtering. The picker is a thin presentation layer on top of
 * `getFilteredActions()`.
 *
 * Why `onPick` is the only output: the FloatingCommandBar parent owns
 * dispatch — it knows how to route a navigation event for any source type
 * (tasks / goals / comments / agents all open the source file at the right
 * spot). Keeping that decision in the parent means the picker stays a leaf
 * component and the dispatch path is trivial to test independently.
 */

export type TaskAction =
  | { kind: "navigate"; filePath: string; line: number; text: string }
  | { kind: "attach"; chip: AttachmentChip };

interface TaskModeProps {
  /** Text typed after the `!` prefix. Empty string shows top tasks. */
  filter: string;
  /**
   * Caller decides which action to take based on its own state. The picker
   * always emits a navigation hint — the parent decides what to do with it.
   */
  onPick: (action: TaskAction) => void;
  /**
   * Whether there's an active chat with composing text. Retained on the
   * props interface for parity with the other prefix pickers — the picker
   * itself no longer reads this (selection always navigates per the
   * 2026-04-26 live-test direction).
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
const MAX_RESULTS = 12;

/** Truncate text to this many chars in the row's primary label. */
const NAME_TRUNCATE = 80;

/** Source-type → glyph (mirrors ActionItemRow / ActionFilterBar). */
const SOURCE_ICONS: Record<ActionSourceType, typeof Square> = {
  task: Square,
  comment: MessageSquare,
  agent: Bot,
  goal: Target,
};

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

/** Compute a stable `fileName:line` secondary label for any action type. */
function actionSecondaryLabel(a: ActionItem): string {
  const file = a.file_path ? basename(a.file_path) : "";
  if (!file) return "";
  return a.line_number ? `${file}:${a.line_number}` : file;
}

/**
 * Status-filter buckets. We mirror the ActionFilterBar's `open`/`done`
 * grouping (delegated/pending/running roll up into "open") — that's how the
 * dashboard exposes status to users. The store still supports the full
 * granular set under the hood.
 */
const STATUS_BUCKETS = {
  all: [
    "open",
    "done",
    "delegated",
    "pending",
    "running",
    "completed",
    "error",
  ] as ActionStatus[],
  open: ["open", "delegated", "pending", "running"] as ActionStatus[],
  done: ["done", "completed"] as ActionStatus[],
};

function deriveStatusValue(filterStatus: ActionStatus[]): "all" | "open" | "done" {
  if (filterStatus.length >= STATUS_BUCKETS.all.length) return "all";
  const hasOpen = filterStatus.some((s) =>
    STATUS_BUCKETS.open.includes(s),
  );
  const hasDone = filterStatus.some((s) =>
    STATUS_BUCKETS.done.includes(s),
  );
  if (hasOpen && !hasDone) return "open";
  if (hasDone && !hasOpen) return "done";
  return "all";
}

function deriveSourceValue(
  filterSourceType: ActionSourceType[],
): "all" | ActionSourceType {
  if (filterSourceType.length >= 4) return "all";
  if (filterSourceType.length === 1) return filterSourceType[0];
  return "all";
}

function TaskMode({
  filter,
  onPick,
  isComposing: _isComposing,
  onDismiss,
  listboxId = "cmd-task-listbox",
  onActiveOptionChange,
}: TaskModeProps) {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  void _isComposing; // retained on the prop interface for parity

  // ---- Store reads ------------------------------------------------------
  // Subscribe to the raw `actions` array + `filter` shape (stable refs from
  // Zustand). We DON'T destructure the store — pulling each field with its
  // own selector keeps re-renders narrow (`feedback_perf_store_selectors.md`).
  const actions = useActionStore((s) => s.actions);
  const storeFilter = useActionStore((s) => s.filter);
  const setFilter = useActionStore((s) => s.setFilter);
  // `getFilteredActions` is a method, not a selector. Call it whenever
  // `actions` or `filter` change to derive the visible list.
  const getFilteredActions = useActionStore((s) => s.getFilteredActions);

  // Project list (for the Project select). Stable refs; derived path arrays
  // memoized so the select options don't churn each render.
  const projects = useWorkspaceStore((s) => s.projects);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);

  const allRoots = useMemo(() => {
    const seen = new Set<string>();
    const roots: {
      path: string;
      label: string;
      kind: "project" | "folder" | "notes";
    }[] = [];
    for (const p of projects) {
      if (!seen.has(p.path)) {
        seen.add(p.path);
        roots.push({
          path: p.path,
          label: p.path.split("/").pop() ?? p.path,
          kind: "project",
        });
      }
    }
    for (const f of explorerFolders) {
      if (!seen.has(f.path)) {
        seen.add(f.path);
        roots.push({
          path: f.path,
          label: f.path.split("/").pop() ?? f.path,
          kind: "folder",
        });
      }
    }
    if (notesRootPath && !seen.has(notesRootPath)) {
      roots.push({
        path: notesRootPath,
        label: "Quick Notes",
        kind: "notes",
      });
    }
    return roots;
  }, [projects, explorerFolders, notesRootPath]);

  // ---- Filter prop → store search --------------------------------------
  // The cmd-bar's typed query (after the `!` prefix) feeds the same
  // `filter.search` field the dashboard uses. Debounce so rapid typing
  // doesn't churn `getFilteredActions()` callers.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter({ search: filter });
    }, 100);
    return () => clearTimeout(timer);
  }, [filter, setFilter]);

  // Reset the search component when the picker unmounts so leaving `!` mode
  // doesn't leave the dashboard with a stale search filter.
  useEffect(() => {
    return () => {
      setFilter({ search: "" });
    };
  }, [setFilter]);

  // ---- Derived rows -----------------------------------------------------
  // `getFilteredActions` reads from the live store on each call. Re-evaluate
  // whenever `actions`, `storeFilter`, or `getFilteredActions` change.
  const filtered = useMemo(
    () => getFilteredActions(),
    // The store mutates `actions` and `filter` together — re-reading on
    // either change keeps the picker in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getFilteredActions, actions, storeFilter],
  );

  const rows = useMemo(() => filtered.slice(0, MAX_RESULTS), [filtered]);

  // Group rows by project (mirrors ActionsDashboard at src/components/actions/
  // ActionsDashboard.tsx:60-70). Items without a `project_root` collect under
  // an `ungrouped` bucket that renders LAST as "Quick Notes". Iteration order
  // of the Map is insertion order, so to put `ungrouped` last we insert it
  // after all named project keys regardless of when the items themselves
  // arrive in `rows`.
  //
  // The `highlight` index continues to address `rows` directly — render-time
  // group rendering computes the absolute row index via a running counter so
  // arrow-key navigation walks every visible row in order across groups.
  const groupedRows = useMemo(() => {
    const map = new Map<string, ActionItem[]>();
    for (const item of rows) {
      const key = item.project_root ?? 'ungrouped';
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    // Re-order so 'ungrouped' is always last.
    if (map.has('ungrouped')) {
      const ungrouped = map.get('ungrouped')!;
      map.delete('ungrouped');
      map.set('ungrouped', ungrouped);
    }
    return map;
  }, [rows]);

  // ---- Counts (for filter-button badges) -------------------------------
  const typeCounts = useMemo(() => {
    let task = 0;
    let comment = 0;
    let agent = 0;
    let goal = 0;
    for (const a of actions) {
      if (a.source_type === "task") task++;
      else if (a.source_type === "comment") comment++;
      else if (a.source_type === "agent") agent++;
      else if (a.source_type === "goal") goal++;
    }
    return { task, comment, agent, goal, all: task + comment + agent + goal };
  }, [actions]);

  const statusCounts = useMemo(() => {
    let open = 0;
    let done = 0;
    for (const a of actions) {
      if (
        a.status === "open" ||
        a.status === "delegated" ||
        a.status === "pending" ||
        a.status === "running"
      ) {
        open++;
      } else if (a.status === "done" || a.status === "completed") {
        done++;
      }
    }
    return { open, done, all: open + done };
  }, [actions]);

  // ---- Highlight + keyboard navigation ---------------------------------
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset highlight when the visible rows change (filter typed, type
  // changed, etc.).
  useEffect(() => {
    setHighlight(0);
  }, [rows]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, highlight, onDismiss]);

  function dispatch(action: ActionItem) {
    // Selection always navigates — prefix pickers are navigation intents
    // (live-test 2026-04-26). Tasks / goals / comments / agents all carry
    // a `file_path` + `text`; the parent's `notesage:open-file` listener
    // jumps to the right spot via `scrollToText`. Agents without a source
    // file (`file_path === ""`) fall through to a no-op navigate.
    onPick({
      kind: "navigate",
      filePath: action.file_path,
      line: action.line_number ?? 0,
      text: action.text,
    });
  }

  // ---- Filter handlers (mirror ActionFilterBar) ------------------------
  const sourceValue = deriveSourceValue(storeFilter.sourceType);
  const statusValue = deriveStatusValue(storeFilter.status);

  function handleSourceType(value: string) {
    if (value === "all") {
      setFilter({ sourceType: ["task", "comment", "agent", "goal"] });
    } else {
      setFilter({ sourceType: [value as ActionSourceType] });
    }
  }

  function handleStatus(value: string) {
    if (value === "open") {
      setFilter({ status: STATUS_BUCKETS.open });
    } else if (value === "done") {
      setFilter({ status: STATUS_BUCKETS.done });
    } else {
      setFilter({ status: STATUS_BUCKETS.all });
    }
  }

  function handleProject(value: string) {
    setFilter({ project: value === "all" ? null : value });
  }

  return (
    <div
      ref={containerRef}
      id={listboxId}
      tabIndex={-1}
      className={cn("flex w-full flex-col py-1 outline-none")}
      role="listbox"
      aria-label={t("cmd.openActions")}
    >
      {/* ---- Filter row ---- */}
      {/*
        Sized for the cmd-bar's expanded width: the bar itself is ~640 px
        wide on focus, and pinned mode is wider still. Three small
        SelectTriggers + counts fit comfortably with `text-xs` density. We
        keep the row below the header padding (px-3) and above the result
        list so the typed `!query` from the cmd-bar input above remains
        the primary search affordance.
      */}
      <div className="flex items-center gap-1.5 px-3 pb-1.5 text-xs">
        <Select value={sourceValue} onValueChange={handleSourceType}>
          <SelectTrigger
            data-testid="taskmode-type-trigger"
            aria-label={t("cmd.filterByType")}
            className="h-6 w-auto min-w-[100px] gap-1 px-2 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <span className="flex items-center gap-1.5">
                <Layers
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span>{t("cmd.allTypes")}</span>
                <span className="text-muted-foreground/60">
                  {typeCounts.all}
                </span>
              </span>
            </SelectItem>
            <SelectItem value="task">
              <span className="flex items-center gap-1.5">
                <ListChecks
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span>{t("cmd.tasks")}</span>
                <span className="text-muted-foreground/60">
                  {typeCounts.task}
                </span>
              </span>
            </SelectItem>
            <SelectItem value="comment">
              <span className="flex items-center gap-1.5">
                <MessageSquare
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span>{t("cmd.comments")}</span>
                <span className="text-muted-foreground/60">
                  {typeCounts.comment}
                </span>
              </span>
            </SelectItem>
            <SelectItem value="agent">
              <span className="flex items-center gap-1.5">
                <Bot
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span>{t("cmd.agentTasks")}</span>
                <span className="text-muted-foreground/60">
                  {typeCounts.agent}
                </span>
              </span>
            </SelectItem>
            <SelectItem value="goal">
              <span className="flex items-center gap-1.5">
                <Target
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span>{t("cmd.goals")}</span>
                <span className="text-muted-foreground/60">
                  {typeCounts.goal}
                </span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusValue} onValueChange={handleStatus}>
          <SelectTrigger
            data-testid="taskmode-status-trigger"
            aria-label={t("cmd.filterByStatus")}
            className="h-6 w-auto min-w-[80px] gap-1 px-2 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">
              <span className="flex items-center gap-1.5">
                <Square
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span>Open</span>
                <span className="text-muted-foreground/60">
                  {statusCounts.open}
                </span>
              </span>
            </SelectItem>
            <SelectItem value="done">
              <span className="flex items-center gap-1.5">
                <CheckSquare2
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span>Done</span>
                <span className="text-muted-foreground/60">
                  {statusCounts.done}
                </span>
              </span>
            </SelectItem>
            <SelectItem value="all">
              <span className="flex items-center gap-1.5">
                <List
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span>All</span>
                <span className="text-muted-foreground/60">
                  {statusCounts.all}
                </span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>

        {allRoots.length > 1 && (
          <Select
            value={storeFilter.project ?? "all"}
            onValueChange={handleProject}
          >
            <SelectTrigger
              data-testid="taskmode-project-trigger"
              aria-label="Filter by project"
              className="h-6 w-auto min-w-[100px] gap-1 px-2 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {(() => {
                const projectRoots = allRoots.filter(
                  (r) => r.kind === "project",
                );
                const folderRoots = allRoots.filter((r) => r.kind === "folder");
                const notesRoots = allRoots.filter((r) => r.kind === "notes");
                return (
                  <>
                    {projectRoots.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase tracking-wider">
                          Projects
                        </SelectLabel>
                        {projectRoots.map((r) => (
                          <SelectItem key={r.path} value={r.path}>
                            <span className="flex items-center gap-1.5">
                              <FolderKanban
                                className="h-3 w-3 shrink-0 text-muted-foreground"
                                strokeWidth={1.5}
                              />
                              <span>{r.label}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {folderRoots.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase tracking-wider">
                          Folders
                        </SelectLabel>
                        {folderRoots.map((r) => (
                          <SelectItem key={r.path} value={r.path}>
                            <span className="flex items-center gap-1.5">
                              <FolderOpen
                                className="h-3 w-3 shrink-0 text-muted-foreground"
                                strokeWidth={1.5}
                              />
                              <span>{r.label}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {notesRoots.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase tracking-wider">
                          Notes
                        </SelectLabel>
                        {notesRoots.map((r) => (
                          <SelectItem key={r.path} value={r.path}>
                            <span className="flex items-center gap-1.5">
                              <StickyNote
                                className="h-3 w-3 shrink-0 text-muted-foreground"
                                strokeWidth={1.5}
                              />
                              <span>{r.label}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </>
                );
              })()}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* ---- Result list ---- */}
      {rows.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          No actions match
        </div>
      ) : (
        (() => {
          // Running index across ALL groups so arrow-key navigation maps
          // 1:1 to `highlight`. Groups are iterated in Map insertion order
          // (project keys first, `ungrouped` always last per `groupedRows`).
          let globalIndex = 0;
          const elements: React.ReactNode[] = [];

          for (const [projectRoot, items] of groupedRows.entries()) {
            if (items.length === 0) continue; // Empty groups don't render.

            const projectName =
              items[0]?.project_name ??
              projectRoot.split('/').pop() ??
              'Files';
            const label =
              projectRoot === 'ungrouped' ? 'Quick Notes' : projectName;

            // Group header — uppercase, tracking-wider, with open count.
            // Mirrors ActionsDashboard.tsx:114-123 visually but tightened
            // for the cmd-bar's narrower viewport. `aria-hidden` because
            // the header is decorative — screen readers still announce
            // each option via the listbox.
            elements.push(
              <div
                key={`header:${projectRoot}`}
                data-task-group-header
                aria-hidden="true"
                className="flex items-center gap-2 px-3 pt-2 pb-1"
              >
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {label}
                </span>
                <span className="text-[10px] text-muted-foreground/50">
                  ({items.length} open)
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>,
            );

            for (const row of items) {
              const index = globalIndex++;
              const active = index === highlight;
              const Icon = SOURCE_ICONS[row.source_type] ?? Square;
              const secondary = actionSecondaryLabel(row);
              elements.push(
                <button
                  key={row.id}
                  id={`${listboxId}-opt-${index}`}
                  type="button"
                  data-task-row
                  data-source-type={row.source_type}
                  data-active={active ? 'true' : undefined}
                  role="option"
                  aria-selected={active}
                  onClick={() => dispatch(row)}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-1.5 text-left',
                    'text-[13px] transition-colors',
                    active
                      ? 'bg-muted/80 text-foreground'
                      : 'hover:bg-muted/60 text-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  )}
                >
                  <Icon
                    className="mt-[3px] h-3 w-3 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">
                      {truncate(row.text, NAME_TRUNCATE)}
                    </span>
                    {secondary && (
                      <span className="truncate text-xs text-muted-foreground">
                        {secondary}
                      </span>
                    )}
                  </div>
                </button>,
              );
            }
          }

          return elements;
        })()
      )}
    </div>
  );
}

export default TaskMode;
