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
import { recommendToolCallingModel, resolveLocalAgentContext } from '@/lib/ai/local-agent-model';
import { log } from '@/lib/logger';

const GOOSE_AGENT_ID = 'goose';

/** Resolve the installed Goose binary's absolute path (managed install). */
async function resolveGoosePath(): Promise<string> {
  const resolution = await invoke<{ path: string } | null>('agent_resolve_binary', {
    agentId: GOOSE_AGENT_ID,
  });
  if (!resolution?.path) {
    throw new Error('Goose binary not found after install');
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
    // test needs to spawn Goose against the bundled server in isolation.
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
        // Setup-time skip: the GitHub-binary install re-downloads the ~79 MB
        // tarball every run, so if the Goose binary already resolves to a real
        // path we don't reinstall it. This is purely a setup-flow optimisation —
        // updates still go through `agent_update` (→ do_agent_install), which
        // must keep forcing a fresh download, so we deliberately don't touch the
        // shared backend command.
        const existing = await invoke<{ path: string } | null>('agent_resolve_binary', {
          agentId: GOOSE_AGENT_ID,
        }).catch(() => null);
        if (existing?.path) return;
        // Resolves when the install finishes (the command awaits do_agent_install).
        await invoke('agent_install', { agentId: GOOSE_AGENT_ID });
      },

      downloadModel: async (modelId) => {
        await tauriApi.downloadLocalModel(modelId);
        await useLocalAIStore.getState().refreshModels();
      },

      ensureServerRunning: async (modelId) => {
        const { contextLength, gpuLayers } = useLocalAIStore.getState();
        // Agentic chat needs a much larger window than the chat default (4096):
        // an agent's system prompt + tool schemas run several thousand tokens, so
        // the server must start with at least LOCAL_AGENT_MIN_CONTEXT or every
        // agentic turn overflows. startLocalServer stops + restarts, so this
        // takes effect even if a smaller-context chat server was already running.
        const agentContext = resolveLocalAgentContext(contextLength);
        const port = await tauriApi.startLocalServer(modelId, agentContext, gpuLayers);
        useLocalAIStore.setState({ serverStatus: 'running', serverPort: port, serverError: null });
        useLocalAIStore.getState().setActiveModel(modelId);
      },

      writeConfig: async () => {
        configResult = await tauriApi.localAgentWriteConfig();
      },

      createPresetConnection: async () => {
        presetBinaryPath = await resolveGoosePath();
        // Reuse an existing preset connection if one is already registered.
        const existing = connStore.connections.find(
          (c) => c.provider === 'custom_acp' && c.config?.localAgentPreset === 'goose',
        );
        if (existing) {
          connStore.updateConnection(existing.id, {
            config: { ...existing.config, binaryPath: presetBinaryPath, binaryArgs: ['acp'], localAgentPreset: 'goose' },
          });
          return existing.id;
        }
        const id = connStore.addConnection({
          provider: 'custom_acp',
          authMethod: 'agent_managed',
          status: 'connected',
          label: 'Local Agent',
          credentials: { type: 'agent_managed', agentBinary: presetBinaryPath },
          config: { binaryPath: presetBinaryPath, binaryArgs: ['acp'], localAgentPreset: 'goose' },
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
          (c) => c.provider === 'custom_acp' && c.config?.localAgentPreset === 'goose',
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
          // Goose is a self-contained Rust binary that needs NO network for local
          // use — no npm install of a provider SDK, no cloud model registry, no
          // auth. It talks only to the bundled llama-server over localhost (added
          // via extraLocalhostPorts below). The preset stays strictly local-only:
          // an EMPTY domain allowlist under kernel network deny.
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
