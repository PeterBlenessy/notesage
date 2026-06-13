import { useEffect, useMemo, useState } from 'react';
import { Check, CircleDashed, Loader2, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useLocalAgentSetup } from '@/hooks/useLocalAgentSetup';
import { recommendToolCallingModel } from '@/lib/ai/local-agent-model';
import type { LocalAgentActiveStage } from '@/stores/local-ai-store';
import { cn } from '@/lib/utils';

const GB = 1024 ** 3;

/** Ordered active stages with user-facing labels. */
const STAGES: { key: LocalAgentActiveStage; label: string }[] = [
  { key: 'detecting', label: 'Check hardware' },
  { key: 'downloading', label: 'Download agent + model' },
  { key: 'configuring', label: 'Configure local agent' },
  { key: 'verifying', label: 'Verify it responds' },
];

const STAGE_ORDER: LocalAgentActiveStage[] = STAGES.map((s) => s.key);

type RowState = 'pending' | 'active' | 'done' | 'failed';

function rowState(
  row: LocalAgentActiveStage,
  current: string,
  failedStage: LocalAgentActiveStage | undefined,
): RowState {
  if (current === 'failed') {
    if (failedStage === row) return 'failed';
    return STAGE_ORDER.indexOf(row) < STAGE_ORDER.indexOf(failedStage ?? 'detecting') ? 'done' : 'pending';
  }
  if (current === 'ready') return 'done';
  if (current === row) return 'active';
  const ci = STAGE_ORDER.indexOf(current as LocalAgentActiveStage);
  if (ci < 0) return 'pending'; // idle
  return STAGE_ORDER.indexOf(row) < ci ? 'done' : 'pending';
}

/**
 * Setup-flow dialog for the Local Agent preset (task #17). Mounted ONCE at the
 * app root; visibility is the app-level `localAgentSetupDialogOpen` flag so every
 * entry point (#18/#19/#20) opens the same instance. Renders the staged
 * progress, a tool-calling model picker (with a sub-8GB reliability warning),
 * inline error + Retry, and a "Continue in background" dismiss — the flow keeps
 * running in the store-backed state machine after the dialog closes.
 */
export function LocalAgentSetupDialog() {
  const open = useLocalAIStore((s) => s.localAgentSetupDialogOpen);
  const onOpenChange = useLocalAIStore((s) => s.setLocalAgentSetupDialogOpen);
  const { setup, start, reset } = useLocalAgentSetup();
  const models = useLocalAIStore((s) => s.models);
  const downloads = useLocalAIStore((s) => s.downloads);
  const systemMemory = useLocalAIStore((s) => s.systemMemory);
  const refreshModels = useLocalAIStore((s) => s.refreshModels);

  const toolModels = useMemo(() => models.filter((m) => m.supports_tool_calling), [models]);
  const recommended = useMemo(
    () => recommendToolCallingModel(models, systemMemory?.total_bytes ?? null),
    [models, systemMemory],
  );
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const effectiveModel = chosenModel ?? setup.modelId ?? recommended;

  // Load the catalog once when the dialog opens so the picker is populated.
  useEffect(() => {
    if (open && models.length === 0) void refreshModels();
  }, [open, models.length, refreshModels]);

  const running = ['detecting', 'downloading', 'configuring', 'verifying'].includes(setup.stage);
  const isReady = setup.stage === 'ready';
  const isFailed = setup.stage === 'failed';

  const chosenModelInfo = toolModels.find((m) => m.id === effectiveModel);
  const lowRam =
    chosenModelInfo != null &&
    systemMemory != null &&
    systemMemory.total_bytes < 8 * GB;

  const handleStart = () => {
    void start(effectiveModel ?? undefined);
  };

  // Per-stage download progress for the model (0–100), if a download is active.
  const modelProgress = effectiveModel ? downloads[effectiveModel]?.progress : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--color-accent-primary)]" strokeWidth={1.5} />
            Set up private, offline AI
          </DialogTitle>
          <DialogDescription>
            Runs an agent entirely on your Mac against the bundled model — no API keys, no network.
          </DialogDescription>
        </DialogHeader>

        {/* Model picker — only meaningful before the flow starts or after failure. */}
        {(setup.stage === 'idle' || isFailed) && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Model</label>
            <Select
              value={effectiveModel ?? undefined}
              onValueChange={setChosenModel}
              disabled={running || toolModels.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={toolModels.length === 0 ? 'Loading models…' : 'Choose a model'} />
              </SelectTrigger>
              <SelectContent>
                {toolModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                    {m.id === recommended ? ' · recommended' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {lowRam && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" strokeWidth={1.5} />
                Your Mac has under 8&nbsp;GB of memory — the agent may respond slowly or unreliably.
              </p>
            )}
          </div>
        )}

        {/* Stage checklist. */}
        <ul className="space-y-2.5 py-1">
          {STAGES.map((s) => {
            const state = rowState(s.key, setup.stage, setup.failedStage);
            return (
              <li key={s.key} className="flex items-center gap-2.5 text-sm">
                <StageIcon state={state} />
                <span
                  className={cn(
                    state === 'pending' && 'text-muted-foreground',
                    state === 'failed' && 'text-destructive',
                    (state === 'active' || state === 'done') && 'text-foreground',
                  )}
                >
                  {s.label}
                </span>
                {s.key === 'downloading' && state === 'active' && modelProgress != null && (
                  <Progress value={modelProgress} className="ml-auto w-24 h-1.5" />
                )}
              </li>
            );
          })}
        </ul>

        {isFailed && setup.error && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-destructive">
            {setup.error}
          </p>
        )}

        <DialogFooter>
          {isReady ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : running ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Continue in background
            </Button>
          ) : (
            <>
              {isFailed && (
                <Button variant="ghost" onClick={reset}>
                  <X className="h-4 w-4" strokeWidth={1.5} />
                  Cancel
                </Button>
              )}
              <Button onClick={handleStart} disabled={!effectiveModel}>
                {isFailed ? 'Retry' : 'Set up'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StageIcon({ state }: { state: RowState }) {
  if (state === 'done') {
    return <Check className="h-4 w-4 text-[var(--color-accent-primary)]" strokeWidth={1.5} />;
  }
  if (state === 'active') {
    return <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent-primary)]" strokeWidth={1.5} />;
  }
  if (state === 'failed') {
    return <TriangleAlert className="h-4 w-4 text-destructive" strokeWidth={1.5} />;
  }
  return <CircleDashed className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />;
}
