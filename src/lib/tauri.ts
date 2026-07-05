import { invoke } from "@tauri-apps/api/core";
import type { AIProviderType } from './ai/types';
import type { BackendTypographyPresets } from './typography-presets';
import type { AcpListResult, AcpSessionResult } from './ai/acp-utils';
import type { AcpMcpServerInput } from './ai/acp-mcp';
import type { AutomationFile, AutomationValidation } from './automations/types';

export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  children?: FileEntry[];
  hidden: boolean;
}

export type GitStatus = 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed' | 'conflicted';

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

export interface PptxTemplateInfo {
  id: string;
  name: string;
  scope: string;  // "builtin" | "global" | "project"
  path: string;
  date_added: string;
}

/**
 * Result of `local_agent_write_config` — the Goose env pointing at the live
 * bundled llama-server (provider + host + model) plus the XDG isolation paths
 * and the respawn-trigger key (`<port>:<modelId>`). Goose is configured purely
 * via env vars — no config file is written. See `src-tauri/.../local_agent.rs`.
 */
export interface LocalAgentConfig {
  configPath: string;
  /** Env vars (Goose provider + XDG isolation paths) the spawn must inject to
   *  point Goose at the bundled server and isolate its config tree. The only
   *  key is a dummy the local server ignores — never real secrets. */
  env: Record<string, string>;
  /** `<port>:<modelId>` — changes when the server port or active model changes. */
  configKey: string;
  /** The bundled server port the config points at (for the Seatbelt allow). */
  port: number;
  modelId: string;
}

/** Stage the smoke test reached. `done` = success; otherwise the failed stage. */
export type SmokeStage = 'health' | 'spawn' | 'session' | 'prompt' | 'done';

/** Result of `acp_agent_smoke_test` — see `src-tauri/.../acp.rs`. */
export interface SmokeTestReport {
  ok: boolean;
  stage: SmokeStage;
  error?: string;
  elapsedMs: number;
}

/** Params for `acpAgentSmokeTest` — mirrors the spawn surface plus the bundled
 *  server health gate (`requireLocalServer`). */
export interface SmokeTestParams {
  agentBinary: string;
  agentArgs?: string[] | null;
  workingDirectory: string;
  envVars?: Record<string, string> | null;
  connectionId?: string | null;
  envVarKeys?: string[] | null;
  sandboxEnabled?: boolean | null;
  sandboxPaths?: string[] | null;
  networkSandboxEnabled?: boolean | null;
  networkAllowedDomains?: string[] | null;
  kernelNetworkDeny?: boolean | null;
  extraLocalhostPorts?: number[] | null;
  requireLocalServer?: boolean | null;
}

// ---------------------------------------------------------------------------
// Managed agent binary types (agent_manager.rs)
// ---------------------------------------------------------------------------

/** Where an agent binary was resolved from (mirrors Rust `BinaryResolution`). */
export interface AgentBinaryResolution {
  path: string;
  source: 'managed' | 'system';
  version: string | null;
}

// ---------------------------------------------------------------------------
// MCP IPC types (mcp.rs) — mirror the Rust structs returned over IPC.
// Structurally compatible with the frontend `McpToolInfo` in mcp-store.
// ---------------------------------------------------------------------------

export interface McpToolInfoIpc {
  name: string;
  description: string | null;
  input_schema: Record<string, unknown>;
  server_id: string;
}

/** Subset of Rust `McpServerInfo` the status-refresh flow consumes. */
export interface McpServerInfoIpc {
  id: string;
  name: string;
  status: 'stopped' | 'starting' | 'running' | 'error';
  error: string | null;
  tools: McpToolInfoIpc[];
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

export interface SkillToolEntry {
  tool_name: string;
  description: string;
  skill_name: string;
  script_path: string;
  parameters: Record<string, unknown>;
  arg_mapping: ArgMapping[];
  explicit_schema: boolean;
}

export interface ArgMapping {
  param_name: string;
  mapping_type: ArgMappingType;
  position?: number;
}

export type ArgMappingType =
  | { type: 'Positional' }
  | { type: 'Flag'; value: { flag: string } }
  | { type: 'BoolFlag'; value: { flag: string } }
  | { type: 'Spread' };

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

export interface CopilotContextPayload {
  uri: string;
  content: string;
  languageId: string;
}

export interface CopilotToolResultPayload {
  content: string | Array<{ value: string }>;
  is_error?: boolean;
  status?: string;
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

/**
 * Result row from `index_search_filenames` — backs the FloatingCommandBar
 * `:file` verb mode (PRD `2026-04-28-cmd-bar-verb-prefixes`).
 *
 * `project_root` is `null` for files indexed under the global DB
 * (`~/Notesage` quick notes, etc.) so the picker can render a "library"
 * badge instead of a project badge. `parent_dir` is derived from `path`
 * server-side so renames stay consistent.
 */
export interface IndexFilenameSearchResult {
  path: string;
  file_name: string;
  parent_dir: string;
  project_root: string | null;
}

export interface IndexStats {
  file_count: number;
  tag_count: number;
  mention_count: number;
  task_count: number;
  goal_count: number;
  indexed_at: number;
}

// ---------------------------------------------------------------------------
// Link graph (OKF wiki-navigation) — `links.db` query results.
//
// IMPORTANT: every field below is SNAKE_CASE on purpose — the Rust IPC structs
// in `src-tauri/src/index/links.rs` (`BacklinkGroup`, `LinkRow`, `WikiTarget`)
// serialize snake_case to match the rest of the `index::*` command surface.
// Do NOT camelCase these — the wire shape must match the backend exactly.
// ---------------------------------------------------------------------------

/** One occurrence of a backlink: a single edge from a source document. */
export interface BacklinkOccurrence {
  link_text: string;
  context: string;
}

/** Backlinks ("Linked from") grouped by their source document (ADR 0006). */
export interface BacklinkGroup {
  source_path: string;
  source_title: string | null;
  source_type: string | null;
  source_description: string | null;
  occurrences: BacklinkOccurrence[];
}

/** One outgoing ("Links to") link row, enriched with the target's frontmatter. */
export interface LinkRow {
  source_path: string;
  target_path: string;
  link_text: string;
  context: string;
  is_internal: boolean;
  /** `true` when the target resolves to a known in-scope file. */
  resolved: boolean;
  target_title: string | null;
  target_type: string | null;
  target_description: string | null;
}

/** A wikilink resolution candidate (filename + title match, ADR 0002). */
export interface WikiTarget {
  path: string;
  title: string | null;
  doc_type: string | null;
  description: string | null;
}

export type ActionSourceType = 'task' | 'comment' | 'agent' | 'goal';
export type ActionStatus = 'open' | 'done' | 'delegated' | 'pending' | 'running' | 'completed' | 'error';

export interface ActionItem {
  id: string;
  source_type: ActionSourceType;
  status: ActionStatus;
  text: string;
  file_path: string;
  line_number?: number;
  project_name?: string;
  project_root?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

export type DomainDecision = 'allow_once' | 'allow_session' | 'allow_always' | 'deny';

/**
 * Auth method descriptor from ACP `initialize`. Matches the Rust
 * `AuthMethodInfo` enum shape (externally-tagged union via `type`).
 * See `src/lib/ai/acp-utils.ts` for the canonical definition.
 */
export type AcpAuthMethodInfo =
  | {
      type: 'agent';
      id: string;
      name: string;
      description?: string | null;
    }
  | {
      type: 'env_var';
      id: string;
      name: string;
      description?: string | null;
      vars: { name: string; label?: string; secret: boolean; optional: boolean }[];
      link?: string | null;
    };

export interface AcpSpawnResult {
  instance_id: string;
  agent_name: string | null;
  agent_version: string | null;
  auth_methods: AcpAuthMethodInfo[];
  network_sandbox_enabled: boolean;
  /** Agent-advertised capabilities from the `initialize` response. */
  capabilities?: unknown;
}

// ---------------------------------------------------------------------------
// Transcription types
// ---------------------------------------------------------------------------

/**
 * A timestamped transcript segment from the whole-file transcription command
 * (`transcribe_file`). Mirrors the Rust `TranscriptSegment` struct in
 * `src-tauri/src/commands/transcription.rs`. That struct has no
 * `#[serde(rename_all)]` attribute, so the JSON keys are the verbatim
 * snake_case Rust field names. `speaker_id` / `speaker_name` are reserved for a
 * future diarization + naming pass and are always `null` in v1.
 */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker_id: string | null;
  speaker_name: string | null;
}

/**
 * Result of `transcribe_file` — ordered timestamped segments for a whole audio
 * file. Mirrors the Rust `TranscriptionResult` struct (no serde rename, so the
 * `duration_secs` key is snake_case).
 */
export interface TranscriptionResult {
  segments: TranscriptSegment[];
  duration_secs: number;
  language: string;
}

/**
 * Result of `stop_recording` — the finalized WAV path plus signal metadata for
 * the frontend's silence-detection warning. Mirrors the Rust `RecordingResult`
 * struct (no serde rename, so `duration_secs` / `sample_rate` are snake_case).
 */
export interface RecordingResult {
  path: string;
  duration_secs: number;
  sample_rate: number;
  source: string;
  rms: number;
  peak: number;
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
  mmproj_filename?: string;
  mmproj_url?: string;
  mmproj_size_bytes?: number;
  multilingual: boolean;
  recommended_for: string[];
}

// ---------------------------------------------------------------------------
// Hugging Face search types
// ---------------------------------------------------------------------------

export interface HfModelSearchResult {
  repo_id: string;
  model_name: string;
  author: string;
  base_model: string | null;
  license: string | null;
  architecture: string | null;
  context_length: number | null;
  total_size: number | null;
  downloads: number;
  likes: number;
  tags: string[];
  supports_tool_calling: boolean;
  supports_thinking: boolean;
  supports_vision: boolean;
  files: HfModelFile[];
}

export interface HfModelFile {
  filename: string;
  size_bytes: number;
  download_url: string;
  quantization: string;
}

export interface HfModelDetails {
  repo_id: string;
  model_name: string;
  author: string;
  base_model: string | null;
  license: string | null;
  architecture: string | null;
  context_length: number | null;
  pipeline_tag: string | null;
  downloads: number;
  likes: number;
  supports_tool_calling: boolean;
  supports_thinking: boolean;
  supports_vision: boolean;
  supports_fim: boolean;
  multilingual: boolean;
  files: HfModelFile[];
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

// ---------------------------------------------------------------------------
// Hardware-aware model recommendation types
// (mirror src-tauri/src/commands/model_fit/types.rs)
// ---------------------------------------------------------------------------

export interface HardwareProfile {
  total_ram_bytes: number;
  available_ram_bytes: number;
  chip_name: string;
  bandwidth_gbs: number;
  is_unified: boolean;
  backend: string; // "metal" | "cpu"
}

export interface GgufCapabilities {
  architecture: string | null;
  context_length: number | null;
  has_fim_tokens: boolean;
  has_tool_template: boolean;
  has_thinking: boolean;
  gguf_version: number;
  truncated: boolean;
}

export interface ModelFitInput {
  id: string;
  file_size_bytes: number;
  params_b: number;
  active_params_b?: number | null;
  quant: string;
}

export type Fit = 'fits' | 'tight' | 'wont-fit';
export type Speed = 'fast' | 'ok' | 'sluggish' | 'unusable';

export interface ModelFitResult {
  id: string;
  est_ram_bytes: number;
  fit: Fit;
  est_tok_per_sec: number;
  speed: Speed;
  runnable: boolean;
  reasons: string[];
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

export interface LinkMetadata {
  url: string;
  title: string | null;
  description: string | null;
  site_name: string | null;
  image_url: string | null;
  favicon_url: string | null;
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

  async listDirectory(path: string, showHidden?: boolean): Promise<FileEntry[]> {
    return await invoke<FileEntry[]>("list_directory", { path, showHidden });
  },

  async listFilesShallow(path: string, showHidden?: boolean): Promise<FileEntry[]> {
    return await invoke<FileEntry[]>("list_files_shallow", { path, showHidden });
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

  async openFileDialog(
    filterName?: string,
    filterExtensions?: string[],
  ): Promise<string | null> {
    return await invoke<string | null>("open_file_dialog", {
      filterName,
      filterExtensions,
    });
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

  // Grant the WebView asset-protocol read access to a user-opened workspace
  // root (replaces the removed blanket `$HOME/**` static asset scope — security
  // H1). Called for every root in `useStartWatchers`.
  async allowAssetDir(path: string): Promise<void> {
    await invoke("allow_asset_dir", { path });
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
    projectRoot?: string;
    typography?: BackendTypographyPresets;
    embeddedSvgs?: string[];
  }): Promise<number[]> {
    return await invoke<number[]>("export_pdf", options);
  },

  async saveBinaryFile(path: string, data: number[]): Promise<void> {
    await invoke("save_binary_file", { path, data });
  },

  async exportPptx(options: {
    markdown: string;
    title: string;
    template: string;
    embeddedSvgs?: string[];
  }): Promise<number[]> {
    return await invoke<number[]>("export_pptx", options);
  },

  async exportDocx(options: {
    markdown: string;
    title: string;
    template: string;
    includeToc: boolean;
    includePageNumbers: boolean;
    pageSize: string;
    projectRoot?: string;
    typography?: BackendTypographyPresets;
    embeddedSvgs?: string[];
  }): Promise<number[]> {
    return await invoke<number[]>("export_docx", options);
  },

  async renderHtml(options: {
    markdown: string;
    title: string;
    theme: string;
    includeStyles: boolean;
    projectRoot?: string;
    typography?: BackendTypographyPresets;
    embeddedSvgs?: string[];
  }): Promise<string> {
    return await invoke<string>("render_html", options);
  },

  /**
   * Render a markdown file to an HTML body fragment for the instant-load
   * preview surface. Reads the file, strips YAML frontmatter, runs comrak
   * via the existing render_html infrastructure. See
   * docs/prds/2026-05-03-large-file-instant-load.md (Phase 1, Layer 1).
   */
  async renderMarkdownPreview(options: {
    path: string;
    projectRoot?: string;
    theme: "light" | "dark";
  }): Promise<string> {
    return await invoke<string>("render_markdown_preview", options);
  },

  async importPptxTemplate(options: {
    sourcePath: string;
    scope: string;
    projectRoot?: string;
  }): Promise<PptxTemplateInfo> {
    return await invoke<PptxTemplateInfo>("import_pptx_template", options);
  },

  async listPptxTemplates(projectRoot?: string): Promise<PptxTemplateInfo[]> {
    return await invoke<PptxTemplateInfo[]>("list_pptx_templates", { projectRoot });
  },

  async deletePptxTemplate(options: {
    templateId: string;
    scope: string;
    projectRoot?: string;
  }): Promise<void> {
    await invoke("delete_pptx_template", options);
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

  /**
   * Migrate user-supplied content out of `.notesage/` hidden folders.
   *
   * Moves `.notesage/research/` → `research/` and
   * `.notesage/pptx-templates/` → `templates/` within the given folder.
   *
   * Returns the number of migrated items and any collision sub-directory
   * names (where the destination already had existing content).
   */
  async migrateUserContentPaths(folderPath: string): Promise<{ migrated: number; collisions: string[] }> {
    return await invoke<{ migrated: number; collisions: string[] }>(
      "migrate_user_content_paths",
      { folderPath },
    );
  },

  // ACP (Agent Client Protocol) operations
  async acpAgentSpawn(
    agentBinary: string,
    agentArgs: string[] | null,
    role: string,
    workingDirectory: string,
    sandboxEnabled?: boolean | null,
    sandboxPaths?: string[] | null,
    networkSandboxEnabled?: boolean | null,
    networkAllowedDomains?: string[] | null,
    kernelNetworkDeny?: boolean | null,
    /** Connection id + env-var names for keychain secret resolution at spawn
     *  (`notesage:<connectionId>:env:<KEY>`). Values never transit IPC here. */
    connectionId?: string | null,
    envVarKeys?: string[] | null,
    /** Inline env passed to the spawned agent (e.g. the Local Agent preset's
     *  generated Goose env). Keychain-resolved values still win backend-side. */
    envVars?: Record<string, string> | null,
    /** Extra localhost ports to allow through the kernel network sandbox
     *  alongside the proxy port (e.g. the bundled llama-server port, #9). */
    extraLocalhostPorts?: number[] | null,
  ): Promise<AcpSpawnResult> {
    return await invoke<AcpSpawnResult>("acp_agent_spawn", {
      agentBinary,
      agentArgs,
      role,
      workingDirectory,
      sandboxEnabled: sandboxEnabled ?? null,
      sandboxPaths: sandboxPaths ?? null,
      networkSandboxEnabled: networkSandboxEnabled ?? null,
      networkAllowedDomains: networkAllowedDomains ?? null,
      kernelNetworkDeny: kernelNetworkDeny ?? null,
      connectionId: connectionId ?? null,
      envVarKeys: envVarKeys ?? null,
      envVars: envVars ?? null,
      extraLocalhostPorts: extraLocalhostPorts ?? null,
    });
  },

  async acpAgentStop(instanceId: string): Promise<void> {
    await invoke("acp_agent_stop", { instanceId });
  },

  async acpAgentAuthenticate(instanceId: string): Promise<void> {
    await invoke("acp_agent_authenticate", { instanceId });
  },

  /**
   * Regenerate the Local Agent (Goose) env from the LIVE bundled llama-server
   * state and return the provider/isolation env + respawn trigger key. Used
   * by `ensureAcpAgent` for `localAgentPreset` connections (tasks #8/#10).
   * Rejects when the bundled server is not running / has no active model.
   */
  async localAgentWriteConfig(): Promise<LocalAgentConfig> {
    return await invoke<LocalAgentConfig>("local_agent_write_config");
  },

  /**
   * Bounded end-to-end verification of an ACP agent (health → spawn → session →
   * one prompt → teardown). Always resolves to a `SmokeTestReport` (never throws
   * for stage failures) so callers can branch on `ok` + `stage` (tasks #12/#13/#16).
   */
  async acpAgentSmokeTest(params: SmokeTestParams): Promise<SmokeTestReport> {
    return await invoke<SmokeTestReport>("acp_agent_smoke_test", {
      agentBinary: params.agentBinary,
      agentArgs: params.agentArgs ?? null,
      workingDirectory: params.workingDirectory,
      envVars: params.envVars ?? null,
      connectionId: params.connectionId ?? null,
      envVarKeys: params.envVarKeys ?? null,
      sandboxEnabled: params.sandboxEnabled ?? null,
      sandboxPaths: params.sandboxPaths ?? null,
      networkSandboxEnabled: params.networkSandboxEnabled ?? null,
      networkAllowedDomains: params.networkAllowedDomains ?? null,
      kernelNetworkDeny: params.kernelNetworkDeny ?? null,
      extraLocalhostPorts: params.extraLocalhostPorts ?? null,
      requireLocalServer: params.requireLocalServer ?? null,
    });
  },

  async acpSessionNew(
    instanceId: string,
    workingDirectory: string,
    /** MCP servers to attach to the session (task #11). Omit for no MCP. */
    mcpServers?: AcpMcpServerInput[] | null,
  ): Promise<AcpSessionResult> {
    return await invoke<AcpSessionResult>("acp_session_new", {
      instanceId,
      workingDirectory,
      mcpServers: mcpServers ?? null,
    });
  },

  async acpSessionLoad(
    instanceId: string,
    sessionId: string,
    workingDirectory: string,
    /** MCP servers for the reloaded session (task #11). Omit for no MCP. */
    mcpServers?: AcpMcpServerInput[] | null,
  ): Promise<AcpSessionResult> {
    return await invoke<AcpSessionResult>("acp_session_load", {
      instanceId,
      sessionId,
      workingDirectory,
      mcpServers: mcpServers ?? null,
    });
  },

  async acpSessionClose(instanceId: string, sessionId: string): Promise<void> {
    await invoke("acp_session_close", { instanceId, sessionId });
  },

  async acpSessionList(instanceId: string, cwd?: string, cursor?: string): Promise<AcpListResult> {
    return await invoke<AcpListResult>("acp_session_list", {
      instanceId,
      cwd: cwd ?? null,
      cursor: cursor ?? null,
    });
  },

  async acpSessionResume(instanceId: string, sessionId: string, workingDirectory: string): Promise<AcpSessionResult> {
    return await invoke<AcpSessionResult>("acp_session_resume", { instanceId, sessionId, workingDirectory });
  },

  async acpSessionFork(instanceId: string, sessionId: string, workingDirectory: string): Promise<AcpSessionResult> {
    return await invoke<AcpSessionResult>("acp_session_fork", { instanceId, sessionId, workingDirectory });
  },

  async acpSessionPrompt(
    instanceId: string,
    sessionId: string,
    content: string,
    images?: Array<{ data: string; mime_type: string }>,
  ): Promise<void> {
    await invoke("acp_session_prompt", {
      instanceId,
      sessionId,
      content,
      images: images ?? null,
    });
  },

  async acpSupportsImages(instanceId: string): Promise<boolean> {
    return invoke<boolean>("acp_supports_images", { instanceId });
  },

  async acpSessionCancel(instanceId: string, sessionId: string): Promise<void> {
    await invoke("acp_session_cancel", { instanceId, sessionId });
  },

  async acpSessionSetMode(instanceId: string, sessionId: string, modeId: string): Promise<void> {
    await invoke("acp_session_set_mode", { instanceId, sessionId, modeId });
  },

  async acpSessionSetConfigOption(instanceId: string, sessionId: string, optionId: string, valueId: string): Promise<void> {
    await invoke("acp_session_set_config_option", { instanceId, sessionId, optionId, valueId });
  },

  async acpPermissionRespond(instanceId: string, requestId: string, optionId: string | null): Promise<void> {
    await invoke("acp_permission_respond", { instanceId, requestId, optionId });
  },

  // Ollama vision capability detection
  async ollamaModelSupportsVision(ollamaUrl: string | null, model: string, baseUrl?: string): Promise<boolean> {
    return invoke<boolean>("ollama_model_supports_vision", { ollamaUrl, model, baseUrl: baseUrl ?? null });
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
  async openaiCompatibleFimCompletion(baseUrl: string, connectionId: string | undefined, model: string, prefix: string, suffix: string, maxTokens?: number): Promise<string> {
    return await invoke<string>("openai_completions_fim", {
      baseUrl,
      connectionId: connectionId ?? null,
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

  // AI model listing — provider must match the Rust AIProviderType enum
  async listModels(provider: AIProviderType | string, connectionId?: string, baseUrl?: string): Promise<string[]> {
    return await invoke<string[]>("list_models", {
      provider,
      connectionId: connectionId ?? null,
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

  // Log level
  async setLogLevel(level: string): Promise<void> {
    await invoke("set_log_level", { level });
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

  async collectDiagnostics(): Promise<Record<string, unknown>> {
    return await invoke<Record<string, unknown>>("collect_diagnostics");
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

  // Network sandboxing proxy
  async networkDomainRespond(instanceId: string, requestId: string, decision: DomainDecision): Promise<void> {
    await invoke('network_domain_respond', { instanceId, requestId, decision });
  },

  async networkDefaultDomains(agentId: string): Promise<string[]> {
    return await invoke<string[]>('network_default_domains', { agentId });
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

  async indexReset(projectPath?: string): Promise<void> {
    await invoke("index_reset", { projectPath: projectPath ?? null });
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

  async indexSearchFilenames(
    projectPaths: string[],
    query: string,
    limit?: number,
  ): Promise<IndexFilenameSearchResult[]> {
    return await invoke<IndexFilenameSearchResult[]>("index_search_filenames", {
      projectPaths,
      query,
      limit: limit ?? null,
    });
  },

  async indexStats(projectPath?: string): Promise<IndexStats> {
    return await invoke<IndexStats>("index_stats", { projectPath: projectPath ?? null });
  },

  // --- Link graph (OKF wiki-navigation, ADR 0002–0007) ---
  // All four query the standalone `links.db`, not the content index.

  /** Backlinks ("Linked from") for `path`, grouped by source document. */
  async getBacklinks(path: string): Promise<BacklinkGroup[]> {
    return await invoke<BacklinkGroup[]>("get_backlinks", { path });
  },

  /** Outgoing ("Links to") links from `path`, enriched with target frontmatter. */
  async getOutlinks(path: string): Promise<LinkRow[]> {
    return await invoke<LinkRow[]>("get_outlinks", { path });
  },

  /** Broken / dangling internal links across `scope` (empty = all). */
  async getBrokenLinks(scope: string[]): Promise<LinkRow[]> {
    return await invoke<LinkRow[]>("get_broken_links", { scope });
  },

  /**
   * Resolve a wikilink `query` against the link store (filename + title,
   * workspace-global). The main consumer is the `[[` authoring extension
   * (#11), but the binding lands here with the rest of the link graph.
   */
  async resolveWikilink(query: string, limit?: number): Promise<WikiTarget[]> {
    return await invoke<WikiTarget[]>("resolve_wikilink", {
      query,
      limit: limit ?? null,
    });
  },

  // Automations
  async listAutomations(baseDirs: string[]): Promise<AutomationFile[]> {
    return await invoke<AutomationFile[]>("list_automations", { baseDirs });
  },

  async saveAutomation(path: string, yaml: string): Promise<void> {
    await invoke("save_automation", { path, yaml });
  },

  async deleteAutomation(path: string): Promise<void> {
    await invoke("delete_automation", { path });
  },

  async validateAutomation(yaml: string): Promise<AutomationValidation> {
    return await invoke<AutomationValidation>("validate_automation", { yaml });
  },

  /** Resolve a document-step write path within `base`, rejecting absolute paths
   *  and `..` traversal. Rejects (throws) if the path would escape the scope. */
  async resolveAutomationWritePath(base: string, relPath: string): Promise<string> {
    return await invoke<string>("resolve_automation_write_path", { base, relPath });
  },

  /** Master enable flag — also gates the scheduler tick loop. */
  async setAutomationsEnabled(enabled: boolean): Promise<void> {
    await invoke("set_automations_enabled", { enabled });
  },

  /** Rebuild the active schedule from disk; the first call per launch also
   *  emits `automations-missed` for the catch-up chooser. Returns the count. */
  async reloadAutomationSchedule(baseDirs: string[]): Promise<number> {
    return await invoke<number>("reload_automation_schedule", { baseDirs });
  },

  // Skill & agent operations
  async discoverSkills(baseDirs: string[]): Promise<SkillEntry[]> {
    return await invoke<SkillEntry[]>("discover_skills", { baseDirs });
  },

  async extractSkillTools(skillEntries: SkillEntry[]): Promise<SkillToolEntry[]> {
    return await invoke<SkillToolEntry[]>("extract_skill_tools", { skillEntries });
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
    /** SHA-256 of the approved script body — backend refuses to run a script
     *  whose content has changed since approval (security audit HIGH #2). */
    expectedHash?: string | null;
  }): Promise<ScriptResult> {
    return await invoke<ScriptResult>("execute_skill_script", options);
  },

  /** SHA-256 (hex) of a skill script, used to content-pin "allow always"
   *  approvals to the exact bytes the user approved. */
  async hashSkillScript(skillPath: string, script: string): Promise<string> {
    return await invoke<string>("hash_skill_script", { skillPath, script });
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

  async cleanupBundledAgents(): Promise<number> {
    return await invoke<number>("cleanup_bundled_agents");
  },

  // Voice transcription operations
  async startRecording(source: string): Promise<void> {
    await invoke("start_recording", { source });
  },

  /** Pause the live capture — samples are discarded while the stream stays alive. */
  async pauseRecording(): Promise<void> {
    await invoke("pause_recording");
  },

  /** Resume a paused capture. */
  async resumeRecording(): Promise<void> {
    await invoke("resume_recording");
  },

  async stopRecording(): Promise<RecordingResult> {
    return await invoke<RecordingResult>("stop_recording");
  },

  /**
   * Transcribe a finalized audio file in a single whole-file Whisper pass.
   * Emits `transcription-progress` events keyed by `jobId`.
   */
  async transcribeFile(jobId: string, path: string, model: string, language?: string): Promise<TranscriptionResult> {
    return await invoke<TranscriptionResult>("transcribe_file", {
      jobId,
      path,
      model,
      language: language ?? null,
    });
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

  async addCustomLocalModel(name: string, url: string, metadata?: {
    supportsToolCalling?: boolean;
    supportsThinking?: boolean;
    supportsVision?: boolean;
    multilingual?: boolean;
    supportsFim?: boolean;
    author?: string;
    architecture?: string;
    contextLength?: number;
    license?: string;
    baseModel?: string;
  }): Promise<LocalModelInfo> {
    return await invoke<LocalModelInfo>("add_custom_local_model", {
      name,
      url,
      supportsToolCalling: metadata?.supportsToolCalling ?? null,
      supportsThinking: metadata?.supportsThinking ?? null,
      supportsVision: metadata?.supportsVision ?? null,
      multilingual: metadata?.multilingual ?? null,
      supportsFim: metadata?.supportsFim ?? null,
      author: metadata?.author ?? null,
      architecture: metadata?.architecture ?? null,
      contextLength: metadata?.contextLength ?? null,
      license: metadata?.license ?? null,
      baseModel: metadata?.baseModel ?? null,
    });
  },

  async removeCustomLocalModel(modelId: string): Promise<void> {
    await invoke("remove_custom_local_model", { modelId });
  },

  async searchHuggingfaceModels(query: string, limit?: number, author?: string): Promise<HfModelSearchResult[]> {
    return await invoke<HfModelSearchResult[]>("search_huggingface_models", { query, limit: limit ?? null, author: author ?? null });
  },

  async fetchHfModelDetails(repoId: string): Promise<HfModelDetails> {
    return await invoke<HfModelDetails>("fetch_hf_model_details", { repoId });
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

  // Dedicated FIM (`/infill`) server — runs alongside the main chat server
  // without `--jinja` so tool calling on chat AND fast native FIM on
  // completions can coexist. See item #8 in `docs/features/ai-providers.md`.
  async startCompletionServer(
    modelId: string,
    contextLength?: number,
    gpuLayers?: number,
  ): Promise<number> {
    return await invoke<number>("start_completion_server", {
      modelId,
      contextLength: contextLength ?? null,
      gpuLayers: gpuLayers ?? null,
    });
  },

  async stopCompletionServer(): Promise<void> {
    await invoke("stop_completion_server");
  },

  async getCompletionServerStatus(): Promise<LocalServerStatus> {
    return await invoke<LocalServerStatus>("get_completion_server_status");
  },

  async checkLlamaServerAvailable(): Promise<BinaryStatus> {
    return await invoke<BinaryStatus>("check_llama_server_available");
  },

  // Model metadata
  async getModelMetadata(modelId: string, modelType: 'llm' | 'whisper'): Promise<ModelMetadata> {
    return await invoke<ModelMetadata>("get_model_metadata", { modelId, modelType });
  },

  async getRuntimeModelMetadata(port: number): Promise<ModelMetadata> {
    return await invoke<ModelMetadata>("get_runtime_model_metadata", { port });
  },

  // Link preview metadata
  async fetchLinkMetadata(url: string): Promise<LinkMetadata> {
    return await invoke<LinkMetadata>("fetch_link_metadata", { url });
  },

  // Copilot LSP conversation operations
  copilotLspConversationCreate(message: string, model?: string, tools?: Array<{ name: string; description: string; inputSchema: unknown }>, docUri?: string, docLanguageId?: string) {
    return invoke<{ conversationId: string; turnId: string }>('copilot_lsp_conversation_create', { message, model: model ?? null, tools: tools ?? null, docUri: docUri ?? null, docLanguageId: docLanguageId ?? null });
  },

  copilotLspConversationTurn(conversationId: string, message: string, model?: string, docUri?: string, docLanguageId?: string) {
    return invoke<{ conversationId: string; turnId: string }>('copilot_lsp_conversation_turn', { conversationId, message, model: model ?? null, docUri: docUri ?? null, docLanguageId: docLanguageId ?? null });
  },

  copilotLspConversationDestroy(conversationId: string) {
    return invoke<void>('copilot_lsp_conversation_destroy', { conversationId });
  },

  copilotLspConversationModels() {
    return invoke<Array<{ id: string; name: string; provider: string }>>('copilot_lsp_conversation_models');
  },

  copilotLspContextResponse(requestId: string, context: CopilotContextPayload | null | unknown[]) {
    return invoke<void>('copilot_lsp_context_response', { requestId, context });
  },

  copilotLspToolResult(requestId: string, result: CopilotToolResultPayload) {
    return invoke<void>('copilot_lsp_tool_result', { requestId, result });
  },

  copilotLspToolConfirmationResponse(requestId: string, accepted: boolean) {
    return invoke<void>('copilot_lsp_tool_confirmation_response', { requestId, accepted });
  },

  copilotLspStart(workingDirectory: string) {
    return invoke<void>('copilot_lsp_start', { workingDirectory });
  },

  copilotLspDidOpen(uri: string, content: string, version: number) {
    return invoke<void>('copilot_lsp_did_open', { uri, content, version });
  },

  // --- Hardware-aware model recommendation ---
  detectHardwareProfile(): Promise<HardwareProfile> {
    return invoke<HardwareProfile>('detect_hardware_profile');
  },

  readGgufCapabilities(
    resolveUrl: string | null,
    localPath: string | null,
  ): Promise<GgufCapabilities> {
    return invoke<GgufCapabilities>('read_gguf_capabilities', { resolveUrl, localPath });
  },

  estimateModelFit(
    candidates: ModelFitInput[],
    profile: HardwareProfile,
    planningCtx: number,
  ): Promise<ModelFitResult[]> {
    return invoke<ModelFitResult[]>('estimate_model_fit', { candidates, profile, planningCtx });
  },

  // Current RSS (bytes) of the running bundled chat server — used by the
  // Phase 2 runtime calibration loop to track peak RAM during a generation.
  getLocalServerRss(): Promise<number> {
    return invoke<number>('get_local_server_rss');
  },

  // --- Managed agent binaries (agent_manager.rs) ---

  /** Remove a Notesage-managed agent binary (~/.notesage/agents/bin/<agentId>)
   *  and its version entry. Connection settings are untouched. */
  async agentUninstall(agentId: string): Promise<void> {
    await invoke('agent_uninstall', { agentId });
  },

  /** Resolve where an agent binary comes from (managed install vs PATH).
   *  `null` when the binary can't be found at all. */
  async agentResolveBinary(agentId: string): Promise<AgentBinaryResolution | null> {
    return await invoke<AgentBinaryResolution | null>('agent_resolve_binary', { agentId });
  },

  // --- Copilot LSP auth ---

  /** Sign out of GitHub Copilot via the LSP. Errors if the LSP is not running. */
  async copilotLspSignOut(): Promise<void> {
    await invoke('copilot_lsp_sign_out');
  },

  // --- MCP servers (mcp.rs) ---

  /** Cache-first tool listing for a registered MCP server. Returns the cached
   *  tools when non-empty; live-queries the server (and updates the backend
   *  cache) when the cache is empty or `refresh` is true. */
  async mcpListTools(serverId: string, refresh = false): Promise<McpToolInfoIpc[]> {
    return await invoke<McpToolInfoIpc[]>('mcp_list_tools', { serverId, refresh });
  },

  /** Snapshot of every MCP server registered in the backend (status, error,
   *  cached tools). Servers that were never started do not appear. */
  async mcpGetServerStatus(): Promise<McpServerInfoIpc[]> {
    return await invoke<McpServerInfoIpc[]>('mcp_get_server_status');
  },

  // --- File-backed store (store.rs) ---

  /** Batch-read multiple `~/.notesage/state/<key>.json` files in one IPC call.
   *  Missing keys are omitted from the result map. */
  async storeReadBatch(keys: string[]): Promise<Record<string, string>> {
    return await invoke<Record<string, string>>('store_read_batch', { keys });
  },
};
