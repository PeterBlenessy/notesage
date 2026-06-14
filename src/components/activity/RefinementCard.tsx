import { ArrowRight, Sparkles, X, AlertTriangle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRefinementStore } from '@/stores/refinement-store';
import type { RefinementEntry, RefinementVerdict } from '@/lib/ai/refinement';
import { cn } from '@/lib/utils';

const VERDICT_LABEL: Record<RefinementVerdict, string> = {
  keep: 'Keep',
  sharpen: 'Sharpen',
  split: 'Split',
  defer: 'Defer',
  drop: 'Drop',
};

/**
 * Fire-and-forget editor commands. The panel has no editor-view reference, so
 * Apply/Jump cross the boundary via `window` CustomEvents — the same pattern
 * tag badges use (`notesage:open-tag-search`). The refinement-apply extension
 * listens for these inside its plugin `view()`.
 */
function dispatchApply(id: string): void {
  window.dispatchEvent(new CustomEvent('notesage:apply-refinement', { detail: { id } }));
}
function dispatchJump(id: string): void {
  window.dispatchEvent(new CustomEvent('notesage:jump-to-refinement', { detail: { id } }));
}

export interface RefinementCardProps {
  entry: RefinementEntry;
}

/**
 * One refinement suggestion in the AgentPanel "Refinements" section (tasks
 * #12/#13). Neutral verdict badge, original line struck through, sharpened
 * outcome in the foreground, a collapsed sub-steps preview, and Jump / Apply /
 * Dismiss actions. Apply/Jump drive the editor via window events; Dismiss hits
 * the store directly.
 */
export function RefinementCard({ entry }: RefinementCardProps) {
  const dismiss = useRefinementStore((s) => s.dismiss);
  const { result } = entry;
  const stepCount = result.steps.length;

  return (
    <div data-testid="refinement-card" className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {VERDICT_LABEL[result.verdict]}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Jump to line"
                  onClick={() => dispatchJump(entry.id)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Jump to line</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Apply suggestion"
                  onClick={() => dispatchApply(entry.id)}
                  className="rounded p-1 text-[var(--color-accent-primary)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Apply suggestion</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismiss(entry.id)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Dismiss</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {entry.error ? (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span>Couldn't refine this line</span>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground line-through line-clamp-2">
            {entry.originalText}
          </p>
          {result.outcome && (
            <p className="text-xs text-foreground line-clamp-3">{result.outcome}</p>
          )}
          {stepCount > 0 && (
            <p className={cn('text-[11px] text-muted-foreground')}>
              {stepCount === 1 ? '1 sub-step' : `${stepCount} sub-steps`}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default RefinementCard;
