import { useCallback, useRef, useMemo, useState, useEffect } from 'react';
import { useAIStore } from '@/stores/ai-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useGoalsDiscovery } from '@/hooks/useGoalsDiscovery';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { useProjectMetadataStore, type ProjectMetadata } from '@/stores/project-metadata-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useEditorStore } from '@/stores/editor-store';
import { getAIProvider } from '@/lib/ai';
import type { AIProviderType, ChatMessage, Citation } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';
import type { FileEntry } from '@/lib/tauri';
import { useConnectionsStore } from '@/stores/connections-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useSkillStore } from '@/stores/skill-store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Extract a user-friendly error message from AI provider errors.
 * Provider backends return raw JSON error bodies — parse out the message field.
 * Includes provider name so the user knows which connection failed.
 */
function friendlyAIError(error: unknown, provider?: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const prefix = provider ? `${provider}: ` : '';

  // Try to extract the nested JSON message from provider error strings
  // e.g. 'Anthropic API error: {"type":"error","error":{"type":"...","message":"Your credit balance..."}}'
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const msg = parsed?.error?.message || parsed?.message;
      if (msg) return prefix + msg;
    } catch {
      // Not valid JSON, fall through
    }
  }

  // Strip common prefixes like "Anthropic API error: " or "OpenAI API error: "
  const stripped = raw.replace(/^(Anthropic|OpenAI|Ollama)\s+API\s+error:\s*/i, '').trim();
  return prefix + (stripped || 'Something went wrong. Please try again.');
}

/**
 * Build a context string from discovered goal files.
 */
function buildGoalsContext(goalFiles: { name: string; content: string }[]): string {
  if (goalFiles.length === 0) return '';

  const sections = goalFiles
    .map((g) => `### ${g.name}\n${g.content}`)
    .join('\n\n');

  return `## Project Goals\n\nThe following goal files exist in this project:\n\n${sections}`;
}

/**
 * Build a context block for a single project (name, description, custom context).
 */
function buildProjectHeader(metadata: ProjectMetadata, rootPath?: string): string {
  const lines: string[] = [];
  if (metadata.name) lines.push(`Project: ${metadata.name}`);
  if (rootPath) lines.push(`Project root: ${rootPath}`);
  if (metadata.description) lines.push(`Description: ${metadata.description}`);
  if (metadata.ai.projectContext) lines.push(`Project context: ${metadata.ai.projectContext}`);
  return lines.join('\n');
}

/** Directories to skip when building file tree context for AI. */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit',
  'dist', 'build', 'out', '.output', 'target',
  '.cache', '.turbo', '.parcel-cache',
  '__pycache__', '.venv', 'venv',
  '.notesage',
]);

/**
 * Build a compact text representation of a file tree for AI context.
 * Limits depth and total file count to avoid bloating the system message.
 */
function buildFileTreeContext(tree: FileEntry[], rootPath: string, maxDepth = 3, maxFiles = 100): string {
  const lines: string[] = [];
  let fileCount = 0;

  function walk(entries: FileEntry[], depth: number, prefix: string) {
    if (depth > maxDepth || fileCount >= maxFiles) return;
    for (const entry of entries) {
      if (fileCount >= maxFiles) {
        lines.push(`${prefix}... (truncated)`);
        return;
      }
      if (entry.is_directory && IGNORED_DIRS.has(entry.name)) continue;
      const icon = entry.is_directory ? '/' : '';
      lines.push(`${prefix}${entry.name}${icon}`);
      fileCount++;
      if (entry.is_directory && entry.children) {
        walk(entry.children, depth + 1, prefix + '  ');
      }
    }
  }

  walk(tree, 0, '  ');

  if (lines.length === 0) return '';

  const rootName = rootPath.split('/').pop() || rootPath;
  return `## Project Files\n\n${rootName}/\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// ACP types and lazy agent management (module-level)
// ---------------------------------------------------------------------------

interface AcpSpawnResult {
  instance_id: string;
  agent_name: string | null;
  agent_version: string | null;
  auth_methods: { id: string; name: string; description: string | null }[];
}

interface AcpSessionResult {
  session_id: string;
}

interface AcpSessionUpdatePayload {
  instanceId: string;
  sessionId: string;
  update: {
    sessionUpdate: string;
    content?: { type: string; text?: string };
    [key: string]: unknown;
  };
}

interface AcpPermissionRequestPayload {
  instanceId: string;
  sessionId: string;
  requestId: string;
  toolCall: unknown;
  options: unknown[];
}

/** Extract tool kind and title from an ACP toolCall payload. */
function extractToolInfo(toolCall: unknown): { kind: string; title: string; input: string } {
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
  // Skip empty or meaningless values
  if (!oneLine || oneLine === '{}' || oneLine === '""' || oneLine === 'null') return '';
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max) + '…';
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
      // Fall back to title if available, otherwise generic label
      if (title) return title;
      if (kind) return kind;
      return 'Working';
  }
}

interface AcpAgentState {
  instanceId: string;
  connectionId: string;
  chatSessionId: string | null;
}

/** Persistent ACP agent state — survives re-renders, reset on connection change. */
let acpAgent: AcpAgentState | null = null;

/** Stop any running ACP agent and clear state. Called on disconnect. */
export function stopAcpAgent(): void {
  if (acpAgent) {
    invoke('acp_agent_stop', { instanceId: acpAgent.instanceId }).catch(() => {});
    acpAgent = null;
  }
}

/**
 * Ensure an ACP agent is spawned and authenticated for the given connection.
 * Reuses the existing agent if the connection matches. Stops and replaces
 * if the connection changed.
 */
async function ensureAcpAgent(connection: Connection, cwd: string): Promise<string> {
  if (acpAgent && acpAgent.connectionId !== connection.id) {
    try {
      await invoke('acp_agent_stop', { instanceId: acpAgent.instanceId });
    } catch {
      // Agent may already be stopped
    }
    acpAgent = null;
  }

  if (acpAgent) {
    return acpAgent.instanceId;
  }

  const creds = connection.credentials as { type: 'agent_managed'; agentBinary: string; agentArgs?: string[] };
  // Inject --model flag if the connection has a model configured
  const args = [...(creds.agentArgs ?? [])];
  if (connection.config?.model) {
    args.push('--model', connection.config.model);
  }
  const result = await invoke<AcpSpawnResult>('acp_agent_spawn', {
    agentBinary: creds.agentBinary,
    agentArgs: args.length > 0 ? args : null,
    role: 'interactive',
    workingDirectory: cwd,
  });
  // Try to authenticate — some agents handle auth internally
  // (e.g. claude-agent-acp uses Claude CLI's stored credentials)
  try {
    await invoke('acp_agent_authenticate', {
      instanceId: result.instance_id,
    });
  } catch (authErr) {
    const msg = String(authErr);
    if (!msg.toLowerCase().includes('not implemented')) {
      throw authErr;
    }
  }

  acpAgent = {
    instanceId: result.instance_id,
    connectionId: connection.id,
    chatSessionId: null,
  };
  return result.instance_id;
}

// ---------------------------------------------------------------------------

/**
 * Resolve provider type, API key, Ollama URL, and config from a Connection.
 * Returns null for agent_managed connections (handled via ACP in callbacks).
 */
function resolveConnectionCredentials(connection: Connection, useCaseModelOverride?: string): {
  provider: AIProviderType;
  apiKey: string | undefined;
  ollamaUrl: string | undefined;
  config: import('@/lib/ai/connections').ConnectionConfig | undefined;
} | null {
  if (connection.authMethod === 'agent_managed') {
    // ACP connections are routed separately in generateText / sendChatMessage
    return null;
  }

  const provider = connection.provider as AIProviderType;

  // Merge config: use-case model override > connection config model > provider default
  const config = connection.config
    ? { ...connection.config }
    : undefined;
  if (useCaseModelOverride) {
    if (config) {
      config.model = useCaseModelOverride;
    } else {
      return resolveWithConfig(provider, connection, { model: useCaseModelOverride });
    }
  }

  if (connection.credentials.type === 'api_key') {
    return { provider, apiKey: connection.credentials.key, ollamaUrl: undefined, config };
  }

  if (connection.credentials.type === 'local') {
    return { provider, apiKey: undefined, ollamaUrl: connection.credentials.url, config };
  }

  return null;
}

function resolveWithConfig(
  provider: AIProviderType,
  connection: Connection,
  configOverride: import('@/lib/ai/connections').ConnectionConfig
): {
  provider: AIProviderType;
  apiKey: string | undefined;
  ollamaUrl: string | undefined;
  config: import('@/lib/ai/connections').ConnectionConfig | undefined;
} | null {
  const config = { ...connection.config, ...configOverride };
  if (connection.credentials.type === 'api_key') {
    return { provider, apiKey: connection.credentials.key, ollamaUrl: undefined, config };
  }
  if (connection.credentials.type === 'local') {
    return { provider, apiKey: undefined, ollamaUrl: connection.credentials.url, config };
  }
  return null;
}

export function useAIOperations() {
  const aiStore = useAIStore();
  const { apiKeys, ollamaUrl } = aiStore;
  const { addMessage, updateMessage, updateMessageThinking, setMessageError, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities, webSearchEnabled } = useChatStore();
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const cleanupRef = useRef<(() => void) | null>(null);

  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  // Resolve interactive connection from routing store
  const interactiveConnection = useRoutingStore((s) => {
    const slot = s.routing.interactive;
    if (!slot?.connectionId) return null;
    return s.getConnectionForUseCase('interactive');
  });

  // Resolve use-case model override from routing store
  const useCaseModel = useRoutingStore((s) => s.routing.interactive?.model);

  // Provider/persona overrides only apply when exactly one project is selected
  const singleProjectPath = selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const singleMetadata = singleProjectPath ? metadataMap[singleProjectPath] ?? null : null;

  // All connections (for reactivity when a connection referenced by project override is added/removed)
  const connections = useConnectionsStore((s) => s.connections);

  // Resolve the effective connection: project override takes priority over global routing.
  // This is critical for agent_managed overrides — without it, a project override to an
  // ACP connection (e.g., Claude Code) would be silently ignored.
  const effectiveConnection = useMemo(() => {
    const projectProviderOverride = singleMetadata?.ai.provider ?? null;
    if (projectProviderOverride) {
      const conn = connections.find((c) => c.id === projectProviderOverride);
      if (conn) return conn;
    }
    return interactiveConnection;
  }, [singleMetadata, interactiveConnection, connections]);

  // Resolve effective provider + credentials:
  // 1. Project override (connection ID or v1 legacy provider name)
  // 2. Routing store connection → uses connection credentials
  // 3. Fall back to ai-store (v1 behavior)
  const resolved = useMemo(() => {
    const projectProviderOverride = singleMetadata?.ai.provider ?? null;

    // If project overrides the provider
    if (projectProviderOverride) {
      // Try resolving as a connection ID (v2)
      const conn = useConnectionsStore.getState().getConnection(projectProviderOverride);
      if (conn) {
        const fromConn = resolveConnectionCredentials(conn, useCaseModel);
        if (fromConn) return fromConn;
        // agent_managed → falls through, handled via ACP
      }

      // Legacy v1 resolution (provider name string like 'anthropic', 'openai', 'ollama')
      const legacyProvider = projectProviderOverride as AIProviderType;
      if (['anthropic', 'openai', 'ollama', 'google'].includes(legacyProvider)) {
        return {
          provider: legacyProvider,
          apiKey: legacyProvider === 'ollama' ? undefined : apiKeys[legacyProvider],
          ollamaUrl,
          config: undefined,
        };
      }
    }

    // Try routing store
    if (interactiveConnection) {
      const fromConnection = resolveConnectionCredentials(interactiveConnection, useCaseModel);
      if (fromConnection) return fromConnection;
      // agent_managed → handled via ACP in callbacks, fall through to ai-store
    }

    // Fall back to ai-store
    if (aiStore.provider) {
      return {
        provider: aiStore.provider,
        apiKey: aiStore.provider === 'ollama' ? undefined : apiKeys[aiStore.provider],
        ollamaUrl,
        config: undefined,
      };
    }

    return null;
  }, [singleMetadata, interactiveConnection, aiStore.provider, apiKeys, ollamaUrl, useCaseModel]);

  // Active agent body — loaded and stored in state so changes trigger re-render
  const activeAgent = useSkillStore((s) => s.getActiveAgent());
  interface AgentBodyState { name: string; body: string }
  const [agentBody, setAgentBody] = useState<AgentBodyState>({ name: '', body: '' });

  // Keep agent body in sync with the active agent
  useEffect(() => {
    const agentName = activeAgent?.name ?? '';
    if (!activeAgent || !agentName) {
      setAgentBody({ name: '', body: '' });
      return;
    }
    // Skip if already loaded for this agent
    if (agentBody.name === agentName) return;

    let cancelled = false;
    invoke<{ name: string; body: string; path: string }>('read_agent_content', { agentPath: activeAgent.path })
      .then((content) => { if (!cancelled) setAgentBody({ name: agentName, body: content.body }); })
      .catch(() => { if (!cancelled) setAgentBody({ name: agentName, body: '' }); });
    return () => { cancelled = true; };
  }, [activeAgent?.name, activeAgent?.path, agentBody.name]);

  // Build the agent system message (replaces persona systemMessage)
  const agentSystemMessage = agentBody.body || 'You are a helpful writing assistant.';

  // Discover goal files (only when exactly one project is selected)
  const { goalFiles } = useGoalsDiscovery(singleProjectPath);
  const goalsContext = useMemo(() => buildGoalsContext(goalFiles), [goalFiles]);

  // Project file tree for single-project context
  const singleProject = useWorkspaceStore((s) =>
    singleProjectPath ? s.projects.find((p) => p.path === singleProjectPath) : undefined
  );

  // Active file for file awareness
  const activeTab = useEditorStore((s) => {
    if (!s.activeTabId) return null;
    return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  });

  // Skill context for AI prompts — filtered by active agent's allowed-tools
  const agentAllowedTools = activeAgent?.allowed_tools;
  const skillDescriptions = useSkillStore((s) => {
    const desc = s.getSkillDescriptionsForPrompt();
    if (!agentAllowedTools || agentAllowedTools.length === 0) return desc;
    // Filter to only allowed skills
    const active = s.getActiveSkills().filter((sk) => agentAllowedTools.includes(sk.name));
    if (active.length === 0) return '';
    const lines = active.map((sk) => `- **${sk.name}**: ${sk.description}${sk.has_scripts ? ' (has scripts)' : ''}`);
    return `\n\nAvailable skills:\n${lines.join('\n')}`;
  });
  const notesageSkillDescriptions = useSkillStore((s) => {
    const desc = s.getNotesageSkillDescriptionsForPrompt();
    if (!agentAllowedTools || agentAllowedTools.length === 0) return desc;
    const active = s.getActiveSkills().filter(
      (sk) => agentAllowedTools.includes(sk.name) &&
        (sk.source === 'notesage-project' || sk.source === 'notesage-global' || sk.source === 'bundled')
    );
    if (active.length === 0) return '';
    const lines = active.map((sk) => `- **${sk.name}**: ${sk.description}${sk.has_scripts ? ' (has scripts)' : ''}`);
    return `\n\nNotesage skills:\n${lines.join('\n')}`;
  });
  const agentInstructions = useSkillStore((s) => s.getMergedAgentInstructions());
  const notesageAgentInstructions = useSkillStore((s) => s.getNotesageAgentInstructions());

  // Shared project/goals/file-tree/active-file context builder
  const buildProjectContext = useCallback((): string[] => {
    const parts: string[] = [];

    if (selectedProjectPaths.length === 1) {
      if (singleMetadata) {
        const header = buildProjectHeader(singleMetadata, singleProjectPath!);
        if (header) parts.push(header);
      } else if (singleProjectPath) {
        parts.push(`Project root: ${singleProjectPath}`);
      }
      if (goalsContext) parts.push(goalsContext);
      if (singleProject?.fileTree) {
        const treeContext = buildFileTreeContext(singleProject.fileTree, singleProjectPath!);
        if (treeContext) parts.push(treeContext);
      }
    } else if (selectedProjectPaths.length > 1) {
      const summaries: string[] = [];
      for (const path of selectedProjectPaths) {
        const meta = metadataMap[path];
        if (meta) {
          summaries.push(buildProjectHeader(meta, path));
        } else {
          const name = path.split('/').pop() || path;
          summaries.push(`Project: ${name}\nProject root: ${path}`);
        }
      }
      parts.push(`The user has the following projects selected:\n\n${summaries.join('\n\n')}`);
    }

    if (activeTab) {
      let fileContext = `Currently editing: ${activeTab.filePath}`;
      if (activeTab.fileType === 'markdown' && activeTab.content) {
        const snippet = activeTab.content.slice(0, 500);
        const truncated = activeTab.content.length > 500 ? '...' : '';
        fileContext += `\n\nFile content preview:\n${snippet}${truncated}`;
      }
      parts.push(fileContext);
    }

    return parts;
  }, [selectedProjectPaths, singleProjectPath, singleMetadata, goalsContext, singleProject, activeTab, metadataMap]);

  // Compose system message based on selected projects
  const composedSystemMessage = useMemo(() => {
    const parts = buildProjectContext();

    // Inject agent instructions (always-on context)
    if (agentInstructions) {
      parts.push(agentInstructions);
    }

    // Active agent body — the selected agent's role and behavior instructions
    if (agentSystemMessage) {
      parts.unshift(agentSystemMessage);
    }

    // Inject skill descriptions (filtered by agent's allowed-tools if set)
    if (skillDescriptions) {
      parts.push(skillDescriptions);
    }

    return parts.join('\n\n') || 'You are a helpful writing assistant.';
  }, [buildProjectContext, agentSystemMessage, agentInstructions, skillDescriptions]);

  // ACP-specific system message: only Notesage-specific skills and instructions
  // (the ACP agent discovers its own provider-specific skills and CLAUDE.md/AGENTS.md independently)
  const acpSystemMessage = useMemo(() => {
    const parts = buildProjectContext();

    // Only Notesage-specific agent instructions (not CLAUDE.md/AGENTS.md — ACP agent loads those itself)
    if (notesageAgentInstructions) {
      parts.push(notesageAgentInstructions);
    }

    // Active agent body — framed as a mandatory role instruction so ACP agents adopt it
    if (agentSystemMessage) {
      parts.push(`<role-instructions>\nYou MUST adopt the following role for all responses in this conversation. This is your primary identity and overrides your default behavior:\n\n${agentSystemMessage}\n</role-instructions>`);
    }

    // Only Notesage-specific skills (filtered by agent's allowed-tools)
    if (notesageSkillDescriptions) {
      parts.push(notesageSkillDescriptions);
    }

    return parts.join('\n\n') || 'You are a helpful writing assistant.';
  }, [buildProjectContext, agentSystemMessage, notesageAgentInstructions, notesageSkillDescriptions]);

  const generateText = useCallback(
    async (prompt: string): Promise<string> => {
      // ACP path: route through agent for agent_managed connections
      if (effectiveConnection?.authMethod === 'agent_managed') {
        const cwd = selectedProjectPaths[0] || '/tmp';
        let instanceId: string;
        try {
          instanceId = await ensureAcpAgent(effectiveConnection, cwd);
        } catch (error) {
          stopAcpAgent();
          throw error;
        }

        // Fresh session per inline action (no multi-turn)
        const session = await invoke<AcpSessionResult>('acp_session_new', {
          instanceId,
          workingDirectory: cwd,
        });

        let result = '';
        const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
          if (event.payload.instanceId !== instanceId) return;
          const { update } = event.payload;
          if (
            update.sessionUpdate === 'agent_message_chunk' &&
            update.content?.type === 'text' &&
            update.content.text
          ) {
            result += update.content.text;
          }
        });

        // Auto-approve permission requests for inline actions
        const unlistenPermission = await listen<AcpPermissionRequestPayload>('acp-permission-request', (event) => {
          if (event.payload.instanceId !== instanceId) return;
          const payload = event.payload;
          let firstOptionId: string | null = null;
          if (Array.isArray(payload.options) && payload.options.length > 0) {
            const opt = payload.options[0] as Record<string, unknown>;
            firstOptionId = typeof opt === 'string' ? opt : String(opt?.id ?? '');
          }
          invoke('acp_permission_respond', {
            instanceId,
            requestId: payload.requestId,
            optionId: firstOptionId,
          }).catch(() => {});
        });

        try {
          const fullPrompt = `${acpSystemMessage}\n\n${prompt}`;
          await invoke('acp_session_prompt', {
            instanceId,
            sessionId: session.session_id,
            content: fullPrompt,
          });
          return result;
        } catch (error) {
          stopAcpAgent();
          throw error;
        } finally {
          unlisten();
          unlistenPermission();
        }
      }

      // Direct API path
      if (!resolved) {
        throw new Error('No AI provider configured. Set up a provider in Settings.');
      }

      try {
        const aiProvider = getAIProvider(
          resolved.provider,
          resolved.apiKey,
          resolved.ollamaUrl,
          resolved.config
        );

        const fullPrompt = `${composedSystemMessage}\n\n${prompt}`;
        return await aiProvider.generateText(fullPrompt);
      } catch (error) {
        console.error('AI generation failed:', error);
        throw error;
      }
    },
    [resolved, composedSystemMessage, acpSystemMessage, effectiveConnection, selectedProjectPaths]
  );

  const sendChatMessage = useCallback(
    async (content: string, messages: ChatMessage[]) => {
      // Clean up any stale listeners from a previous streaming call
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      // ACP path: route through agent for agent_managed connections
      if (effectiveConnection?.authMethod === 'agent_managed') {
        setLoading(true);
        setError(null);

        const userTimestamp = Date.now();
        const userMessage: ChatMessage = { role: 'user', content, timestamp: userTimestamp };
        addMessage(userMessage);
        const assistantMessageId = userTimestamp + 1;
        addMessage({
          role: 'assistant',
          content: '',
          timestamp: assistantMessageId,
          connectionId: effectiveConnection.id,
          connectionLabel: effectiveConnection.label,
          connectionProvider: effectiveConnection.provider,
        });

        try {
          const cwd = selectedProjectPaths[0] || '/tmp';
          const instanceId = await ensureAcpAgent(effectiveConnection, cwd);

          // New conversation (no prior messages) → create a fresh session
          let isNewSession = false;
          if (messages.length === 0 && acpAgent) {
            acpAgent.chatSessionId = null;
          }

          if (!acpAgent!.chatSessionId) {
            const session = await invoke<AcpSessionResult>('acp_session_new', {
              instanceId,
              workingDirectory: cwd,
            });
            acpAgent!.chatSessionId = session.session_id;
            isNewSession = true;
          }

          let streamedContent = '';
          let chunkCount = 0;

          const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
            if (event.payload.instanceId !== instanceId) return;
            const { update } = event.payload;

            if (
              update.sessionUpdate === 'agent_message_chunk' &&
              update.content?.type === 'text' &&
              update.content.text
            ) {
              chunkCount++;
              streamedContent += update.content.text;
              updateMessage(assistantMessageId, streamedContent);
            } else if (update.sessionUpdate === 'tool_call') {
              const kind = (update as Record<string, unknown>).kind as string | undefined;
              const title = (update as Record<string, unknown>).title as string | undefined;
              const rawInput = (update as Record<string, unknown>).rawInput as string | undefined;
              const toolLabel = formatAcpToolName(kind, title);
              setActiveTool(toolLabel);
              addActivity(assistantMessageId, {
                kind: kind || 'unknown',
                label: toolLabel,
                detail: rawInput ? truncateDetail(rawInput) : undefined,
                status: 'running',
                timestamp: Date.now(),
              });
            } else if (update.sessionUpdate === 'tool_call_update') {
              const kind = (update as Record<string, unknown>).kind as string | undefined;
              const title = (update as Record<string, unknown>).title as string | undefined;
              const toolLabel = formatAcpToolName(kind, title);
              setActiveTool(toolLabel);
            } else if (update.sessionUpdate === 'tool_result') {
              setActiveTool(null);
              completeLastActivity(assistantMessageId);
            } else if (update.sessionUpdate === 'agent_turn_complete') {
              setActiveTool(null);
              completeAllActivities(assistantMessageId);
            }
          });

          // Handle permission requests: auto-approve read-only tools,
          // show inline permission card for write tools (user must Allow/Deny).
          const unlistenPermission = await listen<AcpPermissionRequestPayload>('acp-permission-request', (event) => {
            if (event.payload.instanceId !== instanceId) return;
            const payload = event.payload;

            // Clear the active tool spinner — the previous tool finished,
            // now the agent is asking permission for the next action.
            setActiveTool(null);

            const toolInfo = extractToolInfo(payload.toolCall);
            const rawOptions = payload.options as unknown[];
            let firstOptionId: string | null = null;
            if (Array.isArray(rawOptions) && rawOptions.length > 0) {
              const opt = rawOptions[0] as Record<string, unknown>;
              firstOptionId = typeof opt === 'string' ? opt : String(opt?.optionId ?? opt?.id ?? '');
            }

            if (usePermissionStore.getState().isAutoAllowed(toolInfo.kind)) {
              // Tool kinds in session or always allow-lists: auto-approve silently
              invoke('acp_permission_respond', {
                instanceId,
                requestId: payload.requestId,
                optionId: firstOptionId,
              }).catch(() => {});
            } else {
              // Write tools: add to permission store, let PermissionCard UI handle response
              const options = Array.isArray(rawOptions)
                ? rawOptions.map((o) => {
                    const opt = o as Record<string, unknown>;
                    return {
                      optionId: String(opt?.optionId ?? opt?.id ?? ''),
                      kind: String(opt?.kind ?? ''),
                      name: String(opt?.name ?? ''),
                    };
                  })
                : [];

              usePermissionStore.getState().addRequest({
                id: `${payload.requestId}-${Date.now()}`,
                instanceId,
                sessionId: payload.sessionId,
                requestId: payload.requestId,
                toolKind: toolInfo.kind,
                toolTitle: toolInfo.title,
                toolInput: truncateDetail(toolInfo.input, 200),
                options,
                timestamp: Date.now(),
              });
            }
          });

          cleanupRef.current = () => {
            unlisten();
            unlistenPermission();
            // Deny any pending permission requests for this agent and clear from store
            const pendingRequests = usePermissionStore.getState().requests.filter(
              (r) => r.instanceId === instanceId
            );
            for (const req of pendingRequests) {
              invoke('acp_permission_respond', {
                instanceId,
                requestId: req.requestId,
                optionId: null,
              }).catch(() => {});
            }
            usePermissionStore.getState().clearRequestsForInstance(instanceId);
            setLoading(false);
            setActiveTool(null);
            cleanupRef.current = null;
          };

          try {
            // Prepend system prompt on the first message of a new session
            const promptContent = isNewSession
              ? `${acpSystemMessage}\n\n${content}`
              : content;
            await invoke('acp_session_prompt', {
              instanceId,
              sessionId: acpAgent!.chatSessionId,
              content: promptContent,
            });
          } finally {
            if (cleanupRef.current) {
              cleanupRef.current();
            }
          }
        } catch (error) {
          if (cleanupRef.current) {
            cleanupRef.current();
          }
          stopAcpAgent();
          console.error('[AI Chat] ACP error:', error);
          setMessageError(assistantMessageId, friendlyAIError(error, effectiveConnection?.label || effectiveConnection?.provider));
          setLoading(false);
          setActiveTool(null);
        }

        return;
      }

      // Direct API path
      if (!resolved) {
        throw new Error('No AI provider configured. Set up a provider in Settings.');
      }

      setLoading(true);
      setError(null);

      const userTimestamp = Date.now();
      const userMessage: ChatMessage = { role: 'user', content, timestamp: userTimestamp };
      addMessage(userMessage);

      // Add placeholder message for streaming - ensure unique timestamp
      const assistantMessageId = userTimestamp + 1;
      addMessage({
        role: 'assistant',
        content: '',
        timestamp: assistantMessageId,
        ...(effectiveConnection ? {
          connectionId: effectiveConnection.id,
          connectionLabel: effectiveConnection.label,
          connectionProvider: effectiveConnection.provider,
        } : resolved ? {
          connectionProvider: resolved.provider,
        } : {}),
      });

      try {
        let streamedContent = '';
        let streamedThinking = '';
        const collectedCitations: Citation[] = [];

        // Throttle UI updates to avoid overwhelming React with rapid token streams
        let contentDirty = false;
        let thinkingDirty = false;
        const flushInterval = setInterval(() => {
          if (thinkingDirty) {
            updateMessageThinking(assistantMessageId, streamedThinking);
            thinkingDirty = false;
          }
          if (contentDirty) {
            updateMessage(assistantMessageId, streamedContent);
            contentDirty = false;
          }
        }, 50);

        // Listen for stream chunks
        const unlistenChunk = await listen<string>('ai-stream-chunk', (event) => {
          streamedContent += event.payload;
          contentDirty = true;
        });

        // Listen for thinking chunks (Ollama thinking models)
        const unlistenThinking = await listen<string>('ai-stream-thinking-chunk', (event) => {
          streamedThinking += event.payload;
          thinkingDirty = true;
        });

        // Listen for tool use events
        const unlistenTool = await listen<{ tool: string; status: string }>('ai-tool-use', (event) => {
          if (event.payload.status === 'start') {
            setActiveTool(event.payload.tool);
          }
        });

        // Listen for citation events from web search
        const unlistenCitation = await listen<{ url: string; title: string; cited_text: string }>('ai-citation', (event) => {
          const { url, title, cited_text } = event.payload;
          if (!collectedCitations.some((c) => c.url === url)) {
            collectedCitations.push({ url, title, citedText: cited_text });
          }
        });

        const cleanup = () => {
          clearInterval(flushInterval);
          unlistenChunk();
          unlistenThinking();
          unlistenTool();
          unlistenCitation();
          // Final flush of any pending content
          if (streamedThinking) {
            updateMessageThinking(assistantMessageId, streamedThinking);
          }
          // Attach collected citations to the final message
          if (collectedCitations.length > 0 || streamedContent) {
            updateMessage(assistantMessageId, streamedContent, collectedCitations.length > 0 ? collectedCitations : undefined);
          }
          setLoading(false);
          setActiveTool(null);
          cleanupRef.current = null;
        };

        // Store cleanup so it can be called if a new message is sent before this finishes
        cleanupRef.current = cleanup;

        // Listen for stream completion
        const unlistenDone = await listen('ai-stream-done', () => {
          unlistenDone();
          cleanup();
        });

        // System message with composed content (project context + goals + agent)
        const systemMessage: ChatMessage = {
          role: 'system',
          content: composedSystemMessage,
        };

        // Apply history limit (system message and new user message always included)
        const historyLimit = useSettingsStore.getState().chatHistoryLimit;
        const effectiveHistory = historyLimit > 0 ? messages.slice(-historyLimit) : messages;

        // Start streaming
        await invoke('ai_chat_stream', {
          messages: [systemMessage, ...effectiveHistory, userMessage],
          provider: resolved.provider,
          apiKey: resolved.apiKey,
          ollamaUrl: resolved.ollamaUrl,
          webSearchEnabled: webSearchEnabled && resolved.provider !== 'ollama',
          model: resolved.config?.model ?? null,
          temperature: resolved.config?.temperature ?? null,
          maxTokens: resolved.config?.maxTokens ?? null,
          baseUrl: resolved.config?.baseUrl ?? null,
        });
      } catch (error) {
        // Clean up listeners on error
        if (cleanupRef.current) {
          cleanupRef.current();
        }
        console.error('[AI Chat] Stream error:', error);
        setMessageError(assistantMessageId, friendlyAIError(error, effectiveConnection?.label || resolved?.provider));
        setLoading(false);
        setActiveTool(null);
      }
    },
    [resolved, composedSystemMessage, acpSystemMessage, webSearchEnabled, addMessage, updateMessage, updateMessageThinking, setMessageError, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities, effectiveConnection, selectedProjectPaths]
  );

  const cancelChat = useCallback(() => {
    // Clean up listeners and reset loading state
    if (cleanupRef.current) {
      cleanupRef.current();
    }

    // Cancel ACP session if active
    if (acpAgent?.chatSessionId && acpAgent?.instanceId) {
      // Deny any pending permission requests before cancelling
      const pendingRequests = usePermissionStore.getState().requests.filter(
        (r) => r.instanceId === acpAgent!.instanceId
      );
      for (const req of pendingRequests) {
        invoke('acp_permission_respond', {
          instanceId: acpAgent!.instanceId,
          requestId: req.requestId,
          optionId: null,
        }).catch(() => {});
      }
      usePermissionStore.getState().clearRequestsForInstance(acpAgent!.instanceId);

      invoke('acp_session_cancel', {
        instanceId: acpAgent.instanceId,
        sessionId: acpAgent.chatSessionId,
      }).catch(() => {});
    }

    setLoading(false);
    setActiveTool(null);
  }, [setLoading, setActiveTool]);

  return { generateText, sendChatMessage, cancelChat };
}
