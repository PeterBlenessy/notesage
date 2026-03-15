import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ConversationSegment } from '@/stores/chat-store';
const basename = (p: string) => p.split('/').pop() || p;

interface ContextDividerProps {
  segment: ConversationSegment;
  previousSegment?: ConversationSegment;
  /** Actual count of messages before this segment (accounts for deletions) */
  priorMessageCount?: number;
}

export function ContextDivider({ segment, previousSegment, priorMessageCount }: ContextDividerProps) {
  const [expanded, setExpanded] = useState(false);

  const names = segment.projectPaths.map((p) => basename(p));
  const label = names.length === 0
    ? 'No project'
    : names.length === 1
      ? names[0]
      : `${names.length} projects`;

  const prevNames = previousSegment?.projectPaths.map((p) => basename(p)) ?? [];

  return (
    <div className={`mx-4 my-2 rounded-md transition-colors duration-150 ${expanded ? 'bg-muted/50 border border-border/50 px-2.5 py-2' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer group"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          strokeWidth={1.5}
        />
        <span className="font-medium tracking-wider">CONTEXT: <span className="tracking-normal">{label}</span></span>
        <span className="flex-1 border-t border-muted-foreground/30 ml-1 group-hover:border-foreground/30 transition-colors" />
      </button>

      {expanded && (
        <div className="pl-[18px] mt-1 space-y-0.5 text-[10px] text-muted-foreground">
          {names.length > 0 && (
            <p>Included: {names.join(', ')}</p>
          )}
          {prevNames.length > 0 && (
            <p>Switched from: {prevNames.join(', ')}</p>
          )}
          <p>History: {segment.historyIncluded ? 'Included from previous context' : 'Not included'}</p>
          <p>Session: {segment.sessionId ? 'Active' : 'Pending'}</p>
        </div>
      )}
    </div>
  );
}
