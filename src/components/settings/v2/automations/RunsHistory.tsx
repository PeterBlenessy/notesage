import { useState } from 'react';
import { Check, X, Loader2, Minus, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAutomationStore } from '@/stores/automation-store';
import { useFormattingLocale } from '@/lib/useLocale';
import type { AutomationRun, RunStatus } from '@/lib/automations/types';

function StatusIcon({ status }: { status: RunStatus }) {
  switch (status) {
    case 'done':
      return <Check className="size-3.5 text-[var(--color-accent-primary)]" strokeWidth={1.5} />;
    case 'error':
      return <X className="size-3.5 text-destructive" strokeWidth={1.5} />;
    case 'running':
      return <Loader2 className="size-3.5 animate-spin text-muted-foreground" strokeWidth={1.5} />;
    case 'skipped':
    default:
      return <Minus className="size-3.5 text-muted-foreground" strokeWidth={1.5} />;
  }
}

function RunRow({ run }: { run: AutomationRun }) {
  const [open, setOpen] = useState(false);
  const formattingLocale = useFormattingLocale();
  const duration = run.completedAt
    ? `${((run.completedAt - run.startedAt) / 1000).toFixed(1)}s`
    : '—';

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <StatusIcon status={run.status} />
        <span className="text-muted-foreground">{new Date(run.startedAt).toLocaleString(formattingLocale)}</span>
        <span className="text-xs text-muted-foreground">· {duration}</span>
        <ChevronDown
          className={cn(
            'ml-auto size-4 text-muted-foreground transition-transform duration-150',
            open && 'rotate-180',
          )}
          strokeWidth={1.5}
        />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2 text-xs">
          {run.steps.length === 0 && <p className="text-muted-foreground">No steps recorded.</p>}
          {run.steps.map((s, i) => (
            <div key={`${s.id}-${i}`} className="space-y-1">
              <div className="font-medium">
                {s.id} <span className="text-muted-foreground">({s.type})</span>
              </div>
              {s.result?.error ? (
                <pre className="whitespace-pre-wrap break-words text-destructive">
                  {s.result.error}
                </pre>
              ) : s.result?.output ? (
                <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                  {s.result.output}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Durable per-automation run history (Settings → Automations → a run's history). */
export function RunsHistory({ sourcePath }: { sourcePath: string }) {
  const runs = useAutomationStore((s) => s.runsByAutomation[sourcePath] ?? []);

  if (runs.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">No runs yet.</p>;
  }
  return (
    <div className="space-y-1.5">
      {runs.map((run) => (
        <RunRow key={run.runId} run={run} />
      ))}
    </div>
  );
}
