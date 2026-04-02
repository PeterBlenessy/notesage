import { memo, useState } from 'react';
import { ChevronRight, AlertCircle } from 'lucide-react';
import type { ToolResultSegment } from '@/lib/ai/types';

interface ToolResultSegmentViewProps {
  segment: ToolResultSegment;
}

function summarizeResult(segment: ToolResultSegment): string {
  if (segment.error) return 'Error';
  if (!segment.result) return 'No output';
  const lines = segment.result.split('\n').length;
  if (lines > 1) return `Output (${lines} lines)`;
  const len = segment.result.length;
  if (len > 100) return `Output (${Math.ceil(len / 1024)}KB)`;
  return segment.result.trim();
}

export const ToolResultSegmentView = memo(function ToolResultSegmentView({ segment }: ToolResultSegmentViewProps) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!(segment.result || segment.error);
  const isError = !!segment.error;
  const summary = summarizeResult(segment);

  if (!hasContent) return null;

  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={`flex items-center gap-1 px-1 text-[11px] transition-colors duration-150 cursor-pointer ${
          isError ? 'text-destructive' : 'text-muted-foreground/60 hover:text-muted-foreground'
        }`}
      >
        <ChevronRight
          size={10}
          strokeWidth={1.5}
          className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        {isError && <AlertCircle size={10} strokeWidth={1.5} />}
        <span>{summary}</span>
      </button>
      {expanded && (
        <div className="overflow-auto max-h-[360px] rounded-md bg-muted/50 border border-border/50 p-2 mt-0.5">
          <pre className="text-[10px] font-mono whitespace-pre-wrap break-all text-muted-foreground">
            {segment.error || segment.result}
          </pre>
        </div>
      )}
    </div>
  );
});
