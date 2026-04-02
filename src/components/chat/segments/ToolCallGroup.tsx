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

/** Ensure detail is a string — ACP rawInput can be an object */
function stringifyDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (detail == null) return '';
  try { return JSON.stringify(detail); } catch { return String(detail); }
}

/** Try to extract a useful display value from a raw string (JSON or plain text) */
function extractUsefulDetail(raw: unknown): string | null {
  const str = stringifyDetail(raw);
  if (!str) return null;
  return extractFromString(str);
}

function extractFromString(raw: string): string | null {
  // 1. Try JSON parsing
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;

      // Path-like keys → basename
      for (const key of ['file_path', 'path', 'file', 'filePath', 'filename']) {
        const val = obj[key];
        if (typeof val === 'string' && val.length > 0) {
          const parts = val.split('/');
          return parts[parts.length - 1] || val;
        }
      }
      // URL
      for (const key of ['url', 'uri']) {
        const val = obj[key];
        if (typeof val === 'string' && /^https?:\/\//.test(val)) {
          try { return new URL(val).hostname; } catch { return val.slice(0, 60); }
        }
      }
      // Command
      for (const key of ['command', 'cmd']) {
        const val = obj[key];
        if (typeof val === 'string' && val.length > 0) {
          return val.length > 70 ? val.slice(0, 70) + '\u2026' : val;
        }
      }
      // Query/pattern
      for (const key of ['pattern', 'query', 'search', 'search_query', 'regex']) {
        const val = obj[key];
        if (typeof val === 'string' && val.length > 0) {
          return `"${val.length > 50 ? val.slice(0, 50) + '\u2026' : val}"`;
        }
      }
      // Any string value containing a path separator
      for (const val of Object.values(obj)) {
        if (typeof val === 'string' && val.includes('/') && val.length > 1) {
          const parts = val.split('/');
          const base = parts[parts.length - 1];
          if (base && base.length > 1) return base;
        }
      }
      // Any non-trivial string value
      for (const val of Object.values(obj)) {
        if (typeof val === 'string' && val.length > 3 && val.length < 200) {
          if (/^(true|false|null|\d+)$/.test(val)) continue;
          return val.length > 70 ? val.slice(0, 70) + '\u2026' : val;
        }
      }
    }
  } catch {
    // Not JSON — continue to heuristic extraction
  }

  // 2. Try extracting a file path from plain text
  const pathMatch = raw.match(/(?:^|[\s"'])(\/?(?:[\w.-]+\/)+[\w.-]+\.\w+)/);
  if (pathMatch) {
    const parts = pathMatch[1].split('/');
    return parts[parts.length - 1] || pathMatch[1];
  }

  // 3. Try extracting a URL
  const urlMatch = raw.match(/https?:\/\/[^\s"']+/);
  if (urlMatch) {
    try { return new URL(urlMatch[0]).hostname; } catch { return urlMatch[0].slice(0, 60); }
  }

  return null;
}

/** Words that don't carry useful information as child labels */
const GENERIC_WORDS = new Set([
  'file', 'files', 'command', 'resource', 'content', 'skill', 'script',
  'the web', 'web', 'task', 'Task', 'undefined', 'null', 'unknown',
  'Fetch', 'fetch', 'Read', 'read', 'Write', 'write', 'Edit', 'edit',
  'Terminal', 'terminal',
]);

/** Check if a string is useless as a display label */
function isUseless(s: string): boolean {
  if (!s || s === '{}' || s === '""' || s === 'undefined' || s === 'null') return true;
  return GENERIC_WORDS.has(s.trim());
}

/** Extract the most informative detail for a child item */
function getDetail(call: ToolCallSegment): string {
  // Extract part after the verb: "Reading config.ts" → "config.ts"
  const match = call.label.match(/^\S+:?\s+(.+)$/);
  const labelDetail = match?.[1];

  if (labelDetail && !isUseless(labelDetail)) {
    return labelDetail;
  }

  // Parse the detail field (raw JSON, title, or plain text) for a useful value
  if (call.detail && !isUseless(String(call.detail))) {
    const extracted = extractUsefulDetail(call.detail);
    if (extracted && !isUseless(extracted)) return extracted;
  }

  // Use the full label if it has more than just a verb
  if (call.label && call.label.includes(' ') && !isUseless(call.label)) {
    return call.label;
  }

  // Nothing useful — return the kind or a placeholder
  if (call.kind && !isUseless(call.kind)) return call.kind;
  return '(action)';
}

export const ToolCallGroup = memo(function ToolCallGroup({
  label,
  segments,
  isActivelyStreaming,
}: ToolCallGroupProps) {
  const calls = segments.filter((s): s is ToolCallSegment => s.type === 'tool_call');
  // When not actively streaming, treat all as done (safety net for missed finalizeSegments)
  const rawRunning = calls.filter((c) => c.status === 'running').length;
  const hasRunning = isActivelyStreaming && rawRunning > 0;
  const doneCount = calls.length - (isActivelyStreaming ? rawRunning : 0);
  const allDone = !hasRunning;

  // Default: expanded always. User can toggle collapsed.
  const [userCollapsed, setUserCollapsed] = useState(false);
  const isExpanded = !userCollapsed;

  const statusText = hasRunning ? `${doneCount}/${calls.length}` : String(calls.length);

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
                  title={stringifyDetail(effectiveCall.detail) || undefined}
                >
                  <span className="opacity-40 shrink-0">–</span>
                  <span className="truncate">{getDetail(effectiveCall) || effectiveCall.label}</span>
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
