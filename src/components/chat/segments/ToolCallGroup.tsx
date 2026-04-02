import { memo, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import type { Segment, ToolCallSegment } from '@/lib/ai/types';
import { ToolResultSegmentView } from './ToolResultSegmentView';

interface ToolCallGroupProps {
  /** The header label for this group (e.g. "Reading", "Searching for") */
  label: string;
  /** The tool_call + tool_result segments in this group (same verb) */
  segments: Segment[];
  /** Whether the parent message is actively streaming */
  isActivelyStreaming: boolean;
}

/** Extract the detail portion of a tool call label (after the verb) */
function getDetail(call: ToolCallSegment): string {
  // Label format: "Verb detail" or "Verb: detail" — extract the detail part
  const match = call.label.match(/^\S+:?\s+(.+)$/);
  return match ? match[1] : call.label;
}

export const ToolCallGroup = memo(function ToolCallGroup({
  label,
  segments,
  isActivelyStreaming,
}: ToolCallGroupProps) {
  const calls = segments.filter((s): s is ToolCallSegment => s.type === 'tool_call');
  const hasRunning = calls.some((c) => c.status === 'running');
  const doneCount = calls.filter((c) => c.status !== 'running').length;

  // Auto-expand while running, collapse when done. User toggle overrides.
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const isExpanded = userExpanded !== null ? userExpanded : hasRunning;

  const statusText = hasRunning ? `${doneCount}/${calls.length}` : `${calls.length}`;

  return (
    <div className="my-0.5 rounded-md bg-background/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setUserExpanded((prev) => (prev !== null ? !prev : !isExpanded))}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-150 cursor-pointer"
      >
        {hasRunning ? (
          <Loader2 size={10} strokeWidth={1.5} className="animate-spin shrink-0 opacity-60" />
        ) : (
          <ChevronRight
            size={10}
            strokeWidth={1.5}
            className={`transition-transform duration-150 shrink-0 opacity-60 ${isExpanded ? 'rotate-90' : ''}`}
          />
        )}
        <span className="font-medium">{label}</span>
        <span className="opacity-50 text-[10px]">{statusText}</span>
      </button>
      {isExpanded && (
        <div className="px-2 pb-1">
          {calls.map((call, i) => {
            const effectiveCall = !isActivelyStreaming && call.status === 'running'
              ? { ...call, status: 'done' as const }
              : call;
            // Find the corresponding tool_result right after this call
            const callIdx = segments.indexOf(call);
            const nextSeg = callIdx >= 0 && callIdx + 1 < segments.length ? segments[callIdx + 1] : null;
            const result = nextSeg?.type === 'tool_result' ? nextSeg : null;

            return (
              <div key={`call-${i}`} className="flex items-start gap-1.5 py-px">
                <span className="text-muted-foreground/40 mt-px shrink-0 text-[10px]">•</span>
                <div className="min-w-0 flex-1">
                  <div
                    className="flex items-center gap-1 text-[11px] text-muted-foreground truncate"
                    title={effectiveCall.detail || undefined}
                  >
                    <span className="truncate">{getDetail(effectiveCall)}</span>
                    <span className="shrink-0 opacity-50">
                      {effectiveCall.status === 'running' && (
                        <Loader2 size={9} strokeWidth={1.5} className="animate-spin" />
                      )}
                    </span>
                  </div>
                  {result && <ToolResultSegmentView segment={result} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
