import { memo, useState } from 'react';
import { ChevronRight, Loader2, Check } from 'lucide-react';
import type { Segment, ToolCallSegment } from '@/lib/ai/types';
import { ToolResultSegmentView } from './ToolResultSegmentView';

interface ToolCallGroupProps {
  /** The header label for this group (e.g. "Reading", "Searching") */
  label: string;
  /** The tool_call + tool_result segments in this group (same verb) */
  segments: Segment[];
  /** Whether the parent message is actively streaming */
  isActivelyStreaming: boolean;
}

/** Extract the most informative detail for a child item.
 *  Tries: label detail part → detail field (parsed for path/url) → full label */
function getDetail(call: ToolCallSegment): string {
  // Extract part after the verb: "Reading config.ts" → "config.ts"
  const match = call.label.match(/^\S+:?\s+(.+)$/);
  const labelDetail = match?.[1];

  // If the label detail is generic (e.g. "file", "command", "resource"), fall back
  const generic = new Set(['file', 'files', 'command', 'resource', 'content', 'skill', 'script']);
  if (labelDetail && !generic.has(labelDetail.toLowerCase())) {
    return labelDetail;
  }

  // Try extracting a useful value from the detail field (full arguments JSON)
  if (call.detail) {
    // Look for a file path
    const pathMatch = call.detail.match(/"(?:path|file_path|file)":\s*"([^"]+)"/);
    if (pathMatch) {
      const parts = pathMatch[1].split('/');
      return parts[parts.length - 1] || pathMatch[1];
    }
    // Look for a URL
    const urlMatch = call.detail.match(/"url":\s*"([^"]+)"/);
    if (urlMatch) {
      try { return new URL(urlMatch[1]).hostname; } catch { return urlMatch[1].slice(0, 50); }
    }
    // Look for a command
    const cmdMatch = call.detail.match(/"(?:command|cmd)":\s*"([^"]+)"/);
    if (cmdMatch) {
      const cmd = cmdMatch[1];
      return cmd.length > 60 ? cmd.slice(0, 60) + '\u2026' : cmd;
    }
    // Truncated raw detail as last resort
    const oneLine = call.detail.replace(/\n/g, ' ').trim();
    if (oneLine.length > 2 && oneLine !== '{}') {
      return oneLine.length > 60 ? oneLine.slice(0, 60) + '\u2026' : oneLine;
    }
  }

  return call.label;
}

export const ToolCallGroup = memo(function ToolCallGroup({
  label,
  segments,
  isActivelyStreaming,
}: ToolCallGroupProps) {
  const calls = segments.filter((s): s is ToolCallSegment => s.type === 'tool_call');
  const hasRunning = calls.some((c) => c.status === 'running');
  const doneCount = calls.filter((c) => c.status !== 'running').length;
  const allDone = !hasRunning;

  // Default: expanded always. User can toggle collapsed.
  const [userCollapsed, setUserCollapsed] = useState(false);
  const isExpanded = !userCollapsed;

  const statusText = hasRunning ? `${doneCount}/${calls.length}` : `${calls.length}`;

  return (
    <div className="my-1 rounded-lg bg-background/80 border border-border/30 overflow-hidden">
      {/* Group header */}
      <button
        type="button"
        onClick={() => setUserCollapsed((prev) => !prev)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-150 cursor-pointer"
      >
        <ChevronRight
          size={11}
          strokeWidth={1.5}
          className={`transition-transform duration-150 shrink-0 opacity-50 ${isExpanded ? 'rotate-90' : ''}`}
        />
        {hasRunning && (
          <Loader2 size={11} strokeWidth={1.5} className="animate-spin shrink-0 opacity-60" />
        )}
        {allDone && (
          <Check size={11} strokeWidth={1.5} className="shrink-0 opacity-40" />
        )}
        <span className="font-medium">{label}</span>
        <span className="opacity-40 text-[10px] tabular-nums">{statusText}</span>
      </button>

      {/* Expanded child list */}
      {isExpanded && (
        <div className="pl-[38px] pr-2.5 pb-1.5 flex flex-col gap-px">
          {calls.map((call, i) => {
            const effectiveCall = !isActivelyStreaming && call.status === 'running'
              ? { ...call, status: 'done' as const }
              : call;
            const callIdx = segments.indexOf(call);
            const nextSeg = callIdx >= 0 && callIdx + 1 < segments.length ? segments[callIdx + 1] : null;
            const result = nextSeg?.type === 'tool_result' ? nextSeg : null;

            return (
              <div key={`call-${i}`}>
                <div
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 leading-snug"
                  title={effectiveCall.detail || undefined}
                >
                  <span className="opacity-40 shrink-0">–</span>
                  <span className="truncate">{getDetail(effectiveCall)}</span>
                  {effectiveCall.status === 'running' && (
                    <Loader2 size={9} strokeWidth={1.5} className="animate-spin shrink-0 opacity-50" />
                  )}
                </div>
                {result && (
                  <div className="ml-4">
                    <ToolResultSegmentView segment={result} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
