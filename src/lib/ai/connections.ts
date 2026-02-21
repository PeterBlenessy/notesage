// Connection and routing types for AI Provider Architecture v2
// See: docs/prds/2026-02-21-ai-provider-architecture-v2.md

// --- Auth ---

export type AuthMethod =
  | 'api_key'         // User provides an API key (Anthropic, OpenAI)
  | 'agent_managed'   // Agent subprocess handles its own auth (subscription via ACP)
  | 'local';          // No auth needed (Ollama)

// --- Providers ---

export type ConnectionProvider =
  | 'anthropic'    // API key (direct API) or agent-managed subscription (Claude Code via ACP)
  | 'openai'       // API key (direct API) or agent-managed subscription (Codex via ACP)
  | 'github'       // Agent-managed subscription (Copilot via ACP + LSP)
  | 'ollama';      // Local, no auth

// --- Credentials ---

export type ConnectionCredentials =
  | { type: 'api_key'; key: string }
  | { type: 'agent_managed'; agentBinary: string; agentArgs?: string[] }  // e.g., "claude-agent-acp"
  | { type: 'local'; url: string };

// --- Capabilities ---

/** Use case slots for provider routing */
export type AICapability = 'interactive' | 'inline_completion' | 'agent_tasks';
// 'interactive'       = chat + inline actions (Improve, Summarize, Expand)
// 'inline_completion' = ghost text / autocomplete
// 'agent_tasks'       = delegated multi-step work

/**
 * Maps each provider + auth method to the capabilities it supports.
 *
 * When an `api_key` connection is used for `interactive`, Notesage calls the
 * provider's API directly (existing behavior). When an `agent_managed`
 * connection is used for `interactive`, the prompt goes through the ACP agent
 * session instead. The routing layer handles this transparently.
 */
export const PROVIDER_CAPABILITIES: Record<ConnectionProvider, Partial<Record<AuthMethod, AICapability[]>>> = {
  anthropic: {
    api_key:       ['interactive', 'agent_tasks'],
    agent_managed: ['interactive', 'agent_tasks'],
  },
  openai: {
    api_key:       ['interactive', 'agent_tasks'],
    agent_managed: ['interactive', 'agent_tasks'],
  },
  github: {
    agent_managed: ['interactive', 'inline_completion', 'agent_tasks'],
  },
  ollama: {
    local:         ['interactive'],
  },
};

/** Resolve capabilities for a given provider + auth method */
export function getCapabilities(provider: ConnectionProvider, authMethod: AuthMethod): AICapability[] {
  return PROVIDER_CAPABILITIES[provider]?.[authMethod] ?? [];
}

// --- Connections ---

export type ConnectionStatus = 'connected' | 'expired' | 'error' | 'not_installed';

export interface Connection {
  id: string;
  provider: ConnectionProvider;
  authMethod: AuthMethod;
  status: ConnectionStatus;
  label: string;                    // User-facing label, e.g., "Claude Code (Pro subscription)"
  credentials: ConnectionCredentials;
  capabilities: AICapability[];     // Resolved from PROVIDER_CAPABILITIES
  createdAt: number;
}

// --- Use Case Routing ---

export interface UseCaseRouting {
  interactive: string | null;        // Connection ID — handles chat + inline actions
  agent_tasks: string | null;        // Connection ID — handles delegated multi-step work
  inline_completion: string | null;  // Connection ID — handles ghost text (Copilot LSP)
}

/** Empty routing — no providers assigned */
export const EMPTY_ROUTING: UseCaseRouting = {
  interactive: null,
  agent_tasks: null,
  inline_completion: null,
};

// --- Provider metadata (for UI display) ---

export interface ProviderOption {
  provider: ConnectionProvider;
  authMethod: AuthMethod;
  label: string;
  description: string;
  capabilities: AICapability[];
  agentBinary?: string;             // For agent_managed providers (ACP protocol)
  agentArgs?: string[];             // Additional CLI args (e.g., ["--acp"] for Copilot)
  lspBinary?: string;               // For LSP-based providers (e.g., copilot-language-server)
}

/** Available provider options for the "Add Connection" picker */
export const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    provider: 'anthropic',
    authMethod: 'agent_managed',
    label: 'Claude Code',
    description: 'Requires Claude Pro or Max',
    capabilities: ['interactive', 'agent_tasks'],
    agentBinary: 'claude-agent-acp',
  },
  {
    provider: 'anthropic',
    authMethod: 'api_key',
    label: 'Anthropic',
    description: 'Pay-per-use API key',
    capabilities: ['interactive', 'agent_tasks'],
  },
  {
    provider: 'openai',
    authMethod: 'agent_managed',
    label: 'OpenAI Codex',
    description: 'Requires ChatGPT Plus/Pro',
    capabilities: ['interactive', 'agent_tasks'],
    agentBinary: 'codex-acp',
  },
  {
    provider: 'openai',
    authMethod: 'api_key',
    label: 'OpenAI',
    description: 'Pay-per-use API key',
    capabilities: ['interactive', 'agent_tasks'],
  },
  {
    provider: 'github',
    authMethod: 'agent_managed',
    label: 'GitHub Copilot CLI',
    description: 'Chat and agents via ACP',
    capabilities: ['interactive', 'agent_tasks'],
    agentBinary: 'copilot',
    agentArgs: ['--acp'],
  },
  {
    provider: 'github',
    authMethod: 'agent_managed',
    label: 'GitHub Copilot LSP',
    description: 'Chat, completions, and agents via Language Server',
    capabilities: ['interactive', 'inline_completion', 'agent_tasks'],
    lspBinary: 'copilot-language-server',
  },
  {
    provider: 'ollama',
    authMethod: 'local',
    label: 'Ollama',
    description: 'Free, runs locally',
    capabilities: ['interactive'],
  },
];

// --- Capability display labels ---

export const CAPABILITY_LABELS: Record<AICapability, string> = {
  interactive: 'Interactive',
  inline_completion: 'Inline Completion',
  agent_tasks: 'Agent Tasks',
};

export const ROUTING_SLOT_LABELS: Record<AICapability, { label: string; description: string }> = {
  interactive: {
    label: 'Interactive',
    description: 'Chat and inline actions (Improve, Summarize, Expand)',
  },
  inline_completion: {
    label: 'Inline Completion',
    description: 'Ghost text autocomplete while typing',
  },
  agent_tasks: {
    label: 'Agent Tasks',
    description: 'Delegated multi-step work with file changes',
  },
};
