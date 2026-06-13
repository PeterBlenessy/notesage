// Setup orchestrator hook for the Local Agent preset (task #16).
//
// Wires the pure staged driver (`runLocalAgentSetup`) to the real stores and
// Tauri commands: hardware detection → tool-calling model recommendation →
// parallel agent install (#7) + model download → config generation (#8) +
// connection (#2) + routing (#13) → smoke test (#12). The editor stays usable
// throughout; progress surfaces through the persisted setup state (#15) which
// the dialog (#17) and the orb both read.

import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { tauriApi, type LocalAgentConfig } from '@/lib/tauri';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { getChatSandboxScope } from '@/lib/ai/acp-utils';
import { runLocalAgentSetup, type LocalAgentSetupResult } from '@/lib/ai/local-agent-setup';
import { recommendToolCallingModel } from '@/lib/ai/local-agent-model';
import { log } from '@/lib/logger';

const OPENCODE_AGENT_ID = 'opencode';

/** Resolve the installed OpenCode binary's absolute path (managed install). */
async function resolveOpencodePath(): Promise<string> {
  const resolution = await invoke<{ path: string } | null>('agent_resolve_binary', {
    agentId: OPENCODE_AGENT_ID,
  });
  if (!resolution?.path) {
    throw new Error('OpenCode binary not found after install');
  }
  return resolution.path;
}

export interface UseLocalAgentSetup {
  /** Current persisted setup state (stage, modelId, error). */
  setup: ReturnType<typeof useLocalAIStore.getState>['localAgentSetup'];
  /**
   * Run (or resume / retry) the setup flow. Resolves with the outcome.
   * Pass `modelId` to override the hardware recommendation (dialog model picker).
   */
  start: (modelId?: string) => Promise<LocalAgentSetupResult>;
  /** Reset the flow back to idle. */
  reset: () => void;
}

export function useLocalAgentSetup(): UseLocalAgentSetup {
  const setup = useLocalAIStore((s) => s.localAgentSetup);

  const start = useCallback(async (modelOverride?: string): Promise<LocalAgentSetupResult> => {
    const localStore = useLocalAIStore.getState();
    const connStore = useConnectionsStore.getState();
    const routingStore = useRoutingStore.getState();

    // Captured across stages: the generated config (env + llama port) the smoke
    // test needs to spawn OpenCode against the bundled server in isolation.
    let configResult: LocalAgentConfig | null = null;
    let presetBinaryPath = '';

    return runLocalAgentSetup({
      detect: async () => {
        await localStore.refreshModels();
        try {
          const mem = await tauriApi.getSystemMemory();
          localStore.setSystemMemory(mem);
        } catch (e) {
          // Non-fatal — recommendation falls back to catalog defaults.
          log.warn('ai', `Local Agent setup: system memory detection failed: ${String(e)}`);
        }
      },

      recommendModel: async () => {
        if (modelOverride) return modelOverride;
        const { models, systemMemory } = useLocalAIStore.getState();
        const modelId = recommendToolCallingModel(models, systemMemory?.total_bytes ?? null);
        if (!modelId) {
          throw new Error('No tool-calling-capable local model is available to install');
        }
        return modelId;
      },

      isModelDownloaded: (modelId) =>
        useLocalAIStore.getState().models.find((m) => m.id === modelId)?.downloaded ?? false,

      installAgent: async () => {
        // Resolves when the install finishes (the command awaits do_agent_install).
        await invoke('agent_install', { agentId: OPENCODE_AGENT_ID });
      },

      downloadModel: async (modelId) => {
        await tauriApi.downloadLocalModel(modelId);
        await useLocalAIStore.getState().refreshModels();
      },

      ensureServerRunning: async (modelId) => {
        const { contextLength, gpuLayers } = useLocalAIStore.getState();
        const port = await tauriApi.startLocalServer(modelId, contextLength, gpuLayers);
        useLocalAIStore.setState({ serverStatus: 'running', serverPort: port, serverError: null });
        useLocalAIStore.getState().setActiveModel(modelId);
      },

      writeConfig: async () => {
        configResult = await tauriApi.localAgentWriteConfig();
      },

      createPresetConnection: async () => {
        presetBinaryPath = await resolveOpencodePath();
        // Reuse an existing preset connection if one is already registered.
        const existing = connStore.connections.find(
          (c) => c.provider === 'custom_acp' && c.config?.localAgentPreset === 'opencode',
        );
        if (existing) {
          connStore.updateConnection(existing.id, {
            config: { ...existing.config, binaryPath: presetBinaryPath, binaryArgs: ['acp'], localAgentPreset: 'opencode' },
          });
          return existing.id;
        }
        const id = connStore.addConnection({
          provider: 'custom_acp',
          authMethod: 'agent_managed',
          status: 'connected',
          label: 'Local Agent',
          credentials: { type: 'agent_managed', agentBinary: presetBinaryPath },
          config: { binaryPath: presetBinaryPath, binaryArgs: ['acp'], localAgentPreset: 'opencode' },
        });
        // Maximal confinement: the agent only needs the bundled server (allowed
        // via the llama port) — empty network allowlist, kernel deny on (#9).
        connStore.updateConnection(id, {
          sandboxEnabled: true,
          networkSandboxEnabled: true,
          kernelNetworkDeny: true,
        });
        return id;
      },

      routeInteractive: (connectionId) => {
        routingStore.setRouting('interactive', connectionId);
      },

      smokeTest: async () => {
        const paths = selectProjectPaths(useChatStore.getState());
        const cwd = paths[0] || '/tmp';
        const conn = useConnectionsStore.getState().connections.find(
          (c) => c.provider === 'custom_acp' && c.config?.localAgentPreset === 'opencode',
        );
        const sandboxPaths = conn ? getChatSandboxScope({ projectPaths: paths }, conn, false) : paths;
        return tauriApi.acpAgentSmokeTest({
          agentBinary: presetBinaryPath,
          agentArgs: ['acp'],
          workingDirectory: cwd,
          envVars: configResult?.env ?? null,
          sandboxEnabled: true,
          sandboxPaths,
          networkSandboxEnabled: true,
          networkAllowedDomains: [],
          kernelNetworkDeny: true,
          extraLocalhostPorts: configResult ? [configResult.port] : null,
          requireLocalServer: true,
        });
      },

      setStage: (next) => useLocalAIStore.getState().setLocalAgentSetup(next),
      clearDegraded: () => useLocalAIStore.getState().setLocalAgentDegraded(null),
    });
  }, []);

  const reset = useCallback(() => useLocalAIStore.getState().resetLocalAgentSetup(), []);

  return { setup, start, reset };
}
