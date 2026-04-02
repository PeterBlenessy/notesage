import { memo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ThinkingSegment } from '@/lib/ai/types';

interface ThinkingSegmentViewProps {
  segment: ThinkingSegment;
  /** Duration in seconds (computed externally from next segment timestamp or turn end) */
  durationSec?: number;
  isStreaming?: boolean;
}

export const ThinkingSegmentView = memo(function ThinkingSegmentView({
  segment,
  durationSec,
  isStreaming,
}: ThinkingSegmentViewProps) {
  // User toggle overrides auto-collapse. Start expanded if streaming or not collapsed.
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const isExpanded = userExpanded !== null ? userExpanded : (isStreaming || !segment.collapsed);

  const durationLabel = durationSec != null && durationSec > 0
    ? `Thought for ${Math.round(durationSec)}s`
    : 'Thinking';

  return (
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => setUserExpanded((prev) => (prev !== null ? !prev : !isExpanded))}
        className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors duration-150 cursor-pointer"
      >
        <ChevronRight
          size={10}
          strokeWidth={1.5}
          className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <span>{isStreaming ? 'Thinking\u2026' : durationLabel}</span>
      </button>
      {isExpanded && (
        <div className="border-l border-border pl-2.5 py-0.5 mt-0.5">
          <div className="text-[11px] text-muted-foreground/70 italic whitespace-pre-wrap font-mono leading-relaxed">
            {segment.content}
            {isStreaming && (
              <span className="inline-block w-1.5 h-3 bg-muted-foreground/50 animate-pulse ml-0.5" />
            )}
          </div>
        </div>
      )}
    </div>
  );
});
