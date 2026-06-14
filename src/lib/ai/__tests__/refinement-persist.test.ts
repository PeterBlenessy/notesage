import { describe, it, expect } from 'vitest';
import {
  extractRefinements,
  injectRefinements,
  rebuildEntriesFromDoc,
  type PersistedRefinement,
} from '../refinement-persist';
import { hashLine } from '../refinement-hash';
import { serializeRefineComment } from '../refine-comment';
import type { RefinementEntry, RefinementResult } from '../refinement';
import { Schema, type Node as PMNode } from '@tiptap/pm/model';

const result: RefinementResult = {
  verdict: 'sharpen',
  outcome: 'Email the team Friday',
  steps: [],
  rationale: 'no owner/date',
};

function entry(originalText: string, over: Partial<RefinementEntry> = {}): RefinementEntry {
  return {
    id: 'e1',
    docPath: '/d.md',
    anchor: { from: 1, to: 5 },
    srcHash: hashLine(originalText),
    originalText,
    result,
    status: 'pending',
    createdAt: 1,
    ...over,
  };
}

describe('injectRefinements', () => {
  it('appends an ns-refine comment to the matching line', () => {
    const md = '# Notes\n\n- [ ] follow up with the team\n\nmore text';
    const out = injectRefinements(md, [entry('follow up with the team')]);
    const line = out.split('\n').find((l) => l.includes('follow up'))!;
    expect(line).toContain('<!-- ns-refine:v1');
    // Other lines untouched.
    expect(out.split('\n')[0]).toBe('# Notes');
  });

  it('returns markdown unchanged when there are no pending non-keep entries', () => {
    const md = '- [ ] do thing';
    expect(injectRefinements(md, [])).toBe(md);
    expect(injectRefinements(md, [entry('do thing', { status: 'applied' })])).toBe(md);
    expect(
      injectRefinements(md, [entry('do thing', { result: { ...result, verdict: 'keep' } })]),
    ).toBe(md);
  });

  it('does not double-annotate a line that already has a comment', () => {
    const md = `- [ ] do thing ${serializeRefineComment(result, hashLine('do thing'), 'pending')}`;
    const out = injectRefinements(md, [entry('do thing')]);
    expect(out.match(/ns-refine:v1/g) ?? []).toHaveLength(1);
  });
});

describe('extractRefinements', () => {
  it('is a no-op for markdown without ns-refine comments', () => {
    const md = '# Hello\n\n- [ ] task';
    expect(extractRefinements(md)).toEqual({ cleaned: md, persisted: [] });
  });

  it('round-trips inject → extract', () => {
    const md = '- [ ] follow up with the team';
    const injected = injectRefinements(md, [entry('follow up with the team')]);
    const { cleaned, persisted } = extractRefinements(injected);
    expect(cleaned).toBe(md);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].result.outcome).toBe('Email the team Friday');
    expect(persisted[0].srcHash).toBe(hashLine('follow up with the team'));
  });
});

// --- rebuildEntriesFromDoc against a real ProseMirror doc -------------------

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] },
    text: {},
  },
  marks: {},
});

function docFromLines(lines: string[]): PMNode {
  return schema.node(
    'doc',
    null,
    lines.map((l) =>
      l ? schema.node('paragraph', null, [schema.text(l)]) : schema.node('paragraph'),
    ),
  );
}

describe('rebuildEntriesFromDoc', () => {
  it('re-anchors a persisted refinement to the matching block by hash', () => {
    const text = 'follow up with the team';
    const doc = docFromLines(['intro', text, 'outro']);
    const persisted: PersistedRefinement[] = [
      { result, srcHash: hashLine(text), status: 'pending' },
    ];
    const entries = rebuildEntriesFromDoc(doc, persisted, '/d.md', () => 'id1');
    expect(entries).toHaveLength(1);
    expect(entries[0].originalText).toBe(text);
    expect(entries[0].status).toBe('pending');
    // Anchor points at the paragraph's inline content.
    const e = entries[0];
    expect(doc.textBetween(e.anchor.from, e.anchor.to)).toBe(text);
  });

  it('claims each hash at most once and ignores unmatched', () => {
    const doc = docFromLines(['alpha', 'beta']);
    const persisted: PersistedRefinement[] = [
      { result, srcHash: hashLine('alpha'), status: 'pending' },
      { result, srcHash: hashLine('missing'), status: 'pending' },
    ];
    const entries = rebuildEntriesFromDoc(doc, persisted, '/d.md', () => 'id');
    expect(entries.map((e) => e.originalText)).toEqual(['alpha']);
  });

  it('returns empty when nothing is persisted', () => {
    expect(rebuildEntriesFromDoc(docFromLines(['x']), [], '/d.md')).toEqual([]);
  });
});
