import { useMemo } from 'react';

/**
 * Extracts quick-reply options from the end of an assistant message.
 *
 * Detects numbered lists (1. Option), bulleted lists (- Option / * Option),
 * and lettered lists (A. Option) at the tail of the content. Items must be
 * short (≤120 chars) and there must be 2–8 of them in an uninterrupted block.
 */
export function extractQuickReplies(content: string): string[] {
  const lines = content.trimEnd().split('\n');

  // Walk backwards to collect consecutive list items
  const items: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) {
      // Allow one blank line between items, but stop at two
      if (i > 0 && lines[i - 1].trim() === '') break;
      continue;
    }

    // Match: "1. text", "- text", "* text", "A. text"
    const match = line.match(/^(?:\d+\.|[A-Z]\.|[-*•])\s+(.+)/);
    if (match) {
      const text = match[1].replace(/\*\*/g, '').trim();
      if (text.length <= 120) {
        items.unshift(text);
      } else {
        break;
      }
    } else {
      break;
    }
  }

  if (items.length < 2 || items.length > 8) return [];
  return items;
}

interface QuickRepliesProps {
  content: string;
  onSelect: (reply: string) => void;
}

export function QuickReplies({ content, onSelect }: QuickRepliesProps) {
  const replies = useMemo(() => extractQuickReplies(content), [content]);

  if (replies.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1 mb-3 ml-[34px]">
      {replies.map((reply) => (
        <button
          key={reply}
          type="button"
          onClick={() => onSelect(reply)}
          className="px-2.5 py-1 text-xs rounded-lg border border-border bg-background text-foreground hover:bg-accent hover:border-muted-foreground active:opacity-75 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-w-[280px] truncate"
        >
          {reply}
        </button>
      ))}
    </div>
  );
}
