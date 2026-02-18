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

export const tauriApi = {
  async readFile(path: string): Promise<string> {
    return await invoke<string>("read_file", { path });
  },

  async writeFile(path: string, content: string): Promise<void> {
    await invoke("write_file", { path, content });
  },

  async listDirectory(path: string): Promise<FileEntry[]> {
    return await invoke<FileEntry[]>("list_directory", { path });
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
};
