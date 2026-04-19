// Types and pure utility functions shared across ACP modules
// (useAcpLifecycle, useAgentTaskOperations, useAcpSessionListeners)

import { useWorkspaceStore } from '@/stores/workspace-store';
import type { ToolCallContentItem } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// ACP types
// ---------------------------------------------------------------------------

/** Env var descriptor from ACP `AuthMethod::EnvVar`. */
export interface AuthEnvVar {
  /** Name of the environment variable (e.g. `GEMINI_API_KEY`). */
  name: string;
  /** Optional user-facing label; falls back to `name` in the UI. */
  label?: string;
  /** Password-style input if true (default per ACP spec). */
  secret: boolean;
  /** Marks the var as skippable in the UI. */
  optional: boolean;
}

/**
 * Variant-aware auth method descriptor. Mirrors ACP's `AuthMethod` enum with
 * `unstable_auth_methods` enabled. The generic EnvVar flow in `ConnectAgent.tsx`
 * uses the `env_var` variant's `vars[]` and `link` to drive the input form.
 */
export type AuthMethodInfo =
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
      vars: AuthEnvVar[];
      link?: string | null;
    };

export interface AcpSpawnResult {
  instance_id: string;
  agent_name: string | null;
  agent_version: string | null;
  auth_methods: AuthMethodInfo[];
  sandbox_enabled: boolean;
  network_sandbox_enabled: boolean;
  supports_images: boolean;
  capabilities: AcpAgentCapabilities | null;
}

/**
 * Session sub-capabilities from ACP `AgentCapabilities.sessionCapabilities`.
 * The ACP schema encodes each as `Option<Session*Capabilities>` — `null`/missing
 * means unsupported, a non-null object means supported (we don't use the nested fields yet).
 */
export interface AcpSessionCapabilities {
  list?: unknown;
  fork?: unknown;
  resume?: unknown;
  close?: unknown;
}

/**
 * Agent capabilities as delivered over the wire. ACP schema uses
 * `#[serde(rename_all = "camelCase")]`, so JSON keys are camelCase.
 * We accept snake_case aliases as a safety net for older/custom agents
 * that may not follow the spec exactly.
 */
export interface AcpAgentCapabilities {
  loadSession?: boolean;
  /** @deprecated snake_case alias — prefer `loadSession`. */
  load_session?: boolean;
  promptCapabilities?: { image?: boolean };
  sessionCapabilities?: AcpSessionCapabilities;
  /** @deprecated snake_case alias — prefer `sessionCapabilities`. */
  session_capabilities?: AcpSessionCapabilities;
  [key: string]: unknown;
}

/** True when the agent advertises `loadSession` (tolerant of snake_case). */
export function hasLoadSessionCapability(
  caps: AcpAgentCapabilities | null | undefined,
): boolean {
  return caps?.loadSession === true || caps?.load_session === true;
}

/**
 * Returns true when the agent advertises the given session sub-capability.
 * ACP sends each capability as a nullable object — any non-null value counts as supported.
 * Tolerant of snake_case payloads.
 */
export function hasSessionCapability(
  caps: AcpAgentCapabilities | null | undefined,
  key: 'list' | 'fork' | 'resume' | 'close',
): boolean {
  const nested = caps?.sessionCapabilities ?? caps?.session_capabilities;
  const value = nested?.[key];
  return value !== undefined && value !== null;
}

export interface AcpModelInfo {
  model_id: string;
  name: string;
  description: string | null;
}

export interface AcpSessionModeState {
  currentModeId: string;
  availableModes: { id: string; name: string; description?: string }[];
}

export interface AcpSessionConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  /** Flattened from SessionConfigKind::Select — camelCase from ACP schema */
  currentValue?: string;
  /** Select options — agents use `value` field (not `id`) per ACP schema */
  options?: { id?: string; value?: string; name: string; description?: string }[];
  [key: string]: unknown;
}

export interface AcpSessionResult {
  session_id: string;
  current_model: string | null;
  available_models: AcpModelInfo[];
  modes: AcpSessionModeState | null;
  config_options: AcpSessionConfigOption[] | null;
}

/** One session entry returned by `session/list`. */
export interface AcpSessionInfo {
  session_id: string;
  cwd?: string;
}

/** Response from `session/list` — sessions plus an optional pagination cursor. */
export interface AcpListResult {
  sessions: AcpSessionInfo[];
  next_cursor: string | null;
}

/** Single content block as sent on `agent_message_chunk` / `agent_thought_chunk`. */
export type AcpContentBlock = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  /** Resource link fields (type === 'resource_link') */
  uri?: string;
  name?: string;
  description?: string;
  size?: number;
};

/**
 * Format an ACP `resource_link` content block as markdown. The inline markdown renderer
 * downstream handles click navigation (internal file links open as tabs; external URLs
 * open in the system browser via `link-click` extension + `src/lib/link-utils.ts`).
 *
 * - Name falls back to the URI basename when missing.
 * - A one-line description is appended on a new line, truncated to ~80 chars.
 */
export function formatResourceLinkAsMarkdown(block: AcpContentBlock): string {
  const uri = String(block.uri ?? '');
  if (!uri) return '';
  const basename = (u: string): string => {
    // Strip query/hash for the derived display name
    const clean = u.split('#')[0].split('?')[0];
    const parts = clean.replace(/\\/g, '/').split('/');
    const last = parts[parts.length - 1] || clean;
    return last || u;
  };
  const label = block.name && block.name.trim() ? block.name.trim() : basename(uri);
  const base = `[${label}](${uri})`;
  const desc = typeof block.description === 'string' ? block.description.trim() : '';
  if (!desc) return base;
  const MAX = 80;
  const truncated = desc.length > MAX ? desc.slice(0, MAX).trimEnd() + '\u2026' : desc;
  return `${base}\n${truncated}`;
}

/**
 * Raw content items from the ACP wire for `tool_call_update`. The ACP schema uses
 * snake_case (`old_text`, `new_text`), and `Content` wraps a ContentBlock in a `content`
 * field. We accept both camelCase and snake_case to tolerate variant implementations,
 * and normalize via {@link normalizeToolCallContent}.
 */
export interface RawToolCallContent {
  type?: string;
  // Diff variant
  path?: string;
  old_text?: string;
  oldText?: string;
  new_text?: string;
  newText?: string;
  // Terminal variant
  terminal_id?: string;
  terminalId?: string;
  // Content variant (wraps a ContentBlock)
  content?: AcpContentBlock;
  // Direct text (some agents send text content at the top level)
  text?: string;
  [key: string]: unknown;
}

export interface AcpSessionUpdate {
  sessionUpdate: string;
  /**
   * For `agent_message_chunk` / `agent_thought_chunk` this is a single ContentBlock object.
   * For `tool_call_update` the ACP spec says `content` is an array of `ToolCallContent` items
   * (Content / Diff / Terminal). Use `Array.isArray` as a type guard to narrow.
   */
  content?: AcpContentBlock | RawToolCallContent[];
  kind?: string;
  title?: string;
  rawInput?: string;
  [key: string]: unknown;
}

/**
 * Normalize a raw ACP `tool_call_update` content array into the frontend discriminated
 * union stored on `ToolCallSegment.content`. Unknown variants are dropped silently.
 * Terminal entries are preserved so the UI can render a placeholder.
 */
export function normalizeToolCallContent(raw: unknown): ToolCallContentItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCallContentItem[] = [];
  for (const item of raw as RawToolCallContent[]) {
    if (!item || typeof item !== 'object') continue;
    const kind = String(item.type ?? '').toLowerCase();
    if (kind === 'diff') {
      const path = String(item.path ?? '');
      const oldText = typeof item.oldText === 'string' ? item.oldText
        : typeof item.old_text === 'string' ? item.old_text
        : undefined;
      const newText = typeof item.newText === 'string' ? item.newText
        : typeof item.new_text === 'string' ? item.new_text
        : '';
      out.push({ type: 'diff', path, oldText, newText });
    } else if (kind === 'terminal') {
      const terminalId = String(item.terminalId ?? item.terminal_id ?? '');
      if (terminalId) out.push({ type: 'terminal', terminalId });
    } else if (kind === 'content' || kind === 'text') {
      // `Content` variant wraps a ContentBlock in `content` field per ACP schema.
      // Some agents also send text content as top-level `{ type: 'text', text: '...' }`.
      const text = typeof item.content?.text === 'string' ? item.content.text
        : typeof item.text === 'string' ? item.text
        : undefined;
      if (text) out.push({ type: 'text', text });
    }
  }
  return out;
}

export interface AcpSessionUpdatePayload {
  instanceId: string;
  sessionId: string;
  update: AcpSessionUpdate;
}

export interface AcpToolCall {
  kind?: string;
  type?: string;
  title?: string;
  name?: string;
  rawInput?: string;
}

export interface AcpPermissionOption {
  optionId?: string;
  id?: string;
  kind?: string;
  name?: string;
}

export interface AcpPermissionRequestPayload {
  instanceId: string;
  sessionId: string;
  requestId: string;
  toolCall: AcpToolCall | null;
  options: AcpPermissionOption[];
}

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/** Extract tool kind and title from an ACP toolCall payload. */
export function extractToolInfo(toolCall: unknown): { kind: string; title: string; input: string } {
  const tc = toolCall as Record<string, unknown> | null;
  return {
    kind: String(tc?.kind ?? tc?.type ?? 'unknown'),
    title: String(tc?.title ?? tc?.name ?? ''),
    input: typeof tc?.rawInput === 'string' ? tc.rawInput : JSON.stringify(tc?.rawInput ?? ''),
  };
}

/** Truncate a tool detail string (e.g. rawInput) for display. */
export function truncateDetail(text: unknown, max = 80): string {
  const str = typeof text === 'string' ? text : JSON.stringify(text ?? '');
  const oneLine = str.replace(/\n/g, ' ').trim();
  if (!oneLine || oneLine === '{}' || oneLine === '""' || oneLine === 'null') return '';
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max) + '\u2026';
}

/** Map ACP tool kind/title to a user-friendly label */
export function formatAcpToolName(kind?: string, title?: string): string {
  switch (kind?.toLowerCase()) {
    case 'fetch':
    case 'webfetch':
    case 'web_fetch':
      return 'Fetching resource';
    case 'web_search':
    case 'websearch':
      return 'Searching the web';
    case 'bash':
    case 'terminal':
    case 'execute':
      return 'Running command';
    case 'read':
    case 'read_file':
      return 'Reading file';
    case 'write':
    case 'write_file':
    case 'edit':
      return 'Editing file';
    case 'glob':
    case 'list':
    case 'list_directory':
      return 'Searching files';
    case 'grep':
    case 'search':
      return 'Searching content';
    case 'toolsearch':
    case 'tool_search':
      return 'ToolSearch';
    case 'think':
    case 'thinking':
      return 'Thinking';
    case 'execute_skill_script':
      return 'Running skill script';
    case 'read_skill_content':
      return 'Loading skill';
    default:
      if (title) return title;
      if (kind) return kind;
      return 'Working';
  }
}

/** Parse ACP rawInput (JSON string or object) into a Record for formatToolLabel */
export function parseRawInput(rawInput?: string | unknown): Record<string, unknown> {
  if (!rawInput) return {};
  if (typeof rawInput === 'object') return rawInput as Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawInput as string);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Format a descriptive tool call label from the tool kind and its arguments.
 * Returns a human-readable label like "Reading config.ts" instead of generic "Reading file".
 */
export function formatToolLabel(kind: string, args?: Record<string, unknown>, title?: string): string {
  const getArg = (...keys: string[]): string | undefined => {
    if (!args) return undefined;
    for (const key of keys) {
      const val = args[key];
      if (val !== undefined && val !== null && String(val).trim()) return String(val).trim();
    }
    return undefined;
  };

  /** Scan all arg values for a path-like string (contains / and ends in a filename) */
  const findPath = (): string | undefined => {
    if (!args) return undefined;
    for (const val of Object.values(args)) {
      const s = typeof val === 'string' ? val : '';
      if (s.includes('/') && /\/[^/]+\.\w+$/.test(s)) return s;
    }
    return undefined;
  };

  /** Scan all arg values for a URL */
  const findUrl = (): string | undefined => {
    if (!args) return undefined;
    for (const val of Object.values(args)) {
      const s = typeof val === 'string' ? val : '';
      if (/^https?:\/\//.test(s)) return s;
    }
    // Also check the raw string values for embedded URLs
    if (title && /^https?:\/\//.test(title)) return title;
    return undefined;
  };

  const basename = (p: string): string => {
    const parts = p.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || p;
  };

  const truncate = (text: string, max: number): string => {
    if (text.length <= max) return text;
    return text.slice(0, max) + '\u2026';
  };

  const hostname = (url: string): string => {
    try { return new URL(url).hostname; } catch { return truncate(url, 40); }
  };

  // Normalize kind to lowercase for matching
  const k = kind.toLowerCase();

  // Filter out title if it's just the kind name (no useful info)
  const effectiveTitle = title && title.toLowerCase() !== k && title !== 'Task' && title !== 'undefined' && title !== 'null'
    ? title : undefined;

  // Try to extract a path from the title (Claude Code often puts paths in titles)
  const titlePath = effectiveTitle && effectiveTitle.includes('/') ? effectiveTitle : undefined;

  switch (k) {
    case 'read':
    case 'read_file': {
      const path = getArg('path', 'file_path', 'file') ?? findPath() ?? titlePath;
      return path ? `Reading ${basename(path)}` : (effectiveTitle ? `Reading ${effectiveTitle}` : 'Reading file');
    }
    case 'write':
    case 'write_file':
    case 'edit': {
      const path = getArg('path', 'file_path', 'file') ?? findPath() ?? titlePath;
      return path ? `Editing ${basename(path)}` : (effectiveTitle ? `Editing ${effectiveTitle}` : 'Editing file');
    }
    case 'bash':
    case 'terminal':
    case 'execute': {
      const cmd = getArg('command', 'cmd');
      if (cmd) return `Running: ${truncate(cmd, 60)}`;
      if (effectiveTitle) return `Running: ${truncate(effectiveTitle, 60)}`;
      return 'Running command';
    }
    case 'glob':
    case 'list':
    case 'list_directory': {
      const target = getArg('pattern', 'path', 'directory') ?? titlePath;
      return target ? `Searching ${basename(target)}` : (effectiveTitle || 'Searching files');
    }
    case 'grep':
    case 'search': {
      const query = getArg('pattern', 'query', 'search');
      if (query) return `Searching for "${truncate(query, 40)}"`;
      if (effectiveTitle) return `Searching: ${truncate(effectiveTitle, 50)}`;
      return 'Searching';
    }
    case 'toolsearch':
    case 'tool_search':
      return effectiveTitle ? `ToolSearch: ${truncate(effectiveTitle, 50)}` : 'ToolSearch';
    case 'web_search': {
      const query = getArg('query', 'search_query');
      return query ? `Searching web: "${truncate(query, 40)}"` : (effectiveTitle || 'Searching the web');
    }
    case 'fetch':
    case 'webfetch':
    case 'web_fetch': {
      const url = getArg('url') ?? findUrl();
      if (url) return `Fetching ${hostname(url)}`;
      if (effectiveTitle) return `Fetching ${truncate(effectiveTitle, 50)}`;
      return 'Fetching resource';
    }
    case 'think':
    case 'thinking':
      return effectiveTitle ? `Thinking: ${truncate(effectiveTitle, 50)}` : 'Thinking';
    case 'skill':
    case 'execute_skill_script': {
      const skill = getArg('skill', 'name') ?? effectiveTitle;
      return skill ? `Skill (${truncate(skill, 40)})` : 'Running skill';
    }
    case 'read_skill_content': {
      const skill = getArg('skill', 'name') ?? effectiveTitle;
      return skill ? `Loading skill: ${skill}` : 'Loading skill';
    }
    case 'add_comments': {
      const comments = args?.comments;
      const count = Array.isArray(comments) ? comments.length : undefined;
      return count ? `Adding ${count} comment${count !== 1 ? 's' : ''}` : 'Adding comments';
    }
    case 'list_comments':
      return 'Reading comments';
    case 'resolve_comments': {
      const ids = args?.comment_ids;
      const count = Array.isArray(ids) ? ids.length : undefined;
      return count ? `Resolving ${count} comment${count !== 1 ? 's' : ''}` : 'Resolving comments';
    }
    case 'generate_pptx': {
      const tmpl = getArg('template');
      return tmpl ? `Generating presentation (${tmpl})` : 'Generating presentation';
    }
    default: {
      // Use title if it's more descriptive than the raw kind
      if (effectiveTitle && effectiveTitle.length > 0) return effectiveTitle;
      if (kind && kind.length > 0) return kind;
      return 'Working';
    }
  }
}

/**
 * Get all workspace folder paths (projects + explorer folders). Internal helper —
 * callers should use `getChatSandboxScope` instead to respect per-chat project scope.
 * Calling this directly re-introduces the broad-scope leak that the
 * project-data-isolation PRD closes.
 */
function getAllWorkspacePaths(): string[] {
  const ws = useWorkspaceStore.getState();
  const paths = new Set<string>();
  for (const p of ws.projects) paths.add(p.path);
  for (const f of ws.explorerFolders) paths.add(f.path);
  return [...paths];
}

/**
 * Resolve the sandbox scope for a chat conversation — the set of filesystem
 * paths the ACP agent is allowed to write to.
 *
 * Default mode (`crossProjectMode = false`): only the projects explicitly
 * selected in the chat footer (`conv.projectPaths`), unioned with the
 * connection's `extraWritablePaths`. This is the primary isolation guarantee
 * established by the project-data-isolation PRD.
 *
 * Cross-project mode (`crossProjectMode = true`): all workspace projects and
 * explorer folders are unioned in. Opt-in escape hatch for power-user workflows
 * that need multi-project visibility; a settings toggle surfaces the risk.
 */
export function getChatSandboxScope(
  conv: { projectPaths: string[] },
  connection: Pick<Connection, 'extraWritablePaths'>,
  crossProjectMode: boolean,
): string[] {
  const paths = new Set<string>();
  if (crossProjectMode) {
    for (const p of getAllWorkspacePaths()) paths.add(p);
  }
  for (const p of conv.projectPaths) paths.add(p);
  for (const p of connection.extraWritablePaths ?? []) paths.add(p);
  return [...paths];
}
