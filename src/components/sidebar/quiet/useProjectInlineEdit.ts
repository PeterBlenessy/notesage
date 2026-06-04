import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore, type WorkspaceProject } from "@/stores/workspace-store";
import { useQuietSidebarStore } from "@/stores/quiet-sidebar-store";
import { tauriApi } from "@/lib/tauri";
import { dispatchFocusEditor } from "@/lib/editor-events";
import {
  basename as pathBasename,
  resolveRenamePath,
  validateRenameBasename,
} from "@/components/sidebar/quiet/rename-utils";
import { SIDEBAR_ENTER_RENAME_MODE_EVENT } from "@/components/sidebar/quiet/SidebarContextMenu";
import {
  projectBasename,
  isSystemFolderName,
  buildProjectNameValidator,
} from "./project-section-utils";

interface UseProjectInlineEditParams {
  projects: WorkspaceProject[];
  visibleChildPaths: Set<string>;
  setExpandedPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
  renamePath: (oldPath: string, newPath: string) => Promise<unknown>;
  createFile: (parentDir: string, fileName: string) => Promise<unknown>;
  createFolder: (parentDir: string, folderName: string) => Promise<unknown>;
  openFile: (filePath: string, fileName: string) => Promise<unknown>;
}

interface UseProjectInlineEditReturn {
  // ── rename state ─────────────────────────────────────────────────────────
  renamingPath: string | null;
  renamingProjectPath: string | null;
  startRename: (path: string) => void;
  cancelRename: () => void;
  commitRename: (
    oldPath: string,
    newBasename: string,
    isDirectory?: boolean,
  ) => Promise<void>;
  startProjectRename: (path: string) => void;
  cancelProjectRename: () => void;
  commitProjectRename: (oldPath: string, newBasename: string) => Promise<void>;

  // ── inline create (file) ─────────────────────────────────────────────────
  pendingCreate: { parentDir: string } | null;
  pendingCreateProjectPath: string | null;
  handleCreateCommit: (parentDir: string, trimmedName: string) => Promise<void>;
  handleCreateCancel: () => void;
  handleAddToProject: (projectPath: string) => void;

  // ── inline create (project) ──────────────────────────────────────────────
  pendingCreateProject: boolean;
  validateProjectName: (input: string) => string | null;
  handleCreateProjectCommit: (trimmedName: string) => Promise<void>;
  handleCreateProjectCancel: () => void;
}

/**
 * Manages all inline-create / rename state for ProjectsSection.
 *
 * Extracted from `ProjectsSection` (issue #414) so the parent can stay lean
 * while the business logic lives in a focused, testable hook.
 */
export function useProjectInlineEdit({
  projects,
  visibleChildPaths,
  setExpandedPaths,
  renamePath,
  createFile,
  createFolder,
  openFile,
}: UseProjectInlineEditParams): UseProjectInlineEditReturn {
  // ── child-row rename ──────────────────────────────────────────────────────
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  // ── project-root rename ───────────────────────────────────────────────────
  const [renamingProjectPath, setRenamingProjectPath] = useState<string | null>(
    null,
  );

  // ── inline create (file) ─────────────────────────────────────────────────
  const pendingCreate = useQuietSidebarStore((s) => s.pendingCreate);
  const setPendingCreate = useQuietSidebarStore((s) => s.setPendingCreate);

  // ── inline create (project) ──────────────────────────────────────────────
  const pendingCreateProject = useQuietSidebarStore(
    (s) => s.pendingCreateProject,
  );
  const setPendingCreateProject = useQuietSidebarStore(
    (s) => s.setPendingCreateProject,
  );

  // Derive which project the pending create belongs to.
  const pendingCreateProjectPath = useMemo(() => {
    if (!pendingCreate) return null;
    for (const p of projects) {
      if (
        pendingCreate.parentDir === p.path ||
        pendingCreate.parentDir.startsWith(p.path + "/")
      ) {
        return p.path;
      }
    }
    return null;
  }, [pendingCreate, projects]);

  // Auto-expand the owning project when a pending create is set.
  useEffect(() => {
    if (!pendingCreateProjectPath) return;
    setExpandedPaths((prev) => {
      if (prev.has(pendingCreateProjectPath)) return prev;
      const next = new Set(prev);
      next.add(pendingCreateProjectPath);
      return next;
    });
  }, [pendingCreateProjectPath, setExpandedPaths]);

  // ── SIDEBAR_ENTER_RENAME_MODE_EVENT ───────────────────────────────────────
  // Activate on any visible child path (files or folders); project roots and
  // system/dotfile folders are skipped.
  useEffect(() => {
    function handleRenameEvent(event: Event) {
      const detail = (event as CustomEvent<{ filePath: string }>).detail;
      if (!detail?.filePath) return;
      if (!visibleChildPaths.has(detail.filePath)) return;
      const name = pathBasename(detail.filePath);
      if (isSystemFolderName(name)) return;
      setRenamingPath(detail.filePath);
    }
    window.addEventListener(SIDEBAR_ENTER_RENAME_MODE_EVENT, handleRenameEvent);
    return () => {
      window.removeEventListener(
        SIDEBAR_ENTER_RENAME_MODE_EVENT,
        handleRenameEvent,
      );
    };
  }, [visibleChildPaths]);

  // ── rename handlers ───────────────────────────────────────────────────────
  const startRename = useCallback((path: string) => {
    setRenamingPath(path);
  }, []);

  const cancelRename = useCallback(() => setRenamingPath(null), []);

  const commitRename = useCallback(
    async (oldPath: string, newBasename: string, isDirectory?: boolean) => {
      setRenamingPath(null);
      const oldName = pathBasename(oldPath);
      if (newBasename === oldName) return;
      const newPath = resolveRenamePath(oldPath, newBasename, isDirectory);
      try {
        await renamePath(oldPath, newPath);
        toast.success(`Renamed to ${pathBasename(newPath)}`);
      } catch (error) {
        toast.error(`Failed to rename: ${error}`);
      }
    },
    [renamePath],
  );

  const startProjectRename = useCallback((path: string) => {
    setRenamingProjectPath(path);
  }, []);

  const cancelProjectRename = useCallback(
    () => setRenamingProjectPath(null),
    [],
  );

  const commitProjectRename = useCallback(
    async (oldPath: string, newBasename: string) => {
      setRenamingProjectPath(null);
      const oldName = pathBasename(oldPath);
      if (newBasename === oldName) return;
      const newPath = resolveRenamePath(oldPath, newBasename, true);
      try {
        await renamePath(oldPath, newPath);
        useWorkspaceStore.getState().updateProjectPath(oldPath, newPath, []);
        toast.success(`Renamed to ${pathBasename(newPath)}`);
      } catch (error) {
        toast.error(`Failed to rename: ${error}`);
      }
    },
    [renamePath],
  );

  // ── inline create (file) handlers ────────────────────────────────────────
  const handleCreateCommit = useCallback(
    async (parentDir: string, trimmedName: string) => {
      const fileName = trimmedName.includes(".")
        ? trimmedName
        : `${trimmedName}.md`;
      const filePath = `${parentDir}/${fileName}`;
      setPendingCreate(null);
      try {
        await createFile(parentDir, fileName);
        await openFile(filePath, fileName);
        dispatchFocusEditor();
        toast.success(`Created ${fileName}`);
      } catch (error) {
        toast.error(`Failed to create: ${error}`);
      }
    },
    [createFile, openFile, setPendingCreate],
  );

  const handleCreateCancel = useCallback(() => {
    setPendingCreate(null);
  }, [setPendingCreate]);

  const handleAddToProject = useCallback(
    (projectPath: string) => {
      setPendingCreate({ parentDir: projectPath });
    },
    [setPendingCreate],
  );

  // ── inline create (project) handlers ─────────────────────────────────────
  // Build validator from current project basenames (pre-filter list).
  const existingProjectBasenames = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      set.add(projectBasename(p.path));
    }
    return set;
  }, [projects]);

  const validateProjectName = useMemo(
    () => buildProjectNameValidator(existingProjectBasenames),
    [existingProjectBasenames],
  );

  const handleCreateProjectCommit = useCallback(
    async (trimmedName: string) => {
      const libraryRoot = useSettingsStore.getState().notesRootPath;
      if (!libraryRoot || libraryRoot.startsWith("~")) {
        toast.error(
          "Notesage library is not ready yet — try again in a moment",
        );
        setPendingCreateProject(false);
        return;
      }

      const projectPath = `${libraryRoot}/${trimmedName}`;
      setPendingCreateProject(false);

      try {
        await createFolder(libraryRoot, trimmedName);
        let tree: Awaited<ReturnType<typeof tauriApi.listDirectory>> = [];
        try {
          tree = await tauriApi.listDirectory(projectPath, false);
        } catch {
          // Expected on freshly-created directories on some filesystems.
        }
        useWorkspaceStore.getState().addProject(projectPath, tree);
        toast.success(`Created project ${trimmedName}`);
      } catch (error) {
        toast.error(`Failed to create project: ${error}`);
      }
    },
    [createFolder, setPendingCreateProject],
  );

  const handleCreateProjectCancel = useCallback(() => {
    setPendingCreateProject(false);
  }, [setPendingCreateProject]);

  return {
    renamingPath,
    renamingProjectPath,
    startRename,
    cancelRename,
    commitRename,
    startProjectRename,
    cancelProjectRename,
    commitProjectRename,
    pendingCreate,
    pendingCreateProjectPath,
    handleCreateCommit,
    handleCreateCancel,
    handleAddToProject,
    pendingCreateProject,
    validateProjectName,
    handleCreateProjectCommit,
    handleCreateProjectCancel,
  };
}

// Re-export for callers that need the validate-rename helper.
export { validateRenameBasename };
