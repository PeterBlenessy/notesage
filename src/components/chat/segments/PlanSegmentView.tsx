import { memo, useState } from 'react';
import { ChevronDown, ChevronRight, Circle, Loader2, CheckCircle2 } from 'lucide-react';
import type { PlanSegment, PlanEntry } from '@/lib/ai/types';

interface PlanSegmentViewProps {
  segment: PlanSegment;
  isStreaming?: boolean;
}

function StatusIcon({ status }: { status: PlanEntry['status'] }) {
  switch (status) {
    case 'pending':
      return <Circle className="h-3 w-3 text-muted-foreground/40" strokeWidth={1.5} />;
    case 'in_progress':
      return <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" strokeWidth={1.5} />;
    case 'completed':
      return <CheckCircle2 className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />;
  }
}

function PriorityDot({ priority }: { priority: PlanEntry['priority'] }) {
  const color = priority === 'high' ? 'bg-destructive' : priority === 'medium' ? 'bg-muted-foreground/40' : 'bg-muted-foreground/20';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />;
}

export const PlanSegmentView = memo(function PlanSegmentView({ segment, isStreaming }: PlanSegmentViewProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Auto-expand during streaming, respect user toggle otherwise
  const isExpanded = isStreaming ? true : !collapsed;

  return (
    <div className="my-1 rounded-md border border-border bg-background/50 text-xs">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-muted-foreground hover:text-foreground transition-colors duration-150"
      >
        {isExpanded
          ? <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
          : <ChevronRight className="h-3 w-3" strokeWidth={1.5} />
        }
        <span className="font-medium">Plan</span>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
          {segment.entries.length} {segment.entries.length === 1 ? 'step' : 'steps'}
        </span>
      </button>
      {isExpanded && (
        <div className="px-2.5 pb-2 space-y-1">
          {segment.entries.map((entry, i) => (
            <div key={i} className="flex items-start gap-1.5 text-muted-foreground">
              <span className="shrink-0 mt-0.5"><StatusIcon status={entry.status} /></span>
              <PriorityDot priority={entry.priority} />
              <span className={entry.status === 'completed' ? 'line-through opacity-60' : ''}>
                {entry.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
