import { useEffect, useState, useMemo } from 'react';
import { useLocalAIStore, type ModelCategory } from '@/stores/local-ai-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { tauriApi } from '@/lib/tauri';
import type { LocalModelInfo } from '@/lib/tauri';
import { useModelMetadata } from '@/hooks/useModelMetadata';
import { useModelFit } from '@/hooks/useModelFit';
import { useModelFitMeasurementStore } from '@/stores/model-fit-measurement-store';
import { useSettingsStore } from '@/stores/settings-store';
import { Switch } from '@/components/ui/switch';
import { compareByVerdict } from '@/lib/ai/model-fit';
import { AddCustomModelDialog } from './AddCustomModelDialog';
import { CompletionServerSection } from './CompletionServerSection';
import { ServerLogDialog } from './ServerLogDialog';
import { ModelCard } from './ModelCard';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Shield, HeartPulse, Loader2, FolderOpen, ArrowUpDown, Check } from 'lucide-react';
import { toast } from 'sonner';

type ModelSort = 'name' | 'size' | 'ram';

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

const CATEGORY_TABS: { value: ModelCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'general', label: 'General' },
  { value: 'code', label: 'Code' },
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'downloaded', label: 'Downloaded' },
];

const SORT_OPTIONS: { value: ModelSort; label: string }[] = [
  { value: 'ram', label: 'RAM' },
  { value: 'size', label: 'Size' },
  { value: 'name', label: 'Name' },
];

export function LocalAISettings() {
  const {
    activeModelId,
    serverStatus,
    serverError,
    models,
    downloads,
    systemMemory,
    binaryStatus,
    categoryFilter,
    setActiveModel,
    refreshModels,
    downloadModel,
    cancelDownload,
    deleteModel,
    removeCustomModel,
    hideModel,
    restoreDefaults,
    hiddenModelIds,
    checkBinary,
    startServer,
    setCategoryFilter,
  } = useLocalAIStore();

  const connections = useConnectionsStore((s) => s.connections);
  const hasConnection = connections.some(
    (c) => c.provider === 'local_ai' && c.authMethod === 'local_bundled'
  );

  const [healthChecking, setHealthChecking] = useState(false);
  const [sortBy, setSortBy] = useState<ModelSort>('ram');

  // Hardware-aware model-fit verdicts. The hook populates the store maps below;
  // we subscribe to them reactively so cards re-render as results arrive.
  const { capsLoading, hostSpeedScale } = useModelFit(models);
  const fitById = useLocalAIStore((s) => s.fitById);
  const capsById = useLocalAIStore((s) => s.capsById);
  const measurements = useModelFitMeasurementStore((s) => s.measurements);
  const offerCalibrationShare = useSettingsStore((s) => s.offerCalibrationShare);
  const setOfferCalibrationShare = useSettingsStore((s) => s.setOfferCalibrationShare);

  useEffect(() => {
    refreshModels();
    checkBinary();
    tauriApi.getSystemMemory().then((mem) => {
      useLocalAIStore.getState().setSystemMemory(mem);
    }).catch(() => {});
  }, [refreshModels, checkBinary]);

  const activeModel = models.find((m) => m.id === activeModelId);
  const hasDownloadedModels = models.some((m) => m.downloaded);

  const sortModels = (list: LocalModelInfo[]) => {
    const byPreference = (a: LocalModelInfo, b: LocalModelInfo) => {
      switch (sortBy) {
        case 'name': return a.name.localeCompare(b.name);
        case 'size': return a.size_bytes - b.size_bytes;
        case 'ram': return a.ram_required_bytes - b.ram_required_bytes;
      }
    };
    return [...list].sort((a, b) => {
      // Runnable models first, unrunnable pushed below; the user's chosen sort
      // is the tiebreaker within each partition. compareByVerdict gives the
      // runnable-first ordering (and tok/s desc, harmless as a tiebreaker).
      const byVerdict = compareByVerdict(
        { fit: fitById[a.id] },
        { fit: fitById[b.id] }
      );
      if (byVerdict !== 0) return byVerdict;
      return byPreference(a, b);
    });
  };

  const filteredModels = useMemo(() => {
    let filtered: LocalModelInfo[];
    if (categoryFilter === 'downloaded') {
      filtered = models.filter((m) => m.downloaded);
    } else if (categoryFilter === 'all') {
      filtered = models;
    } else {
      filtered = models.filter((m) => m.category === categoryFilter);
    }
    // Hide models the user has removed from the list (unless downloaded)
    const hiddenSet = new Set(hiddenModelIds);
    filtered = filtered.filter((m) => !hiddenSet.has(m.id) || m.downloaded);
    return sortModels(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, categoryFilter, sortBy, hiddenModelIds, fitById]);

  // Batch-fetch metadata for all models when settings panel mounts
  const modelIds = useMemo(() => models.map((m) => ({ id: m.id })), [models]);
  const { metadataMap } = useModelMetadata(modelIds, 'llm');

  const handleSetActive = async (modelId: string) => {
    setActiveModel(modelId);
  };

  const handleHealthCheck = async () => {
    setHealthChecking(true);
    try {
      const status = await tauriApi.getLocalServerStatus();
      if (status.running) {
        toast.success('Local AI server is healthy');
      } else {
        toast.error('Local AI server is not responding');
      }
    } catch (err) {
      toast.error(`Health check failed: ${err}`);
    } finally {
      setHealthChecking(false);
    }
  };

  // Derive a human-readable status message
  const statusMessage = (() => {
    if (serverStatus === 'running' && activeModel) {
      return `Running — ${activeModel.name}`;
    }
    if (serverStatus === 'starting') return 'Loading model...';
    if (serverStatus === 'error') {
      if (binaryStatus === 'not_found') return 'AI engine not found — try reinstalling Notesage';
      if (serverError) {
        if (serverError.includes('healthy within')) return 'Server took too long to start — try a smaller model or restart';
        if (serverError.includes('not found')) return 'Model file missing — download a model below';
        return serverError;
      }
      return 'Server error';
    }
    if (!hasConnection) return 'Not connected — add Local AI in the Connections tab';
    if (!hasDownloadedModels) return 'No models downloaded';
    if (!activeModelId) return 'No model selected';
    return 'Stopped';
  })();

  // Can the server be manually started?
  const canStart = binaryStatus === 'available' && hasDownloadedModels && activeModelId && hasConnection;
  const startDisabledReason = !hasConnection
    ? 'Add Local AI connection first'
    : binaryStatus !== 'available'
    ? 'AI engine not found'
    : !activeModelId
    ? 'Select a model first'
    : !hasDownloadedModels
    ? 'Download a model first'
    : undefined;

  const handleStartOrRestart = async () => {
    if (!activeModelId) return;
    const store = useLocalAIStore.getState();
    if (store.serverStatus === 'running') {
      await tauriApi.stopLocalServer().catch(() => {});
    }
    await startServer(activeModelId, store.contextLength, store.gpuLayers);
  };

  const renderModelCard = (model: LocalModelInfo) => (
    <ModelCard
      key={model.id}
      model={model}
      isActive={model.id === activeModelId}
      download={downloads[model.id]}
      metadata={metadataMap[model.id]}
      fit={fitById[model.id]}
      caps={capsById[model.id]}
      capsLoading={capsLoading}
      measurement={measurements[model.id]}
      hostScale={hostSpeedScale}
      onSetActive={() => handleSetActive(model.id)}
      onDownload={() => downloadModel(model.id)}
      onCancelDownload={() => cancelDownload(model.id)}
      onDelete={() => deleteModel(model.id)}
      onRemoveCustom={() => removeCustomModel(model.id)}
      onHide={() => hideModel(model.id)}
    />
  );

  return (
    <div className="space-y-6">
      {/* Header + description */}
      <div>
        <div>
          <h3 className="text-sm font-semibold">Local AI</h3>
          <p className="text-xs text-muted-foreground mt-1">
            On-device inference — your data stays private
          </p>
        </div>
        <div className="mt-3 p-3 rounded-md border border-border bg-muted/30">
          <div className="flex items-start gap-2">
            <Shield className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.5} />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Local AI runs language models entirely on your Mac using the bundled llama.cpp engine with Metal GPU acceleration.
              No API keys, no internet connection, and no data ever leaves your device. Download a model below, then add
              Local AI as a connection in the Connections tab to start using it.
            </p>
          </div>
        </div>
      </div>

      {/* Status indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${
              serverStatus === 'running'
                ? 'bg-green-500'
                : serverStatus === 'starting'
                ? 'bg-amber-500 animate-pulse'
                : serverStatus === 'error'
                ? 'bg-red-500'
                : !hasConnection
                ? 'bg-muted-foreground/30'
                : hasDownloadedModels && activeModelId
                ? 'bg-amber-500'
                : 'bg-muted-foreground/30'
            }`}
          />
          <span className={`${serverStatus === 'error' ? 'text-red-500' : 'text-muted-foreground'} truncate`}>
            {statusMessage}
          </span>
          {systemMemory && activeModel && serverStatus === 'running' && (
            <span className="text-muted-foreground/60 shrink-0">
              · {formatBytes(activeModel.size_bytes + (activeModel.mmproj_size_bytes ?? 0))} · ~{formatBytes(activeModel.ram_required_bytes)} RAM
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(serverStatus === 'stopped' || serverStatus === 'error') && hasConnection && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={handleStartOrRestart}
                      disabled={!canStart}
                    >
                      Start
                    </Button>
                  </span>
                </TooltipTrigger>
                {startDisabledReason && (
                  <TooltipContent side="bottom">
                    <p className="text-xs">{startDisabledReason}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
          {serverStatus === 'starting' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5"
              disabled
            >
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
              Starting...
            </Button>
          )}
          {serverStatus === 'running' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleStartOrRestart}
              >
                Restart
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleHealthCheck}
                disabled={healthChecking}
              >
                {healthChecking ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
                ) : (
                  <HeartPulse className="h-3 w-3" strokeWidth={1.5} />
                )}
                Health check
              </Button>
            </>
          )}
          {/* Available whenever there is something to read — including after a
              crash, which is exactly when the engine's own output matters. */}
          <ServerLogDialog />
        </div>
      </div>

      {/* Binary not found banner */}
      {binaryStatus === 'not_found' && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-sm font-medium">AI engine not found</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            The llama.cpp inference engine should be bundled with Notesage. Try reinstalling the app.
          </p>
        </div>
      )}

      {/* Models */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Models
          </h4>
          <AddCustomModelDialog onAdded={refreshModels} />
        </div>

        {/* Category filter tabs + sort */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setCategoryFilter(tab.value)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  categoryFilter === tab.value
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground rounded-md hover:bg-muted transition-colors">
                <ArrowUpDown className="h-3 w-3" strokeWidth={1.5} />
                {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[100px]">
              {SORT_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setSortBy(opt.value)}
                  className="text-xs gap-2"
                >
                  {opt.label}
                  {sortBy === opt.value && <Check className="h-3 w-3 ml-auto" strokeWidth={1.5} />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* All models — sorted runnable-first (computed verdict), unrunnable
            disabled and pushed below. No hand-authored RAM-tier filtering. */}
        <div className="space-y-2">
          <TooltipProvider delayDuration={300}>
            {filteredModels.map(renderModelCard)}
          </TooltipProvider>
        </div>

        {/* Dedicated FIM completion server (item #8 — `--jinja`/FIM conflict) */}
        <CompletionServerSection />

        {/* Opt-in community calibration share (Phase 2) */}
        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="min-w-0">
            <p className="text-xs font-medium">Offer to share calibration data</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              After you've run a few local models, Notesage can offer to share their
              measured speed on your Mac to help improve recommendations. Nothing is
              ever sent automatically — you review and submit it yourself.
            </p>
          </div>
          <Switch
            checked={offerCalibrationShare}
            onCheckedChange={setOfferCalibrationShare}
            aria-label="Offer to share calibration data"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {hiddenModelIds.length > 0 && (
            <button
              onClick={restoreDefaults}
              className="text-[10px] text-muted-foreground hover:text-foreground hover:underline transition-colors"
            >
              Restore {hiddenModelIds.length} hidden model{hiddenModelIds.length !== 1 ? 's' : ''}
            </button>
            )}
          <p className="text-[10px] text-muted-foreground">
            Models stored in ~/.notesage/models/llm/
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground"
            onClick={async () => {
              try {
                const home = await tauriApi.getHomeDir();
                await tauriApi.revealInFinder(`${home}/.notesage/models/llm`);
              } catch {
                toast.error('Could not open models folder');
              }
            }}
          >
            <FolderOpen className="h-3 w-3" />
          </Button>
        </div>
      </div>

    </div>
  );
}
