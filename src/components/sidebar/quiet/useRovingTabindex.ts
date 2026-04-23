import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

/**
 * useRovingTabindex — shared roving-tabindex + arrow navigation for a flat
 * list of sidebar rows (#80).
 *
 * Each section owns a list of stable row ids. At any time exactly one row is
 * `tabIndex={0}` (the "active" row) while the others are `tabIndex={-1}`. When
 * the section has no focus yet, the first row is returned as active so Tab
 * into the section lands on the first row. Once the user focuses a row (by
 * Tab, ArrowUp/Down, or click) the hook remembers that id across renders.
 *
 * Key contract:
 *
 *   - `getTabIndex(rowId)` → 0 for the active row, -1 otherwise.
 *   - `handleKeyDown(event, rowId)` wires ArrowUp / ArrowDown with wrap-at-edge
 *     navigation WITHIN the provided `rowIds` list. Named keys other than
 *     the arrows are untouched so callers can chain their own handlers.
 *   - `handleFocus(rowId)` / `setActive(rowId)` keeps internal state in sync
 *     when focus changes via non-keyboard paths (click, context menu, etc.).
 *
 * The hook intentionally does NOT touch Tab — the browser's natural tab order
 * delegates between sections, and because only one row per section is
 * tabIndex=0, Tab between sections Just Works.
 *
 * Wrapping: ArrowUp at the first row wraps to the last; ArrowDown at the last
 * row wraps to the first. This matches the Things 3 / Linear sidebar feel —
 * arrow keys are always cyclic within a section, Tab moves between sections.
 */
export interface UseRovingTabindexOptions {
  /**
   * Ordered list of row ids for the section. Must be stable across renders
   * (use paths, not indices) — the hook sheds focus tracking if the active
   * id disappears from the list.
   */
  rowIds: string[];
}

export interface UseRovingTabindexResult {
  /** Returns `0` for the active row, `-1` for the others. */
  getTabIndex: (rowId: string) => 0 | -1;
  /**
   * ArrowUp / ArrowDown handler with edge-wrap. Caller spreads this on every
   * row's onKeyDown. Unrelated keys pass through (no preventDefault).
   */
  handleKeyDown: (
    event: KeyboardEvent<HTMLElement>,
    rowId: string,
  ) => void;
  /**
   * Record that a row received focus (mouse click, focus ring, etc.) so the
   * roving-tabindex state stays aligned with the DOM.
   */
  handleFocus: (rowId: string) => void;
  /** Imperatively mark a row as active. */
  setActive: (rowId: string) => void;
  /** The id currently treated as tabIndex=0. `null` when the list is empty. */
  activeId: string | null;
  /** Register a ref for a row id so `focusRow` can move DOM focus to it. */
  registerRef: (rowId: string, el: HTMLElement | null) => void;
  /** Move DOM focus to the given row, updating roving state. */
  focusRow: (rowId: string) => void;
}

export function useRovingTabindex(
  options: UseRovingTabindexOptions,
): UseRovingTabindexResult {
  const { rowIds } = options;

  // `activeId` tracks the row the user most recently interacted with. Before
  // any row has focus it's null, and `getTabIndex` falls back to the first
  // row so Tab into the section is well-defined.
  const [activeId, setActiveId] = useState<string | null>(null);

  // Drop the active id if it's no longer in the list (project removed,
  // filter hid it, etc.) so Tab doesn't try to focus a detached node.
  useEffect(() => {
    if (activeId && !rowIds.includes(activeId)) {
      setActiveId(null);
    }
  }, [rowIds, activeId]);

  const effectiveActive = useMemo(() => {
    if (activeId && rowIds.includes(activeId)) return activeId;
    return rowIds[0] ?? null;
  }, [activeId, rowIds]);

  const refs = useRef<Map<string, HTMLElement | null>>(new Map());

  const registerRef = useCallback(
    (rowId: string, el: HTMLElement | null) => {
      if (el) refs.current.set(rowId, el);
      else refs.current.delete(rowId);
    },
    [],
  );

  const focusRow = useCallback((rowId: string) => {
    const el = refs.current.get(rowId);
    if (el) {
      setActiveId(rowId);
      el.focus();
    }
  }, []);

  const getTabIndex = useCallback(
    (rowId: string): 0 | -1 => (rowId === effectiveActive ? 0 : -1),
    [effectiveActive],
  );

  const handleFocus = useCallback((rowId: string) => {
    setActiveId(rowId);
  }, []);

  const setActive = useCallback((rowId: string) => {
    setActiveId(rowId);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, rowId: string) => {
      if (rowIds.length === 0) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      event.stopPropagation();
      const idx = rowIds.indexOf(rowId);
      if (idx < 0) return;
      const next =
        event.key === "ArrowDown"
          ? rowIds[(idx + 1) % rowIds.length]
          : rowIds[(idx - 1 + rowIds.length) % rowIds.length];
      focusRow(next);
    },
    [rowIds, focusRow],
  );

  return {
    getTabIndex,
    handleKeyDown,
    handleFocus,
    setActive,
    activeId: effectiveActive,
    registerRef,
    focusRow,
  };
}
