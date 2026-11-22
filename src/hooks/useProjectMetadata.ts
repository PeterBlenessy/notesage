import { useEffect, useRef } from 'react';
import { useWorkspaceStore } from '@/stores/workspace-store';
import {
  useProjectMetadataStore,
  createDefaultMetadata,
  type ProjectMetadata,
} from '@/stores/project-metadata-store';
import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';
import { buildDocumentIndex, type DocumentIndex } from '@/lib/document-index';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

const METADATA_DIR = '.notesage';
const METADATA_FILE = 'project.json';

/** In-memory document index cache per project root. */
const documentIndexCache = new Map<string, DocumentIndex>();

/** Get the cached document index for a project, or an empty one. */
export function getDocumentIndex(projectRoot: string): DocumentIndex {
  return documentIndexCache.get(projectRoot) ?? { entries: {} };
}

function getMetadataDir(rootPath: string): string {
  return `${rootPath}/${METADATA_DIR}`;
}

function getMetadataPath(rootPath: string): string {
  return `${rootPath}/${METADATA_DIR}/${METADATA_FILE}`;
}

function folderNameFromPath(path: string): string {
  return path.split('/').filter(Boolean).pop() || 'Untitled';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Runtime guard for `project.json` read from disk (user-editable, may be
 * half-written or hand-edited). Checks the fields the app actually reads:
 * `name` / `description` strings, the `ai` block, and — when present — the
 * security-relevant `aiLock.connectionId`.
 */
export function isProjectMetadata(v: unknown): v is ProjectMetadata {
  if (!isRecord(v)) return false;
  if (typeof v.name !== 'string' || typeof v.description !== 'string') return false;

  const ai = v.ai;
  if (!isRecord(ai)) return false;
  if (ai.provider !== null && ai.provider !== undefined && typeof ai.provider !== 'string') {
    return false;
  }
  if (ai.agentName !== null && ai.agentName !== undefined && typeof ai.agentName !== 'string') {
    return false;
  }
  if (ai.projectContext !== undefined && typeof ai.projectContext !== 'string') return false;

  // aiLock is enforcement data — if present it must carry a connection id.
  if (v.aiLock !== undefined) {
    if (!isRecord(v.aiLock) || typeof v.aiLock.connectionId !== 'string') return false;
  }

  return true;
}

/**
 * `project.json` exists (or may exist) but could not be read. Fail closed:
 * install the locked stand-in so no send path treats the project as unlocked,
 * leave the file alone, and offer a retry.
 */
function markMetadataUnavailable(
  projectPath: string,
  setMetadata: (path: string, metadata: ProjectMetadata) => void,
  message: string,
): void {
  useProjectMetadataStore.getState().setMetadataUnavailable(projectPath, message);
  toast.error(message, {
    id: `project-metadata-unavailable:${projectPath}`,
    duration: Infinity,
    action: {
      label: t('toast.projectMetadataRetry'),
      onClick: () => {
        void loadProjectMetadata(projectPath, setMetadata);
      },
    },
  });
}

export async function loadProjectMetadata(
  projectPath: string,
  setMetadata: (path: string, metadata: ProjectMetadata) => void,
): Promise<void> {
  const dirPath = getMetadataDir(projectPath);
  const filePath = getMetadataPath(projectPath);
  const name = folderNameFromPath(projectPath);
  const toastId = `project-metadata-unavailable:${projectPath}`;

  try {
    // Bail out if the project directory itself doesn't exist (e.g., externally renamed/deleted)
    const projectExists = await tauriApi.pathExists(projectPath);
    if (!projectExists) return;

    // Migration: .note-sage -> .notesage
    const oldDirPath = `${projectPath}/.note-sage`;
    try {
      const oldExists = await tauriApi.pathExists(oldDirPath);
      const newExists = await tauriApi.pathExists(dirPath);
      if (oldExists && !newExists) {
        await tauriApi.renamePath(oldDirPath, dirPath);
        log.info('project-metadata', `Migrated .note-sage to .notesage for ${projectPath}`);
      }
    } catch (error) {
      console.warn(`Failed to migrate .note-sage to .notesage:`, error);
    }

    const dirExists = await tauriApi.pathExists(dirPath);
    if (!dirExists) {
      await tauriApi.createDirectory(dirPath);
    }

    const fileExists = await tauriApi.pathExists(filePath);
    if (!fileExists) {
      // `pathExists` is also false for a file iCloud has evicted to a
      // `.name.icloud` placeholder. Writing defaults then would replace the
      // real project.json (its `aiLock` included) and create a sync conflict.
      const evicted = await tauriApi.pathExists(`${dirPath}/.${METADATA_FILE}.icloud`);
      if (evicted) {
        log.warn('project-metadata', `project.json is not downloaded from iCloud for ${projectPath}`);
        void tauriApi.icloudEnsureDownloaded(filePath).catch((downloadError: unknown) => {
          log.warn('project-metadata', `Could not request download of ${filePath}`, downloadError);
        });
        markMetadataUnavailable(projectPath, setMetadata, t('toast.projectMetadataNotDownloaded', { project: name }));
        return;
      }
      const defaults = createDefaultMetadata(name);
      await tauriApi.writeFile(filePath, JSON.stringify(defaults, null, 2));
      setMetadata(projectPath, defaults);
      toast.dismiss(toastId);
      return;
    }

    const raw = await tauriApi.readFile(filePath);
    const parsed: unknown = JSON.parse(raw);
    if (isProjectMetadata(parsed)) {
      setMetadata(projectPath, parsed);
      toast.dismiss(toastId);
    } else if (isRecord(parsed) && 'aiLock' in parsed) {
      // The file tries to carry a provider lock we cannot make sense of.
      // Falling back to defaults here would silently unlock the project.
      log.warn('project-metadata', `Invalid project.json with an aiLock for ${projectPath} — failing closed`);
      markMetadataUnavailable(projectPath, setMetadata, t('toast.projectMetadataUnreadable', { project: name }));
    } else {
      // Corrupted / hand-edited file with no lock in it: fall back to
      // defaults in memory but do NOT overwrite the file on disk — the user
      // may want to repair it.
      log.warn(
        'project-metadata',
        `Invalid project.json shape for ${projectPath} — using defaults`,
      );
      setMetadata(projectPath, createDefaultMetadata(name));
      toast.dismiss(toastId);
    }
  } catch (error) {
    console.error(`Failed to load project metadata for ${projectPath}:`, error);
    log.error('project-metadata', `Failed to load project metadata for ${projectPath}`, error);
    markMetadataUnavailable(projectPath, setMetadata, t('toast.projectMetadataUnreadable', { project: name }));
  }
}

async function saveProjectMetadata(
  projectPath: string,
  metadata: ProjectMetadata,
  setClean: (path: string) => void,
): Promise<void> {
  const filePath = getMetadataPath(projectPath);
  // Never persist the fail-closed stand-in: it is not the file's contents.
  if (useProjectMetadataStore.getState().unavailablePaths.has(projectPath)) return;
  try {
    await tauriApi.writeFile(filePath, JSON.stringify(metadata, null, 2));
    setClean(projectPath);
  } catch (error) {
    console.error(`Failed to save project metadata for ${projectPath}:`, error);
  }
}

export function useProjectMetadata() {
  const projects = useWorkspaceStore((s) => s.projects);
  const { metadataMap, dirtyPaths, setMetadata, setClean } = useProjectMetadataStore();
  const saveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const loadedPathsRef = useRef<Set<string>>(new Set());

  // Load metadata for newly added projects
  useEffect(() => {
    const currentPaths = new Set(projects.map((p) => p.path));

    // Load metadata for new projects
    for (const project of projects) {
      if (!loadedPathsRef.current.has(project.path)) {
        loadedPathsRef.current.add(project.path);
        loadProjectMetadata(project.path, setMetadata);
        // Build document index in background (non-blocking)
        buildDocumentIndex(project.path)
          .then((index) => documentIndexCache.set(project.path, index))
          .catch((err) => {
            const projectName = folderNameFromPath(project.path);
            console.error(`Failed to build document index for ${projectName}:`, err);
            toast.warning(`Tag index for ${projectName} failed — search may be incomplete`);
          });
      }
    }

    // Clean up removed projects
    for (const loaded of loadedPathsRef.current) {
      if (!currentPaths.has(loaded)) {
        loadedPathsRef.current.delete(loaded);
        documentIndexCache.delete(loaded);
      }
    }
  }, [projects, setMetadata]);

  // Debounced auto-save for dirty projects
  useEffect(() => {
    for (const dirtyPath of dirtyPaths) {
      const metadata = metadataMap[dirtyPath];
      if (!metadata) continue;

      // Clear existing timer for this path
      const existing = saveTimersRef.current.get(dirtyPath);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        saveProjectMetadata(dirtyPath, metadata, setClean);
        saveTimersRef.current.delete(dirtyPath);
      }, 1000);

      saveTimersRef.current.set(dirtyPath, timer);
    }

    return () => {
      // Clean up timers on unmount
      for (const timer of saveTimersRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, [dirtyPaths, metadataMap, setClean]);
}
