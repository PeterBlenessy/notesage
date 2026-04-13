import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useProjectMetadataStore, type ProjectMetadata } from '@/stores/project-metadata-store';

interface ActiveProject {
  projectPath: string | null;
  metadata: ProjectMetadata | null;
}

export function useActiveProject(): ActiveProject {
  // Only subscribe to the active tab's filePath — NOT the full tabs array.
  // tabs changes on every keystroke (content updates), which would cause
  // every component using this hook to re-render on every character typed.
  const activeFilePath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.filePath ?? null;
  });
  const projects = useWorkspaceStore((s) => s.projects);
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  if (!activeFilePath) return { projectPath: null, metadata: null };

  const project = projects.find((p) => activeFilePath.startsWith(p.path + '/'));
  if (!project) return { projectPath: null, metadata: null };

  return {
    projectPath: project.path,
    metadata: metadataMap[project.path] ?? null,
  };
}
