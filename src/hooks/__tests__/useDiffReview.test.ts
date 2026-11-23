// @vitest-environment jsdom
/**
 * useDiffReview — which open document a branch diff is drawn on and saved to.
 * The diff store holds repo-relative paths, tabs hold absolute ones; a wrong
 * match draws hunks on, and "Accept all" saves, a document the diff is not for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import type { Editor } from '@tiptap/core';

const mocks = vi.hoisted(() => ({
  saveFile: vi.fn<(filePath: string, content: string, tabId?: string) => Promise<void>>(),
  showInlineDiff: vi.fn(),
  clearInlineDiff: vi.fn(),
}));

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({ saveFile: mocks.saveFile }),
}));

vi.mock('@/components/editor/extensions', () => ({
  showInlineDiff: mocks.showInlineDiff,
  clearInlineDiff: mocks.clearInlineDiff,
}));

vi.mock('@/lib/pm-line-map', () => ({
  buildLineMap: () => new Map([[1, { pmFrom: 1, pmTo: 6 }]]),
  getPositionRangeForLines: () => ({ pmFrom: 1, pmTo: 6 }),
}));

vi.mock('@/lib/markdown', () => ({
  getMarkdownFromEditor: () => 'ACCEPTED MARKDOWN',
}));

import { useDiffReview } from '@/hooks/useDiffReview';
import { useDiffReviewStore, type FileDiff } from '@/stores/diff-review-store';
import { useEditorStore } from '@/stores/editor-store';

const editor = { state: { doc: { content: { size: 20 } } } } as unknown as Editor;

function fileDiff(filePath: string, hunkCount = 2): FileDiff {
  const hunks = Array.from({ length: hunkCount }, (_, i) => ({
    old_start: 1 + i,
    old_lines: 1,
    new_start: 1 + i,
    new_lines: 1,
    delete_text: `old ${i}`,
    insert_text: `new ${i}`,
  }));
  return { filePath, hunks, resolved: hunks.map(() => null) };
}

function startReview(...files: FileDiff[]) {
  useDiffReviewStore.setState({
    reviewActive: true,
    compareBranch: 'feature',
    baseBranch: 'main',
    changedFiles: files,
  });
}

function openTab(filePath: string) {
  useEditorStore.setState({
    openDocuments: [{
      id: 'tab-1',
      filePath,
      fileName: filePath.split('/').pop() ?? '',
      isDirty: false,
      content: 'original',
      frontmatter: null,
      fileType: 'markdown' as const,
      contentLoaded: true,
    }],
    activeTabId: 'tab-1',
  });
}

function resolved(filePath: string) {
  return useDiffReviewStore.getState().getFileDiff(filePath)?.resolved;
}

describe('useDiffReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveFile.mockResolvedValue(undefined);
    useDiffReviewStore.getState().endReview();
    useEditorStore.setState({ openDocuments: [], activeTabId: null });
  });

  describe('which file the diff belongs to', () => {
    it('draws the hunks of the changed file that is open', () => {
      startReview(fileDiff('notes/a.md'));
      openTab('/repo/notes/a.md');

      renderHook(() => useDiffReview(editor));

      expect(mocks.showInlineDiff).toHaveBeenCalledTimes(1);
      expect(mocks.showInlineDiff.mock.calls[0][1]).toHaveLength(2);
    });

    it('draws nothing on a file whose name merely ends with the changed path', () => {
      // `a.md` changed; `/repo/notes/data.md` ends with "a.md" but is another file.
      startReview(fileDiff('a.md'));
      openTab('/repo/notes/data.md');

      renderHook(() => useDiffReview(editor));

      expect(mocks.showInlineDiff).not.toHaveBeenCalled();
    });

    it('draws nothing when a directory name merely ends with the changed directory', () => {
      startReview(fileDiff('notes/a.md'));
      openTab('/repo/oldnotes/a.md');

      renderHook(() => useDiffReview(editor));

      expect(mocks.showInlineDiff).not.toHaveBeenCalled();
    });

    it('picks the most specific changed file when two of them match', () => {
      startReview(fileDiff('a.md', 1), fileDiff('notes/a.md', 3));
      openTab('/repo/notes/a.md');

      renderHook(() => useDiffReview(editor));

      expect(mocks.showInlineDiff.mock.calls[0][1]).toHaveLength(3);
    });

    it('accept all on a lookalike file saves nothing and resolves nothing', async () => {
      startReview(fileDiff('a.md'));
      openTab('/repo/notes/data.md');
      const { result } = renderHook(() => useDiffReview(editor));

      await act(async () => { await result.current.handleAcceptAll(); });

      expect(mocks.saveFile).not.toHaveBeenCalled();
      expect(resolved('a.md')).toEqual([null, null]);
      expect(useEditorStore.getState().openDocuments[0].content).toBe('original');
    });

    it('accepting a single hunk on a lookalike file saves nothing', async () => {
      startReview(fileDiff('a.md'));
      openTab('/repo/notes/data.md');
      const { result } = renderHook(() => useDiffReview(editor));

      await act(async () => { await result.current.handleHunkAccepted('hunk-0'); });

      expect(mocks.saveFile).not.toHaveBeenCalled();
      expect(resolved('a.md')).toEqual([null, null]);
    });
  });

  describe('accept and reject', () => {
    it('accept all saves the active file only, once, and marks its hunks accepted', async () => {
      startReview(fileDiff('notes/a.md'), fileDiff('notes/b.md'));
      openTab('/repo/notes/a.md');
      const { result } = renderHook(() => useDiffReview(editor));

      await act(async () => { await result.current.handleAcceptAll(); });

      expect(mocks.saveFile.mock.calls).toEqual([['/repo/notes/a.md', 'ACCEPTED MARKDOWN', 'tab-1']]);
      expect(resolved('notes/a.md')).toEqual(['accept', 'accept']);
      expect(resolved('notes/b.md')).toEqual([null, null]);
    });

    it('reject all marks the hunks rejected and does not save', () => {
      startReview(fileDiff('notes/a.md'));
      openTab('/repo/notes/a.md');
      const { result } = renderHook(() => useDiffReview(editor));

      act(() => { result.current.handleRejectAll(); });

      expect(mocks.saveFile).not.toHaveBeenCalled();
      expect(resolved('notes/a.md')).toEqual(['reject', 'reject']);
      expect(useEditorStore.getState().openDocuments[0].content).toBe('original');
    });

    it('accepting one hunk resolves that hunk and saves; rejecting one does not save', async () => {
      startReview(fileDiff('notes/a.md'));
      openTab('/repo/notes/a.md');
      const { result } = renderHook(() => useDiffReview(editor));

      act(() => { result.current.handleHunkRejected('hunk-1'); });
      expect(mocks.saveFile).not.toHaveBeenCalled();

      await act(async () => { await result.current.handleHunkAccepted('hunk-0'); });

      expect(resolved('notes/a.md')).toEqual(['accept', 'reject']);
      expect(mocks.saveFile).toHaveBeenCalledTimes(1);
    });
  });

  it('clears the decorations when the review ends', () => {
    startReview(fileDiff('notes/a.md'));
    openTab('/repo/notes/a.md');
    renderHook(() => useDiffReview(editor));
    mocks.clearInlineDiff.mockClear();

    act(() => { useDiffReviewStore.getState().endReview(); });

    expect(mocks.clearInlineDiff).toHaveBeenCalled();
  });
});
