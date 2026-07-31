import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
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
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { isLocalAgentPreset } from '@/lib/ai/acp-agent-state';
import { useLocalAgentSetup } from '@/hooks/useLocalAgentSetup';
import { recommendToolCallingModel } from '@/lib/ai/local-agent-model';
import { LocalAgentAttribution } from './LocalAgentAttribution';
import type { LocalAgentActiveStage } from '@/stores/local-ai-store';
import { cn } from '@/lib/utils';
import { log } from '@/lib/logger';

const GB = 1024 ** 3;

/** Agent id used for the Goose managed install (mirrors useLocalAgentSetup). */
/** Managed-install agent ids whose download progress the dialog bar tracks,
 *  per engine. pi installs two artifacts (pi + the bridge). */
const ENGINE_AGENT_IDS: Record<'goose' | 'pi', string[]> = {
  goose: ['goose'],
  pi: ['pi', 'notesage-acp-pi'],
};

/** Ordered active stages with user-facing labels. */
const STAGES: { key: LocalAgentActiveStage; label: string }[] = [
  { key: 'detecting', label: 'Check hardware' },
  { key: 'downloading', label: 'Download agent + model' },
  { key: 'configuring', label: 'Configure local agent' },
  { key: 'verifying', label: 'Verify it responds' },
];

const STAGE_ORDER: LocalAgentActiveStage[] = STAGES.map((s) => s.key);

/**
 * Stage-specific guidance under a failed setup. Must stay accurate to the
 * failure: only the download stage involves the network — a local server-health
 * or smoke-test failure must NOT blame the internet (the bundled server is local).
 */
function failureHint(stage: LocalAgentActiveStage | undefined): string {
  switch (stage) {
    case 'downloading':
      return 'The agent or model download didn’t finish — check your internet connection and try again.';
    case 'configuring':
      return 'The local AI server didn’t start in time. Make sure a model is downloaded in Settings → Local AI, then try again.';
    case 'verifying':
      return 'The agent started but didn’t respond in time. Try again, or pick a smaller model in Settings → Local AI.';
    default:
      return 'Try again.';
  }
}

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
  const hasPresetConnection = useConnectionsStore((s) => s.connections.some(isLocalAgentPreset));
  // Defensive: if the persisted setup state says `ready` but the preset
  // connection no longer exists (removed here, or absent after an iCloud sync /
  // reinstall that carried the persisted state), the state is stale — reset to
  // idle so opening the dialog re-runs setup instead of showing a dead "Done".
  useEffect(() => {
    if (open && setup.stage === 'ready' && !hasPresetConnection) {
      reset();
    }
  }, [open, setup.stage, hasPresetConnection, reset]);
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
  // Engine choice — Goose (default) or pi. Reset to idle happens per-engine in
  // the setup hook (a distinct preset connection per engine), so switching here
  // before starting just changes which engine `start` installs and wires.
  const [engine, setEngine] = useState<'goose' | 'pi'>('goose');

  // Goose binary download percent (0–100) from `agent-install-progress`. The
  // backend emits bytes downloaded / content-length during the GitHub-binary
  // download — unlike the model download (tracked via `downloads`), the agent
  // download previously showed only a spinner for the ~79 MB tarball.
  const [agentProgress, setAgentProgress] = useState<number | null>(null);

  // Load the catalog once when the dialog opens so the picker is populated.
  useEffect(() => {
    if (open && models.length === 0) void refreshModels();
  }, [open, models.length, refreshModels]);

  // Track Goose binary download progress while the dialog is open. The IPC
  // payload is serde snake_case (`agent_id`, `progress`, `total`), matching the
  // ConnectAgent listener.
  useEffect(() => {
    if (!open) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<{ agent_id: string; phase: string; progress: number; total: number; message: string }>(
      'agent-install-progress',
      (event) => {
        const p = event.payload;
        if (!ENGINE_AGENT_IDS[engine].includes(p.agent_id)) return;
        if (p.phase === 'downloading') {
          setAgentProgress(p.total > 0 ? Math.round((p.progress / p.total) * 100) : null);
        } else {
          // Past the download phase (extracting/configuring/done) — the model
          // download takes over the bar.
          setAgentProgress(null);
        }
      },
    ).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [open, engine]);

  const running = ['detecting', 'downloading', 'configuring', 'verifying'].includes(setup.stage);
  const isReady = setup.stage === 'ready';
  const isFailed = setup.stage === 'failed';

  // Surface setup failures as a dismissable toast (user-facing) + a log line
  // carrying the raw backend error (developer-facing, forwarded to the backend
  // log). The raw string is NOT rendered in the dialog — it's debug detail, not
  // a user message. Deduped on (stage, error) so a re-render can't re-toast.
  const lastFailureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isFailed) {
      if (setup.stage === 'idle' || isReady) lastFailureRef.current = null; // allow re-toast on the next attempt
      return;
    }
    const key = `${setup.failedStage ?? ''}:${setup.error ?? ''}`;
    if (lastFailureRef.current === key) return;
    lastFailureRef.current = key;
    log.error('ai', `Local Agent setup failed at ${setup.failedStage ?? 'unknown'} stage: ${setup.error ?? '(no detail)'}`);
    toast.error('Local Agent setup failed', {
      description: failureHint(setup.failedStage),
    });
  }, [isFailed, isReady, setup.stage, setup.failedStage, setup.error]);

  const chosenModelInfo = toolModels.find((m) => m.id === effectiveModel);
  const lowRam =
    chosenModelInfo != null &&
    systemMemory != null &&
    systemMemory.total_bytes < 8 * GB;

  const handleStart = () => {
    void start(effectiveModel ?? undefined, engine);
  };

  // Per-stage download progress for the model (0–100), if a download is active.
  const modelProgress = effectiveModel ? downloads[effectiveModel]?.progress : undefined;
  // During the "downloading" stage we show whichever of the two is currently
  // downloading: the Goose binary runs first, then the model. Prefer the agent
  // bar while it's active, falling back to the model bar.
  const downloadProgress = agentProgress ?? modelProgress ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--color-accent-primary)]" strokeWidth={1.5} />
            Set up a private, on-device agent
          </DialogTitle>
          <DialogDescription>
            Runs an agent on your Mac against the bundled local model — no API keys, no cloud account.
          </DialogDescription>
        </DialogHeader>

        {/* Engine picker — only before the flow starts or after failure. */}
        {(setup.stage === 'idle' || isFailed) && (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Engine</Label>
            <RadioGroup
              value={engine}
              onValueChange={(v) => setEngine(v as 'goose' | 'pi')}
              disabled={running}
              className="gap-2"
            >
              {[
                { id: 'goose' as const, name: 'Goose', desc: 'Default. Agentic AI Foundation (AAIF).' },
                { id: 'pi' as const, name: 'pi', desc: 'Alternative engine by earendil-works.' },
              ].map((e) => (
                <label
                  key={e.id}
                  htmlFor={`engine-${e.id}`}
                  className={cn(
                    'flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors duration-150',
                    engine === e.id ? 'border-border-strong bg-muted/40' : 'border-border hover:bg-muted/20',
                  )}
                >
                  <RadioGroupItem value={e.id} id={`engine-${e.id}`} className="mt-0.5" />
                  <span className="space-y-0.5">
                    <span className="text-sm font-medium text-foreground block">{e.name}</span>
                    <span className="text-xs text-muted-foreground block">{e.desc}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
        )}

        {/* Model picker — only meaningful before the flow starts or after failure. */}
        {(setup.stage === 'idle' || isFailed) && (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Model</Label>
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
                {s.key === 'downloading' && state === 'active' && downloadProgress != null && (
                  <Progress value={downloadProgress} className="ml-auto w-24 h-1.5" />
                )}
              </li>
            );
          })}
        </ul>

        {/* No raw error string in the dialog — the failed stage is already
            marked in the checklist above, the actionable hint + full detail go
            to the toast + log (see the failure effect). Retry is in the footer. */}

        <LocalAgentAttribution engine={engine} />

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
