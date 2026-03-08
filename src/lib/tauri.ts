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
// Skill & Agent types
// ---------------------------------------------------------------------------

export interface SkillEntry {
  name: string;
  description: string;
  path: string;
  source: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowed_tools?: string[];
  user_invocable?: boolean;
  disable_model_invocation?: boolean;
  has_scripts: boolean;
  has_references: boolean;
}

export interface SkillContent {
  name: string;
  body: string;
  scripts: string[];
  references: string[];
  assets: string[];
}

export interface ScriptResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

export interface AgentEntry {
  name: string;
  description: string;
  path: string;
  source: string;
  model?: string;
  icon?: string;
  allowed_tools?: string[];
  user_invocable?: boolean;
  disable_model_invocation?: boolean;
}

export interface AgentContent {
  name: string;
  body: string;
  path: string;
}

export interface AgentInstruction {
  source: string;
  source_type: string;
  content: string;
  priority: number;
}

// ---------------------------------------------------------------------------
// ACP (Agent Client Protocol) types
// ---------------------------------------------------------------------------

export interface TagOccurrence {
  path: string;
  file_name: string;
  line_number: number;
  occurrence_in_file: number;
  snippet: string;
}

export interface ContentMatch {
  path: string;
  file_name: string;
  line_number: number;
  snippet: string;
}

export interface ResearchSearchResult {
  file: string;
  title: string;
  tags: string[];
  source_url: string;
  snippet: string;
  relevance: number;
  date_saved: string;
  word_count: number;
}

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

  async copyDirectory(source: string, destination: string): Promise<void> {
    await invoke("copy_directory", { source, destination });
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

  // Ollama FIM completion
  async ollamaFimCompletion(prefix: string, suffix: string, model?: string, ollamaUrl?: string): Promise<string> {
    return await invoke<string>("ollama_fim_completion", {
      prefix,
      suffix,
      model: model ?? null,
      ollamaUrl: ollamaUrl ?? null,
    });
  },

  // AI model listing
  async listModels(provider: string, apiKey?: string, baseUrl?: string): Promise<string[]> {
    return await invoke<string[]>("list_models", {
      provider,
      apiKey: apiKey ?? null,
      baseUrl: baseUrl ?? null,
    });
  },

  // Health commands
  async ping(): Promise<void> {
    await invoke("ping");
  },

  async healthCheck(): Promise<{
    watcher_alive: boolean;
    watched_paths: string[];
    acp_agents: { name: string; alive: boolean; pid: number | null }[];
    copilot_lsp: { name: string; alive: boolean; pid: number | null } | null;
    mcp_servers: { name: string; alive: boolean; pid: number | null }[];
  }> {
    return await invoke("health_check");
  },

  // Debug logging
  async setDebugLogging(enabled: boolean): Promise<void> {
    await invoke("set_debug_logging", { enabled });
  },

  // Log file operations
  async getLogPath(): Promise<string> {
    return await invoke<string>("get_log_path");
  },

  async getLogSize(): Promise<number> {
    return await invoke<number>("get_log_size");
  },

  async clearLogs(): Promise<void> {
    await invoke("clear_logs");
  },

  // Tag scanning
  async scanTagsInDirectories(paths: string[]): Promise<Record<string, string[]>> {
    return await invoke<Record<string, string[]>>("scan_tags_in_directories", { paths });
  },

  async findTagOccurrences(tag: string, paths: string[]): Promise<TagOccurrence[]> {
    return await invoke<TagOccurrence[]>("find_tag_occurrences", { tag, paths });
  },

  async searchFileContent(query: string, paths: string[]): Promise<ContentMatch[]> {
    return await invoke<ContentMatch[]>("search_file_content", { query, paths });
  },

  async searchResearch(
    dirs: string[],
    query?: string,
    tag?: string,
    limit?: number,
  ): Promise<ResearchSearchResult[]> {
    return await invoke<ResearchSearchResult[]>("search_research", {
      dirs,
      query: query ?? null,
      tag: tag ?? null,
      limit: limit ?? null,
    });
  },

  // Skill & agent operations
  async discoverSkills(baseDirs: string[]): Promise<SkillEntry[]> {
    return await invoke<SkillEntry[]>("discover_skills", { baseDirs });
  },

  async readSkillContent(skillPath: string): Promise<SkillContent> {
    return await invoke<SkillContent>("read_skill_content", { skillPath });
  },

  async executeSkillScript(options: {
    skillPath: string;
    script: string;
    args: string[];
    workingDir: string | null;
    env: Record<string, string> | null;
    timeoutMs: number | null;
  }): Promise<ScriptResult> {
    return await invoke<ScriptResult>("execute_skill_script", options);
  },

  async discoverAgents(baseDirs: string[]): Promise<AgentEntry[]> {
    return await invoke<AgentEntry[]>("discover_agents", { baseDirs });
  },

  async readAgentContent(agentPath: string): Promise<AgentContent> {
    return await invoke<AgentContent>("read_agent_content", { agentPath });
  },

  async readAgentInstructions(projectRoot: string | null, connectedProviders: string[]): Promise<AgentInstruction[]> {
    return await invoke<AgentInstruction[]>("read_agent_instructions", { projectRoot, connectedProviders });
  },

  async extractBundledSkills(): Promise<string> {
    return await invoke<string>("extract_bundled_skills");
  },

  async extractBundledAgents(): Promise<string> {
    return await invoke<string>("extract_bundled_agents");
  },
};
