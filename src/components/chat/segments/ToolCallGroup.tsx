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

/** Try to parse a string as JSON and extract a useful value */
function extractFromJson(raw: string): string | null {
  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  // Try path-like keys → basename
  for (const key of ['file_path', 'path', 'file']) {
    const val = obj[key];
    if (typeof val === 'string' && val.length > 0) {
      const parts = val.split('/');
      return parts[parts.length - 1] || val;
    }
  }
  // Try URL
  for (const key of ['url', 'uri']) {
    const val = obj[key];
    if (typeof val === 'string' && /^https?:\/\//.test(val)) {
      try { return new URL(val).hostname; } catch { return val.slice(0, 60); }
    }
  }
  // Try command
  for (const key of ['command', 'cmd']) {
    const val = obj[key];
    if (typeof val === 'string' && val.length > 0) {
      return val.length > 70 ? val.slice(0, 70) + '\u2026' : val;
    }
  }
  // Try query/pattern
  for (const key of ['pattern', 'query', 'search', 'search_query', 'regex']) {
    const val = obj[key];
    if (typeof val === 'string' && val.length > 0) {
      return `"${val.length > 50 ? val.slice(0, 50) + '\u2026' : val}"`;
    }
  }
  // Try any string value that looks useful
  for (const val of Object.values(obj)) {
    if (typeof val === 'string' && val.length > 3 && val.length < 200) {
      // Skip booleans-as-string, numbers, etc.
      if (/^(true|false|null|\d+)$/.test(val)) continue;
      return val.length > 70 ? val.slice(0, 70) + '\u2026' : val;
    }
  }
  return null;
}

/** Extract the most informative detail for a child item */
function getDetail(call: ToolCallSegment): string {
  // Extract part after the verb: "Reading config.ts" → "config.ts"
  const match = call.label.match(/^\S+:?\s+(.+)$/);
  const labelDetail = match?.[1];

  // If the label detail is specific (not a generic word), use it
  const generic = new Set([
    'file', 'files', 'command', 'resource', 'content', 'skill', 'script',
    'the web', 'web', 'task', 'Task',
  ]);
  if (labelDetail && !generic.has(labelDetail)) {
    return labelDetail;
  }

  // Parse the detail field (raw JSON or title) for a useful value
  if (call.detail) {
    const fromJson = extractFromJson(call.detail);
    if (fromJson) return fromJson;

    // Not JSON — use as-is if it's not too generic
    const trimmed = call.detail.trim();
    if (trimmed.length > 2 && !generic.has(trimmed)) {
      return trimmed.length > 70 ? trimmed.slice(0, 70) + '\u2026' : trimmed;
    }
  }

  // Last resort: return the full label (e.g. "Reading file")
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
