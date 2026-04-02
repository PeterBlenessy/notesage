import { memo, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import type { Segment, ToolCallSegment } from '@/lib/ai/types';
import { ToolCallSegmentView } from './ToolCallSegmentView';
import { ToolResultSegmentView } from './ToolResultSegmentView';

interface ToolCallGroupProps {
  /** The consecutive tool_call + tool_result segments in this group */
  segments: Segment[];
  /** Whether the parent message is actively streaming */
  isActivelyStreaming: boolean;
}

/** Build a short summary like "Read 2 files, searched web" from the tool calls in a group */
function buildSummary(segments: Segment[]): string {
  const calls = segments.filter((s): s is ToolCallSegment => s.type === 'tool_call');
  if (calls.length === 0) return 'actions';

  // Count by verb (first word of label)
  const verbCounts = new Map<string, number>();
  for (const call of calls) {
    const verb = call.label.split(/[\s:]/)[0] || call.kind;
    verbCounts.set(verb, (verbCounts.get(verb) || 0) + 1);
  }

  // Build summary parts: "Read 2 files, Fetched 3 pages"
  const parts: string[] = [];
  for (const [verb, count] of verbCounts) {
    parts.push(count > 1 ? `${verb} ×${count}` : verb);
  }

  return parts.slice(0, 3).join(', ') + (parts.length > 3 ? ', …' : '');
}

export const ToolCallGroup = memo(function ToolCallGroup({
  segments,
  isActivelyStreaming,
}: ToolCallGroupProps) {
  const calls = segments.filter((s): s is ToolCallSegment => s.type === 'tool_call');
  const hasRunning = calls.some((c) => c.status === 'running');
  const doneCount = calls.filter((c) => c.status !== 'running').length;

  // Auto-expand while running, collapse when done. User toggle overrides.
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const isExpanded = userExpanded !== null ? userExpanded : hasRunning;

  const summary = buildSummary(segments);
  const countLabel = hasRunning
    ? `${doneCount} of ${calls.length} actions`
    : `${calls.length} actions`;

  return (
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => setUserExpanded((prev) => (prev !== null ? !prev : !isExpanded))}
        className="flex items-center gap-1.5 px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-150 cursor-pointer rounded bg-background/50 w-full"
      >
        {hasRunning ? (
          <Loader2 size={10} strokeWidth={1.5} className="animate-spin shrink-0" />
        ) : (
          <ChevronRight
            size={10}
            strokeWidth={1.5}
            className={`transition-transform duration-150 shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
          />
        )}
        <span className="font-medium">{countLabel}</span>
        <span className="opacity-60 truncate">— {summary}</span>
      </button>
      {isExpanded && (
        <div className="ml-3 border-l border-border/50 pl-2 mt-0.5">
          {segments.map((segment, i) => {
            if (segment.type === 'tool_call') {
              const effectiveSegment = !isActivelyStreaming && segment.status === 'running'
                ? { ...segment, status: 'done' as const }
                : segment;
              return <ToolCallSegmentView key={`tc-${i}`} segment={effectiveSegment} />;
            }
            if (segment.type === 'tool_result') {
              return <ToolResultSegmentView key={`tr-${i}`} segment={segment} />;
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
});
