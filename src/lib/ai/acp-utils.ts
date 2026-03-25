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

/** Get all workspace folder paths (projects + explorer folders) for sandbox scope */
export function getAllWorkspacePaths(): string[] {
  const ws = useWorkspaceStore.getState();
  const paths = new Set<string>();
  for (const p of ws.projects) paths.add(p.path);
  for (const f of ws.explorerFolders) paths.add(f.path);
  return [...paths];
}
