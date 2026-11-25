// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { IndexingNote } from '../IndexingNote';
import { showIndexingForTests } from '@/stores/index-progress-store';
import { MESSAGE_KEYS, setLocale, t } from '@/lib/i18n';

const INDEXING_KEYS = [
  'indexing.progress',
  'indexing.starting',
  'indexing.incomplete',
  'indexing.now',
  'indexing.pendingProjects',
  'indexing.scopeLibrary',
  'activity.downloadingModel',
  'activity.downloadingModels',
] as const;

describe('IndexingNote', () => {
  afterEach(() => {
    showIndexingForTests(null);
    setLocale(null);
  });

  it('renders nothing when the library is not being indexed', () => {
    const { container } = render(<IndexingNote />);
    expect(container.firstChild).toBeNull();
  });

  it('is one muted line while indexing, and goes when indexing ends', () => {
    setLocale('en');
    showIndexingForTests({});
    render(<IndexingNote className="px-2" />);

    const note = screen.getByText('Still indexing: results may be incomplete');
    expect(note.tagName).toBe('P');
    expect(note.className).toContain('text-muted-foreground');
    expect(note.className).toContain('px-2');
    // A note, not an announcement: several can be on screen at once.
    expect(note.getAttribute('role')).toBeNull();

    act(() => showIndexingForTests(null));
    expect(screen.queryByText('Still indexing: results may be incomplete')).toBeNull();
  });

  it('is in Swedish when the app is', () => {
    setLocale('sv');
    showIndexingForTests({});
    render(<IndexingNote />);
    expect(screen.getByText('Indexering pågår: resultaten kan vara ofullständiga')).toBeTruthy();
  });
});

describe('indexing i18n keys', () => {
  afterEach(() => setLocale(null));

  it('exist in English and in Swedish, and the two differ', () => {
    for (const key of INDEXING_KEYS) {
      expect(MESSAGE_KEYS, key).toContain(key);
      setLocale('en');
      const english = t(key);
      setLocale('sv');
      const swedish = t(key);
      expect(english.length, key).toBeGreaterThan(0);
      expect(swedish.length, key).toBeGreaterThan(0);
      // `indexing.now` differs only in its first word, which is enough.
      expect(swedish, `${key} has no Swedish translation`).not.toBe(english);
    }
  });

  it('pluralises the projects still to start', () => {
    setLocale('en');
    expect(t('indexing.pendingProjects', { count: 1 })).toBe('1 project still to start');
    expect(t('indexing.pendingProjects', { count: 3 })).toBe('3 projects still to start');
    setLocale('sv');
    expect(t('indexing.pendingProjects', { count: 3 })).toBe('3 projekt återstår att påbörja');
  });
});
