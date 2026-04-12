import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';

/**
 * Lifecycle hook for local AI: fetches system info, auto-starts server,
 * manages the connection in connections-store.
 * Must be mounted in App.tsx.
 */
export function useLocalAI() {
  const startupReady = useSettingsStore((s) => s.startupReady);
  const activeModelId = useLocalAIStore((s) => s.activeModelId);
  const contextLength = useLocalAIStore((s) => s.contextLength);
  const gpuLayers = useLocalAIStore((s) => s.gpuLayers);
  const serverStatus = useLocalAIStore((s) => s.serverStatus);
  const binaryStatus = useLocalAIStore((s) => s.binaryStatus);
  const models = useLocalAIStore((s) => s.models);
  const connections = useConnectionsStore((s) => s.connections);
  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);
  const startupLoadedRef = useRef(false);
  const diagnosticsLoggedRef = useRef(false);
  const lastStartedModelRef = useRef<string | null>(null);

  // Check if Local AI connection exists in connections-store
  const hasLocalAIConnection = connections.some(
    (c) => c.provider === 'local_ai' && c.authMethod === 'local_bundled'
  );

  // Fetch system memory and model list on startup
  useEffect(() => {
    if (!startupReady) return;

    (async () => {
      try {
        const store = useLocalAIStore.getState();
        const [memoryResult, modelsResult, binaryResultSettled] = await Promise.allSettled([
          tauriApi.getSystemMemory(),
          tauriApi.listLocalModels(),
          store.checkBinary(),
        ]);
        if (memoryResult.status === 'fulfilled') {
          store.setSystemMemory(memoryResult.value);
        } else {
          log.warn('local-ai', 'Failed to fetch system memory', memoryResult.reason);
        }
        if (modelsResult.status === 'fulfilled') {
          store.setModels(modelsResult.value);
          log.debug('local-ai', `Loaded ${modelsResult.value.length} models`);
        } else {
          log.warn('local-ai', 'Failed to list local models', modelsResult.reason);
        }
        if (binaryResultSettled.status === 'fulfilled') {
          const binaryResult = binaryResultSettled.value;
          if (binaryResult.available) {
            log.debug('local-ai', `Binary found at ${binaryResult.location}: ${binaryResult.path}`);
          } else {
            log.warn('local-ai', 'Binary not found — sidecar may not be bundled correctly');
          }
        } else {
          log.warn('local-ai', 'Failed to check binary', binaryResultSettled.reason);
        }
        startupLoadedRef.current = true;
      } catch (e) {
        log.error('local-ai', 'Failed to fetch local AI info', e);
        startupLoadedRef.current = true; // Don't block auto-start forever
      }
    })();
  }, [startupReady]);

  // Auto-start server when Local AI connection exists and a model is downloaded.
  // Depends on `models` and `binaryStatus` so it re-fires after startup fetch completes.
  useEffect(() => {
    if (!startupReady) return;

    const store = useLocalAIStore.getState();
    let autoStartResult = 'skipped';
    let skipReason = '';

    if (!hasLocalAIConnection) {
      skipReason = 'no Local AI connection';
      log.info('local-ai', `Auto-start skipped: ${skipReason}`, {
        connectionCount: connections.length,
        providers: connections.map(c => c.provider),
      });
      return;
    }
    if (!activeModelId) {
      skipReason = 'no activeModelId';
      log.info('local-ai', `Auto-start skipped: ${skipReason}`);
      store.setServerStatusReason('No model selected — choose a model in Settings → Local AI');
      updateConnectionStatus('expired');
      return;
    }

    // Don't auto-start if binary is not available
    if (binaryStatus === 'not_found' || binaryStatus === 'unknown') {
      if (binaryStatus !== 'unknown') {
        skipReason = `binary not available (status: ${binaryStatus})`;
        log.info('local-ai', `Auto-start skipped: ${skipReason}`);
        store.setServerStatusReason('AI engine not found — try reinstalling Notesage');
        updateConnectionStatus('expired');
      }
      return;
    }

    const model = models.find((m) => m.id === activeModelId);
    if (!model?.downloaded) {
      // Only log after startup has loaded models (avoid noise from empty initial state)
      if (startupLoadedRef.current) {
        skipReason = `model ${activeModelId} not downloaded (${models.length} models loaded)`;
        log.info('local-ai', `Auto-start skipped: ${skipReason}`);
        store.setServerStatusReason('Model not downloaded — download it in Settings → Local AI');
        updateConnectionStatus('expired');
      }
      return;
    }

    // If already running with a different model, restart with the new one
    if (store.serverStatus === 'running' || store.serverStatus === 'starting') {
      if (store.serverStatus === 'running' && lastStartedModelRef.current && lastStartedModelRef.current !== activeModelId) {
        log.info('local-ai', `Model changed from ${lastStartedModelRef.current} to ${activeModelId} — restarting server`);
        store.setServerStatusReason('Switching model...');
        // Fall through to start with new model (start_local_server kills the old one)
      } else {
        autoStartResult = store.serverStatus === 'running' ? 'already running' : 'already starting';
        return;
      }
    }

    autoStartResult = 'started';
    log.info('local-ai', `Auto-starting server with model ${activeModelId}`, {
      binaryStatus,
      modelsLoaded: models.length,
    });
    store.setServerStatusReason('Starting...');
    lastStartedModelRef.current = activeModelId;
    startServer(activeModelId, contextLength, gpuLayers);

    // Log startup diagnostics once (task 5)
    if (!diagnosticsLoggedRef.current && startupLoadedRef.current) {
      diagnosticsLoggedRef.current = true;
      log.info('local-ai', 'Startup diagnostics', {
        connection: hasLocalAIConnection,
        activeModelId,
        binaryStatus,
        modelsLoaded: models.length,
        modelDownloaded: !!model?.downloaded,
        serverStatus: store.serverStatus,
        autoStartResult: autoStartResult || `skipped (${skipReason})`,
      });
    }
  }, [startupReady, hasLocalAIConnection, activeModelId, contextLength, gpuLayers, models, binaryStatus]);

  // Log startup diagnostics even if auto-start was skipped
  useEffect(() => {
    if (!startupReady || !startupLoadedRef.current || diagnosticsLoggedRef.current) return;
    if (!hasLocalAIConnection) return; // Don't log diagnostics if Local AI isn't set up at all

    diagnosticsLoggedRef.current = true;
    const store = useLocalAIStore.getState();
    const model = activeModelId ? models.find((m) => m.id === activeModelId) : null;
    log.info('local-ai', 'Startup diagnostics', {
      connection: hasLocalAIConnection,
      activeModelId,
      binaryStatus,
      modelsLoaded: models.length,
      modelDownloaded: !!model?.downloaded,
      serverStatus: store.serverStatus,
      autoStartResult: 'skipped',
    });
  }, [startupReady, hasLocalAIConnection, activeModelId, binaryStatus, models]);

  // Stop server when Local AI connection is removed
  useEffect(() => {
    if (!hasLocalAIConnection && useLocalAIStore.getState().serverStatus === 'running') {
      log.info('local-ai', 'Connection removed, stopping server');
      tauriApi.stopLocalServer().catch(() => {}); // Expected: best-effort stop, server may not be running
      useLocalAIStore.getState().setServerStatus('stopped');
      useLocalAIStore.getState().setServerPort(null);
      useLocalAIStore.getState().setServerStatusReason(null);
    }
  }, [hasLocalAIConnection]);

  // Listen for server status events
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let mounted = true;

    listen<{ running: boolean; port: number | null; model: string | null }>(
      'local-server-status',
      (event) => {
        const { running, port } = event.payload;
        log.debug('local-ai', 'Server status event', event.payload);
        const store = useLocalAIStore.getState();

        if (running) {
          store.setServerStatus('running');
          store.setServerPort(port);
          store.setServerStatusReason(null);
          retryCountRef.current = 0;
          updateConnectionStatus('connected');
          // Fetch runtime model metadata for tooltip enrichment
          if (port) {
            tauriApi.getRuntimeModelMetadata(port).catch(() => {}); // Expected: metadata fetch is best-effort enrichment
          }
        } else {
          store.setServerStatus('stopped');
          store.setServerPort(null);
          store.setServerStatusReason('Server stopped unexpectedly');
          updateConnectionStatus('error');
        }
      },
    ).then((fn) => {
      if (mounted) {
        unlisten = fn;
      } else {
        fn(); // Already unmounted — immediately remove listener
      }
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  // Health check every 30s when server should be running
  useEffect(() => {
    if (serverStatus !== 'running') {
      if (healthCheckRef.current) {
        clearInterval(healthCheckRef.current);
        healthCheckRef.current = null;
      }
      return;
    }

    healthCheckRef.current = setInterval(async () => {
      try {
        const status = await tauriApi.getLocalServerStatus();
        if (!status.running && useLocalAIStore.getState().serverStatus === 'running') {
          log.warn('local-ai', `Health check: server not running, retry ${retryCountRef.current + 1}/3`);
          // Server crashed — attempt restart
          if (retryCountRef.current < 3) {
            retryCountRef.current++;
            const store = useLocalAIStore.getState();
            if (store.activeModelId) {
              toast.info('Local AI restarted');
              store.setServerStatusReason('Restarting...');
              await startServer(store.activeModelId, store.contextLength, store.gpuLayers);
            }
          } else {
            useLocalAIStore.getState().setServerStatus('error', 'Server crashed and failed to restart after 3 attempts');
            useLocalAIStore.getState().setServerStatusReason('Server crashed and failed to restart after 3 attempts');
            updateConnectionStatus('error');
            toast.error('Local AI failed to restart after 3 attempts');
          }
        }
      } catch {
        // Expected: transient health check errors during server startup/shutdown
      }
    }, 30_000);

    return () => {
      if (healthCheckRef.current) {
        clearInterval(healthCheckRef.current);
        healthCheckRef.current = null;
      }
    };
  }, [serverStatus]);

  // Cleanup on unmount (secondary defense)
  useEffect(() => {
    return () => {
      if (useLocalAIStore.getState().serverStatus === 'running') {
        tauriApi.stopLocalServer().catch(() => {}); // Expected: best-effort cleanup on unmount
      }
    };
  }, []);
}

async function startServer(modelId: string, contextLength: number, gpuLayers: number) {
  log.info('local-ai', `Starting server: model=${modelId} ctx=${contextLength} gpu=${gpuLayers}`);
  useLocalAIStore.getState().setServerStatus('starting');
  useLocalAIStore.getState().setServerStatusReason('Starting...');
  updateConnectionStatus('expired'); // Amber while starting

  // Listen for status updates from the backend (e.g., mmproj download for vision models)
  let unlisten: (() => void) | undefined;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    unlisten = await listen<{ status: string; model: string }>('local-ai-status', (event) => {
      if (event.payload.status === 'downloading_mmproj') {
        useLocalAIStore.getState().setServerStatusReason('Downloading vision support...');
      }
    });
  } catch { /* ignore */ }

  try {
    const port = await tauriApi.startLocalServer(modelId, contextLength, gpuLayers);
    log.info('local-ai', `Server started on port ${port}`);
    useLocalAIStore.getState().setServerStatus('running');
    useLocalAIStore.getState().setServerPort(port);
    useLocalAIStore.getState().setServerStatusReason(null);
    updateConnectionStatus('connected');
  } catch (err) {
    const errorMsg = String(err);
    log.error('local-ai', `Server start failed: ${errorMsg}`);
    useLocalAIStore.getState().setServerStatus('error', errorMsg);
    useLocalAIStore.getState().setServerStatusReason(`Server failed to start: ${errorMsg}`);
    updateConnectionStatus('error');
    toast.error(`Failed to start Local AI: ${errorMsg}`);
  } finally {
    unlisten?.();
  }
}

function findLocalAIConnection() {
  return useConnectionsStore.getState().connections.find(
    (c) => c.provider === 'local_ai' && c.authMethod === 'local_bundled'
  );
}

function updateConnectionStatus(status: 'connected' | 'error' | 'expired') {
  const existing = findLocalAIConnection();
  if (existing && existing.status !== status) {
    useConnectionsStore.getState().updateConnection(existing.id, { status });
  }
}
