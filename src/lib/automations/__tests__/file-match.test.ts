import { describe, it, expect, vi } from 'vitest';
import { matchesCondition, automationBase, relativeToBase } from '../file-match';
import type { Automation, Condition } from '../types';

function fileAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'inbox',
    name: 'Inbox Triage',
    enabled: true,
    armed: false,
    scope: '/proj',
    mode: 'single',
    trigger: { type: 'file', event: 'file-created' },
    guardrails: { maxRunsPerDay: 50, debounceMs: 60000, maxStepsPerRun: 15 },
    steps: [{ id: 'a', type: 'notify', title: 't', body: 'b' }],
    sourcePath: '/proj/.notesage/automations/inbox.yaml',
    ...overrides,
  };
}

function withCondition(condition: Condition | undefined, overrides: Partial<Automation> = {}) {
  return fileAutomation({ condition, ...overrides });
}

// A reader that must never be hit (proves frontmatter I/O is gated on the glob).
const noReader = vi.fn(async () => {
  throw new Error('readFrontmatter should not have been called');
});

describe('automationBase', () => {
  it('prefers trigger.path over scope', () => {
    expect(automationBase(fileAutomation({ trigger: { type: 'file', path: '/inbox' } }))).toBe(
      '/inbox',
    );
  });

  it('falls back to the project scope', () => {
    expect(automationBase(fileAutomation())).toBe('/proj');
  });

  it('is undefined for a global automation with no trigger.path', () => {
    expect(automationBase(fileAutomation({ scope: 'global' }))).toBeUndefined();
  });
});

describe('relativeToBase', () => {
  it('strips the base prefix', () => {
    expect(relativeToBase('/proj', '/proj/Inbox/a.md')).toBe('Inbox/a.md');
  });

  it('tolerates a trailing slash on the base', () => {
    expect(relativeToBase('/proj/', '/proj/Inbox/a.md')).toBe('Inbox/a.md');
  });

  it('returns null when the file is outside the base', () => {
    expect(relativeToBase('/proj', '/other/a.md')).toBeNull();
  });

  it('returns "" when the file IS the base', () => {
    expect(relativeToBase('/proj', '/proj')).toBe('');
  });

  it('strips the leading separator when there is no base', () => {
    expect(relativeToBase(undefined, '/a/b/c.md')).toBe('a/b/c.md');
  });
});

describe('matchesCondition', () => {
  it('no condition ⇒ matches', async () => {
    expect(await matchesCondition(fileAutomation(), '/proj/anything.txt', noReader)).toBe(true);
  });

  it('empty condition object ⇒ matches', async () => {
    expect(await matchesCondition(withCondition({}), '/proj/anything.txt', noReader)).toBe(true);
  });

  it('scope-relative glob matches a file under the scope', async () => {
    const a = withCondition({ glob: 'Inbox/*.md' });
    expect(await matchesCondition(a, '/proj/Inbox/note.md', noReader)).toBe(true);
  });

  it('scope-relative glob does NOT match a sibling outside the glob', async () => {
    const a = withCondition({ glob: 'Inbox/*.md' });
    expect(await matchesCondition(a, '/proj/Outbox/note.md', noReader)).toBe(false);
    // single-segment glob does not descend into subfolders
    expect(await matchesCondition(a, '/proj/Inbox/sub/note.md', noReader)).toBe(false);
    // wrong extension
    expect(await matchesCondition(a, '/proj/Inbox/note.txt', noReader)).toBe(false);
  });

  it('** glob matches at any depth', async () => {
    const a = withCondition({ glob: '**/*.md' });
    expect(await matchesCondition(a, '/proj/a.md', noReader)).toBe(true);
    expect(await matchesCondition(a, '/proj/deep/nested/a.md', noReader)).toBe(true);
    expect(await matchesCondition(a, '/proj/a.txt', noReader)).toBe(false);
  });

  it('a file outside the watched root never matches a glob', async () => {
    const a = withCondition({ glob: '**/*.md' });
    expect(await matchesCondition(a, '/elsewhere/a.md', noReader)).toBe(false);
  });

  it('honours an explicit trigger.path as the glob root', async () => {
    const a = withCondition({ glob: '*.md' }, { trigger: { type: 'file', path: '/inbox' } });
    expect(await matchesCondition(a, '/inbox/note.md', noReader)).toBe(true);
    expect(await matchesCondition(a, '/proj/note.md', noReader)).toBe(false);
  });

  it('global automation globs against the path as-is', async () => {
    const a = withCondition({ glob: '**/Inbox/*.md' }, { scope: 'global' });
    expect(await matchesCondition(a, '/Users/me/Notesage/Inbox/x.md', noReader)).toBe(true);
  });

  it('matches a frontmatter key (read lazily)', async () => {
    const read = vi.fn(async () => ({ type: 'goal', title: 'Q3' }));
    const a = withCondition({ frontmatter: { type: 'goal' } });
    expect(await matchesCondition(a, '/proj/g.md', read)).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith('/proj/g.md');
  });

  it('rejects when a frontmatter value differs', async () => {
    const read = vi.fn(async () => ({ type: 'note' }));
    const a = withCondition({ frontmatter: { type: 'goal' } });
    expect(await matchesCondition(a, '/proj/g.md', read)).toBe(false);
  });

  it('rejects when the file has no frontmatter', async () => {
    const read = vi.fn(async () => null);
    const a = withCondition({ frontmatter: { type: 'goal' } });
    expect(await matchesCondition(a, '/proj/g.md', read)).toBe(false);
  });

  it('matches frontmatter array membership and coerces non-strings', async () => {
    const read = vi.fn(async () => ({ tags: ['urgent', 'inbox'], priority: 1 }));
    expect(await matchesCondition(withCondition({ frontmatter: { tags: 'inbox' } }), '/proj/g.md', read)).toBe(true);
    expect(await matchesCondition(withCondition({ frontmatter: { tags: 'missing' } }), '/proj/g.md', read)).toBe(false);
    expect(await matchesCondition(withCondition({ frontmatter: { priority: '1' } }), '/proj/g.md', read)).toBe(true);
  });

  it('requires ALL frontmatter keys to match', async () => {
    const read = vi.fn(async () => ({ type: 'goal', status: 'open' }));
    const both = withCondition({ frontmatter: { type: 'goal', status: 'open' } });
    expect(await matchesCondition(both, '/proj/g.md', read)).toBe(true);
    const mismatch = withCondition({ frontmatter: { type: 'goal', status: 'done' } });
    expect(await matchesCondition(mismatch, '/proj/g.md', read)).toBe(false);
  });

  it('does NOT read frontmatter when the glob fails first (gated)', async () => {
    const read = vi.fn(async () => ({ type: 'goal' }));
    const a = withCondition({ glob: 'Inbox/*.md', frontmatter: { type: 'goal' } });
    expect(await matchesCondition(a, '/proj/Outbox/g.md', read)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('reads frontmatter only after the glob passes (combined condition)', async () => {
    const read = vi.fn(async () => ({ type: 'goal' }));
    const a = withCondition({ glob: 'Inbox/*.md', frontmatter: { type: 'goal' } });
    expect(await matchesCondition(a, '/proj/Inbox/g.md', read)).toBe(true);
    expect(read).toHaveBeenCalledOnce();
  });

  it('ignores schedule-level weekdays (file matcher only cares about glob/frontmatter)', async () => {
    const a = withCondition({ weekdays: [1, 2, 3] });
    expect(await matchesCondition(a, '/proj/anything', noReader)).toBe(true);
  });
});
