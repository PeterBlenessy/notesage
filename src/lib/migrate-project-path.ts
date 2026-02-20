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

  // Update project metadata store (re-key from old → new)
  const metaStore = useProjectMetadataStore.getState();
  const meta = metaStore.metadataMap[oldPath];
  if (meta) {
    metaStore.removeMetadata(oldPath);
    metaStore.setMetadata(newPath, meta);
  }

  // Update editor store (rewrite open tab paths, persisted tabs, scroll positions)
  const editorStore = useEditorStore.getState();
  editorStore.updateFilePaths(oldPath, newPath);
}
