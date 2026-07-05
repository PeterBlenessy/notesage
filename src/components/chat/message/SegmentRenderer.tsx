import { memo, useMemo } from 'react';
import type { Segment } from '@/lib/ai/types';
import { TextSegmentView, ThinkingSegmentView, ToolCallSegmentView, ToolResultSegmentView, ImageSegmentView, ToolCallGroup } from '../segments';
import { PlanSegmentView } from '../segments/PlanSegmentView';

/** Extract the verb (first word) from a tool call label for grouping */
function getVerb(seg: Segment): string {
  if (seg.type !== 'tool_call') return '';
  // Label format: "Reading file.ts", "Searching for ...", "Running: cmd", "Fetching host"
  const match = seg.label.match(/^(\S+?)(?::?\s|$)/);
  return match ? match[1] : seg.label;
}

type SegmentGroup =
  | { type: 'single'; index: number }
  | { type: 'verb_group'; label: string; startIndex: number; endIndex: number };

/**
 * Group consecutive tool segments by verb. Each run of tool_call/tool_result
 * with the same verb becomes one collapsible group. Runs with a single tool_call
 * render inline (no wrapper).
 */
function groupSegments(segments: Segment[]): SegmentGroup[] {
  const groups: SegmentGroup[] = [];
  let i = 0;
  while (i < segments.length) {
    const seg = segments[i];
    if (seg.type !== 'tool_call' && seg.type !== 'tool_result') {
      groups.push({ type: 'single', index: i });
      i++;
      continue;
    }

    // Collect consecutive tool segments, splitting by verb
    // Each tool_call starts a potential group entry; tool_results attach to their preceding call
    const toolRunStart = i;
    // Collect the full consecutive tool run first
    while (i < segments.length && (segments[i].type === 'tool_call' || segments[i].type === 'tool_result')) {
      i++;
    }
    const toolRun = segments.slice(toolRunStart, i);

    // Now split this run into verb sub-groups
    const verbRuns: Array<{ verb: string; start: number; end: number }> = [];
    let currentVerb = '';
    let runStart = toolRunStart;

    for (let j = 0; j < toolRun.length; j++) {
      const s = toolRun[j];
      if (s.type === 'tool_call') {
        const verb = getVerb(s);
        if (verb !== currentVerb && currentVerb !== '') {
          // New verb — close current run
          verbRuns.push({ verb: currentVerb, start: runStart, end: toolRunStart + j - 1 });
          runStart = toolRunStart + j;
        }
        currentVerb = verb;
      }
      // tool_result always stays with current verb
    }
    if (currentVerb) {
      verbRuns.push({ verb: currentVerb, start: runStart, end: i - 1 });
    }

    // Convert verb runs into groups
    for (const run of verbRuns) {
      const callCount = segments.slice(run.start, run.end + 1).filter((s) => s.type === 'tool_call').length;
      if (callCount >= 2) {
        groups.push({ type: 'verb_group', label: run.verb, startIndex: run.start, endIndex: run.end });
      } else {
        // Single call — render inline
        for (let j = run.start; j <= run.end; j++) {
          groups.push({ type: 'single', index: j });
        }
      }
    }
  }
  return groups;
}

/**
 * Group descriptor ready for rendering: verb groups carry their segment slice
 * so the (memoized) grouping computation is the only place slices are
 * allocated — memo-wrapped `ToolCallGroup` then sees a stable array reference
 * on renders where `segments` didn't change.
 */
type RenderableGroup =
  | { type: 'single'; index: number }
  | { type: 'verb_group'; label: string; startIndex: number; segments: Segment[] };

export const SegmentRenderer = memo(function SegmentRenderer({ segments, isActivelyStreaming }: { segments: Segment[]; isActivelyStreaming: boolean }) {
  // Grouping + per-group slices computed once per `segments` reference. The
  // segments array changes on every store flush (correct — content changed);
  // the memo stops recomputation on renders where it didn't.
  const groups = useMemo<RenderableGroup[]>(
    () =>
      groupSegments(segments).map((group) =>
        group.type === 'verb_group'
          ? {
              type: 'verb_group' as const,
              label: group.label,
              startIndex: group.startIndex,
              segments: segments.slice(group.startIndex, group.endIndex + 1),
            }
          : group,
      ),
    [segments],
  );

  return (
    <div className="flex flex-col">
      {groups.map((group) => {
        if (group.type === 'verb_group') {
          return (
            <ToolCallGroup
              key={`group-${group.startIndex}`}
              label={group.label}
              segments={group.segments}
              isActivelyStreaming={isActivelyStreaming}
            />
          );
        }

        const index = group.index;
        const segment = segments[index];
        const isLastSegment = index === segments.length - 1;
        const isStreamingSegment = isActivelyStreaming && isLastSegment;

        // Compute thinking duration from next segment's timestamp
        let thinkingDuration: number | undefined;
        if (segment.type === 'thinking' && index < segments.length - 1) {
          const nextTimestamp = segments[index + 1].timestamp;
          thinkingDuration = (nextTimestamp - segment.timestamp) / 1000;
        }

        switch (segment.type) {
          case 'text':
            return (
              <TextSegmentView
                key={`text-${index}`}
                segment={segment}
                isStreaming={isStreamingSegment}
              />
            );
          case 'thinking':
            return (
              <ThinkingSegmentView
                key={`thinking-${index}`}
                segment={segment}
                durationSec={thinkingDuration}
                isStreaming={isStreamingSegment}
              />
            );
          case 'tool_call': {
            // When not streaming, force status to done as a safety net
            const effectiveSegment = !isActivelyStreaming && segment.status === 'running'
              ? { ...segment, status: 'done' as const }
              : segment;
            return (
              <ToolCallSegmentView
                key={`tool_call-${index}`}
                segment={effectiveSegment}
              />
            );
          }
          case 'tool_result':
            return (
              <ToolResultSegmentView
                key={`tool_result-${index}`}
                segment={segment}
              />
            );
          case 'image':
            return (
              <ImageSegmentView
                key={`image-${index}`}
                segment={segment}
              />
            );
          case 'plan':
            return (
              <PlanSegmentView
                key={`plan-${index}`}
                segment={segment}
                isStreaming={isStreamingSegment}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
});
