import { useMemo } from "react";
import type { GitStatus } from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";
import { useExternalChangeStore } from "@/stores/external-change-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useGitStore } from "@/stores/git-store";

const GIT_STATUS_CONFIG: Record<GitStatus, { label: string; color: string; tooltip: string }> = {
  modified: { label: "M", color: "text-muted-foreground/50", tooltip: "Modified" },
  added: { label: "A", color: "text-muted-foreground/50", tooltip: "Added — new file staged for commit" },
  untracked: { label: "U", color: "text-muted-foreground/50", tooltip: "Untracked — not yet tracked by git" },
  deleted: { label: "D", color: "text-muted-foreground/50", tooltip: "Deleted" },
  renamed: { label: "R", color: "text-muted-foreground/50", tooltip: "Renamed" },
  conflicted: { label: "C", color: "text-destructive", tooltip: "Conflicted — merge conflict" },
};

export interface GitInfo {
  label: string;
  color: string;
  tooltip: string;
}

export interface FileTreeItemState {
  isActive: boolean;
  hasExternalChange: boolean;
  isCloudFile: boolean;
  gitInfo: GitInfo | null;
}

export function useFileTreeItemState(
  path: string,
  isDirectory: boolean,
  gitRepoRoot?: string,
): FileTreeItemState {
  // Editor store — active file path only (not full tabs array)
  const activeFilePath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.filePath ?? null;
  });

  // External changes (old and new stores)
  const hasExternalChangeOld = useEditorStore((s) => path in s.externalChanges);
  const externalChangeNew = useExternalChangeStore((s) => s.getChange(path));

  // iCloud path
  const icloudNotesagePath = useSettingsStore((s) => s.icloudNotesagePath);

  // Git
  const gitEnabled = useSettingsStore((s) => s.gitEnabled);
  const repo = useGitStore((s) => gitRepoRoot ? s.repos[gitRepoRoot] : undefined);
  const fileStatusMap = repo?.fileStatusMap;
  const fileStatuses = repo?.fileStatuses;

  return useMemo(() => {
    // isActive
    const isActive = activeFilePath === path;

    // hasExternalChange
    const hasExternalChange = !isDirectory && (hasExternalChangeOld || !!externalChangeNew);

    // isCloudFile
    const isCloudFile = !!(icloudNotesagePath && path.startsWith(icloudNotesagePath + "/"));

    // gitInfo
    let gitInfo: GitInfo | null = null;
    if (gitEnabled && gitRepoRoot && fileStatusMap && fileStatusMap.size > 0) {
      if (!isDirectory) {
        const statuses = fileStatusMap.get(path);
        if (statuses) {
          const unstaged = statuses.find((s) => !s.staged);
          const staged = statuses.find((s) => s.staged);
          if (unstaged) gitInfo = GIT_STATUS_CONFIG[unstaged.status];
          else if (staged) gitInfo = GIT_STATUS_CONFIG[staged.status];
        }
      } else {
        const dirPrefix = path + "/";
        const hasChanges = fileStatuses?.some((s) => s.path.startsWith(dirPrefix));
        if (hasChanges) gitInfo = { label: "●", color: "text-muted-foreground/50", tooltip: "Contains changes" };
      }
    }

    return { isActive, hasExternalChange, isCloudFile, gitInfo };
  }, [
    activeFilePath,
    path,
    isDirectory,
    hasExternalChangeOld,
    externalChangeNew,
    icloudNotesagePath,
    gitEnabled,
    gitRepoRoot,
    fileStatusMap,
    fileStatuses,
  ]);
}
