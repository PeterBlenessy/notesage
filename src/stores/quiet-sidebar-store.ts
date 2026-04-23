import { create } from "zustand";

/**
 * quiet-sidebar-store — ephemeral signals shared between the quiet-composer
 * sidebar sections and the layout-level keyboard handlers (PRD
 * `2026-04-21-ui-refresh`, Phase 1 tasks #41 + #42).
 *
 * Two signals today:
 *
 *   - `pendingCreate` (task #41) — when set to a parent directory, the
 *     matching project row in `ProjectsSection` renders a
 *     `SidebarInlineEdit` in create mode under that parent. Driven by
 *     `⌘N` in `QuietLayout` (resolves parent from the active tab) and by
 *     the per-row `+` button on a project (sets the signal to the project
 *     root). Cleared by the inline edit on commit or cancel.
 *
 *   - `pendingCreateProject` (task #42) — boolean flag that tells
 *     `ProjectsSection` to render a top-of-list `SidebarInlineEdit` row
 *     that creates a fresh empty project under the Notesage library root.
 *     Driven by `⌘⇧N` in `QuietLayout` and the section-header `+` button.
 *
 * No persistence — opening either inline surface is always a fresh,
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

  /**
   * When true, `ProjectsSection` renders a top-of-list `SidebarInlineEdit`
   * row in create mode. Commit creates a new project directory under the
   * Notesage library root (`settings.notesRootPath`) and registers it via
   * `workspace-store.addProject`. False when no project-create flow is
   * active.
   */
  pendingCreateProject: boolean;

  /** Set / clear the pending-project-create flag. */
  setPendingCreateProject: (next: boolean) => void;
}

export const useQuietSidebarStore = create<QuietSidebarStore>((set) => ({
  pendingCreate: null,
  setPendingCreate: (next) => set({ pendingCreate: next }),
  pendingCreateProject: false,
  setPendingCreateProject: (next) => set({ pendingCreateProject: next }),
}));
