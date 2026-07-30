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
import { tauriApi, type BinaryResolution, type LocalAgentConfig } from '@/lib/tauri';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { getChatSandboxScope } from '@/lib/ai/acp-utils';
import { runLocalAgentSetup, installAgentIfMissing, type LocalAgentSetupResult } from '@/lib/ai/local-agent-setup';
import { recommendToolCallingModel, resolveLocalAgentContext } from '@/lib/ai/local-agent-model';
import { log } from '@/lib/logger';

export type LocalAgentEngine = 'goose' | 'pi';

/** Managed-install agent ids per engine. pi needs BOTH the pi binary and the
 *  notesage-pi-acp bridge (the connection's spawned binary IS the bridge). */
function engineAgentIds(engine: LocalAgentEngine): string[] {
  return engine === 'pi' ? ['pi', 'notesage-pi-acp'] : ['goose'];
}

/** Resolve an installed managed binary's absolute path. */
async function resolveManagedPath(agentId: string): Promise<string> {
  const resolution = await invoke<BinaryResolution | null>('agent_resolve_binary', {
    agentId,
  });
  if (!resolution?.path) {
    throw new Error(`${agentId} binary not found after install`);
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
  start: (modelId?: string, engine?: LocalAgentEngine) => Promise<LocalAgentSetupResult>;
  /** Reset the flow back to idle. */
  reset: () => void;
}

export function useLocalAgentSetup(): UseLocalAgentSetup {
  const setup = useLocalAIStore((s) => s.localAgentSetup);

  const start = useCallback(async (
    modelOverride?: string,
    engine: LocalAgentEngine = 'goose',
  ): Promise<LocalAgentSetupResult> => {
    const localStore = useLocalAIStore.getState();
    const connStore = useConnectionsStore.getState();
    const routingStore = useRoutingStore.getState();

    // Captured across stages: the generated config (env + llama port) the smoke
    // test needs to spawn Goose against the bundled server in isolation.
    let configResult: LocalAgentConfig | null = null;
    // The binary the connection spawns: Goose itself, or the pi bridge.
    let presetBinaryPath = '';
    // Stable (non-live) spawn args: Goose `['acp']`; pi `['--pi-bin', <pi>]`
    // (the live post-`--` provider/model args come from the endpoint config).
    let presetBinaryArgs: string[] = [];
    // The connection id this run *created* (vs reused). Only a created one is
    // rolled back on failure — never one the run found already registered.
    let createdConnectionId: string | null = null;

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
        // Setup-time skip (resume guard): the GitHub-binary install re-downloads
        // the whole tarball every run, so binaries that already resolve are not
        // reinstalled. Logic lives in the pure `installAgentIfMissing` so the
        // skip is unit-tested. Updates still go through `agent_update`
        // (→ do_agent_install), which must keep forcing a fresh download.
        // pi installs two artifacts (pi + the bridge), sequentially — the
        // progress events already carry per-agent ids for the dialog.
        for (const agentId of engineAgentIds(engine)) {
          await installAgentIfMissing({
            resolveBinaryPath: async () =>
              (
                await invoke<BinaryResolution | null>('agent_resolve_binary', {
                  agentId,
                }).catch(() => null)
              )?.path ?? null,
            install: () => invoke('agent_install', { agentId }),
          });
        }
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
        configResult = await tauriApi.localAgentWriteConfig(engine);
      },

      createPresetConnection: async () => {
        if (engine === 'pi') {
          const piPath = await resolveManagedPath('pi');
          presetBinaryPath = await resolveManagedPath('notesage-pi-acp');
          presetBinaryArgs = ['--pi-bin', piPath];
        } else {
          presetBinaryPath = await resolveManagedPath('goose');
          presetBinaryArgs = ['acp'];
        }
        // Reuse an existing preset connection FOR THIS ENGINE if registered.
        const existing = connStore.connections.find(
          (c) => c.provider === 'custom_acp' && c.config?.localAgentPreset === engine,
        );
        if (existing) {
          connStore.updateConnection(existing.id, {
            config: { ...existing.config, binaryPath: presetBinaryPath, binaryArgs: presetBinaryArgs, localAgentPreset: engine },
          });
          return existing.id;
        }
        const id = connStore.addConnection({
          provider: 'custom_acp',
          authMethod: 'agent_managed',
          status: 'connected',
          label: engine === 'pi' ? 'Local Agent (pi)' : 'Local Agent',
          credentials: { type: 'agent_managed', agentBinary: presetBinaryPath },
          config: { binaryPath: presetBinaryPath, binaryArgs: presetBinaryArgs, localAgentPreset: engine },
        });
        // Maximal confinement: the agent only needs the bundled server (allowed
        // via the llama port) — empty network allowlist, kernel deny on (#9).
        connStore.updateConnection(id, {
          sandboxEnabled: true,
          networkSandboxEnabled: true,
          kernelNetworkDeny: true,
        });
        createdConnectionId = id;
        return id;
      },

      routeInteractive: (connectionId) => {
        routingStore.setRouting('interactive', connectionId);
      },

      rollback: (connectionId) => {
        // Only undo a connection THIS run created — never a reused one (so
        // re-running setup on an already-working agent can't delete it). On a
        // failed add, clear the interactive routing slot pointing at it and
        // remove the connection so the broken agent never reaches the dropdown.
        if (createdConnectionId !== connectionId) return;
        useRoutingStore.getState().clearRoutingForConnection(connectionId);
        useConnectionsStore.getState().removeConnection(connectionId);
        createdConnectionId = null;
      },

      smokeTest: async () => {
        const paths = selectProjectPaths(useChatStore.getState());
        const cwd = paths[0] || '/tmp';
        const conn = useConnectionsStore.getState().connections.find(
          (c) => c.provider === 'custom_acp' && c.config?.localAgentPreset === engine,
        );
        const sandboxPaths = conn ? getChatSandboxScope({ projectPaths: paths }, conn, false) : paths;
        // pi: append the live post-`--` provider/model args from the config,
        // exactly like the real spawn path (ensureAcpAgent) does.
        const smokeArgs =
          engine === 'pi' && configResult
            ? [...presetBinaryArgs, '--', ...configResult.piArgs]
            : presetBinaryArgs;
        return tauriApi.acpAgentSmokeTest({
          agentBinary: presetBinaryPath,
          agentArgs: smokeArgs,
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
    });
  }, []);

  const reset = useCallback(() => useLocalAIStore.getState().resetLocalAgentSetup(), []);

  return { setup, start, reset };
}
