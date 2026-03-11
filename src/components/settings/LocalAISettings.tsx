import { useEffect, useState, useMemo } from 'react';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { tauriApi } from '@/lib/tauri';
import { useModelMetadata } from '@/hooks/useModelMetadata';
import { ModelMetadataTooltip } from './ModelMetadataTooltip';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Download, Trash2, X, Cpu, Plus, Link, Shield, HeartPulse, Loader2, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

function AddCustomModelDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const addCustomModel = useLocalAIStore((s) => s.addCustomModel);

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) {
      toast.error('Name and URL are required');
      return;
    }
    setLoading(true);
    try {
      await addCustomModel(name.trim(), url.trim());
      setName('');
      setUrl('');
      setOpen(false);
      onAdded();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add custom model
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Add Custom Model</DialogTitle>
          <DialogDescription className="text-xs">
            Paste a direct link to a GGUF model file from Hugging Face or any URL.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Model name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Phi-4 Mini"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">GGUF download URL</label>
            <div className="relative">
              <Link className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://huggingface.co/.../model.gguf"
                className="h-8 text-sm pl-8"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Use Q4_K_M quantization for the best size/quality balance.
            </p>
          </div>
          <Button
            onClick={handleSubmit}
            disabled={loading || !name.trim() || !url.trim()}
            className="w-full"
            size="sm"
          >
            {loading ? 'Adding...' : 'Add model'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LocalAISettings() {
  const {
    activeModelId,
    serverStatus,
    serverError,
    models,
    downloads,
    systemMemory,
    binaryStatus,
    binaryDownloadProgress,
    setActiveModel,
    refreshModels,
    downloadModel,
    cancelDownload,
    deleteModel,
    removeCustomModel,
    checkBinary,
    downloadBinary,
    cancelBinaryDownload,
  } = useLocalAIStore();

  const connections = useConnectionsStore((s) => s.connections);
  const hasConnection = connections.some(
    (c) => c.provider === 'local_ai' && c.authMethod === 'local_bundled'
  );

  const [healthChecking, setHealthChecking] = useState(false);

  useEffect(() => {
    refreshModels();
    checkBinary();
    tauriApi.getSystemMemory().then((mem) => {
      useLocalAIStore.getState().setSystemMemory(mem);
    }).catch(() => {});
  }, [refreshModels, checkBinary]);

  const activeModel = models.find((m) => m.id === activeModelId);
  const totalMemGB = systemMemory ? (systemMemory.total_bytes / 1_000_000_000).toFixed(0) : '?';
  const hasDownloadedModels = models.some((m) => m.downloaded);

  // Batch-fetch metadata for all models when settings panel mounts
  const modelIds = useMemo(() => models.map((m) => ({ id: m.id })), [models]);
  const { metadataMap } = useModelMetadata(modelIds, 'llm');

  const handleSetActive = async (modelId: string) => {
    setActiveModel(modelId);
    // Server auto-starts via useLocalAI hook when connection exists
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
    if (serverStatus === 'starting') return 'Starting server...';
    if (serverStatus === 'error') {
      if (binaryStatus === 'not_found') return 'AI engine not installed — download it below';
      if (serverError) {
        if (serverError.includes('healthy within')) return 'Server took too long to start — try a smaller model or restart';
        if (serverError.includes('not found')) return 'Model file missing — download a model below';
        return serverError;
      }
      return 'Server error';
    }
    if (!hasConnection) return 'Not connected — add Local AI in the Connections tab';
    if (!activeModelId) return 'No model selected';
    if (!hasDownloadedModels) return 'No models downloaded yet';
    return 'Stopped';
  })();

  return (
    <div className="space-y-6">
      {/* Header + description */}
      <div>
        <div className="flex items-center gap-3">
          <Cpu className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
          <div>
            <h3 className="text-sm font-medium">Local AI</h3>
            <p className="text-xs text-muted-foreground">
              On-device inference — your data stays private
            </p>
          </div>
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
              · ~{formatBytes(activeModel.ram_required_bytes)} / {totalMemGB} GB RAM
            </span>
          )}
        </div>
        {serverStatus === 'running' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5 shrink-0"
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
        )}
      </div>

      {/* Binary download banner */}
      {binaryStatus === 'not_found' && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">AI engine not installed</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Download the llama.cpp inference engine (~11 MB) to run models locally.
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => downloadBinary()}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          </div>
        </div>
      )}
      {binaryStatus === 'downloading' && (
        <div className="rounded-md border border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Downloading AI engine...</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => cancelBinaryDownload()}
            >
              Cancel
            </Button>
          </div>
          <Progress value={binaryDownloadProgress} className="h-1.5" />
          <p className="text-xs text-muted-foreground text-center">
            {Math.round(binaryDownloadProgress)}%
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
        <div className="space-y-2">
          <TooltipProvider delayDuration={300}>
            {[...models].sort((a, b) => a.name.localeCompare(b.name)).map((model) => {
              const download = downloads[model.id];
              const isActive = model.id === activeModelId;

              return (
                <ModelMetadataTooltip
                  key={model.id}
                  metadata={metadataMap[model.id]}
                  modelType="llm"
                  side="right"
                >
                <div
                  className="relative rounded-md border px-3 py-2.5"
                >
                  {/* Action buttons — top right */}
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    {download ? (
                      <div className="flex items-center gap-2">
                        <div className="w-16">
                          <Progress value={download.progress} className="h-1.5" />
                        </div>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {Math.round(download.progress)}%
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => cancelDownload(model.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">Cancel download</TooltipContent>
                        </Tooltip>
                      </div>
                    ) : model.downloaded ? (
                      <>
                        {!isActive && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-[11px] px-2"
                                onClick={() => handleSetActive(model.id)}
                              >
                                Use
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">Set as active model</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              disabled={isActive}
                              onClick={() => deleteModel(model.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {isActive ? 'Stop the model first' : 'Delete model file'}
                          </TooltipContent>
                        </Tooltip>
                        {model.is_custom && !isActive && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={() => removeCustomModel(model.id)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">Remove custom model</TooltipContent>
                          </Tooltip>
                        )}
                      </>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => downloadModel(model.id)}
                          >
                            <Download className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Download model</TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {/* Content */}
                  <div className="pr-24">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{model.name}</span>
                      <span className="text-[10px] text-muted-foreground/50">
                        {model.size_bytes > 0 && formatBytes(model.size_bytes)}
                        {model.size_bytes > 0 && model.ram_required_bytes > 0 && ' · '}
                        {model.ram_required_bytes > 0 && `~${formatBytes(model.ram_required_bytes)} RAM`}
                      </span>
                      {isActive && model.downloaded && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          Active
                        </span>
                      )}
                      {model.is_custom && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          Custom
                        </span>
                      )}
                      {model.supports_fim && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          FIM
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {model.description}
                    </p>
                  </div>
                </div>
                </ModelMetadataTooltip>
              );
            })}
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-1.5">
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
