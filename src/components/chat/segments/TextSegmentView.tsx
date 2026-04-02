import { memo } from 'react';
import { MarkdownContent } from '@/components/MarkdownContent';
import type { TextSegment } from '@/lib/ai/types';

interface TextSegmentViewProps {
  segment: TextSegment;
  isStreaming?: boolean;
}

export const TextSegmentView = memo(function TextSegmentView({ segment, isStreaming }: TextSegmentViewProps) {
  if (!segment.content) return null;

  return (
    <div>
      <MarkdownContent content={segment.content} className="text-sm" />
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse bg-muted-foreground" />
      )}
    </div>
  );
});
