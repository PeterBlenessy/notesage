import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { AgentActivity } from '@/lib/ai/types';

function ActivityIcon({ activity, isActive }: { activity: AgentActivity; isActive: boolean }) {
  if (isActive && activity.status === 'running') {
    return <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" strokeWidth={1.5} />;
  }
  return <Check className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.5} />;
}

export function ActivityLog({ activities, isActive }: { activities: AgentActivity[]; isActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  // Attachments are rendered via AttachmentFileStrip on the user bubble —
  // exclude them here so the agent activity log stays tool-call focused.
  const filtered = activities.filter((a) => a.kind !== 'attachment');
  if (filtered.length === 0) return null;
  // Only show running state if the chat is actively loading; otherwise treat all as done
  const hasRunning = isActive && filtered.some((a) => a.status === 'running');

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
        <span>
          {hasRunning
            ? `Working (${filtered.length} ${filtered.length === 1 ? 'step' : 'steps'})`
            : `${filtered.length} ${filtered.length === 1 ? 'step' : 'steps'} completed`}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 flex flex-col gap-0.5">
          {filtered.map((activity, i) => (
            <div
              key={`${activity.kind}-${activity.timestamp}-${i}`}
              className="flex items-start gap-1.5 pl-1 py-0.5"
            >
              <span className="mt-px shrink-0">
                <ActivityIcon activity={activity} isActive={isActive} />
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                <span className="font-medium">{activity.label}</span>
                {activity.detail && (
                  <span className="opacity-70"> — {activity.detail}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
