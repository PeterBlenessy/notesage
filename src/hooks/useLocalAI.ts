import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { tauriApi } from '@/lib/tauri';

const isDev = import.meta.env.DEV;

function devLog(...args: unknown[]) {
  if (isDev) console.log('[LocalAI]', ...args);
}

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
        const [memory, fetchedModels, binaryResult] = await Promise.all([
          tauriApi.getSystemMemory(),
          tauriApi.listLocalModels(),
          store.checkBinary(),
        ]);
        store.setSystemMemory(memory);
        store.setModels(fetchedModels);
        startupLoadedRef.current = true;
        if (binaryResult.available) {
          devLog('Binary found at', binaryResult.location, binaryResult.path);
        } else {
          devLog('Binary not found — user will need to download it');
        }
        devLog('Loaded system memory and', fetchedModels.length, 'models');
      } catch (e) {
        console.error('[LocalAI] Failed to fetch local AI info:', e);
        startupLoadedRef.current = true; // Don't block auto-start forever
      }
    })();
  }, [startupReady]);

  // Auto-start server when Local AI connection exists and a model is downloaded.
  // Depends on `models` and `binaryStatus` so it re-fires after startup fetch completes.
  useEffect(() => {
    if (!startupReady || !hasLocalAIConnection || !activeModelId) return;

    // Don't auto-start if binary is not available
    if (binaryStatus === 'not_found' || binaryStatus === 'downloading' || binaryStatus === 'unknown') {
      if (binaryStatus !== 'unknown') {
        devLog('Binary not available (status:', binaryStatus, '), skipping auto-start');
        updateConnectionStatus('expired');
      }
      return;
    }

    const model = models.find((m) => m.id === activeModelId);
    if (!model?.downloaded) {
      // Only log after startup has loaded models (avoid noise from empty initial state)
      if (startupLoadedRef.current) {
        devLog('Active model', activeModelId, 'not downloaded, skipping auto-start');
        updateConnectionStatus('expired');
      }
      return;
    }

    const store = useLocalAIStore.getState();
    // Don't auto-start if already running
    if (store.serverStatus === 'running' || store.serverStatus === 'starting') return;

    devLog('Auto-starting server with model', activeModelId);
    startServer(activeModelId, contextLength, gpuLayers);
  }, [startupReady, hasLocalAIConnection, activeModelId, contextLength, gpuLayers, models, binaryStatus]);

  // Stop server when Local AI connection is removed
  useEffect(() => {
    if (!hasLocalAIConnection && useLocalAIStore.getState().serverStatus === 'running') {
      devLog('Connection removed, stopping server');
      tauriApi.stopLocalServer().catch(() => {});
      useLocalAIStore.getState().setServerStatus('stopped');
      useLocalAIStore.getState().setServerPort(null);
    }
  }, [hasLocalAIConnection]);

  // Listen for server status events
  useEffect(() => {
    const unlisten = listen<{ running: boolean; port: number | null; model: string | null }>(
      'local-server-status',
      (event) => {
        const { running, port } = event.payload;
        devLog('Server status event:', event.payload);
        const store = useLocalAIStore.getState();

        if (running) {
          store.setServerStatus('running');
          store.setServerPort(port);
          retryCountRef.current = 0;
          updateConnectionStatus('connected');
        } else {
          store.setServerStatus('stopped');
          store.setServerPort(null);
          updateConnectionStatus('error');
        }
      },
    );

    return () => { unlisten.then((fn) => fn()); };
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
          devLog('Health check: server not running, attempt', retryCountRef.current + 1);
          // Server crashed — attempt restart
          if (retryCountRef.current < 3) {
            retryCountRef.current++;
            const store = useLocalAIStore.getState();
            if (store.activeModelId) {
              toast.info('Local AI restarted');
              await startServer(store.activeModelId, store.contextLength, store.gpuLayers);
            }
          } else {
            useLocalAIStore.getState().setServerStatus('error', 'Server crashed and failed to restart after 3 attempts');
            updateConnectionStatus('error');
            toast.error('Local AI failed to restart after 3 attempts');
          }
        }
      } catch {
        // Ignore transient health check errors
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
        tauriApi.stopLocalServer().catch(() => {});
      }
    };
  }, []);
}

async function startServer(modelId: string, contextLength: number, gpuLayers: number) {
  devLog('Starting server with model', modelId, 'ctx', contextLength, 'gpu', gpuLayers);
  useLocalAIStore.getState().setServerStatus('starting');
  updateConnectionStatus('expired'); // Amber while starting
  try {
    const port = await tauriApi.startLocalServer(modelId, contextLength, gpuLayers);
    devLog('Server started on port', port);
    useLocalAIStore.getState().setServerStatus('running');
    useLocalAIStore.getState().setServerPort(port);
    updateConnectionStatus('connected');
  } catch (err) {
    const errorMsg = String(err);
    devLog('Server start failed:', errorMsg);
    useLocalAIStore.getState().setServerStatus('error', errorMsg);
    updateConnectionStatus('error');
    toast.error(`Failed to start Local AI: ${errorMsg}`);
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
