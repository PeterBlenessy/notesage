// Module-level ACP agent singleton state and spawn logic.
// Extracted from useAcpLifecycle.ts — survives re-renders, shared across the app.

import { invoke } from '@tauri-apps/api/core';
import { log } from '@/lib/logger';
import { usePermissionStore } from '@/stores/permission-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { PROVIDER_OPTIONS, getCapabilities } from '@/lib/ai/connections';
import type { Connection, ConnectionCredentials, AcpDiscoveredCapabilities } from '@/lib/ai/connections';
import type { AcpSpawnResult, AcpSessionResult, AcpSessionModeState, AcpSessionConfigOption, AcpAgentCapabilities } from '@/lib/ai/acp-utils';

// ---------------------------------------------------------------------------
// Common mode mapping — maps agent-specific mode IDs to universal display names
// ---------------------------------------------------------------------------

export type CommonModeKey = 'read_only' | 'agent' | 'full_access' | 'plan';

interface CommonMode {
  key: CommonModeKey;
  name: string;
  tooltip: string;
}

const COMMON_MODES: Record<CommonModeKey, CommonMode> = {
  read_only:   { key: 'read_only',    name: 'Read Only',   tooltip: 'Read access only — agent is denied any write or execute tool calls' },
  agent:       { key: 'agent',        name: 'Agent',       tooltip: 'Can read and edit files — asks for risky operations' },
  full_access: { key: 'full_access',  name: 'Full Access', tooltip: 'No permission prompts — use with caution' },
  plan:        { key: 'plan',         name: 'Plan',        tooltip: 'Read-only — proposes changes without executing' },
};

/**
 * Maps known agent mode IDs to common permission-level modes. Used to classify
 * a mode's permission level (e.g. detecting "Full Access" for the sandbox
 * conflict dialog) and to label non-preset agents in the command-bar picker.
 * The picker itself no longer hides unmapped modes — it renders every mode the
 * agent advertises (see `getAgentModeDisplay`).
 *
 * Mode IDs come from actual ACP agent responses:
 * - Claude Code: default, acceptEdits, plan, dontAsk, bypassPermissions
 * - Codex: read-only, auto, full-access
 * - Gemini CLI: default, autoEdit, yolo, plan
 * - Copilot CLI: URL-based (agent, plan, autopilot)
 */
const MODE_ID_TO_COMMON: Record<string, CommonModeKey> = {
  // Read Only — can read, must ask for writes
  'default': 'read_only',
  'read-only': 'read_only',
  // Agent — Copilot's "Agent" is their default working mode (read + edit)
  'https://agentclientprotocol.com/protocol/session-modes#agent': 'agent',
  // Agent — can read and edit, asks for risky ops
  'acceptEdits': 'agent',
  'auto': 'agent',
  'autoEdit': 'agent',
  'code': 'agent',
  // Full Access — no permission prompts
  'bypassPermissions': 'full_access',
  'full-access': 'full_access',
  'yolo': 'full_access',
  'https://agentclientprotocol.com/protocol/session-modes#autopilot': 'full_access',
  // Plan — read-only, proposes but doesn't execute
  'architect': 'plan',
  'plan': 'plan',
  'https://agentclientprotocol.com/protocol/session-modes#plan': 'plan',
};

/**
 * Get the common mode for an agent mode ID.
 * Returns null for advanced/agent-specific modes that should be hidden.
 */
export function getCommonMode(modeId: string): CommonMode | null {
  const key = MODE_ID_TO_COMMON[modeId];
  return key ? COMMON_MODES[key] : null;
}

/**
 * Get the display label for a mode. Maps to common mode names.
 * Falls back to native name for unmapped modes.
 */
export function getModeLabel(_agentBinary: string | undefined, modeId: string, nativeName: string): { name: string; tooltip: string } {
  const common = getCommonMode(modeId);
  if (common) return { name: common.name, tooltip: common.tooltip };
  return { name: nativeName, tooltip: '' };
}

/**
 * Filter available modes to only common modes.
 * Returns deduplicated common modes with their corresponding agent mode IDs.
 */
export function getCommonModes(availableModes: { id: string; name: string; description?: string }[]): { commonKey: CommonModeKey; name: string; tooltip: string; agentModeId: string }[] {
  const seen = new Set<CommonModeKey>();
  const result: { commonKey: CommonModeKey; name: string; tooltip: string; agentModeId: string }[] = [];
  for (const mode of availableModes) {
    const common = getCommonMode(mode.id);
    if (common && !seen.has(common.key)) {
      seen.add(common.key);
      result.push({ commonKey: common.key, name: common.name, tooltip: common.tooltip, agentModeId: mode.id });
    }
  }
  return result;
}

/**
 * Friendly labels + descriptions for the Local Agent preset's (Goose) ACP
 * session modes. Goose reports raw snake_case ids (`auto`, `approve`,
 * `smart_approve`, `chat`) as both `id` and `name`, which read as developer
 * jargon in the settings picker. Semantics per Goose docs (goose-docs.ai):
 *   - smart_approve — asks for approval only before risky tool calls (default)
 *   - approve       — asks for approval before every tool call
 *   - auto          — runs every tool without asking
 *   - chat          — no tools, conversation only
 * Kept separate from the cross-agent {@link MODE_ID_TO_COMMON} map because
 * Goose's `auto` (full access) collides with Codex's `auto` (read + edit,
 * asks for risky), so it must only be consulted for the Local Agent preset.
 */
const GOOSE_MODE_DISPLAY: Record<string, { name: string; description: string }> = {
  smart_approve: { name: 'Smart Approval', description: 'Asks for approval only before potentially risky operations. Recommended.' },
  approve:       { name: 'Approve Each Step', description: 'Asks for approval before every tool call.' },
  auto:          { name: 'Full Access', description: 'Reads, edits, and runs commands without asking. Use with caution.' },
  chat:          { name: 'Chat Only', description: 'Conversation only — no file edits or commands.' },
};

/**
 * User-facing label + description for an agent mode in the settings picker.
 * For the Local Agent preset (Goose) uses {@link GOOSE_MODE_DISPLAY}; for any
 * other agent maps through the common-mode names, falling back to the agent's
 * own native name/description for unmapped ids.
 */
export function getAgentModeDisplay(
  connection: Connection,
  modeId: string,
  nativeName: string,
  nativeDescription?: string,
): { name: string; description?: string } {
  if (isLocalAgentPreset(connection)) {
    const g = GOOSE_MODE_DISPLAY[modeId];
    if (g) return g;
    return { name: nativeName, description: nativeDescription };
  }
  const common = getCommonMode(modeId);
  if (common) return { name: common.name, description: common.tooltip };
  return { name: nativeName, description: nativeDescription };
}

/**
 * The configured mode for a conversation: the per-conversation pick if set,
 * otherwise the connection's default mode. Single source of the
 * `conversationModeId → connection.acpDefaults.modeId` precedence so the command-bar
 * mode picker and `reapplySessionMode` can't drift. Returns undefined when neither is
 * set (caller falls back to a display default or the agent's own default).
 */
export function resolveConfiguredModeId(
  conversationModeId: string | undefined,
  connection: Connection | null,
): string | undefined {
  return conversationModeId ?? connection?.acpDefaults?.modeId;
}

// ---------------------------------------------------------------------------
// Agent state (module-level singleton — survives re-renders)
// ---------------------------------------------------------------------------

export interface AcpAgentState {
  instanceId: string;
  connectionId: string;
  /** Serialized sandbox scope key — used to detect when agent needs respawning. */
  sandboxScopeKey: string;
  /**
   * Endpoint-config key (`<llama-port>:<modelId>`) for `localAgentPreset`
   * connections, or `''` for ordinary agents. When the bundled server restarts
   * on a new port or the active model changes, this key changes and
   * `ensureAcpAgent` respawns the agent against the regenerated config (#10).
   */
  configKey: string;
  chatSessionId: string | null;
  /** Agent binary name (e.g., 'claude-agent-acp', 'codex-acp') */
  agentBinary?: string;
  /** Agent capabilities from initialize response */
  capabilities?: AcpAgentCapabilities | null;
}

// ---------------------------------------------------------------------------
// Session-level state (modes, config options) — module-level, reset per session
// ---------------------------------------------------------------------------

export interface AcpUsageInfo {
  contextUsed: number;
  contextSize: number;
  cost?: { amount: number; currency: string };
}

export interface AcpAgentCommand {
  name: string;
  description: string;
  inputHint?: string;
}

export interface AcpSessionInfo {
  modes: AcpSessionModeState | null;
  configOptions: AcpSessionConfigOption[] | null;
  usage: AcpUsageInfo | null;
  commands: AcpAgentCommand[];
}

let sessionInfo: AcpSessionInfo = { modes: null, configOptions: null, usage: null, commands: [] };

/** Listeners notified when session info changes (for React re-renders) */
const sessionInfoListeners = new Set<() => void>();

export function getSessionInfo(): AcpSessionInfo { return sessionInfo; }

export function setSessionModes(modes: AcpSessionModeState | null): void {
  sessionInfo = { ...sessionInfo, modes };
  sessionInfoListeners.forEach(fn => fn());
}

export function setSessionConfigOptions(configOptions: AcpSessionConfigOption[] | null): void {
  sessionInfo = { ...sessionInfo, configOptions };
  sessionInfoListeners.forEach(fn => fn());
}

export function updateCurrentMode(modeId: string): void {
  if (sessionInfo.modes) {
    sessionInfo = {
      ...sessionInfo,
      modes: { ...sessionInfo.modes, currentModeId: modeId },
    };
    sessionInfoListeners.forEach(fn => fn());
  }
}

export function updateConfigOptionValue(optionId: string, valueId: string): void {
  if (sessionInfo.configOptions) {
    sessionInfo = {
      ...sessionInfo,
      configOptions: sessionInfo.configOptions.map(opt =>
        opt.id === optionId ? { ...opt, currentValue: valueId } : opt
      ),
    };
    sessionInfoListeners.forEach(fn => fn());
  }
}

export function updateUsage(usage: AcpUsageInfo): void {
  sessionInfo = { ...sessionInfo, usage };
  sessionInfoListeners.forEach(fn => fn());
}

export function setAvailableCommands(commands: AcpAgentCommand[]): void {
  sessionInfo = { ...sessionInfo, commands };
  sessionInfoListeners.forEach(fn => fn());
}

export function clearSessionInfo(): void {
  sessionInfo = { modes: null, configOptions: null, usage: null, commands: [] };
  sessionInfoListeners.forEach(fn => fn());
}

export function subscribeSessionInfo(fn: () => void): () => void {
  sessionInfoListeners.add(fn);
  return () => { sessionInfoListeners.delete(fn); };
}

// ---------------------------------------------------------------------------
// Launch resolution — single source of binary/args/env per connection
// ---------------------------------------------------------------------------

export interface AgentLaunchSpec {
  /** Binary name (managed agents, resolved via PATH/Homebrew/npm by the backend)
   *  or absolute path (custom agents, validated verbatim by `acp_binary.rs`). */
  agentBinary: string;
  agentArgs: string[];
  /** In-memory env values (same-session fallback — present right after the
   *  EnvVar auth form, absent after a restart). Passed over IPC only as the
   *  fallback; keychain-resolved values win in `acp_agent_spawn`. */
  envVars: Record<string, string> | null;
  /** Names of env vars whose values live in the OS keychain
   *  (`notesage:<connectionId>:env:<KEY>`); resolved by the backend at spawn. */
  envVarKeys: string[] | null;
}

/**
 * Resolve what to spawn for an ACP connection.
 *
 * `custom_acp` connections launch the user-supplied binary: `config.binaryPath`
 * (absolute — the backend's absolute-path branch validates existence + exec bit
 * and returns a precise error) with `config.binaryArgs`. Managed connections keep
 * launching from `credentials.agentBinary`/`agentArgs`. Env-var secrets come from
 * the keychain-backed `credentials.envVars`/`envVarKeys` flow in both cases.
 */
export function resolveAgentLaunch(connection: Connection): AgentLaunchSpec {
  const creds: ConnectionCredentials = connection.credentials;
  const managedCreds = creds.type === 'agent_managed' ? creds : null;
  const envVarKeys = (() => {
    if (!managedCreds) return null;
    const keys = managedCreds.envVarKeys ?? Object.keys(managedCreds.envVars ?? {});
    return keys.length > 0 ? keys : null;
  })();
  if (connection.provider === 'custom_acp') {
    // Prefer `config.binaryPath`, but fall back to `credentials.agentBinary` —
    // both the Local Agent preset (`createPresetConnection`) and the custom-agent
    // form store the binary there too. This self-heals a connection whose
    // `config` was dropped/never-persisted (observed on a 0.46.0-alpha.28 prod
    // connection: `credentials.agentBinary` held the goose path but `config` was
    // absent, so the old config-only read threw "has no binary path configured").
    const binaryPath = connection.config?.binaryPath || managedCreds?.agentBinary;
    if (!binaryPath) {
      throw new Error(`Custom agent connection '${connection.label}' has no binary path configured`);
    }
    return {
      agentBinary: binaryPath,
      agentArgs: connection.config?.binaryArgs ?? [],
      envVars: managedCreds?.envVars ?? null,
      envVarKeys,
    };
  }
  if (!managedCreds) {
    throw new Error(`Connection '${connection.label}' is not an agent-managed connection`);
  }
  return {
    agentBinary: managedCreds.agentBinary,
    agentArgs: managedCreds.agentArgs ?? [],
    envVars: managedCreds.envVars ?? null,
    envVarKeys,
  };
}

/**
 * Resolved endpoint config for a `localAgentPreset` connection: the isolation
 * env to inject at spawn, the respawn-trigger key, and the bundled server port
 * (allowed through the Seatbelt network sandbox alongside the proxy port, #9).
 */
export interface LocalAgentEndpoint {
  env: Record<string, string>;
  configKey: string;
  port: number;
}

/**
 * Returns true when `connection` is the Local Agent preset (Goose wired to
 * the bundled llama-server). Only these connections regenerate config and key
 * their respawn on the live endpoint.
 */
export function isLocalAgentPreset(connection: Connection): boolean {
  return connection.provider === 'custom_acp' && connection.config?.localAgentPreset === 'goose';
}

/**
 * Resolve the live endpoint config for a preset connection by (re)generating
 * the Goose env against the running bundled server (#8). Returns `null`
 * for non-preset connections (their `configKey` is always `''`). Throws the
 * backend error verbatim when the server is down / has no model — the caller
 * (#13 routing) is responsible for falling back to direct local chat.
 */
export async function resolveLocalAgentEndpoint(
  connection: Connection,
): Promise<LocalAgentEndpoint | null> {
  if (!isLocalAgentPreset(connection)) return null;
  const cfg = await invoke<import('@/lib/tauri').LocalAgentConfig>('local_agent_write_config');
  return { env: cfg.env, configKey: cfg.configKey, port: cfg.port };
}

/** Persistent ACP agent state — survives re-renders, reset on connection change. */
export let acpAgent: AcpAgentState | null = null;

/** In-flight spawn promise — prevents concurrent callers from double-spawning. */
let acpSpawnPromise: Promise<string> | null = null;

/** Read the current agent state — bypasses TypeScript control-flow narrowing. */
function getAcpAgent(): AcpAgentState | null {
  return acpAgent;
}

/** Update the instance ID of the current agent (used by recovery). */
export function updateAcpAgentInstanceId(newInstanceId: string): void {
  if (acpAgent) {
    acpAgent.instanceId = newInstanceId;
  }
}

/** Clear agent state without sending stop command (used after recovery failure). */
export function clearAcpAgent(): void {
  acpAgent = null;
  acpSpawnPromise = null;
  clearSessionInfo();
}

/** Stop any running ACP agent and clear state. Called on disconnect. */
export function stopAcpAgent(): void {
  if (acpAgent) {
    invoke('acp_agent_stop', { instanceId: acpAgent.instanceId }).catch(() => {
      // Expected: fire-and-forget cleanup — agent may already be stopped or crashed
    });
    acpAgent = null;
  }
  acpSpawnPromise = null;
  clearSessionInfo();
}

/** Maximum recursion depth for ensureAcpAgent to prevent infinite loops from racing callers. */
const MAX_ENSURE_DEPTH = 3;

/**
 * Ensure an ACP agent is spawned and authenticated for the given connection.
 * Reuses the existing agent if the connection matches. Stops and replaces
 * if the connection changed.
 *
 * @param callerTag Short identifier for the call site (e.g. 'eager', 'send-chat',
 *   'retry-reconnect-failed'). Used only for structured diagnostic logging; does
 *   not affect behavior. Present so we can trace respawn cascades without guessing.
 * @param depth Internal recursion counter — callers should not set this.
 */
export async function ensureAcpAgent(
  connection: Connection,
  cwd: string,
  sandboxPaths?: string[],
  callerTag: string = 'unknown',
  depth = 0,
): Promise<string> {
  if (depth > MAX_ENSURE_DEPTH) {
    throw new Error('Agent spawn failed after multiple retries');
  }
  const scopeKey = (sandboxPaths ?? []).sort().join('|');

  // For the Local Agent preset, regenerate the Goose env against the LIVE
  // bundled server and derive the respawn-trigger key (`<port>:<model>`). A
  // server restart on a new port (or a model switch) changes this key, so the
  // existing agent is torn down and respawned against the fresh config — same
  // mechanism as `sandboxScopeKey`. Non-preset connections get `configKey=''`.
  //
  // Preset endpoint resolution throws when the bundled llama-server isn't
  // running / has no model. We let that propagate: the caller's send path
  // surfaces it as a proper error in the chat message (user decision — no
  // silent Path-4 fallback, no header "Fix" pill).
  const endpoint = await resolveLocalAgentEndpoint(connection);
  const configKey = endpoint?.configKey ?? '';

  log.info(
    'ai',
    `[ensureAcpAgent:${callerTag}] conn=${connection.id} scope=[${scopeKey}] cwd=${cwd} currentAgent=${acpAgent ? `conn=${acpAgent.connectionId} scope=[${acpAgent.sandboxScopeKey}] session=${acpAgent.chatSessionId ?? 'none'}` : 'none'}`,
  );

  // Respawn if connection changed OR sandbox scope changed OR endpoint config changed
  if (
    acpAgent &&
    (acpAgent.connectionId !== connection.id ||
      acpAgent.sandboxScopeKey !== scopeKey ||
      acpAgent.configKey !== configKey)
  ) {
    const connectionChanged = acpAgent.connectionId !== connection.id;
    if (acpAgent.sandboxScopeKey !== scopeKey) {
      log.info(
        'ai',
        `[ensureAcpAgent:${callerTag}] sandbox scope changed, respawning. old=[${acpAgent.sandboxScopeKey}] new=[${scopeKey}]`,
      );
    }
    if (acpAgent.configKey !== configKey) {
      log.info(
        'ai',
        `[ensureAcpAgent:${callerTag}] endpoint config changed, respawning. old=[${acpAgent.configKey}] new=[${configKey}]`,
      );
    }
    try {
      await invoke('acp_agent_stop', { instanceId: acpAgent.instanceId });
    } catch {
      // Expected: agent may already be stopped or crashed — proceed with cleanup
    }
    acpAgent = null;
    acpSpawnPromise = null;
    // When the connection itself changed, the previous agent's sessionInfo
    // (modes, currentModeId, configOptions, usage, commands) no longer
    // applies. Clearing here ensures the picker's "currently selected"
    // state falls back to the new connection's defaults instead of showing
    // the previous agent's values until session/new completes.
    if (connectionChanged) {
      clearSessionInfo();
    }
  }

  // Verify the backend still has this agent (may be gone after app restart or crash)
  if (acpAgent) {
    const alive = await invoke<boolean>('acp_agent_exists', { instanceId: acpAgent.instanceId });
    if (!alive) {
      log.info('ai', `ACP agent ${acpAgent.instanceId} no longer exists in backend, respawning`);
      acpAgent = null;
      acpSpawnPromise = null;
    }
  }

  if (acpAgent) {
    return acpAgent.instanceId;
  }

  // If a spawn is already in progress, await it then verify the result
  if (acpSpawnPromise) {
    const instanceId = await acpSpawnPromise;
    // Re-read module-level state after await (may have changed during suspension)
    const current = getAcpAgent();
    // Verify the spawned agent matches our connection (another caller may have changed it)
    if (current?.instanceId === instanceId && current.connectionId === connection.id) {
      return instanceId;
    }
    // Agent changed or was replaced during await — restart the entire check
    return ensureAcpAgent(connection, cwd, sandboxPaths, `${callerTag}-retry`, depth + 1);
  }

  // Wrap spawn in a tracked promise so concurrent callers await instead of double-spawning
  acpSpawnPromise = (async () => {
    try {
      const launch = resolveAgentLaunch(connection);

      // Model selection is done post-session via the model-category session
      // config option (session/set_config_option). CLI args are only used for
      // non-model flags.
      const args = [...launch.agentArgs];

      // Build network sandbox config if enabled
      const networkSandboxEnabled = connection.networkSandboxEnabled ?? false;
      let networkAllowedDomains: string[] | null = null;
      if (networkSandboxEnabled) {
        // Custom binaries (absolute paths) match no PROVIDER_OPTIONS entry — the
        // `?? []` keeps their built-in allowlist EMPTY (only user-added domains).
        const providerOption = PROVIDER_OPTIONS.find(
          (o) => o.agentBinary === launch.agentBinary || o.lspBinary === launch.agentBinary
        );
        const builtIn = providerOption?.installMeta?.allowedDomains ?? [];
        const permStore = usePermissionStore.getState();
        const userDomains = permStore.getDomainAllowedList(connection.id, null);
        networkAllowedDomains = [...builtIn, ...userDomains];
      }

      // Merge the preset's isolation env (provider + XDG paths) on top of the
      // connection's own env. These point Goose at the bundled server and the
      // Notesage-owned XDG tree so the user's real Goose setup is untouched (#8).
      const spawnEnvVars = endpoint
        ? { ...(launch.envVars ?? {}), ...endpoint.env }
        : launch.envVars;

      const result = await invoke<AcpSpawnResult>('acp_agent_spawn', {
        agentBinary: launch.agentBinary,
        agentArgs: args.length > 0 ? args : null,
        role: 'interactive',
        workingDirectory: cwd,
        envVars: spawnEnvVars,
        connectionId: connection.id,
        envVarKeys: launch.envVarKeys,
        sandboxEnabled: connection.sandboxEnabled ?? null,
        // Deduplicate — `getChatSandboxScope` may already include extraWritablePaths;
        // non-chat callers (comment delegation, inline actions) pass them separately.
        sandboxPaths: (() => {
          const merged = [...new Set<string>([
            ...(sandboxPaths ?? []),
            ...(connection.extraWritablePaths ?? []),
          ])];
          return merged.length > 0 ? merged : null;
        })(),
        networkSandboxEnabled: networkSandboxEnabled || null,
        networkAllowedDomains,
        kernelNetworkDeny: connection.kernelNetworkDeny ?? null,
        // Allow the bundled llama-server port through the kernel network sandbox
        // alongside the proxy port (#9) — the preset agent must reach the local
        // OpenAI-compatible endpoint even under `(deny default)` networking.
        extraLocalhostPorts: endpoint ? [endpoint.port] : null,
      });

      // Try to authenticate — some agents handle auth internally
      // (e.g. claude-agent-acp v0.24+ uses stored CLI credentials and
      // reports zero auth methods; older versions return "not implemented")
      try {
        await invoke('acp_agent_authenticate', {
          instanceId: result.instance_id,
        });
      } catch (authErr) {
        const msg = String(authErr).toLowerCase();
        if (!msg.includes('not implemented') && !msg.includes('no authentication methods')) {
          throw authErr;
        }
        // Agent handles auth internally — proceed without authentication
        log.info('ai', `ACP auth skipped (agent handles internally): ${String(authErr)}`);
      }

      acpAgent = {
        instanceId: result.instance_id,
        connectionId: connection.id,
        sandboxScopeKey: scopeKey,
        configKey,
        chatSessionId: null,
        agentBinary: launch.agentBinary,
        capabilities: result.capabilities,
      };
      return result.instance_id;
    } finally {
      acpSpawnPromise = null;
    }
  })();

  return acpSpawnPromise;
}

// ---------------------------------------------------------------------------
// Capability probe — lightweight spawn → session → read → stop
// ---------------------------------------------------------------------------

/**
 * Probe an ACP agent's capabilities by spawning it, creating a session,
 * reading modes/config, and stopping. Used at connection registration time
 * to discover what the agent supports before the user sends any messages.
 */
export async function probeAcpCapabilities(connection: Connection): Promise<AcpDiscoveredCapabilities> {
  const launch = resolveAgentLaunch(connection);

  let instanceId: string | null = null;
  try {
    // Spawn agent (minimal config). The FS sandbox follows the connection's
    // setting — custom_acp candidates carry an explicit `sandboxEnabled: true`
    // so an arbitrary binary never runs its probe with full $HOME read access.
    // The NETWORK sandbox is deliberately off for the probe: the proxy's
    // domain-approval cards have no surface during registration and a blocked
    // first egress would false-fail the probe; the persisted connection still
    // gets the full network confinement for real use.
    const result = await invoke<AcpSpawnResult>('acp_agent_spawn', {
      agentBinary: launch.agentBinary,
      agentArgs: launch.agentArgs.length ? launch.agentArgs : null,
      role: 'interactive',
      workingDirectory: '/tmp',
      envVars: launch.envVars,
      connectionId: connection.id,
      envVarKeys: launch.envVarKeys,
      sandboxEnabled: connection.sandboxEnabled ?? null,
      sandboxPaths: null,
      networkSandboxEnabled: null,
      networkAllowedDomains: null,
      kernelNetworkDeny: null,
    });
    instanceId = result.instance_id;

    // Authenticate (skip if agent handles it internally)
    try {
      await invoke('acp_agent_authenticate', { instanceId });
    } catch (authErr) {
      const msg = String(authErr).toLowerCase();
      if (!msg.includes('not implemented') && !msg.includes('no authentication methods')) {
        throw authErr;
      }
    }

    // Create a session to discover modes and config options
    const session = await invoke<AcpSessionResult>('acp_session_new', {
      instanceId,
      workingDirectory: '/tmp',
    });

    // Extract capabilities
    const capabilities: AcpDiscoveredCapabilities = {
      availableModes: session.modes?.availableModes,
      configOptions: session.config_options?.map(opt => ({
        id: opt.id,
        name: opt.name,
        description: opt.description,
        category: opt.category,
        currentValue: opt.currentValue,
        options: opt.options,
      })),
      supportsLoadSession: result.capabilities?.loadSession ?? result.capabilities?.load_session ?? false,
      supportsImages: result.supports_images,
      agentVersion: result.agent_version ?? undefined,
      lastProbed: Date.now(),
    };

    log.info('ai', `ACP capability probe for ${launch.agentBinary}: ${JSON.stringify(capabilities)}`);
    return capabilities;
  } finally {
    // Always stop the probe agent
    if (instanceId) {
      invoke('acp_agent_stop', { instanceId }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Custom agent registration — probe-first, nothing persisted on failure
// ---------------------------------------------------------------------------

export interface CustomAcpRegistrationInput {
  label: string;
  /** Absolute path to the agent binary — validated by the backend at spawn. */
  binaryPath: string;
  binaryArgs?: string[];
  /** Stored via the existing `credentials.envVars` flow (keychain-backed). */
  envVars?: Record<string, string>;
}

/**
 * Register a `custom_acp` connection. The capability probe (spawn → initialize →
 * session → stop) runs FIRST against a transient connection object; only a
 * passing probe persists anything. A probe failure rejects with the backend's
 * error — which carries the agent's stderr tail (mirroring `mcp_validate_server`)
 * — and leaves the connections store untouched.
 */
export async function registerCustomAcpConnection(
  input: CustomAcpRegistrationInput,
): Promise<{ connectionId: string; capabilities: AcpDiscoveredCapabilities }> {
  const credentials: ConnectionCredentials = {
    type: 'agent_managed',
    // Mirror the path so display-only readers of `credentials.agentBinary`
    // (connection card, reauth lookup) see a stable value; the spawn pipeline
    // resolves from `config.binaryPath` via `resolveAgentLaunch`.
    agentBinary: input.binaryPath,
    ...(input.envVars && Object.keys(input.envVars).length > 0 ? { envVars: input.envVars } : {}),
  };
  const candidate: Connection = {
    // Unique ephemeral id — never persisted. Keeps concurrent probes (popover
    // reopened mid-probe) from sharing keychain-lookup / state-map identity.
    id: `custom-acp-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    provider: 'custom_acp',
    authMethod: 'agent_managed',
    status: 'connected',
    label: input.label,
    credentials,
    capabilities: getCapabilities('custom_acp', 'agent_managed'),
    config: { binaryPath: input.binaryPath, binaryArgs: input.binaryArgs ?? [] },
    // Maximal confinement for arbitrary third-party binaries (task #3 policy).
    // `should_sandbox_by_default` in sandbox.rs only auto-sandboxes managed
    // installs under ~/.notesage/agents/bin — a custom absolute path would
    // default to UNSANDBOXED, so the connection must carry an explicit true.
    // Applies to the registration probe too (FS sandbox, writable = /tmp cwd).
    sandboxEnabled: true,
    networkSandboxEnabled: true,
    kernelNetworkDeny: true,
    createdAt: Date.now(),
  };

  // Throws on probe failure — registration is blocked, nothing persisted.
  const capabilities = await probeAcpCapabilities(candidate);

  const connectionId = useConnectionsStore.getState().addConnection({
    provider: 'custom_acp',
    authMethod: 'agent_managed',
    status: 'connected',
    label: input.label,
    credentials,
    config: candidate.config,
  });
  useConnectionsStore.getState().updateConnection(connectionId, {
    acpCapabilities: capabilities,
    sandboxEnabled: true,
    networkSandboxEnabled: true,
    kernelNetworkDeny: true,
  });
  return { connectionId, capabilities };
}

/**
 * Backfill `connection.acpCapabilities` from a session/new (or load/resume/fork) response.
 *
 * Lazy upgrade path for connections that existed before the capability probe was
 * introduced (commit 29013ce8): the eager-session response from `useAcpLifecycle`
 * carries the same `modes` + `config_options` data the probe extracts, so we
 * populate caps for free whenever the user opens or switches a chat — no extra
 * spawn, no startup cost.
 *
 * No-op when caps are already populated AND fresh (<24h) AND non-empty.
 */
export function backfillAcpCapabilities(
  connectionId: string | undefined,
  session: { modes?: AcpSessionModeState | null; config_options?: AcpSessionConfigOption[] | null },
): void {
  if (!connectionId) return;
  const connection = useConnectionsStore.getState().getConnection(connectionId);
  if (!connection || connection.authMethod !== 'agent_managed') return;

  const existing = connection.acpCapabilities;
  const fresh = !!existing?.lastProbed && Date.now() - existing.lastProbed < 24 * 60 * 60 * 1000;
  const hasModes = (existing?.availableModes?.length ?? 0) > 0;
  if (fresh && hasModes) return;

  const next: AcpDiscoveredCapabilities = {
    ...existing,
    availableModes: session.modes?.availableModes ?? existing?.availableModes,
    configOptions:
      session.config_options?.map((opt) => ({
        id: opt.id,
        name: opt.name,
        description: opt.description,
        category: opt.category,
        currentValue: opt.currentValue,
        options: opt.options,
      })) ?? existing?.configOptions,
    supportsLoadSession: existing?.supportsLoadSession ?? false,
    supportsImages: existing?.supportsImages ?? false,
    agentVersion: existing?.agentVersion,
    lastProbed: Date.now(),
  };
  useConnectionsStore.getState().updateConnection(connectionId, { acpCapabilities: next });
  log.info('ai', `Backfilled acpCapabilities for ${connectionId} from eager session`);
}
