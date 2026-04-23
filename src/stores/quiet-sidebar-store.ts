import { create } from "zustand";

/**
 * quiet-sidebar-store — ephemeral signals shared between the quiet-composer
 * sidebar sections and the layout-level keyboard handlers (PRD
 * `2026-04-21-ui-refresh`, Phase 1 task #41).
 *
 * Currently exposes a single `pendingCreate` signal: when set to a parent
 * directory, the matching project row in `ProjectsSection` renders a
 * `SidebarInlineEdit` in create mode as its first child. The store is the
 * coupling point between:
 *
 *   - `⌘N` in `QuietLayout` (resolves parent from active tab, then sets the
 *     signal)
 *   - the per-row `+` button on a project (sets the signal to the project
 *     root)
 *   - the inline-edit rendered by `ProjectsSection` (clears the signal on
 *     commit or cancel)
 *
 * No persistence — opening the inline create row is always a fresh,
 * ephemeral action.
 */

export interface PendingCreate {
  /** Absolute path of the directory to create the new file under. */
  parentDir: string;
}

interface QuietSidebarStore {
  /**
   * When non-null, one project row in `ProjectsSection` should render an
   * inline `SidebarInlineEdit` in create mode under `parentDir`. Null when
   * no pending create is active.
   */
  pendingCreate: PendingCreate | null;

  /**
   * Set / clear the pending create signal. Pass `null` to dismiss. Callers
   * can pass `{ parentDir }` to request a pending create row under the
   * given directory; resolving which rendered row owns the input is
   * `ProjectsSection`'s job (it matches on `project.path` prefix).
   */
  setPendingCreate: (next: PendingCreate | null) => void;
}

export const useQuietSidebarStore = create<QuietSidebarStore>((set) => ({
  pendingCreate: null,
  setPendingCreate: (next) => set({ pendingCreate: next }),
}));
