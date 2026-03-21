import type { ReactNode } from 'react';

/**
 * Renders inline markdown (bold, inline code) as React elements.
 * Supports: **bold**, `code`
 */
export function renderInlineMarkdown(text: string): ReactNode {
  // Match **bold** and `code` patterns
  const parts: ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // **bold**
      parts.push(
        <strong key={key++} className="font-semibold text-foreground">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      // `code`
      parts.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded bg-accent text-[0.9em] font-mono"
        >
          {match[3]}
        </code>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // If no markdown was found, return the original string
  if (parts.length === 0) return text;

  return <>{parts}</>;
}
