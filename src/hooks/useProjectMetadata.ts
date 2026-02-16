import { useEffect, useRef } from 'react';
import { useProjectStore } from '@/stores/project-store';
import {
  useProjectMetadataStore,
  createDefaultMetadata,
  type ProjectMetadata,
} from '@/stores/project-metadata-store';
import { tauriApi } from '@/lib/tauri';

const METADATA_DIR = '.note-sage';
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

export function useProjectMetadata() {
  const rootPath = useProjectStore((s) => s.rootPath);
  const { metadata, isDirty, setMetadata, setDirty } = useProjectMetadataStore();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootPathRef = useRef(rootPath);

  // Keep rootPathRef in sync
  rootPathRef.current = rootPath;

  // Load metadata when rootPath changes
  useEffect(() => {
    if (!rootPath) return;

    let cancelled = false;

    async function loadMetadata() {
      const dirPath = getMetadataDir(rootPath!);
      const filePath = getMetadataPath(rootPath!);

      try {
        const dirExists = await tauriApi.pathExists(dirPath);
        if (cancelled) return;

        if (!dirExists) {
          await tauriApi.createDirectory(dirPath);
          if (cancelled) return;
        }

        const fileExists = await tauriApi.pathExists(filePath);
        if (cancelled) return;

        if (!fileExists) {
          const defaults = createDefaultMetadata(folderNameFromPath(rootPath!));
          await tauriApi.writeFile(filePath, JSON.stringify(defaults, null, 2));
          if (cancelled) return;
          setMetadata(defaults);
        } else {
          const raw = await tauriApi.readFile(filePath);
          if (cancelled) return;
          const parsed = JSON.parse(raw) as ProjectMetadata;
          setMetadata(parsed);
        }
      } catch (error) {
        console.error('Failed to load project metadata:', error);
      }
    }

    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, [rootPath, setMetadata]);

  // Debounced auto-save when isDirty
  useEffect(() => {
    if (!isDirty || !metadata || !rootPath) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      const currentRootPath = rootPathRef.current;
      if (!currentRootPath) return;

      const filePath = getMetadataPath(currentRootPath);
      try {
        await tauriApi.writeFile(filePath, JSON.stringify(metadata, null, 2));
        setDirty(false);
      } catch (error) {
        console.error('Failed to save project metadata:', error);
      }
    }, 1000);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [isDirty, metadata, rootPath, setDirty]);
}
