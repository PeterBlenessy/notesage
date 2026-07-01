import { useEffect, useMemo } from 'react';
import { Loader2, Play, Square, Zap } from 'lucide-react';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

/**
 * Settings panel for the dedicated FIM (`/infill`) completion server (item #8
 * in the local-LLM agentic stack — `--jinja`/FIM conflict resolution).
 *
 * The user picks a FIM-capable model (e.g. Qwen2.5-Coder) and starts a second
 * llama-server WITHOUT `--jinja`. While running, `local_bundled_fim` routes
 * to it instead of the main `--jinja`-loaded chat server, so inline
 * completions get fast native FIM AND chat keeps tool calling. Stopped by
 * default — opt-in feature, costs a second model's worth of RAM/VRAM.
 */
export function CompletionServerSection() {
  const {
    models,
    completionModelId,
    completionServerStatus,
    completionServerPort,
    completionServerError,
    contextLength,
    gpuLayers,
    setCompletionModelId,
    startCompletionServer,
    stopCompletionServer,
    refreshCompletionServerStatus,
  } = useLocalAIStore();

  // Sync from the backend on mount so a server already running (e.g. after
  // a window reload) shows the correct state.
  useEffect(() => {
    refreshCompletionServerStatus();
  }, [refreshCompletionServerStatus]);

  // Only FIM-capable models can serve `/infill`. Filtering here keeps the
  // user from picking an incompatible model and hitting the 501 fallback.
  const fimModels = useMemo(
    () => models.filter((m) => m.supports_fim && m.downloaded),
    [models],
  );

  const isRunning = completionServerStatus === 'running';
  const isStarting = completionServerStatus === 'starting';
  const isError = completionServerStatus === 'error';

  // The dropdown shows the persisted choice while stopped, the running model
  // while running (kept in sync via the local-completion-server-status event).
  const selectedModel = completionModelId ?? '';

  const handleStart = () => {
    if (!selectedModel) return;
    startCompletionServer(selectedModel, contextLength, gpuLayers);
  };

  const handleStop = () => {
    stopCompletionServer();
  };

  const noDownloadedFimModels = fimModels.length === 0;

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <Zap className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Code completion server
        </h3>
        {isRunning && (
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
            running · port {completionServerPort}
          </Badge>
        )}
        {isError && (
          <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
            error
          </Badge>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Run a second llama-server (no <code>--jinja</code>) dedicated to{' '}
        <code>/infill</code> code completion. Lets the main chat model keep
        tool calling while inline completions get native FIM from a
        code-specialist model. Costs the extra model&apos;s RAM/VRAM.
      </p>

      <div className="flex items-center gap-2">
        <Select
          value={selectedModel}
          onValueChange={(value) => setCompletionModelId(value)}
          disabled={isStarting || isRunning || noDownloadedFimModels}
        >
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue
              placeholder={
                noDownloadedFimModels
                  ? 'No FIM-capable models downloaded'
                  : 'Pick a FIM-capable model'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {fimModels.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isRunning ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleStop}
          >
            <Square className="mr-1 h-3 w-3" />
            Stop
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={!selectedModel || isStarting || noDownloadedFimModels}
            onClick={handleStart}
          >
            {isStarting ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Starting
              </>
            ) : (
              <>
                <Play className="mr-1 h-3 w-3" />
                Start
              </>
            )}
          </Button>
        )}
      </div>

      {isError && completionServerError && (
        <p className="text-[11px] text-destructive">{completionServerError}</p>
      )}

      <Separator className="opacity-50" />
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        When stopped, FIM falls back to the main server&apos;s{' '}
        <code>/infill</code> → chat fallback (the previous behaviour). Only
        downloaded models with FIM support are listed.
      </p>
    </div>
  );
}
