import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useProjectMetadataStore, type ProjectMetadata } from '@/stores/project-metadata-store';

interface ActiveProject {
  projectPath: string | null;
  metadata: ProjectMetadata | null;
}

export function useActiveProject(): ActiveProject {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const projects = useWorkspaceStore((s) => s.projects);
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab) return { projectPath: null, metadata: null };

  const project = projects.find((p) => activeTab.filePath.startsWith(p.path + '/'));
  if (!project) return { projectPath: null, metadata: null };

  return {
    projectPath: project.path,
    metadata: metadataMap[project.path] ?? null,
  };
}
