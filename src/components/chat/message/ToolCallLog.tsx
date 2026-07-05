import { AlertTriangle, Ban, Check, ChevronDown, Loader2, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { ToolCallActivity, ToolCallStatus } from '@/lib/ai/types';

function getToolCallIcon(status: ToolCallStatus, _isActive: boolean) {
  switch (status) {
    case 'pending':
    case 'running':
      return <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" strokeWidth={1.5} />;
    case 'complete':
      return <Check className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.5} />;
    case 'error':
      return <AlertTriangle className="h-2.5 w-2.5 text-destructive" strokeWidth={1.5} />;
    case 'denied':
      return <Ban className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.5} />;
  }
}

function ToolCallItem({ activity, isActive }: { activity: ToolCallActivity; isActive: boolean }) {
  const [resultExpanded, setResultExpanded] = useState(false);
  const icon = getToolCallIcon(activity.status, isActive);

  return (
    <div className="rounded-md bg-muted/30 px-2 py-1.5">
      <div className="flex items-start gap-1.5">
        <span className="mt-px shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-medium">{activity.name}</span>
          {activity.status === 'error' && activity.error && (
            <p className="text-[10px] text-destructive mt-0.5">{activity.error}</p>
          )}
          {activity.status === 'denied' && (
            <p className="text-[10px] text-muted-foreground mt-0.5">Permission denied</p>
          )}
          {activity.status === 'complete' && activity.result && (
            <button
              onClick={() => setResultExpanded(!resultExpanded)}
              className="text-[10px] text-muted-foreground hover:text-foreground mt-0.5 flex items-center gap-0.5 transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
            >
              <ChevronDown
                className={`h-2 w-2 transition-transform duration-150 ${resultExpanded ? '' : '-rotate-90'}`}
                strokeWidth={1.5}
              />
              Result
            </button>
          )}
          {resultExpanded && activity.result && (
            <pre className="mt-1 text-[9px] text-muted-foreground bg-muted/50 rounded px-1.5 py-1 overflow-x-auto max-h-32 overflow-y-auto thin-scrollbar whitespace-pre-wrap break-all">
              {activity.result}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function ToolCallLog({ activities, isActive }: { activities: ToolCallActivity[]; isActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasRunning = isActive && activities.some((a) => a.status === 'running' || a.status === 'pending');

  return (
    <div className="mt-2 pt-1.5 border-t border-border/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
      >
        <ChevronDown
          className={`h-2.5 w-2.5 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
          strokeWidth={1.5}
        />
        <Wrench className="h-2.5 w-2.5" strokeWidth={1.5} />
        <span>
          {hasRunning
            ? `Running tools (${activities.length})`
            : `${activities.length} tool ${activities.length === 1 ? 'call' : 'calls'}`}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 flex flex-col gap-1">
          {activities.map((activity) => (
            <ToolCallItem key={activity.id} activity={activity} isActive={isActive} />
          ))}
        </div>
      )}
    </div>
  );
}
