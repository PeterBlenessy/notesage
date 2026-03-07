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

/**
 * Heuristic: detect a trailing numbered/bulleted list where most items end with "?"
 * These are clearly options the AI is presenting to the user.
 * Returns null if no such pattern is found.
 */
function detectQuestionList(content: string): { strippedContent: string; replies: string[] } | null {
  const lines = content.split('\n');

  // Find the last contiguous block of list items (numbered or bulleted)
  const listItemRegex = /^(\s*[-*•]|\s*\d+[.)]\s)/;
  let blockEnd = lines.length - 1;

  // Skip trailing blank lines
  while (blockEnd >= 0 && lines[blockEnd].trim() === '') blockEnd--;
  if (blockEnd < 0) return null;

  // The last non-blank line must be a list item
  if (!listItemRegex.test(lines[blockEnd])) return null;

  let blockStart = blockEnd;
  while (blockStart > 0 && listItemRegex.test(lines[blockStart - 1])) {
    blockStart--;
  }

  // Need at least 2 list items
  const listLines = lines.slice(blockStart, blockEnd + 1);
  if (listLines.length < 2) return null;

  // Extract text from list items
  const items = listLines.map((line) =>
    line.replace(/^\s*[-*•]\s*/, '').replace(/^\s*\d+[.)]\s*/, '').trim()
  );

  // Most items must end with "?" to be considered options
  const questionCount = items.filter((item) => item.endsWith('?')).length;
  if (questionCount < items.length * 0.6) return null;

  // All items must be short enough to be clickable chips
  if (items.some((item) => item.length > 120)) return null;

  const strippedContent = lines.slice(0, blockStart).join('\n').trimEnd();
  return { strippedContent, replies: items };
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

  // If tag-based parsing found replies, use those
  if (replies.length > 0) {
    return { strippedContent, replies };
  }

  // Fallback: detect trailing question-style list items
  const heuristic = detectQuestionList(content);
  if (heuristic) {
    return heuristic;
  }

  return { strippedContent, replies };
}

interface QuickRepliesProps {
  replies: string[];
  onSelect: (reply: string) => void;
}

export function QuickReplies({ replies, onSelect }: QuickRepliesProps) {
  if (replies.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 mt-1 mb-3 ml-[34px]">
      {replies.map((reply, i) => (
        <button
          key={reply}
          type="button"
          onClick={() => onSelect(reply)}
          className="flex items-center gap-2 self-start px-2.5 py-1 text-xs text-left rounded-lg border border-border bg-background text-foreground hover:bg-accent hover:border-muted-foreground active:opacity-75 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="text-muted-foreground shrink-0">{i + 1}.</span>
          {reply}
        </button>
      ))}
    </div>
  );
}
