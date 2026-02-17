import { useEffect, useRef } from 'react';
import { useWorkspaceStore } from '@/stores/workspace-store';
import {
  useProjectMetadataStore,
  createDefaultMetadata,
  type ProjectMetadata,
} from '@/stores/project-metadata-store';
import { tauriApi } from '@/lib/tauri';

const METADATA_DIR = '.notesage';
const METADATA_FILE = 'project.json';

function getMetadataDir(rootPath: string): string {
  return `${rootPath}/${METADATA_DIR}`;
}

function getMetadataPath(rootPath: string): string {
  return `${rootPath}/${METADATA_DIR}/${METADATA_FILE}`;
}

function folderNameFromPath(path: string): string {
  return path.split('/').filter(Boolean).pop() || 'Untitled';
}

async function loadProjectMetadata(
  projectPath: string,
  setMetadata: (path: string, metadata: ProjectMetadata) => void,
): Promise<void> {
  const dirPath = getMetadataDir(projectPath);
  const filePath = getMetadataPath(projectPath);

  try {
    // Migration: .note-sage -> .notesage
    const oldDirPath = `${projectPath}/.note-sage`;
    try {
      const oldExists = await tauriApi.pathExists(oldDirPath);
      const newExists = await tauriApi.pathExists(dirPath);
      if (oldExists && !newExists) {
        await tauriApi.renamePath(oldDirPath, dirPath);
        console.log(`Migrated .note-sage to .notesage for ${projectPath}`);
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
      const defaults = createDefaultMetadata(folderNameFromPath(projectPath));
      await tauriApi.writeFile(filePath, JSON.stringify(defaults, null, 2));
      setMetadata(projectPath, defaults);
    } else {
      const raw = await tauriApi.readFile(filePath);
      const parsed = JSON.parse(raw) as ProjectMetadata;
      setMetadata(projectPath, parsed);
    }
  } catch (error) {
    console.error(`Failed to load project metadata for ${projectPath}:`, error);
  }
}

async function saveProjectMetadata(
  projectPath: string,
  metadata: ProjectMetadata,
  setClean: (path: string) => void,
): Promise<void> {
  const filePath = getMetadataPath(projectPath);
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
      }
    }

    // Clean up removed projects
    for (const loaded of loadedPathsRef.current) {
      if (!currentPaths.has(loaded)) {
        loadedPathsRef.current.delete(loaded);
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
