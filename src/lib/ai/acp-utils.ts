// Types and pure utility functions shared across ACP modules
// (useAcpLifecycle, useAgentTaskOperations, useAcpSessionListeners)

import { useWorkspaceStore } from '@/stores/workspace-store';

// ---------------------------------------------------------------------------
// ACP types
// ---------------------------------------------------------------------------

export interface AcpSpawnResult {
  instance_id: string;
  agent_name: string | null;
  agent_version: string | null;
  auth_methods: { id: string; name: string; description: string | null }[];
  sandbox_enabled: boolean;
  network_sandbox_enabled: boolean;
}

export interface AcpModelInfo {
  model_id: string;
  name: string;
  description: string | null;
}

export interface AcpSessionResult {
  session_id: string;
  current_model: string | null;
  available_models: AcpModelInfo[];
}

export interface AcpSessionUpdate {
  sessionUpdate: string;
  content?: { type: string; text?: string };
  kind?: string;
  title?: string;
  rawInput?: string;
  [key: string]: unknown;
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
  switch (kind) {
    case 'fetch':
      return 'Searching the web';
    case 'bash':
    case 'terminal':
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
      return 'Searching files';
    case 'grep':
      return 'Searching content';
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

  switch (k) {
    case 'read':
    case 'read_file': {
      const path = getArg('path', 'file_path', 'file') ?? findPath() ?? (title && title.includes('/') ? title : undefined);
      return path ? `Reading ${basename(path)}` : (title || 'Reading file');
    }
    case 'write':
    case 'write_file':
    case 'edit': {
      const path = getArg('path', 'file_path', 'file') ?? findPath() ?? (title && title.includes('/') ? title : undefined);
      return path ? `Editing ${basename(path)}` : (title || 'Editing file');
    }
    case 'bash':
    case 'terminal':
    case 'execute': {
      const cmd = getArg('command', 'cmd');
      if (cmd) return `Running: ${truncate(cmd, 60)}`;
      if (title) return `Running: ${truncate(title, 60)}`;
      return 'Running command';
    }
    case 'glob':
    case 'list':
    case 'list_directory': {
      const target = getArg('pattern', 'path', 'directory');
      return target ? `Searching ${basename(target)}` : (title || 'Searching files');
    }
    case 'grep':
    case 'search': {
      const query = getArg('pattern', 'query', 'search');
      if (query) return `Searching for "${truncate(query, 40)}"`;
      if (title) return `Searching: ${truncate(title, 50)}`;
      return 'Searching';
    }
    case 'web_search': {
      const query = getArg('query', 'search_query');
      return query ? `Searching web: "${truncate(query, 40)}"` : (title || 'Searching the web');
    }
    case 'fetch':
    case 'webfetch':
    case 'web_fetch': {
      const url = getArg('url') ?? findUrl();
      if (url) return `Fetching ${hostname(url)}`;
      if (title) return `Fetching ${truncate(title, 50)}`;
      return 'Fetching resource';
    }
    case 'think':
    case 'thinking':
      return title ? `Thinking: ${truncate(title, 50)}` : 'Thinking';
    case 'execute_skill_script': {
      const skill = getArg('skill', 'name');
      return skill ? `Running skill: ${skill}` : (title || 'Running skill script');
    }
    case 'read_skill_content': {
      const skill = getArg('skill', 'name');
      return skill ? `Loading skill: ${skill}` : (title || 'Loading skill');
    }
    default: {
      // Use title if it's more descriptive than the raw kind
      if (title && title.length > 0) return title;
      if (kind && kind.length > 0) return kind;
      return 'Working';
    }
  }
}

/** Get all workspace folder paths (projects + explorer folders) for sandbox scope */
export function getAllWorkspacePaths(): string[] {
  const ws = useWorkspaceStore.getState();
  const paths = new Set<string>();
  for (const p of ws.projects) paths.add(p.path);
  for (const f of ws.explorerFolders) paths.add(f.path);
  return [...paths];
}
