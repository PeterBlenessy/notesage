// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { findTextInDoc } from '../pm-text-search';

// Minimal ProseMirror schema for testing
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] as const },
    text: { group: 'inline', inline: true },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0] as const },
    italic: { toDOM: () => ['em', 0] as const },
  },
});

const { nodes: n } = schema;
const bold = schema.mark('bold');
const italic = schema.mark('italic');

function doc(...children: ReturnType<typeof n.doc.create>[]) {
  return n.doc.create(null, children);
}

function p(...children: ReturnType<typeof schema.text>[]) {
  return n.paragraph.create(null, children.length > 0 ? children : undefined);
}

function text(content: string, marks?: ReturnType<typeof schema.mark>[]) {
  return schema.text(content, marks);
}

describe('findTextInDoc', () => {
  describe('plain text', () => {
    it('finds text in a single paragraph', () => {
      const d = doc(p(text('Hello world')));
      const result = findTextInDoc(d, 'world');
      expect(result).not.toBeNull();
      expect(result!.to - result!.from).toBe(5);
      expect(d.textBetween(result!.from, result!.to)).toBe('world');
    });

    it('finds text at the beginning of a paragraph', () => {
      const d = doc(p(text('Hello world')));
      const result = findTextInDoc(d, 'Hello');
      expect(result).not.toBeNull();
      expect(d.textBetween(result!.from, result!.to)).toBe('Hello');
    });

    it('returns null when text is not found', () => {
      const d = doc(p(text('Hello world')));
      expect(findTextInDoc(d, 'goodbye')).toBeNull();
    });

    it('returns null for empty search text', () => {
      const d = doc(p(text('Hello world')));
      expect(findTextInDoc(d, '')).toBeNull();
    });

    it('returns null for whitespace-only search text', () => {
      const d = doc(p(text('Hello world')));
      expect(findTextInDoc(d, '   ')).toBeNull();
    });
  });

  describe('text spanning formatted ranges', () => {
    it('finds text across bold + plain nodes', () => {
      const d = doc(p(text('hello '), text('world', [bold])));
      const result = findTextInDoc(d, 'hello world');
      expect(result).not.toBeNull();
      expect(d.textBetween(result!.from, result!.to)).toBe('hello world');
    });

    it('finds text across plain + italic + plain nodes', () => {
      const d = doc(p(text('start '), text('middle', [italic]), text(' end')));
      const result = findTextInDoc(d, 'start middle end');
      expect(result).not.toBeNull();
      expect(d.textBetween(result!.from, result!.to)).toBe('start middle end');
    });

    it('finds partial text within a formatted range', () => {
      const d = doc(p(text('hello '), text('beautiful world', [bold])));
      const result = findTextInDoc(d, 'beautiful');
      expect(result).not.toBeNull();
      expect(d.textBetween(result!.from, result!.to)).toBe('beautiful');
    });
  });

  describe('occurrence parameter', () => {
    it('finds the first occurrence by default', () => {
      const d = doc(p(text('foo bar foo bar')));
      const result = findTextInDoc(d, 'foo');
      expect(result).not.toBeNull();
      expect(d.textBetween(result!.from, result!.to)).toBe('foo');
      expect(result!.from).toBe(1);
    });

    it('finds the second occurrence', () => {
      const d = doc(p(text('foo bar foo bar')));
      const result = findTextInDoc(d, 'foo', 2);
      expect(result).not.toBeNull();
      expect(d.textBetween(result!.from, result!.to)).toBe('foo');
      // "foo bar foo" — second "foo" at index 8, PM pos = 1+8 = 9
      expect(result!.from).toBe(9);
    });

    it('returns null when occurrence exceeds count', () => {
      const d = doc(p(text('foo bar foo bar')));
      expect(findTextInDoc(d, 'foo', 3)).toBeNull();
    });

    it('finds occurrences across paragraphs', () => {
      const d = doc(p(text('hello world')), p(text('hello again')));
      const result1 = findTextInDoc(d, 'hello', 1);
      const result2 = findTextInDoc(d, 'hello', 2);
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result1!.from).not.toBe(result2!.from);
    });
  });

  describe('whitespace normalization', () => {
    it('normalizes multiple spaces in the document', () => {
      const d = doc(p(text('hello   world')));
      const result = findTextInDoc(d, 'hello world');
      expect(result).not.toBeNull();
    });

    it('normalizes search text whitespace', () => {
      const d = doc(p(text('hello world')));
      const result = findTextInDoc(d, 'hello   world');
      expect(result).not.toBeNull();
    });

    it('trims leading/trailing whitespace in search text', () => {
      const d = doc(p(text('hello world')));
      const result = findTextInDoc(d, '  hello world  ');
      expect(result).not.toBeNull();
    });
  });

  describe('case sensitivity', () => {
    it('is case-sensitive', () => {
      const d = doc(p(text('Hello World')));
      expect(findTextInDoc(d, 'hello world')).toBeNull();
      expect(findTextInDoc(d, 'Hello World')).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    it('returns null for occurrence < 1', () => {
      const d = doc(p(text('hello')));
      expect(findTextInDoc(d, 'hello', 0)).toBeNull();
      expect(findTextInDoc(d, 'hello', -1)).toBeNull();
    });

    it('handles single character search', () => {
      const d = doc(p(text('abc')));
      const result = findTextInDoc(d, 'b');
      expect(result).not.toBeNull();
      expect(d.textBetween(result!.from, result!.to)).toBe('b');
    });

    it('handles document with minimal content', () => {
      const d = doc(p(text('x')));
      expect(findTextInDoc(d, 'hello')).toBeNull();
    });
  });
});
