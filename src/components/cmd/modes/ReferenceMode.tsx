import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  FileText,
  MessageSquare,
  User,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  tauriApi,
  type FileEntry,
  type IndexedMention,
  type IndexTagOccurrence,
} from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useCommentStore } from "@/stores/comment-store";
import { selectProjectPaths, useChatStore } from "@/stores/chat-store";
import type { AttachmentChip } from "@/components/cmd/AttachmentChips";

/**
 * ReferenceMode — picker for the `@` prefix of the FloatingCommandBar.
 *
 * Surfaces a unified list of references the user can attach to the
 * composer:
 *
 *   - Files     — workspace file index (project / explorer / notes trees)
 *   - People    — SQLite mention index (`@bob` → mention name + file count)
 *   - Comments  — `comment-store.commentsByDocument` (per-document arrays)
 *
 * Each row carries a kind badge so the user can tell sources apart at a
 * glance. Up to 8 rows are shown, mixed proportionally — when one source
 * has fewer hits, the remainder is filled from the others. Empty filter
 * shows the top hits from each source.
 *
 * The component is **purely presentational** with respect to the bar:
 *   - It does not own input focus.
 *   - It does not mutate the input value.
 *   - On click / Enter it fires `onPick(chip)`; the parent inserts the chip
 *     into `AttachmentChips` and clears the `@…` token from the input.
 *
 * Wiring map: this is task #15 from `docs/tasks/2026-04-21-ui-refresh-phase1-tasks.md`.
 * The parent `FloatingCommandBar` will dispatch into this picker once all
 * six mode pickers (#14–#19) have landed.
 */

const MAX_RESULTS = 8;
const PER_SOURCE_QUOTA = 3;

/**
 * Live-test 2026-04-26 (slice 2) — `@person` drilldown.
 *
 * When the user picks a person at level 1, ReferenceMode drills into the
 * file occurrences of that mention (legacy palette parity). The level-2
 * pick fires a separate callback (`onPickOccurrence`) that carries the
 * full navigate payload. File / comment picks still fire the original
 * `onPick(chip)` — file → open file directly, comment → no-op for now.
 */
export type ReferenceOccurrenceAction = {
  filePath: string;
  fileName: string;
  /** The full `@mention` symbol — matches `useFileOperations.openFileAtTag`. */
  symbol: string;
  occurrenceInFile: number;
};

interface ReferenceModeProps {
  /** Text typed after the `@` prefix (e.g. "alic" for `@alic`). */
  filter: string;
  /** Called when the user picks a file or comment reference. */
  onPick: (chip: AttachmentChip) => void;
  /**
   * Called when the user picks an occurrence inside a person's drilldown.
   * Optional so existing callers (tests, legacy code paths) keep working.
   */
  onPickOccurrence?: (action: ReferenceOccurrenceAction) => void;
  /**
   * When set, mounts the picker directly at the level-2 (person
   * occurrences) view for the given mention name. Used by sidebar
   * MentionsSection so a single click jumps from row to occurrences.
   */
  initialPersonDrilldown?: string | null;
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

type ResultKind = "file" | "person" | "comment";

interface ReferenceResult {
  /** Stable id used as React key + chip id. */
  id: string;
  kind: ResultKind;
  /** Visible primary label. */
  name: string;
  /** Optional muted secondary text (file path, mention count, snippet). */
  detail?: string;
  /** Pre-built chip handed to `onPick`. */
  chip: AttachmentChip;
}

const KIND_META: Record<ResultKind, { label: string; icon: LucideIcon }> = {
  file: { label: "File", icon: FileText },
  person: { label: "Person", icon: User },
  comment: { label: "Comment", icon: MessageSquare },
};

// ---------------------------------------------------------------------------
// Source loaders — pure functions over the relevant store / IPC slice.
// Each returns at most `limit` results matching `filter`.
// ---------------------------------------------------------------------------

function flattenFiles(entries: FileEntry[], out: FileEntry[]): void {
  for (const entry of entries) {
    if (!entry.is_directory) out.push(entry);
    if (entry.children) flattenFiles(entry.children, out);
  }
}

function loadFileResults(
  filter: string,
  workspaceFiles: FileEntry[],
  limit: number,
): ReferenceResult[] {
  const q = filter.trim().toLowerCase();
  const out: ReferenceResult[] = [];
  const seen = new Set<string>();
  for (const file of workspaceFiles) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    if (q.length > 0) {
      const haystack = `${file.name}\n${file.path}`.toLowerCase();
      if (!haystack.includes(q)) continue;
    }
    out.push({
      id: `file:${file.path}`,
      kind: "file",
      name: file.name,
      detail: file.path,
      chip: { id: `file:${file.path}`, kind: "file", name: file.name },
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function loadPersonResults(
  filter: string,
  projectPaths: string[],
  limit: number,
): Promise<ReferenceResult[]> {
  // The mention index is scoped per-project. When no projects are selected,
  // pass an empty array — the backend treats this as "no results" rather
  // than throwing, and we degrade gracefully to the other two sources.
  let mentions: IndexedMention[] = [];
  try {
    mentions = await tauriApi.indexMentions(
      projectPaths,
      filter.trim() ? filter.trim() : undefined,
    );
  } catch {
    // Index not initialised yet, or an out-of-scope path was passed —
    // silently degrade. A toast here would be noisy on every keystroke.
    mentions = [];
  }
  const out: ReferenceResult[] = [];
  for (const m of mentions) {
    out.push({
      id: `person:${m.mention}`,
      kind: "person",
      name: m.mention,
      detail:
        m.file_count === 1 ? "1 mention" : `${m.file_count} mentions`,
      chip: { id: `person:${m.mention}`, kind: "person", name: m.mention },
    });
    if (out.length >= limit) break;
  }
  return out;
}

function loadCommentResults(
  filter: string,
  commentsByDocument: Record<
    string,
    Array<{ id: string; body: string; documentId: string }>
  >,
  limit: number,
): ReferenceResult[] {
  const q = filter.trim().toLowerCase();
  const out: ReferenceResult[] = [];
  for (const docId of Object.keys(commentsByDocument)) {
    for (const c of commentsByDocument[docId]) {
      const body = c.body ?? "";
      if (q.length > 0 && !body.toLowerCase().includes(q)) continue;
      const truncated = body.length > 80 ? `${body.slice(0, 77)}…` : body;
      out.push({
        id: `comment:${c.id}`,
        kind: "comment",
        name: truncated || "(empty comment)",
        detail: undefined,
        chip: {
          id: c.id,
          kind: "comment",
          name: truncated || "(empty comment)",
        },
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mixing — pull `quota` from each, then top up the shortfall from whichever
// sources still have results so we always render up to `MAX_RESULTS`.
// ---------------------------------------------------------------------------

function mixResults(
  files: ReferenceResult[],
  people: ReferenceResult[],
  comments: ReferenceResult[],
): ReferenceResult[] {
  const initial = [
    ...files.slice(0, PER_SOURCE_QUOTA),
    ...people.slice(0, PER_SOURCE_QUOTA),
    ...comments.slice(0, PER_SOURCE_QUOTA),
  ].slice(0, MAX_RESULTS);

  if (initial.length >= MAX_RESULTS) {
    return initial;
  }

  // Top up from leftovers in source order: files → people → comments.
  const takenIds = new Set(initial.map((r) => r.id));
  const leftovers = [
    ...files.slice(PER_SOURCE_QUOTA),
    ...people.slice(PER_SOURCE_QUOTA),
    ...comments.slice(PER_SOURCE_QUOTA),
  ];
  for (const r of leftovers) {
    if (takenIds.has(r.id)) continue;
    initial.push(r);
    takenIds.add(r.id);
    if (initial.length >= MAX_RESULTS) break;
  }
  return initial;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ReferenceMode({
  filter,
  onPick,
  onPickOccurrence,
  initialPersonDrilldown,
  listboxId = 'cmd-reference-listbox',
  onActiveOptionChange,
}: ReferenceModeProps) {
  // Workspace file tree slices.
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);
  const projects = useWorkspaceStore((s) => s.projects);
  const notesTree = useWorkspaceStore((s) => s.notesTree);

  // Comments — keyed by documentId; we flatten across all open documents.
  const commentsByDocument = useCommentStore((s) => s.commentsByDocument);

  // Active conversation's project scope. Drives the mention-index call so we
  // only surface people from projects the user actually has selected.
  const projectPaths = useChatStore(selectProjectPaths);

  const workspaceFiles = useMemo(() => {
    const acc: FileEntry[] = [];
    for (const folder of explorerFolders) flattenFiles(folder.fileTree, acc);
    for (const project of projects) flattenFiles(project.fileTree, acc);
    flattenFiles(notesTree, acc);
    return acc;
  }, [explorerFolders, projects, notesTree]);

  const [people, setPeople] = useState<ReferenceResult[]>([]);
  // Files & comments are sync, so we recompute inline. People is async (IPC).
  // We deliberately don't debounce here — the picker mounts only when the
  // user is mid-typing the @-token, and the SQLite index is fast enough that
  // 150 ms debouncing would feel laggy on local data.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await loadPersonResults(filter, projectPaths, MAX_RESULTS);
      if (!cancelled) setPeople(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, projectPaths]);

  const files = useMemo(
    () => loadFileResults(filter, workspaceFiles, MAX_RESULTS),
    [filter, workspaceFiles],
  );

  const comments = useMemo(
    () => loadCommentResults(filter, commentsByDocument, MAX_RESULTS),
    [filter, commentsByDocument],
  );

  const results = useMemo(
    () => mixResults(files, people, comments),
    [files, people, comments],
  );

  // Auto-highlight the first row. Reset whenever the result *identity set*
  // changes (i.e. a different list of result ids) — not on every new array
  // reference, so a re-mix that produces the same ids doesn't yank the
  // selection back to 0 mid-keystroke.
  //
  // We keep both a state (for re-rendering the highlighted row) and a ref
  // (so the keydown handler reads the current value without going through
  // the memoised closure — important when two key events fire back-to-back).
  const [highlightIndex, setHighlightIndex] = useState(0);
  const highlightRef = useRef(0);
  const setHighlight = useCallback((next: number) => {
    highlightRef.current = next;
    setHighlightIndex(next);
  }, []);
  const resultsKey = useMemo(() => results.map((r) => r.id).join("|"), [results]);
  useEffect(() => {
    setHighlight(0);
    // resultsKey is the dependency we actually care about; results is the
    // referentially-changing array we'd otherwise depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsKey]);

  // Report active option state upward so the parent can mirror it on its
  // combobox input via aria-activedescendant.
  useEffect(() => {
    if (!onActiveOptionChange) return;
    const activeOptionId =
      results.length > 0 ? `${listboxId}-opt-${highlightIndex}` : null;
    onActiveOptionChange({
      listboxId,
      activeOptionId,
      count: results.length,
    });
  }, [onActiveOptionChange, listboxId, highlightIndex, results.length]);

  // Live-test 2026-04-26 (slice 2) — `@person` drilldown state. Picking
  // a person at level 1 does NOT fire `onPick` immediately; instead we
  // drill into the mention's file occurrences and fire
  // `onPickOccurrence` once the user picks a specific row at level 2.
  // Files / comments still fire `onPick(chip)` directly (no drilldown
  // needed — files ARE files; comments are out of scope for v1).
  const [selectedPerson, setSelectedPerson] = useState<string | null>(
    initialPersonDrilldown ?? null,
  );

  // Re-sync when the drilldown seed changes (sidebar click on a different
  // mention while the bar is already open).
  useEffect(() => {
    if (initialPersonDrilldown != null) {
      setSelectedPerson(initialPersonDrilldown);
    }
  }, [initialPersonDrilldown]);
  const [occurrences, setOccurrences] = useState<IndexTagOccurrence[]>([]);
  const [occHighlighted, setOccHighlighted] = useState(0);
  const occReqIdRef = useRef(0);

  useEffect(() => {
    if (selectedPerson === null) {
      setOccurrences([]);
      return;
    }
    const reqId = ++occReqIdRef.current;
    tauriApi
      .indexMentionOccurrences(selectedPerson, projectPaths)
      .then((rows) => {
        if (reqId !== occReqIdRef.current) return;
        setOccurrences(rows);
        setOccHighlighted(0);
      })
      .catch(() => {
        if (reqId !== occReqIdRef.current) return;
        setOccurrences([]);
      });
  }, [selectedPerson, projectPaths]);

  const handlePick = useCallback(
    (result: ReferenceResult) => {
      if (result.kind === "person") {
        // Drill into level 2 — the picker stays mounted; fetch effect
        // above triggers and the level-2 render branch takes over.
        const personName = result.id.startsWith("person:")
          ? result.id.slice("person:".length)
          : result.name;
        setSelectedPerson(personName);
        return;
      }
      onPick(result.chip);
    },
    [onPick],
  );

  const listRef = useRef<HTMLDivElement | null>(null);

  // Live-test 2026-04-26 — listen on `window` so arrow / Enter fire even
  // while the parent FloatingCommandBar's textarea owns focus. Capture
  // phase so Esc at level 2 (drilldown back) beats the bar's window
  // dismiss handler.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Level 2 — person occurrences
      if (selectedPerson !== null) {
        if (event.key === "ArrowDown") {
          if (occurrences.length === 0) return;
          event.preventDefault();
          setOccHighlighted((h) => Math.min(h + 1, occurrences.length - 1));
        } else if (event.key === "ArrowUp") {
          if (occurrences.length === 0) return;
          event.preventDefault();
          setOccHighlighted((h) => Math.max(h - 1, 0));
        } else if (event.key === "Enter") {
          if (occurrences.length === 0) return;
          event.preventDefault();
          const occ = occurrences[occHighlighted];
          if (!occ || !onPickOccurrence) return;
          onPickOccurrence({
            filePath: occ.path,
            fileName: occ.file_name,
            symbol: `@${selectedPerson}`,
            occurrenceInFile: occHighlighted,
          });
        } else if (event.key === "Escape") {
          // Esc at level 2 → back to level 1 (don't dismiss the bar).
          event.preventDefault();
          event.stopPropagation();
          setSelectedPerson(null);
        }
        return;
      }

      // Level 1 — mixed references
      if (results.length === 0) return;
      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const next = (highlightRef.current + 1) % results.length;
          setHighlight(next);
          return;
        }
        case "ArrowUp": {
          event.preventDefault();
          const next =
            (highlightRef.current - 1 + results.length) % results.length;
          setHighlight(next);
          return;
        }
        case "Enter":
          event.preventDefault();
          handlePick(results[highlightRef.current]);
          return;
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    results,
    handlePick,
    setHighlight,
    selectedPerson,
    occurrences,
    occHighlighted,
    onPickOccurrence,
  ]);

  // ---------------------------------------------------------------------
  // Level 2 — person drilldown (occurrences across files)
  // ---------------------------------------------------------------------
  if (selectedPerson !== null) {
    return (
      <div
        data-reference-list
        data-cmd-mode-level="occurrences"
        id={`${listboxId}-occ`}
        role="listbox"
        aria-label={`Occurrences of @${selectedPerson}`}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
          <button
            type="button"
            onClick={() => setSelectedPerson(null)}
            aria-label="Back to references"
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
              "text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60",
              "transition-colors",
            )}
          >
            <ChevronLeft className="h-3 w-3" strokeWidth={1.5} />
            <span>Back</span>
          </button>
          <span className="text-[13px] font-medium">@{selectedPerson}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {occurrences.length === 1
              ? "1 file"
              : `${occurrences.length} files`}
          </span>
        </div>
        {occurrences.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            No occurrences found
          </div>
        ) : (
          <ul className="py-1">
            {occurrences.map((occ, idx) => {
              const selected = idx === occHighlighted;
              return (
                <li
                  key={`${occ.path}-${idx}`}
                  id={`${listboxId}-occ-${idx}`}
                  role="option"
                  aria-selected={selected ? "true" : "false"}
                  onMouseEnter={() => setOccHighlighted(idx)}
                  onClick={() =>
                    onPickOccurrence?.({
                      filePath: occ.path,
                      fileName: occ.file_name,
                      symbol: `@${selectedPerson}`,
                      occurrenceInFile: idx,
                    })
                  }
                  className={cn(
                    "flex items-start gap-2 px-3 py-1.5 cursor-pointer",
                    "text-[13px] transition-colors",
                    selected
                      ? "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]"
                      : "text-foreground hover:bg-muted/60",
                  )}
                >
                  <FileText
                    size={12}
                    strokeWidth={1.5}
                    className={cn(
                      "mt-[3px] shrink-0",
                      selected
                        ? "text-[oklch(100%_0_0)]/85"
                        : "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">
                      {occ.file_name}
                    </span>
                    {(occ.context_before || occ.context_after) && (
                      <span
                        className={cn(
                          "truncate text-xs",
                          selected
                            ? "text-[oklch(100%_0_0)]/75"
                            : "text-muted-foreground",
                        )}
                      >
                        …{occ.context_before}
                        <span
                          className={cn(
                            "font-medium",
                            selected
                              ? "text-[oklch(100%_0_0)]"
                              : "text-foreground",
                          )}
                        >
                          @{selectedPerson}
                        </span>
                        {occ.context_after}…
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Level 1 — mixed references (files + people + comments)
  // ---------------------------------------------------------------------
  return (
    <div
      ref={listRef}
      id={listboxId}
      data-reference-list
      role="listbox"
      aria-label="References"
      tabIndex={-1}
      className={cn(
        "py-1",
        "focus:outline-none",
      )}
    >
      {results.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
          No matches
        </div>
      ) : (
        results.map((r, i) => (
          <ResultRow
            key={r.id}
            id={`${listboxId}-opt-${i}`}
            result={r}
            highlighted={i === highlightIndex}
            onMouseEnter={() => setHighlightIndex(i)}
            onClick={() => handlePick(r)}
          />
        ))
      )}
    </div>
  );
}

interface ResultRowProps {
  id: string;
  result: ReferenceResult;
  highlighted: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}

function ResultRow({
  id,
  result,
  highlighted,
  onClick,
  onMouseEnter,
}: ResultRowProps) {
  const meta = KIND_META[result.kind];
  const Icon = meta.icon;

  return (
    <div
      id={id}
      data-result-kind={result.kind}
      role="option"
      aria-selected={highlighted}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        // Density (live-test 2026-04-26).
        "flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[13px]",
        "transition-colors",
        highlighted
          ? "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]"
          : "text-foreground hover:bg-muted/60",
      )}
    >
      <Icon
        className={cn(
          "h-3 w-3 shrink-0",
          highlighted
            ? "text-[oklch(100%_0_0)]/85"
            : "text-muted-foreground",
        )}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span
        className={cn(
          "shrink-0 rounded px-1 py-px text-[10px] uppercase tracking-wide",
          highlighted
            ? "bg-[oklch(100%_0_0)]/15 text-[oklch(100%_0_0)]/85"
            : "border border-border bg-muted/40 text-muted-foreground",
        )}
      >
        {meta.label}
      </span>
      <span className="truncate">{result.name}</span>
      {result.detail ? (
        <span
          className={cn(
            "ml-auto truncate text-xs",
            highlighted
              ? "text-[oklch(100%_0_0)]/75"
              : "text-muted-foreground",
          )}
        >
          {result.detail}
        </span>
      ) : null}
    </div>
  );
}

export default ReferenceMode;
