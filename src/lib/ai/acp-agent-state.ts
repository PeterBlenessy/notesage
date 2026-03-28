// Module-level ACP agent singleton state and spawn logic.
// Extracted from useAcpLifecycle.ts — survives re-renders, shared across the app.

import { invoke } from '@tauri-apps/api/core';
import { log } from '@/lib/logger';
import { usePermissionStore } from '@/stores/permission-store';
import { PROVIDER_OPTIONS } from '@/lib/ai/connections';
import type { Connection } from '@/lib/ai/connections';
import type { AcpSpawnResult } from '@/lib/ai/acp-utils';

// ---------------------------------------------------------------------------
// Agent state (module-level singleton — survives re-renders)
// ---------------------------------------------------------------------------

export interface AcpAgentState {
  instanceId: string;
  connectionId: string;
  /** Serialized sandbox scope key — used to detect when agent needs respawning. */
  sandboxScopeKey: string;
  chatSessionId: string | null;
}

/** Persistent ACP agent state — survives re-renders, reset on connection change. */
export let acpAgent: AcpAgentState | null = null;

/** In-flight spawn promise — prevents concurrent callers from double-spawning. */
let acpSpawnPromise: Promise<string> | null = null;

/** Read the current agent state — bypasses TypeScript control-flow narrowing. */
function getAcpAgent(): AcpAgentState | null {
  return acpAgent;
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
}

/**
 * Ensure an ACP agent is spawned and authenticated for the given connection.
 * Reuses the existing agent if the connection matches. Stops and replaces
 * if the connection changed.
 */
export async function ensureAcpAgent(connection: Connection, cwd: string, sandboxPaths?: string[]): Promise<string> {
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
    return ensureAcpAgent(connection, cwd, sandboxPaths);
  }

  // Wrap spawn in a tracked promise so concurrent callers await instead of double-spawning
  acpSpawnPromise = (async () => {
    try {
      const creds = connection.credentials as { type: 'agent_managed'; agentBinary: string; agentArgs?: string[]; envVars?: Record<string, string> };

      // Inject model flag if the connection has a model configured
      // Different agents use different flag formats:
      //   codex-acp: -c model="<model>"
      //   others:    --model <model>
      const args = [...(creds.agentArgs ?? [])];
      if (connection.config?.model) {
        // Append reasoning effort suffix for codex-acp (e.g., "gpt-5.2-codex" -> "gpt-5.2-codex/low")
        let modelId = connection.config.model;
        if (creds.agentBinary === 'codex-acp' && connection.config.reasoningEffort) {
          modelId = `${modelId}/${connection.config.reasoningEffort}`;
        }
        if (creds.agentBinary === 'codex-acp') {
          args.push('-c', `model="${modelId}"`);
        } else {
          args.push('--model', modelId);
        }
      }

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
        sandboxScopeKey: scopeKey,
        chatSessionId: null,
      };
      return result.instance_id;
    } finally {
      acpSpawnPromise = null;
    }
  })();

  return acpSpawnPromise;
}
