import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter, ensureDocumentId } from '../frontmatter';

describe('parseFrontmatter', () => {
  it('extracts YAML object and content from valid frontmatter', () => {
    const raw = `---
title: Hello World
author: Jane
---

This is the body.`;

    const result = parseFrontmatter(raw);

    expect(result.frontmatter).toEqual({ title: 'Hello World', author: 'Jane' });
    expect(result.content).toBe('This is the body.');
  });

  it('returns null frontmatter and full content when no frontmatter is present', () => {
    const raw = 'Just some regular markdown content.\n\nNo frontmatter here.';

    const result = parseFrontmatter(raw);

    expect(result.frontmatter).toBeNull();
    expect(result.content).toBe(raw);
  });

  it('treats empty frontmatter block (---\\n---) as no frontmatter since YAML parses to null', () => {
    const raw = '---\n---\nSome content.';

    const result = parseFrontmatter(raw);

    // Empty YAML string parses to null, which the function treats as no frontmatter
    expect(result.frontmatter).toBeNull();
    expect(result.content).toBe(raw);
  });

  it('parses explicit empty object frontmatter (---\\n{}\\n---)', () => {
    const raw = '---\n{}\n---\n\nBody text.';

    const result = parseFrontmatter(raw);

    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe('Body text.');
  });

  it('handles various YAML types: strings, numbers, booleans, arrays', () => {
    const raw = `---
title: My Note
count: 42
draft: true
rating: 3.5
tags:
  - javascript
  - testing
  - vitest
---

Content here.`;

    const result = parseFrontmatter(raw);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!.title).toBe('My Note');
    expect(result.frontmatter!.count).toBe(42);
    expect(result.frontmatter!.draft).toBe(true);
    expect(result.frontmatter!.rating).toBe(3.5);
    expect(result.frontmatter!.tags).toEqual(['javascript', 'testing', 'vitest']);
  });

  it('does not treat --- in the document body as frontmatter', () => {
    const raw = `This is a normal document.

---

Some content after a horizontal rule.`;

    const result = parseFrontmatter(raw);

    expect(result.frontmatter).toBeNull();
    expect(result.content).toBe(raw);
  });

  it('parses goal-specific frontmatter with type, template, created, title', () => {
    const raw = `---
type: goal
template: quarterly-review
created: "2026-01-15"
title: Q1 Goals
---

## Objectives

- Ship v1.0`;

    const result = parseFrontmatter(raw);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!.type).toBe('goal');
    expect(result.frontmatter!.template).toBe('quarterly-review');
    expect(result.frontmatter!.created).toBe('2026-01-15');
    expect(result.frontmatter!.title).toBe('Q1 Goals');
    expect(result.content).toBe('## Objectives\n\n- Ship v1.0');
  });

  it('parses note-specific frontmatter with type, created, title, tags', () => {
    const raw = `---
type: note
created: "2026-02-17"
title: Meeting Notes
tags:
  - meetings
  - project-alpha
---

Discussed the roadmap.`;

    const result = parseFrontmatter(raw);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!.type).toBe('note');
    expect(result.frontmatter!.created).toBe('2026-02-17');
    expect(result.frontmatter!.title).toBe('Meeting Notes');
    expect(result.frontmatter!.tags).toEqual(['meetings', 'project-alpha']);
    expect(result.content).toBe('Discussed the roadmap.');
  });

  it('returns frontmatter with empty string content when file is just frontmatter', () => {
    const raw = `---
title: Only Frontmatter
---`;

    const result = parseFrontmatter(raw);

    expect(result.frontmatter).toEqual({ title: 'Only Frontmatter' });
    expect(result.content).toBe('');
  });

  it('returns frontmatter with empty content when frontmatter ends with trailing newline only', () => {
    const raw = '---\ntitle: Just Meta\n---\n';

    const result = parseFrontmatter(raw);

    expect(result.frontmatter).toEqual({ title: 'Just Meta' });
    expect(result.content).toBe('');
  });

  it('treats file with no closing delimiter as no frontmatter', () => {
    const raw = `---
title: Unclosed
This keeps going without a closing delimiter.
And there is no end.`;

    const result = parseFrontmatter(raw);

    expect(result.frontmatter).toBeNull();
    expect(result.content).toBe(raw);
  });

  it('does not treat --- with trailing text on the same line as a closing delimiter', () => {
    // The closing delimiter must be exactly "---" followed by newline or end of string.
    // "---extra" is skipped by findClosingDelimiter, so the real closing is the
    // standalone "---" on a later line. The YAML between opening and real closing
    // includes "---extra text here" which is invalid YAML, so the parser fails
    // and parseFrontmatter gracefully returns null frontmatter with the full raw content.
    const raw = `---
title: Edge Case
---extra text here
---

Body.`;

    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toBeNull();
    expect(result.content).toBe(raw);
  });
});

describe('serializeFrontmatter', () => {
  it('returns content unchanged when frontmatter is null', () => {
    const content = 'Just regular content.\n\nNo frontmatter.';

    const result = serializeFrontmatter(null, content);

    expect(result).toBe(content);
  });

  it('serializes frontmatter and content into a valid frontmatter string', () => {
    const frontmatter = { title: 'Hello', draft: true };
    const content = 'Body text.';

    const result = serializeFrontmatter(frontmatter, content);

    expect(result).toContain('---\n');
    expect(result).toContain('title: Hello');
    expect(result).toContain('draft: true');
    expect(result.endsWith('\n\nBody text.')).toBe(true);
  });

  it('serializes empty object frontmatter', () => {
    const result = serializeFrontmatter({}, 'Some content.');

    expect(result).toBe('---\n{}\n---\n\nSome content.');
  });

  it('serializes frontmatter with empty content', () => {
    const result = serializeFrontmatter({ title: 'No Body' }, '');

    expect(result).toContain('---\n');
    expect(result).toContain('title: No Body');
    expect(result.endsWith('---\n\n')).toBe(true);
  });
});

describe('frontmatter round-trip', () => {
  it('round-trips a file with frontmatter', () => {
    const original = `---
title: Round Trip
tags:
  - a
  - b
---

This is the content.`;

    const parsed = parseFrontmatter(original);
    expect(parsed.frontmatter).not.toBeNull();

    const serialized = serializeFrontmatter(parsed.frontmatter, parsed.content);
    const reparsed = parseFrontmatter(serialized);

    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
    expect(reparsed.content).toBe(parsed.content);
  });

  it('round-trips a file without frontmatter', () => {
    const original = 'No frontmatter here.\n\nJust plain markdown.';

    const parsed = parseFrontmatter(original);
    expect(parsed.frontmatter).toBeNull();

    const serialized = serializeFrontmatter(parsed.frontmatter, parsed.content);

    expect(serialized).toBe(original);
  });

  it('round-trips goal frontmatter', () => {
    const original = `---
type: goal
template: okr
created: "2026-01-01"
title: Annual Goals
---

## Key Results

1. Launch product`;

    const parsed = parseFrontmatter(original);
    expect(parsed.frontmatter).not.toBeNull();

    const serialized = serializeFrontmatter(parsed.frontmatter, parsed.content);
    const reparsed = parseFrontmatter(serialized);

    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
    expect(reparsed.content).toBe(parsed.content);
  });

  it('round-trips note frontmatter', () => {
    const original = `---
type: note
created: "2026-02-17"
title: Daily Standup
tags:
  - standup
  - team
---

Blockers: none.`;

    const parsed = parseFrontmatter(original);
    expect(parsed.frontmatter).not.toBeNull();

    const serialized = serializeFrontmatter(parsed.frontmatter, parsed.content);
    const reparsed = parseFrontmatter(serialized);

    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
    expect(reparsed.content).toBe(parsed.content);
  });

  it('round-trips frontmatter with no body content', () => {
    const frontmatter = { type: 'note', title: 'Empty Body' };
    const content = '';

    const serialized = serializeFrontmatter(frontmatter, content);
    const parsed = parseFrontmatter(serialized);

    expect(parsed.frontmatter).toEqual(frontmatter);
    expect(parsed.content).toBe('');
  });

  it('round-trips explicit empty object frontmatter', () => {
    const frontmatter = {};
    const content = 'Content with empty frontmatter.';

    const serialized = serializeFrontmatter(frontmatter, content);
    const parsed = parseFrontmatter(serialized);

    expect(parsed.frontmatter).toEqual({});
    expect(parsed.content).toBe(content);
  });
});

describe('ensureDocumentId', () => {
  it('generates a new UUID when frontmatter is null', () => {
    const result = ensureDocumentId(null);

    expect(result.frontmatter).toHaveProperty('id');
    expect(typeof result.id).toBe('string');
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(result.frontmatter.id).toBe(result.id);
  });

  it('generates a new UUID when frontmatter has no id field', () => {
    const result = ensureDocumentId({ title: 'foo' });

    expect(result.frontmatter.title).toBe('foo');
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.frontmatter.id).toBe(result.id);
  });

  it('preserves existing UUID when frontmatter already has an id', () => {
    const result = ensureDocumentId({ id: 'existing-uuid-123' });

    expect(result.id).toBe('existing-uuid-123');
    expect(result.frontmatter.id).toBe('existing-uuid-123');
  });

  it('preserves other frontmatter fields when generating a new id', () => {
    const result = ensureDocumentId({ title: 'My Doc', type: 'note', tags: ['a', 'b'] });

    expect(result.frontmatter.title).toBe('My Doc');
    expect(result.frontmatter.type).toBe('note');
    expect(result.frontmatter.tags).toEqual(['a', 'b']);
    expect(typeof result.frontmatter.id).toBe('string');
  });

  it('generates unique UUIDs on each call', () => {
    const a = ensureDocumentId(null);
    const b = ensureDocumentId(null);

    expect(a.id).not.toBe(b.id);
  });
});
