// @vitest-environment jsdom
//
// The placeholder-document loader: on-demand load of the active document,
// background preload of the rest, and the load-error path. None of
// `setTabLoadError` / `loadError` was reached by any test before (audit
// 2026-11-22, test coverage).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    readFile: vi.fn(),
    readBinaryFile: vi.fn(),
  },
}));

import { tauriApi } from '@/lib/tauri';
import { useEditorStore, type Tab as EditorTab } from '@/stores/editor-store';
import { useEditorTabContentLoader } from '@/hooks/useEditorTabContentLoader';
import { clearAllBinaryData, getBinaryData } from '@/lib/binary-cache';
import type { FileType } from '@/lib/file-utils';

const readFile = vi.mocked(tauriApi.readFile);
const readBinaryFile = vi.mocked(tauriApi.readBinaryFile);

function placeholder(id: string, filePath: string, fileType: FileType = 'markdown'): EditorTab {
  return {
    id,
    filePath,
    fileName: filePath.split('/').pop() ?? filePath,
    isDirty: false,
    content: '',
    frontmatter: null,
    fileType,
    contentLoaded: false,
  } as EditorTab;
}

function seed(tabs: EditorTab[], activeTabId: string | null): void {
  useEditorStore.setState({ openDocuments: tabs, activeTabId });
}

const tabById = (id: string) => useEditorStore.getState().openDocuments.find((t) => t.id === id)!;

/** Mounts the hook against the live store, the way Editor.tsx feeds it. */
function mountLoader() {
  return renderHook(() => {
    const openDocuments = useEditorStore((s) => s.openDocuments);
    const activeTabId = useEditorStore((s) => s.activeTabId);
    const activeTab = openDocuments.find((t) => t.id === activeTabId);
    useEditorTabContentLoader({ activeTab, activeTabId, openDocuments });
  });
}

/** A promise the test resolves by hand, to hold a read open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useEditorTabContentLoader', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    readFile.mockReset();
    readBinaryFile.mockReset();
    clearAllBinaryData();
    seed([], null);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    seed([], null);
  });

  describe('the active document', () => {
    it('splits frontmatter off a markdown file', async () => {
      readFile.mockResolvedValue('---\ntitle: Plan\n---\n# Body\n');
      seed([placeholder('a', '/notes/plan.md')], 'a');

      mountLoader();

      await waitFor(() => expect(tabById('a').contentLoaded).toBe(true));
      expect(readFile).toHaveBeenCalledWith('/notes/plan.md');
      const tab = tabById('a');
      expect(tab.content).toBe('# Body\n');
      expect(tab.frontmatter).toMatchObject({ title: 'Plan' });
      // The loaded text is the save baseline, so it is not seen as an edit.
      expect(tab.lastSavedContent).toBe('# Body\n');
      expect(tab.loadError).toBeUndefined();
    });

    it('keeps a non-markdown text file verbatim, frontmatter delimiters included', async () => {
      const raw = '---\nnot: frontmatter\n---\nconst x = 1;\n';
      readFile.mockResolvedValue(raw);
      seed([placeholder('a', '/src/x.ts', 'other')], 'a');

      mountLoader();

      await waitFor(() => expect(tabById('a').contentLoaded).toBe(true));
      expect(tabById('a').content).toBe(raw);
      expect(tabById('a').frontmatter).toBeNull();
    });

    it('sends a binary file to the byte cache and leaves the content empty', async () => {
      readBinaryFile.mockResolvedValue([37, 80, 68, 70]);
      seed([placeholder('a', '/docs/report.pdf', 'pdf')], 'a');

      mountLoader();

      await waitFor(() => expect(tabById('a').contentLoaded).toBe(true));
      expect(readBinaryFile).toHaveBeenCalledWith('/docs/report.pdf');
      expect(readFile).not.toHaveBeenCalled();
      expect(tabById('a').content).toBe('');
      expect(Array.from(getBinaryData('/docs/report.pdf') ?? [])).toEqual([37, 80, 68, 70]);
    });

    it('marks an image loaded without reading it (the viewer streams it itself)', async () => {
      seed([placeholder('a', '/img/photo.png', 'image')], 'a');

      mountLoader();

      await waitFor(() => expect(tabById('a').contentLoaded).toBe(true));
      expect(readFile).not.toHaveBeenCalled();
      expect(readBinaryFile).not.toHaveBeenCalled();
      expect(getBinaryData('/img/photo.png')).toBeUndefined();
    });

    it('records a read failure as loadError and writes no content', async () => {
      readFile.mockRejectedValue('No such file or directory (os error 2)');
      seed([{ ...placeholder('a', '/notes/gone.md'), content: 'stale placeholder text' }], 'a');

      mountLoader();

      await waitFor(() => expect(tabById('a').loadError).toBe('No such file or directory (os error 2)'));
      const tab = tabById('a');
      // The error view keys off loadError; contentLoaded flips so the loading
      // placeholder does not sit there forever.
      expect(tab.contentLoaded).toBe(true);
      expect(tab.content).toBe('stale placeholder text');
      expect(tab.lastSavedContent).toBeUndefined();
      expect(tab.isDirty).toBe(false);
    });

    it('does not read a document that is already loaded', async () => {
      seed([{ ...placeholder('a', '/notes/a.md'), contentLoaded: true, content: 'in memory' }], 'a');

      mountLoader();
      await Promise.resolve();

      expect(readFile).not.toHaveBeenCalled();
      expect(tabById('a').content).toBe('in memory');
    });
  });

  describe('background preload', () => {
    it('loads the remaining placeholders once the active document is in', async () => {
      readFile.mockImplementation(async (path: string) => `content of ${path}`);
      readBinaryFile.mockResolvedValue([1, 2, 3]);
      seed(
        [
          placeholder('a', '/notes/a.md'),
          placeholder('b', '/notes/b.md'),
          placeholder('c', '/docs/c.pdf', 'pdf'),
        ],
        'a',
      );

      mountLoader();

      await waitFor(() => {
        expect(tabById('b').contentLoaded).toBe(true);
        expect(tabById('c').contentLoaded).toBe(true);
      });
      expect(tabById('a').content).toBe('content of /notes/a.md');
      expect(tabById('b').content).toBe('content of /notes/b.md');
      expect(Array.from(getBinaryData('/docs/c.pdf') ?? [])).toEqual([1, 2, 3]);
      // Each file is read exactly once.
      expect(readFile).toHaveBeenCalledTimes(2);
      expect(readBinaryFile).toHaveBeenCalledTimes(1);
    });

    it('waits for the active document before preloading anything else', async () => {
      const active = deferred<string>();
      readFile.mockImplementation((path: string) =>
        path === '/notes/a.md' ? active.promise : Promise.resolve('background'),
      );
      seed([placeholder('a', '/notes/a.md'), placeholder('b', '/notes/b.md')], 'a');

      mountLoader();
      await Promise.resolve();
      expect(readFile).toHaveBeenCalledTimes(1);
      expect(readFile).toHaveBeenCalledWith('/notes/a.md');

      active.resolve('foreground');
      await waitFor(() => expect(tabById('b').contentLoaded).toBe(true));
      expect(tabById('b').content).toBe('background');
    });

    it('a failed preload sets loadError on that document only and carries on', async () => {
      readFile.mockImplementation(async (path: string) => {
        if (path === '/notes/b.md') throw new Error('Permission denied');
        return `content of ${path}`;
      });
      seed(
        [placeholder('a', '/notes/a.md'), placeholder('b', '/notes/b.md'), placeholder('c', '/notes/c.md')],
        'a',
      );

      mountLoader();

      await waitFor(() => expect(tabById('c').contentLoaded).toBe(true));
      expect(tabById('b').loadError).toBe('Error: Permission denied');
      expect(tabById('b').content).toBe('');
      expect(tabById('a').loadError).toBeUndefined();
      expect(tabById('c').loadError).toBeUndefined();
      expect(tabById('c').content).toBe('content of /notes/c.md');
    });

    it('stops on unmount: an in-flight read is discarded and later documents are never read', async () => {
      const slow = deferred<string>();
      readFile.mockImplementation((path: string) => {
        if (path === '/notes/a.md') return Promise.resolve('active');
        if (path === '/notes/b.md') return slow.promise;
        return Promise.resolve('should never be read');
      });
      seed(
        [placeholder('a', '/notes/a.md'), placeholder('b', '/notes/b.md'), placeholder('c', '/notes/c.md')],
        'a',
      );

      const { unmount } = mountLoader();
      await waitFor(() => expect(readFile).toHaveBeenCalledWith('/notes/b.md'));

      unmount();
      slow.resolve('arrived after unmount');
      await slow.promise;
      await Promise.resolve();
      await Promise.resolve();

      expect(tabById('b').contentLoaded).toBe(false);
      expect(tabById('b').content).toBe('');
      expect(tabById('c').contentLoaded).toBe(false);
      expect(readFile).not.toHaveBeenCalledWith('/notes/c.md');
    });
  });
});
