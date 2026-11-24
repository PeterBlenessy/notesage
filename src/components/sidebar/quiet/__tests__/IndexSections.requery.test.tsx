// @vitest-environment jsdom

/**
 * Perf review F-1: when the Tags and Mentions sections query the document
 * index. Before, each queried on every replacement of `projects`, i.e. on
 * every tree refresh, changed or not.
 */

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { renderWithProviders } from '@/test/component-harness';
import { emitMockEvent } from '@/test/tauri-mock';
import { TagsSection } from '../TagsSection';
import { MentionsSection } from '../MentionsSection';
import { INDEX_REQUERY_DEBOUNCE_MS } from '../useIndexQueryTrigger';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { FileEntry } from '@/lib/tauri';

const indexTagsMock = vi.fn();
const indexMentionsMock = vi.fn();

vi.mock('@/lib/tauri', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri')>('@/lib/tauri');
  return {
    ...actual,
    tauriApi: {
      ...actual.tauriApi,
      indexTags: (...args: unknown[]) => indexTagsMock(...args),
      indexMentions: (...args: unknown[]) => indexMentionsMock(...args),
    },
  };
});

vi.mock('@/lib/cmd-bar-events', () => ({ emitCmdBarEvent: vi.fn() }));

function tree(root: string, names: string[]): FileEntry[] {
  return names.map((name) => ({ name, path: `${root}/${name}`, is_directory: false, hidden: false }));
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const sections = [
  { name: 'TagsSection', Section: TagsSection, query: indexTagsMock },
  { name: 'MentionsSection', Section: MentionsSection, query: indexMentionsMock },
] as const;

describe.each(sections)('$name — index queries per tree refresh', ({ Section, query }) => {
  beforeEach(() => {
    vi.useFakeTimers();
    indexTagsMock.mockReset().mockResolvedValue([]);
    indexMentionsMock.mockReset().mockResolvedValue([]);
    useSettingsStore.setState({ sidebarTagsCap: 5, sidebarMentionsCap: 5 });
    useWorkspaceStore.setState({
      projects: [
        { path: '/lib/Work', fileTree: tree('/lib/Work', ['a.md']) },
        { path: '/lib/Home', fileTree: tree('/lib/Home', ['b.md']) },
      ],
      explorerFolders: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries once on mount, with the project roots', async () => {
    renderWithProviders(<Section />);
    await flushMicrotasks();
    await advance(INDEX_REQUERY_DEBOUNCE_MS * 2);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(['/lib/Work', '/lib/Home'], undefined);
  });

  it('a tree refresh that found nothing new triggers 0 queries', async () => {
    renderWithProviders(<Section />);
    await flushMicrotasks();
    query.mockClear();

    act(() => {
      useWorkspaceStore.getState().updateProjectTree('/lib/Work', tree('/lib/Work', ['a.md']));
      useWorkspaceStore.getState().updateProjectTree('/lib/Home', tree('/lib/Home', ['b.md']));
    });
    await advance(INDEX_REQUERY_DEBOUNCE_MS * 2);

    expect(query).toHaveBeenCalledTimes(0);
  });

  it('a burst of real tree changes triggers exactly one query, after the debounce', async () => {
    renderWithProviders(<Section />);
    await flushMicrotasks();
    query.mockClear();

    for (const names of [['a.md', 'n1.md'], ['a.md', 'n1.md', 'n2.md'], ['a.md', 'n2.md']]) {
      act(() => {
        useWorkspaceStore.getState().updateProjectTree('/lib/Work', tree('/lib/Work', names));
      });
      await advance(100);
    }
    // Still inside the debounce window of the last change.
    expect(query).toHaveBeenCalledTimes(0);

    await advance(INDEX_REQUERY_DEBOUNCE_MS);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenLastCalledWith(['/lib/Work', '/lib/Home'], undefined);
  });

  it('adding a project queries once, immediately, with the new root set', async () => {
    renderWithProviders(<Section />);
    await flushMicrotasks();
    query.mockClear();

    act(() => {
      useWorkspaceStore.getState().addProject('/lib/New', []);
    });
    await flushMicrotasks();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenLastCalledWith(['/lib/Work', '/lib/Home', '/lib/New'], undefined);

    // And no second, debounced one for the same change.
    await advance(INDEX_REQUERY_DEBOUNCE_MS * 2);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('removing a project queries once, immediately', async () => {
    renderWithProviders(<Section />);
    await flushMicrotasks();
    query.mockClear();

    act(() => {
      useWorkspaceStore.getState().removeProject('/lib/Home');
    });
    await flushMicrotasks();
    await advance(INDEX_REQUERY_DEBOUNCE_MS * 2);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenLastCalledWith(['/lib/Work'], undefined);
  });

  it('queries again, once, when the backend reports an index pass finished', async () => {
    renderWithProviders(<Section />);
    await flushMicrotasks();
    query.mockClear();

    // One `index-ready` per project at startup: they collapse into one query.
    act(() => {
      emitMockEvent('index-ready', { project_path: '/lib/Work' });
      emitMockEvent('index-ready', { project_path: '/lib/Home' });
      emitMockEvent('index-ready', { project_path: null });
    });
    await advance(INDEX_REQUERY_DEBOUNCE_MS);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('stops listening and cancels a pending query when unmounted', async () => {
    const { unmount } = renderWithProviders(<Section />);
    await flushMicrotasks();
    query.mockClear();

    act(() => {
      useWorkspaceStore.getState().updateProjectTree('/lib/Work', tree('/lib/Work', ['a.md', 'z.md']));
    });
    unmount();
    act(() => {
      emitMockEvent('index-ready', { project_path: null });
    });
    await advance(INDEX_REQUERY_DEBOUNCE_MS * 2);

    expect(query).toHaveBeenCalledTimes(0);
  });
});
