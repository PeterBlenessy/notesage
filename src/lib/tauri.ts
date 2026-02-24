import { invoke } from "@tauri-apps/api/core";

export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  children?: FileEntry[];
}

export type GitStatus = 'modified' | 'added' | 'staged' | 'untracked' | 'deleted' | 'renamed' | 'conflicted';

export interface GitFileStatus {
  path: string;
  status: GitStatus;
  staged: boolean;
}

export interface DiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  delete_text: string;
  insert_text: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  is_main: boolean;
}

export interface SyncSettings {
  version: number;
  icloudEnabled: boolean;
  syncQuickNotes: boolean;
  syncedProjects: string[];
}

// ---------------------------------------------------------------------------
// ACP (Agent Client Protocol) types
// ---------------------------------------------------------------------------

export interface AcpSpawnResult {
  instance_id: string;
  agent_name: string | null;
  agent_version: string | null;
  auth_methods: { id: string; name: string; description: string | null }[];
}

export interface AcpSessionResult {
  session_id: string;
}

export const tauriApi = {
  async readFile(path: string): Promise<string> {
    return await invoke<string>("read_file", { path });
  },

  async readBinaryFile(path: string): Promise<number[]> {
    return await invoke<number[]>("read_binary_file", { path });
  },

  async writeFile(path: string, content: string): Promise<void> {
    await invoke("write_file", { path, content });
  },

  async listDirectory(path: string): Promise<FileEntry[]> {
    return await invoke<FileEntry[]>("list_directory", { path });
  },

  async listFilesShallow(path: string): Promise<FileEntry[]> {
    return await invoke<FileEntry[]>("list_files_shallow", { path });
  },

  async createFile(path: string): Promise<void> {
    await invoke("create_file", { path });
  },

  async createDirectory(path: string): Promise<void> {
    await invoke("create_directory", { path });
  },

  async renamePath(oldPath: string, newPath: string): Promise<void> {
    await invoke("rename_path", { oldPath, newPath });
  },

  async deletePath(path: string): Promise<void> {
    await invoke("delete_path", { path });
  },

  async pathExists(path: string): Promise<boolean> {
    return await invoke<boolean>("path_exists", { path });
  },

  async openFolderDialog(): Promise<string | null> {
    return await invoke<string | null>("open_folder_dialog");
  },

  async getHomeDir(): Promise<string> {
    return await invoke<string>("get_home_dir");
  },

  async revealInFinder(path: string): Promise<void> {
    await invoke("reveal_in_finder", { path });
  },

  // Git operations
  async gitCheckAvailable(): Promise<boolean> {
    return await invoke<boolean>("git_check_available");
  },

  async gitIsRepo(path: string): Promise<boolean> {
    return await invoke<boolean>("git_is_repo", { path });
  },

  async gitInit(path: string): Promise<void> {
    await invoke("git_init", { path });
  },

  async gitGetConfig(key: string): Promise<string | null> {
    return await invoke<string | null>("git_get_config", { key });
  },

  async gitSetConfig(key: string, value: string): Promise<void> {
    await invoke("git_set_config", { key, value });
  },

  async gitStatus(path: string): Promise<GitFileStatus[]> {
    return await invoke<GitFileStatus[]>("git_status", { path });
  },

  async gitBranchCurrent(path: string): Promise<string> {
    return await invoke<string>("git_branch_current", { path });
  },

  async gitBranchList(path: string): Promise<string[]> {
    return await invoke<string[]>("git_branch_list", { path });
  },

  async gitBranchSwitch(path: string, branch: string): Promise<void> {
    await invoke("git_branch_switch", { path, branch });
  },

  async gitStage(path: string, files: string[]): Promise<void> {
    await invoke("git_stage", { path, files });
  },

  async gitUnstage(path: string, files: string[]): Promise<void> {
    await invoke("git_unstage", { path, files });
  },

  async gitCommit(path: string, message: string): Promise<string> {
    return await invoke<string>("git_commit", { path, message });
  },

  // Git diff operations
  async gitDiffFiles(repoPath: string, baseBranch: string, compareBranch: string): Promise<string[]> {
    return await invoke<string[]>("git_diff_files", { repoPath, baseBranch, compareBranch });
  },

  async gitDiffFile(repoPath: string, baseBranch: string, compareBranch: string, filePath: string): Promise<DiffHunk[]> {
    return await invoke<DiffHunk[]>("git_diff_file", { repoPath, baseBranch, compareBranch, filePath });
  },

  async gitWorktreeList(repoPath: string): Promise<WorktreeInfo[]> {
    return await invoke<WorktreeInfo[]>("git_worktree_list", { repoPath });
  },

  // Filesystem watcher operations
  async watchDirectory(path: string): Promise<void> {
    await invoke("watch_directory", { path });
  },

  async unwatchDirectory(): Promise<void> {
    await invoke("unwatch_directory");
  },

  async markSelfWrite(path: string): Promise<void> {
    await invoke("mark_self_write", { path });
  },

  async clearSelfWrite(path: string): Promise<void> {
    await invoke("clear_self_write", { path });
  },

  // Export operations
  async exportPdf(options: {
    markdown: string;
    title: string;
    template: string;
    includeToc: boolean;
    includePageNumbers: boolean;
    pageSize: string;
  }): Promise<number[]> {
    return await invoke<number[]>("export_pdf", options);
  },

  async saveBinaryFile(path: string, data: number[]): Promise<void> {
    await invoke("save_binary_file", { path, data });
  },

  // iCloud sync operations
  async getICloudPath(): Promise<string | null> {
    return await invoke<string | null>("get_icloud_path");
  },

  async readSyncSettings(notesagePath: string): Promise<SyncSettings | null> {
    return await invoke<SyncSettings | null>("read_sync_settings", { notesagePath });
  },

  async writeSyncSettings(notesagePath: string, settings: SyncSettings): Promise<void> {
    await invoke("write_sync_settings", { notesagePath, settings });
  },

  async migrateToICloud(projectPath: string, icloudNotesagePath: string): Promise<string> {
    return await invoke<string>("migrate_to_icloud", { projectPath, icloudNotesagePath });
  },

  async migrateFromICloud(projectPath: string, localNotesagePath: string): Promise<string> {
    return await invoke<string>("migrate_from_icloud", { projectPath, localNotesagePath });
  },

  async migrateQuickNotes(fromPath: string, toPath: string): Promise<number> {
    return await invoke<number>("migrate_quick_notes", { fromPath, toPath });
  },

  // ACP (Agent Client Protocol) operations
  async acpAgentSpawn(agentBinary: string, agentArgs: string[] | null, role: string, workingDirectory: string): Promise<AcpSpawnResult> {
    return await invoke<AcpSpawnResult>("acp_agent_spawn", { agentBinary, agentArgs, role, workingDirectory });
  },

  async acpAgentStop(instanceId: string): Promise<void> {
    await invoke("acp_agent_stop", { instanceId });
  },

  async acpAgentAuthenticate(instanceId: string): Promise<void> {
    await invoke("acp_agent_authenticate", { instanceId });
  },

  async acpSessionNew(instanceId: string, workingDirectory: string): Promise<AcpSessionResult> {
    return await invoke<AcpSessionResult>("acp_session_new", { instanceId, workingDirectory });
  },

  async acpSessionPrompt(instanceId: string, sessionId: string, content: string): Promise<void> {
    await invoke("acp_session_prompt", { instanceId, sessionId, content });
  },

  async acpSessionCancel(instanceId: string, sessionId: string): Promise<void> {
    await invoke("acp_session_cancel", { instanceId, sessionId });
  },

  async acpPermissionRespond(instanceId: string, requestId: string, optionId: string | null): Promise<void> {
    await invoke("acp_permission_respond", { instanceId, requestId, optionId });
  },
};
