import { Loader2, Check, X, Zap } from 'lucide-react';
import type { AgentTask } from '@/stores/activity-store';

/**
 * Automation-run card (kind === 'automation'). A distinct Zap glyph + the
 * automation name + status. The full per-step log lives in the durable Runs
 * history (Settings → Automations); this is the ambient live indicator.
 */
export function AutomationCard({ task }: { task: AgentTask }) {
  const status = task.status === 'cancelled' ? 'skipped' : task.status;
  return (
    <div className="min-w-0 space-y-1 overflow-hidden px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {task.status === 'error' ? (
            <X className="h-3.5 w-3.5 text-destructive" strokeWidth={1.5} />
          ) : task.status === 'done' ? (
            <Check className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
          ) : task.status === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" strokeWidth={1.5} />
          ) : (
            <Zap className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{task.label}</div>
          <div className="text-xs text-muted-foreground">Automation · {status}</div>
        </div>
      </div>
    </div>
  );
}
