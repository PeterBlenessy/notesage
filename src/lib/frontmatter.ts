import { parse, stringify } from 'yaml';

export interface Frontmatter {
  [key: string]: unknown;
}

export interface GoalFrontmatter extends Frontmatter {
  type: 'goal';
  template: string;
  created: string;
  title: string;
}

export interface NoteFrontmatter extends Frontmatter {
  type: 'note';
  created: string;
  title: string;
  tags: string[];
}

interface ParseResult {
  frontmatter: Frontmatter | null;
  content: string;
}

/**
 * Ensure a document has a UUID in its frontmatter.
 * If the frontmatter already has an `id`, it's returned unchanged.
 * Otherwise a new UUID is generated via `crypto.randomUUID()`.
 * If frontmatter is null, a new object with just `{ id }` is created.
 */
export function ensureDocumentId(frontmatter: Frontmatter | null): { frontmatter: Frontmatter; id: string } {
  if (frontmatter?.id && typeof frontmatter.id === 'string') {
    return { frontmatter, id: frontmatter.id };
  }

  const id = crypto.randomUUID();
  const updated = { ...frontmatter, id };
  return { frontmatter: updated, id };
}

/**
 * Parse frontmatter from a raw markdown string.
 *
 * Frontmatter must start at position 0 with `---` followed by a newline,
 * and be closed by another `---` followed by a newline (or end of string).
 * The YAML between the delimiters is parsed into an object.
 *
 * If no valid frontmatter block is found, returns null frontmatter
 * and the full raw string as content.
 */
export function parseFrontmatter(raw: string): ParseResult {
  // Check if the string starts with --- followed by a newline
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { frontmatter: null, content: raw };
  }

  // Find the opening delimiter length
  const openDelimiterEnd = raw.startsWith('---\r\n') ? 5 : 4;

  // Search for closing delimiter after the opening one
  const closingIndex = findClosingDelimiter(raw, openDelimiterEnd);

  if (closingIndex === -1) {
    // No closing delimiter found, treat as no frontmatter
    return { frontmatter: null, content: raw };
  }

  // Extract the YAML string between the delimiters
  const yamlString = raw.substring(openDelimiterEnd, closingIndex);

  // Determine the length of the closing delimiter line
  const afterClosing = raw.substring(closingIndex);
  let closingDelimiterEnd: number;
  if (afterClosing.startsWith('---\r\n')) {
    closingDelimiterEnd = closingIndex + 5;
  } else if (afterClosing.startsWith('---\n')) {
    closingDelimiterEnd = closingIndex + 4;
  } else if (afterClosing === '---') {
    // Closing delimiter at end of string with no trailing newline
    closingDelimiterEnd = closingIndex + 3;
  } else {
    // Should not reach here given findClosingDelimiter logic
    return { frontmatter: null, content: raw };
  }

  // Parse the YAML — if it's invalid, treat as no frontmatter
  let parsed: unknown;
  try {
    parsed = parse(yamlString);
  } catch {
    // Expected: invalid YAML in frontmatter block — treat as no frontmatter
    return { frontmatter: null, content: raw };
  }

  // If parsed result is not a plain object, treat as no frontmatter
  if (parsed === null || parsed === undefined || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { frontmatter: null, content: raw };
  }

  // Extract content after closing delimiter, stripping one leading newline
  let content = raw.substring(closingDelimiterEnd);
  if (content.startsWith('\r\n')) {
    content = content.substring(2);
  } else if (content.startsWith('\n')) {
    content = content.substring(1);
  }

  return {
    frontmatter: parsed as Frontmatter,
    content,
  };
}

/**
 * Serialize frontmatter and content back into a raw markdown string.
 *
 * If frontmatter is null, returns content unchanged.
 * An empty object `{}` is still serialized as an empty frontmatter block.
 */
export function serializeFrontmatter(frontmatter: Frontmatter | null, content: string): string {
  if (frontmatter === null) {
    return content;
  }

  const yamlString = stringify(frontmatter);

  // stringify already adds a trailing newline, so we get:
  // ---\n{yaml}\n---\n\n{content}
  return `---\n${yamlString}---\n\n${content}`;
}

/**
 * Find the position of the closing `---` delimiter.
 * The closing delimiter must appear at the start of a line.
 * Returns the index of the `---` or -1 if not found.
 */
function findClosingDelimiter(raw: string, startFrom: number): number {
  let pos = startFrom;

  while (pos < raw.length) {
    // Check if we're at a `---` at the start of a line
    if (raw.startsWith('---', pos)) {
      const afterDashes = pos + 3;
      // Valid closing delimiter if followed by \n, \r\n, or end of string
      if (
        afterDashes >= raw.length ||
        raw[afterDashes] === '\n' ||
        (raw[afterDashes] === '\r' && raw[afterDashes + 1] === '\n')
      ) {
        return pos;
      }
    }

    // Move to the next line
    const nextNewline = raw.indexOf('\n', pos);
    if (nextNewline === -1) {
      break;
    }
    pos = nextNewline + 1;
  }

  return -1;
}
