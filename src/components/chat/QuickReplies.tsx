/**
 * Parse `<quick-replies>` blocks from AI message content.
 * Returns extracted reply options and the content with the block stripped.
 *
 * Format the AI is instructed to use:
 * ```
 * <quick-replies>
 * Option one
 * Option two
 * Option three
 * </quick-replies>
 * ```
 */

const QUICK_REPLY_REGEX = /<quick-replies>\s*([\s\S]*?)\s*<\/quick-replies>/g;

export interface ParsedQuickReplies {
  /** Message content with <quick-replies> blocks removed */
  strippedContent: string;
  /** Extracted reply options */
  replies: string[];
}

export function parseQuickReplies(content: string): ParsedQuickReplies {
  const replies: string[] = [];

  const strippedContent = content.replace(QUICK_REPLY_REGEX, (_match, inner: string) => {
    const lines = inner
      .split('\n')
      .map((line: string) => line.replace(/^[-*•\d.]+\s*/, '').trim())
      .filter((line: string) => line.length > 0 && line.length <= 120);
    replies.push(...lines);
    return '';
  }).trimEnd();

  return { strippedContent, replies };
}

interface QuickRepliesProps {
  replies: string[];
  onSelect: (reply: string) => void;
}

export function QuickReplies({ replies, onSelect }: QuickRepliesProps) {
  if (replies.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1 mb-3 ml-[34px]">
      {replies.map((reply) => (
        <button
          key={reply}
          type="button"
          onClick={() => onSelect(reply)}
          className="px-2.5 py-1 text-xs rounded-lg border border-border bg-background text-foreground hover:bg-accent hover:border-muted-foreground active:opacity-75 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {reply}
        </button>
      ))}
    </div>
  );
}
