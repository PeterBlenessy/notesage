import { useState } from 'react';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { tauriApi } from '@/lib/tauri';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Cpu, Shield } from 'lucide-react';
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

function recommendModel(totalMemBytes: number): { id: string; name: string; size: string } {
  if (totalMemBytes >= 16_000_000_000) {
    return { id: 'llama-3.1-8b', name: 'Llama 3.1 8B', size: '~4.9 GB' };
  }
  if (totalMemBytes >= 8_000_000_000) {
    return { id: 'qwen3-4b', name: 'Qwen3 4B', size: '~2.5 GB' };
  }
  return { id: 'qwen3-1.7b', name: 'Qwen3 1.7B', size: '~1.8 GB' };
}

export function LocalAISetupCard() {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const dismissedFirstRun = useLocalAIStore((s) => s.dismissedFirstRun);
  const serverStatus = useLocalAIStore((s) => s.serverStatus);
  const systemMemory = useLocalAIStore((s) => s.systemMemory);
  const downloads = useLocalAIStore((s) => s.downloads);
  const connections = useConnectionsStore((s) => s.connections);

  const [isSettingUp, setIsSettingUp] = useState(false);

  // Don't show if: already dismissed, server running, has other connections, or setting up
  const hasConnections = connections.length > 0;
  if (dismissedFirstRun || serverStatus === 'running' || hasConnections || isSettingUp) {
    return null;
  }

  const totalMem = systemMemory?.total_bytes ?? 16_000_000_000;
  const totalMemGB = (totalMem / 1_000_000_000).toFixed(0);
  const recommended = recommendModel(totalMem);
  const download = downloads[recommended.id];

  const handleSetup = async () => {
    setIsSettingUp(true);
    const store = useLocalAIStore.getState();

    // Check if binary is available (should always be bundled)
    try {
      await store.checkBinary();
    } catch {
      // Non-fatal — useLocalAI hook will handle missing binary
    }

    store.setActiveModel(recommended.id);

    // Ensure Local AI connection exists
    const connectionsStore = useConnectionsStore.getState();
    const existing = connectionsStore.connections.find(
      (c) => c.provider === 'local_ai' && c.authMethod === 'local_bundled'
    );
    if (!existing) {
      const id = connectionsStore.addConnection({
        provider: 'local_ai',
        authMethod: 'local_bundled',
        status: 'expired',
        label: 'Local AI',
        credentials: { type: 'local_bundled' },
      });
      useRoutingStore.getState().autoAssign(id);
    }

    // Check if model is already downloaded
    const models = store.models;
    const model = models.find((m) => m.id === recommended.id);
    if (model?.downloaded) {
      // Already downloaded — just start
      try {
        store.setServerStatus('starting');
        await tauriApi.startLocalServer(recommended.id, store.contextLength, store.gpuLayers);
      } catch {
        store.setServerStatus('error');
      }
    } else {
      // Download first, then auto-start (handled by useLocalAI hook)
      store.downloadModel(recommended.id);
    }
  };

  const handleSkip = () => {
    useLocalAIStore.getState().dismissFirstRun();
  };

  // Show progress if download is in progress
  if (download) {
    return (
      <div className="mx-auto max-w-sm mt-8 p-5 rounded-lg border border-border">
        <div className="flex items-center gap-2 mb-3">
          <Cpu className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-sm font-medium">Downloading {recommended.name}...</span>
        </div>
        <Progress value={download.progress} className="h-1.5 mb-2" />
        <p className="text-xs text-muted-foreground text-center">
          {Math.round(download.progress)}% · {recommended.size} download
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm mt-8 p-5 rounded-lg border border-border">
      <h3 className="text-sm font-medium mb-1">{t("chat.getStarted")}</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Notesage can run AI locally on your Mac — no account or API key needed.
      </p>

      <div className="rounded-md border border-border px-3 py-2.5 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{recommended.name}</span>
          <span className="text-xs text-muted-foreground">· {recommended.size} download</span>
        </div>
        <div className="flex items-center gap-1 mt-1">
          <Shield className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-xs text-muted-foreground">
            Recommended for your Mac ({totalMemGB} GB)
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Button size="sm" onClick={handleSetup} className="flex-1">
          Set up Local AI
        </Button>
        <Button variant="outline" size="sm" onClick={handleSkip}>
          Skip
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Or connect a cloud provider in Settings (⌘,)
      </p>
    </div>
  );
}
