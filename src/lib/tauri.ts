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

// SQLite document index types
export interface IndexedTag {
  tag: string;
  file_count: number;
}

export interface IndexTagOccurrence {
  path: string;
  file_name: string;
  context_before: string;
  context_after: string;
}

export interface IndexedMention {
  mention: string;
  file_count: number;
}

export interface IndexedTask {
  path: string;
  file_name: string;
  text: string;
  done: boolean;
  position: number;
  context_before: string;
  context_after: string;
  project_name?: string;
}

export interface IndexedGoal {
  path: string;
  file_name: string;
  title: string;
  template: string;
  total_tasks: number;
  completed_tasks: number;
  project_name?: string;
}

export interface IndexResearchResult {
  file: string;
  title: string;
  tags: string[];
  source_url: string;
  snippet: string;
  date_saved: string;
  word_count: number;
  project_name?: string;
}

export interface IndexContentSearchResult {
  path: string;
  file_name: string;
  title?: string;
  snippet: string;
  rank: number;
}

export interface IndexStats {
  file_count: number;
  tag_count: number;
  mention_count: number;
  task_count: number;
  goal_count: number;
  indexed_at: number;
}

export interface ActionItem {
  id: string;
  source_type: string;
  status: string;
  text: string;
  file_path: string;
  line_number?: number;
  project_name?: string;
  project_root?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
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

// ---------------------------------------------------------------------------
// Transcription types
// ---------------------------------------------------------------------------

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface TranscriptionResultData {
  segments: TranscriptionSegment[];
  duration_secs: number;
  language: string;
}

export interface AudioBufferInfo {
  duration_secs: number;
  sample_count: number;
  sample_rate: number;
  source: string;
}

export interface WhisperModelInfo {
  name: string;
  size_bytes: number;
  downloaded: boolean;
  path?: string;
  author?: string;
  license?: string;
  parameters?: string;
  description?: string;
  languages_count?: number;
  hf_repo_id?: string;
}

// ---------------------------------------------------------------------------
// Local AI types
// ---------------------------------------------------------------------------

export interface ThinkingTags {
  open: string;
  close: string;
}

export interface LocalModelInfo {
  id: string;
  name: string;
  filename: string;
  size_bytes: number;
  ram_required_bytes: number;
  downloaded: boolean;
  description: string;
  huggingface_url: string;
  is_custom: boolean;
  source: string;
  supports_fim: boolean;
  author?: string;
  organization?: string;
  license?: string;
  parameters?: string;
  architecture?: string;
  context_length?: number;
  quantization?: string;
  hf_repo_id?: string;
  category?: string;
  supports_tool_calling: boolean;
  supports_thinking: boolean;
  thinking_tags?: ThinkingTags;
  supports_vision: boolean;
  multilingual: boolean;
  recommended_for: string[];
}

// ---------------------------------------------------------------------------
// Model Metadata types
// ---------------------------------------------------------------------------

export interface ModelMetadata {
  author?: string;
  organization?: string;
  license?: string;
  base_model?: string;
  quantized_by?: string;
  parameters?: string;
  parameters_raw?: number;
  architecture?: string;
  context_length?: number;
  quantization?: string;
  embedding_length?: number;
  vocab_size?: number;
  block_count?: number;
  languages?: string[];
  hf_repo_id?: string;
  hf_repo_url?: string;
  last_modified?: string;
  downloads?: number;
  _sources?: string[];
}

export interface SystemMemoryInfo {
  total_bytes: number;
  available_bytes: number;
}

export interface LocalServerStatus {
  running: boolean;
  port: number | null;
  model: string | null;
}

export interface BinaryStatus {
  available: boolean;
  location: string; // "bundled" | "managed" | "system" | "not_found"
  path: string | null;
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

  // OpenAI-compatible FIM completion (for openai_compatible connections)
  async openaiCompatibleFimCompletion(baseUrl: string, apiKey: string | undefined, model: string, prefix: string, suffix: string, maxTokens?: number): Promise<string> {
    return await invoke<string>("openai_completions_fim", {
      baseUrl,
      apiKey: apiKey ?? null,
      model,
      prefix,
      suffix,
      maxTokens: maxTokens ?? null,
    });
  },

  // Local bundled FIM completion
  async localBundledFimCompletion(prefix: string, suffix: string, model?: string, maxTokens?: number): Promise<string> {
    return await invoke<string>("local_bundled_fim", {
      prefix,
      suffix,
      model: model ?? null,
      maxTokens: maxTokens ?? null,
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

  // Action scanning
  async scanActions(
    paths: string[],
    since?: number,
  ): Promise<ActionItem[]> {
    return await invoke<ActionItem[]>("scan_actions", {
      paths,
      since: since ?? null,
    });
  },

  // SQLite document index
  async indexInit(projectPath?: string): Promise<IndexStats> {
    return await invoke<IndexStats>("index_init", { projectPath: projectPath ?? null });
  },

  async indexFile(path: string): Promise<void> {
    await invoke("index_file", { path });
  },

  async indexRebuild(projectPath?: string): Promise<IndexStats> {
    return await invoke<IndexStats>("index_rebuild", { projectPath: projectPath ?? null });
  },

  async indexTags(projectPaths: string[], query?: string): Promise<IndexedTag[]> {
    return await invoke<IndexedTag[]>("index_tags", { projectPaths, query: query ?? null });
  },

  async indexTagOccurrences(tag: string, projectPaths: string[]): Promise<IndexTagOccurrence[]> {
    return await invoke<IndexTagOccurrence[]>("index_tag_occurrences", { tag, projectPaths });
  },

  async indexMentions(projectPaths: string[], query?: string): Promise<IndexedMention[]> {
    return await invoke<IndexedMention[]>("index_mentions", { projectPaths, query: query ?? null });
  },

  async indexMentionOccurrences(mention: string, projectPaths: string[]): Promise<IndexTagOccurrence[]> {
    return await invoke<IndexTagOccurrence[]>("index_mention_occurrences", { mention, projectPaths });
  },

  async indexSearchResearch(
    projectPaths: string[],
    query?: string,
    tag?: string,
    limit?: number,
  ): Promise<IndexResearchResult[]> {
    return await invoke<IndexResearchResult[]>("index_search_research", {
      projectPaths,
      query: query ?? null,
      tag: tag ?? null,
      limit: limit ?? null,
    });
  },

  async indexTasks(
    projectPaths: string[],
    done?: boolean,
    query?: string,
    limit?: number,
  ): Promise<IndexedTask[]> {
    return await invoke<IndexedTask[]>("index_tasks", {
      projectPaths,
      done: done ?? null,
      query: query ?? null,
      limit: limit ?? null,
    });
  },

  async indexToggleTask(
    path: string,
    contextBefore: string,
    contextAfter: string,
    taskText: string,
    done: boolean,
  ): Promise<void> {
    await invoke("index_toggle_task", { path, contextBefore, contextAfter, taskText, done });
  },

  async indexGoals(projectPaths: string[]): Promise<IndexedGoal[]> {
    return await invoke<IndexedGoal[]>("index_goals", { projectPaths });
  },

  async indexSearchContent(
    projectPaths: string[],
    query: string,
    limit?: number,
  ): Promise<IndexContentSearchResult[]> {
    return await invoke<IndexContentSearchResult[]>("index_search_content", {
      projectPaths,
      query,
      limit: limit ?? null,
    });
  },

  async indexStats(projectPath?: string): Promise<IndexStats> {
    return await invoke<IndexStats>("index_stats", { projectPath: projectPath ?? null });
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

  // Voice transcription operations
  async startRecording(source: string): Promise<void> {
    await invoke("start_recording", { source });
  },

  async stopRecording(): Promise<AudioBufferInfo> {
    return await invoke<AudioBufferInfo>("stop_recording");
  },

  async transcribe(model: string, language?: string): Promise<TranscriptionResultData> {
    return await invoke<TranscriptionResultData>("transcribe", { model, language: language ?? null });
  },

  async startDictation(language?: string): Promise<void> {
    await invoke("start_dictation", { language: language ?? null });
  },

  async stopDictation(): Promise<void> {
    await invoke("stop_dictation");
  },

  async listWhisperModels(): Promise<WhisperModelInfo[]> {
    return await invoke<WhisperModelInfo[]>("list_whisper_models");
  },

  async downloadWhisperModel(size: string): Promise<void> {
    await invoke("download_whisper_model", { size });
  },

  async deleteWhisperModel(size: string): Promise<void> {
    await invoke("delete_whisper_model", { size });
  },

  // Local AI inference
  async getSystemMemory(): Promise<SystemMemoryInfo> {
    return await invoke<SystemMemoryInfo>("get_system_memory");
  },

  async listLocalModels(): Promise<LocalModelInfo[]> {
    return await invoke<LocalModelInfo[]>("list_local_models");
  },

  async downloadLocalModel(modelId: string): Promise<void> {
    await invoke("download_local_model", { modelId });
  },

  async cancelLocalModelDownload(modelId: string): Promise<void> {
    await invoke("cancel_local_model_download", { modelId });
  },

  async deleteLocalModel(modelId: string): Promise<void> {
    await invoke("delete_local_model", { modelId });
  },

  async addCustomLocalModel(name: string, url: string): Promise<LocalModelInfo> {
    return await invoke<LocalModelInfo>("add_custom_local_model", { name, url });
  },

  async removeCustomLocalModel(modelId: string): Promise<void> {
    await invoke("remove_custom_local_model", { modelId });
  },

  async startLocalServer(
    modelId: string,
    contextLength?: number,
    gpuLayers?: number,
  ): Promise<number> {
    return await invoke<number>("start_local_server", {
      modelId,
      contextLength: contextLength ?? null,
      gpuLayers: gpuLayers ?? null,
    });
  },

  async stopLocalServer(): Promise<void> {
    await invoke("stop_local_server");
  },

  async getLocalServerStatus(): Promise<LocalServerStatus> {
    return await invoke<LocalServerStatus>("get_local_server_status");
  },

  async checkLlamaServerAvailable(): Promise<BinaryStatus> {
    return await invoke<BinaryStatus>("check_llama_server_available");
  },

  async downloadLlamaServerBinary(): Promise<string> {
    return await invoke<string>("download_llama_server_binary");
  },

  async cancelLlamaServerDownload(): Promise<void> {
    await invoke("cancel_llama_server_download");
  },

  // Model metadata
  async getModelMetadata(modelId: string, modelType: 'llm' | 'whisper'): Promise<ModelMetadata> {
    return await invoke<ModelMetadata>("get_model_metadata", { modelId, modelType });
  },

  async getRuntimeModelMetadata(port: number): Promise<ModelMetadata> {
    return await invoke<ModelMetadata>("get_runtime_model_metadata", { port });
  },
};
