import { tauriApi } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useEditorStore } from "@/stores/editor-store";

/**
 * Update all store references after a project has been migrated to a new path.
 * Called after the Tauri migration command succeeds.
 */
export async function migrateProjectPath(oldPath: string, newPath: string): Promise<void> {
  // Load file tree at the new location
  const tree = await tauriApi.listDirectory(newPath);

  // Update workspace store (atomic path swap, preserves expanded state)
  const ws = useWorkspaceStore.getState();
  ws.updateProjectPath(oldPath, newPath, tree);

  // Update project metadata store (re-key from old → new, update name to match new folder)
  const metaStore = useProjectMetadataStore.getState();
  const meta = metaStore.metadataMap[oldPath];
  if (meta) {
    metaStore.removeMetadata(oldPath);
    const newFolderName = newPath.split('/').filter(Boolean).pop() || meta.name;
    const updatedMeta = { ...meta, name: newFolderName };
    metaStore.setMetadata(newPath, updatedMeta);

    // Persist to disk so useProjectMetadata doesn't reload stale data
    const metaFilePath = `${newPath}/.notesage/project.json`;
    try {
      await tauriApi.writeFile(metaFilePath, JSON.stringify(updatedMeta, null, 2));
    } catch {
      // Non-fatal — in-memory state is already correct
    }
  }

  // Update editor store (rewrite open tab paths, persisted tabs, scroll positions)
  const editorStore = useEditorStore.getState();
  editorStore.updateFilePaths(oldPath, newPath);
}
