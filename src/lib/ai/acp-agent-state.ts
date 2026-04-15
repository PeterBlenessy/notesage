// Module-level ACP agent singleton state and spawn logic.
// Extracted from useAcpLifecycle.ts — survives re-renders, shared across the app.

import { invoke } from '@tauri-apps/api/core';
import { log } from '@/lib/logger';
import { usePermissionStore } from '@/stores/permission-store';
import { PROVIDER_OPTIONS } from '@/lib/ai/connections';
import type { Connection } from '@/lib/ai/connections';
import type { AcpSpawnResult, AcpSessionModeState, AcpSessionConfigOption, AcpAgentCapabilities } from '@/lib/ai/acp-utils';

// ---------------------------------------------------------------------------
// Claude Code mode label mapping
// ---------------------------------------------------------------------------

interface ModeLabel {
  name: string;
  tooltip: string;
}

const CLAUDE_CODE_MODE_LABELS: Record<string, ModeLabel> = {
  code: { name: 'Edit', tooltip: 'Agent can read and modify your documents' },
  architect: { name: 'Plan', tooltip: 'Agent discusses approach without making changes' },
  ask: { name: 'Chat', tooltip: 'Conversation only — no file access' },
};

/** Get display label for a mode. Only applies Claude Code-specific labels. */
export function getModeLabel(agentBinary: string | undefined, modeId: string, nativeName: string): ModeLabel {
  if (agentBinary?.includes('claude') && CLAUDE_CODE_MODE_LABELS[modeId]) {
    return CLAUDE_CODE_MODE_LABELS[modeId];
  }
  return { name: nativeName, tooltip: '' };
}

// ---------------------------------------------------------------------------
// Agent state (module-level singleton — survives re-renders)
// ---------------------------------------------------------------------------

export interface AcpAgentState {
  instanceId: string;
  connectionId: string;
  /** Serialized sandbox scope key — used to detect when agent needs respawning. */
  sandboxScopeKey: string;
  chatSessionId: string | null;
  /** Agent binary name (e.g., 'claude-agent-acp', 'codex-acp') */
  agentBinary?: string;
  /** Agent capabilities from initialize response */
  capabilities?: AcpAgentCapabilities | null;
}

// ---------------------------------------------------------------------------
// Session-level state (modes, config options) — module-level, reset per session
// ---------------------------------------------------------------------------

export interface AcpSessionInfo {
  modes: AcpSessionModeState | null;
  configOptions: AcpSessionConfigOption[] | null;
}

let sessionInfo: AcpSessionInfo = { modes: null, configOptions: null };

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

export function clearSessionInfo(): void {
  sessionInfo = { modes: null, configOptions: null };
  sessionInfoListeners.forEach(fn => fn());
}

export function subscribeSessionInfo(fn: () => void): () => void {
  sessionInfoListeners.add(fn);
  return () => { sessionInfoListeners.delete(fn); };
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
 * @param depth Internal recursion counter — callers should not set this.
 */
export async function ensureAcpAgent(connection: Connection, cwd: string, sandboxPaths?: string[], depth = 0): Promise<string> {
  if (depth > MAX_ENSURE_DEPTH) {
    throw new Error('Agent spawn failed after multiple retries');
  }
  const scopeKey = (sandboxPaths ?? []).sort().join('|');

  // Respawn if connection changed OR sandbox scope changed
  if (acpAgent && (acpAgent.connectionId !== connection.id || acpAgent.sandboxScopeKey !== scopeKey)) {
    if (acpAgent.sandboxScopeKey !== scopeKey) {
      log.info('ai', 'Chat agent sandbox scope changed, respawning');
    }
    try {
      await invoke('acp_agent_stop', { instanceId: acpAgent.instanceId });
    } catch {
      // Expected: agent may already be stopped or crashed — proceed with cleanup
    }
    acpAgent = null;
    acpSpawnPromise = null;
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
    return ensureAcpAgent(connection, cwd, sandboxPaths, depth + 1);
  }

  // Wrap spawn in a tracked promise so concurrent callers await instead of double-spawning
  acpSpawnPromise = (async () => {
    try {
      const creds = connection.credentials as { type: 'agent_managed'; agentBinary: string; agentArgs?: string[]; envVars?: Record<string, string> };

      // Model selection is now done post-session via session/set_model (ACP-native).
      // CLI args are only used for non-model flags.
      const args = [...(creds.agentArgs ?? [])];

      // Build network sandbox config if enabled
      const networkSandboxEnabled = connection.networkSandboxEnabled ?? false;
      let networkAllowedDomains: string[] | null = null;
      if (networkSandboxEnabled) {
        const providerOption = PROVIDER_OPTIONS.find(
          (o) => o.agentBinary === creds.agentBinary || o.lspBinary === creds.agentBinary
        );
        const builtIn = providerOption?.installMeta?.allowedDomains ?? [];
        const permStore = usePermissionStore.getState();
        const userDomains = permStore.getDomainAllowedList(connection.id);
        networkAllowedDomains = [...builtIn, ...userDomains];
      }

      const result = await invoke<AcpSpawnResult>('acp_agent_spawn', {
        agentBinary: creds.agentBinary,
        agentArgs: args.length > 0 ? args : null,
        role: 'interactive',
        workingDirectory: cwd,
        envVars: creds.envVars ?? null,
        sandboxEnabled: connection.sandboxEnabled ?? null,
        sandboxPaths: [
          ...(sandboxPaths ?? []),
          ...(connection.extraWritablePaths ?? []),
        ].length > 0 ? [...(sandboxPaths ?? []), ...(connection.extraWritablePaths ?? [])] : null,
        networkSandboxEnabled: networkSandboxEnabled || null,
        networkAllowedDomains,
        kernelNetworkDeny: connection.kernelNetworkDeny ?? null,
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
        chatSessionId: null,
        agentBinary: creds.agentBinary,
        capabilities: result.capabilities,
      };
      return result.instance_id;
    } finally {
      acpSpawnPromise = null;
    }
  })();

  return acpSpawnPromise;
}
