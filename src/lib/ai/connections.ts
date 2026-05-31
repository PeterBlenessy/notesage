// Connection and routing types for AI Provider Architecture v2
// See: docs/prds/2026-02-21-ai-provider-architecture-v2.md

// --- Auth ---

export type AuthMethod =
  | 'api_key'         // User provides an API key (Anthropic, OpenAI)
  | 'agent_managed'   // Agent subprocess handles its own auth (subscription via ACP)
  | 'local'           // No auth needed (Ollama)
  | 'local_bundled';  // Bundled local inference (llama-server sidecar)

// --- Providers ---

export type ConnectionProvider =
  | 'anthropic'          // API key (direct API) or agent-managed subscription (Claude Code via ACP)
  | 'openai'             // API key (direct API) or agent-managed subscription (Codex via ACP)
  | 'github'             // Agent-managed subscription (Copilot via ACP + LSP)
  | 'google'             // Agent-managed subscription (Gemini CLI via ACP)
  | 'ollama'             // Local, no auth
  | 'openai_compatible'  // Any OpenAI-compatible API (vLLM, LiteLLM, Together AI, Groq)
  | 'local_ai';          // Bundled local inference (llama-server)

// --- Credentials ---

export type ConnectionCredentials =
  | { type: 'api_key'; key?: string; credentialStored?: boolean }
  // `envVars` stores credentials collected by the generic ACP EnvVar auth flow
  // (`AuthMethod::EnvVar` with `unstable_auth_methods`). The flow writes values
  // keyed by the var names the agent advertises (e.g. `GEMINI_API_KEY`), and
  // `acp_agent_spawn` injects them into the child process environment. Kept as
  // the storage layer because it's the minimal shape needed to round-trip ACP
  // EnvVar auth — audit conclusion for PRD 2026-04-18-acp-protocol-tail #11.
  | { type: 'agent_managed'; agentBinary: string; agentArgs?: string[]; envVars?: Record<string, string> }  // e.g., "claude-agent-acp"
  | { type: 'local'; url: string }
  | { type: 'local_bundled' };    // No credentials — bundled llama-server

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
  google: {
    agent_managed: ['interactive', 'agent_tasks'],
  },
  ollama: {
    local:         ['interactive', 'agent_tasks', 'inline_completion'],
  },
  openai_compatible: {
    api_key:       ['interactive', 'agent_tasks', 'inline_completion'],
  },
  local_ai: {
    local_bundled: ['interactive', 'agent_tasks', 'inline_completion'],
  },
};

/** Resolve capabilities for a given provider + auth method */
export function getCapabilities(provider: ConnectionProvider, authMethod: AuthMethod): AICapability[] {
  return PROVIDER_CAPABILITIES[provider]?.[authMethod] ?? [];
}

// --- Connection Config ---

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface ConnectionConfig {
  model?: string;              // Default model for this connection
  temperature?: number;        // 0.0 - 2.0
  maxTokens?: number;          // Provider-specific max
  baseUrl?: string;            // Custom API endpoint override
  /** @deprecated Use acpDefaults.thinkingEffort instead. Kept for migration. */
  reasoningEffort?: ReasoningEffort;
}

// --- ACP Capabilities (discovered at connection registration) ---

export interface AcpDiscoveredCapabilities {
  availableModes?: { id: string; name: string; description?: string }[];
  configOptions?: { id: string; name: string; description?: string; category?: string; currentValue?: string; options?: { value?: string; name: string; description?: string }[] }[];
  supportsLoadSession?: boolean;
  supportsImages?: boolean;
  agentVersion?: string;
  lastProbed?: number;  // timestamp — re-probe if stale (>24h) or agent version changed
}

export interface AcpDefaults {
  modeId?: string;           // e.g., "default", "code", "read-only"
  thinkingEffort?: string;   // e.g., "medium", "high"
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
  config?: ConnectionConfig;        // Optional model/temperature/maxTokens/baseUrl configuration
  binarySource?: BinarySource;      // 'managed' (Notesage-installed) or 'system' (user-installed)
  sandboxEnabled?: boolean;         // OS-level filesystem sandbox (default: true for managed, false for system)
  networkSandboxEnabled?: boolean;  // Network sandbox via proxy (requires sandboxEnabled)
  kernelNetworkDeny?: boolean;      // Kernel-enforced network deny via Seatbelt (requires networkSandboxEnabled)
  extraWritablePaths?: string[];    // Additional writable paths for the sandbox (user-configured)
  freeAccount?: boolean;            // Detected at runtime — disables reasoning effort tiers
  acpCapabilities?: AcpDiscoveredCapabilities;  // Discovered at registration, refreshed periodically
  acpDefaults?: AcpDefaults;        // User-chosen defaults for mode and config options
  createdAt: number;
}

// --- Use Case Routing ---

export interface UseCaseSlot {
  connectionId: string | null;
  model?: string;  // Overrides connection's default model for this use case
}

export interface UseCaseRouting {
  interactive: UseCaseSlot;
  agent_tasks: UseCaseSlot;
  inline_completion: UseCaseSlot;
}

/** Empty routing — no providers assigned */
export const EMPTY_ROUTING: UseCaseRouting = {
  interactive: { connectionId: null },
  agent_tasks: { connectionId: null },
  inline_completion: { connectionId: null },
};

// --- Agent install metadata ---

export type BinarySource = 'managed' | 'system';

export interface AgentInstallMeta {
  /** GitHub repo for binary downloads (owner/repo) */
  githubRepo: string;
  /** Manual install command for guidance fallback */
  manualCommand: string;
  /** Whether this agent requires a Node.js runtime */
  requiresNodeRuntime?: boolean;
  /** Required network domains when sandboxed (built-in, not removable) */
  allowedDomains?: string[];
}


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
  installMeta?: AgentInstallMeta;   // For managed agent binary downloads
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
    installMeta: {
      githubRepo: 'agentclientprotocol/claude-agent-acp',
      manualCommand: 'npm install -g @agentclientprotocol/claude-agent-acp',
      requiresNodeRuntime: true,
      allowedDomains: ['api.anthropic.com', 'github.com', '*.githubusercontent.com'],
    },
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
    installMeta: {
      githubRepo: 'agentclientprotocol/codex-acp',
      manualCommand: 'npm install -g @agentclientprotocol/codex-acp',
      requiresNodeRuntime: true,
      allowedDomains: ['api.openai.com', 'chatgpt.com', '*.chatgpt.com', 'github.com', '*.githubusercontent.com'],
    },
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
    installMeta: {
      githubRepo: 'github/copilot-cli',
      manualCommand: 'npm install -g @github/copilot',
      requiresNodeRuntime: true,
      allowedDomains: ['api.github.com', 'copilot-proxy.githubusercontent.com', '*.githubcopilot.com', 'github.com', '*.githubusercontent.com'],
    },
  },
  {
    provider: 'github',
    authMethod: 'agent_managed',
    label: 'GitHub Copilot LSP',
    description: 'Chat, completions, and agents via Language Server',
    capabilities: ['interactive', 'inline_completion', 'agent_tasks'],
    lspBinary: 'copilot-language-server',
    installMeta: {
      githubRepo: 'github/copilot-language-server-release',
      manualCommand: 'npm install -g @github/copilot-language-server',
      requiresNodeRuntime: true,
      allowedDomains: ['api.github.com', 'copilot-proxy.githubusercontent.com', '*.githubcopilot.com', 'github.com', '*.githubusercontent.com'],
    },
  },
  {
    provider: 'google',
    authMethod: 'agent_managed',
    label: 'Gemini CLI',
    description: 'Free with Google account, or Gemini Code Assist subscription',
    capabilities: ['interactive', 'agent_tasks'],
    agentBinary: 'gemini',
    agentArgs: ['--experimental-acp', '-y'],
    installMeta: {
      githubRepo: 'google-gemini/gemini-cli',
      manualCommand: 'npm install -g @google/gemini-cli',
      requiresNodeRuntime: true,
      allowedDomains: ['generativelanguage.googleapis.com', 'oauth2.googleapis.com', 'github.com', '*.githubusercontent.com'],
    },
  },
  {
    provider: 'ollama',
    authMethod: 'local',
    label: 'Ollama',
    description: 'Free, runs locally',
    capabilities: ['interactive', 'agent_tasks', 'inline_completion'],
  },
  {
    provider: 'openai_compatible',
    authMethod: 'api_key',
    label: 'OpenAI-Compatible',
    description: 'vLLM, LiteLLM, Together AI, Groq, or any compatible API',
    capabilities: ['interactive', 'agent_tasks', 'inline_completion'],
  },
  {
    provider: 'local_ai',
    authMethod: 'local_bundled',
    label: 'Local AI',
    description: 'Bundled on-device AI — no API key needed',
    capabilities: ['interactive', 'agent_tasks', 'inline_completion'],
  },
];

// --- Default models per provider ---

import { DEFAULT_MODELS as _DEFAULT_MODELS } from './constants';
export const DEFAULT_MODELS: Partial<Record<ConnectionProvider, string>> = _DEFAULT_MODELS;

// --- Agent model cache (runtime, not persisted) ---

export interface AgentModel {
  modelId: string;
  name: string;
  description: string | null;
}

/** Runtime cache of models reported by ACP agents during session creation */
const agentModelCache = new Map<string, { models: AgentModel[]; currentModel: string | null }>();

/** Reasoning effort suffixes reported by some agents (e.g., codex-acp) */
const EFFORT_SUFFIXES = ['/low', '/medium', '/high', '/xhigh'];

/** Strip reasoning effort suffix from a model ID (e.g., "gpt-5.2-codex/medium" → "gpt-5.2-codex") */
function stripEffortSuffix(modelId: string): string {
  for (const suffix of EFFORT_SUFFIXES) {
    if (modelId.endsWith(suffix)) return modelId.slice(0, -suffix.length);
  }
  return modelId;
}

export function setAgentModels(connectionId: string, models: AgentModel[], currentModel: string | null): void {
  // Deduplicate models that differ only by reasoning effort suffix
  const seen = new Set<string>();
  const deduped: AgentModel[] = [];
  for (const m of models) {
    const base = stripEffortSuffix(m.modelId);
    if (!seen.has(base)) {
      seen.add(base);
      deduped.push({ modelId: base, name: m.name.split('/')[0] || m.name, description: m.description });
    }
  }
  const baseCurrentModel = currentModel ? stripEffortSuffix(currentModel) : null;
  agentModelCache.set(connectionId, { models: deduped, currentModel: baseCurrentModel });
}

export function getAgentModels(connectionId: string): { models: AgentModel[]; currentModel: string | null } | undefined {
  return agentModelCache.get(connectionId);
}

// --- Model display names ---

/** Map model IDs to human-readable display names. Falls through to titleCase if not found. */
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  // Claude
  'sonnet': 'Claude Sonnet',
  'opus': 'Claude Opus',
  'haiku': 'Claude Haiku',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-sonnet-4': 'Claude Sonnet 4',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-opus-4-6-fast': 'Claude Opus 4.6 Fast',
  'claude-opus-4-5': 'Claude Opus 4.5',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  // OpenAI / Codex
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'gpt-5.3-codex-spark': 'GPT-5.3 Codex Spark',
  'gpt-5.2-codex': 'GPT-5.2 Codex',
  'gpt-5.2': 'GPT-5.2',
  'gpt-5.1-codex': 'GPT-5.1 Codex',
  'gpt-5.1-codex-max': 'GPT-5.1 Codex Max',
  'gpt-5.1-codex-mini': 'GPT-5.1 Codex Mini',
  'gpt-5.1': 'GPT-5.1',
  'gpt-5-mini': 'GPT-5 Mini',
  'gpt-5-codex-mini': 'GPT-5 Codex Mini',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4o': 'GPT-4o',
  'gpt-41-copilot': 'GPT-4.1 Copilot',
  'o4-mini': 'o4-mini',
  'o3': 'o3',
  'auto': 'Auto',
  // Gemini
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-3-pro-preview': 'Gemini 3 Pro (Preview)',
};

/** Get a human-readable display name for a model ID */
export function prettyModelName(modelId: string): string {
  if (MODEL_DISPLAY_NAMES[modelId]) return MODEL_DISPLAY_NAMES[modelId];

  // Auto-format: remove dashes, capitalize segments
  return modelId
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

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
