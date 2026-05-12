import type { ReactNode } from 'react';

// Group 2: **bold**, Group 3: `code`, Groups 4+5: [text](url), Group 6: _italic_, Group 7: *italic*
const INLINE_MD_REGEX = /(\*\*(.+?)\*\*|`([^`]+)`|\[(.+?)\]\(([^)]+)\)|_(.+?)_|\*(?!\*)([^*]+)\*)/g;

/**
 * Renders inline markdown as React elements.
 * Supports: **bold**, `code`, [text](url), _italic_, *italic*
 */
export function renderInlineMarkdown(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const regex = new RegExp(INLINE_MD_REGEX.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
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
    } else if (match[4]) {
      // [text](url)
      parts.push(
        <a key={key++} href={match[5]}>
          {match[4]}
        </a>
      );
    } else if (match[6]) {
      // _italic_
      parts.push(<em key={key++}>{match[6]}</em>);
    } else if (match[7]) {
      // *italic*
      parts.push(<em key={key++}>{match[7]}</em>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  if (parts.length === 0) return text;

  return <>{parts}</>;
}
