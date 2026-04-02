import { memo, useMemo } from 'react';
import { MarkdownContent } from '@/components/MarkdownContent';
import type { TextSegment } from '@/lib/ai/types';

const QUICK_REPLY_REGEX = /<quick-replies>\s*[\s\S]*?(<\/quick-replies>|$)/g;

interface TextSegmentViewProps {
  segment: TextSegment;
  isStreaming?: boolean;
}

export const TextSegmentView = memo(function TextSegmentView({ segment, isStreaming }: TextSegmentViewProps) {
  // Strip <quick-replies> blocks — they're rendered as clickable chips by ChatMessageList
  const content = useMemo(
    () => segment.content.replace(QUICK_REPLY_REGEX, '').trimEnd(),
    [segment.content],
  );

  if (!content) return null;

  return (
    <div>
      <MarkdownContent content={content} className="text-sm" />
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse bg-muted-foreground" />
      )}
    </div>
  );
});
