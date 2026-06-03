// @vitest-environment jsdom
//
// Regression coverage for the external-change routing decision (audit tests A2)
// — the exact branch where in-memory edits on a dirty tab can be lost.
//
// useFileWatcher (upstream) decides, based on settings.externalChangeDiffReview,
// WHICH surface receives an external change:
//   - OFF (default): editor-store `externalChanges[path]` → this hook silently
//     auto-reloads from disk (data-loss path for dirty tabs) + info toast.
//   - ON: external-change-store pending entry → this hook shows inline-diff
//     decorations + a sticky Accept/Reject toast.
// These tests lock that routing so a regression flipping the default or
// mis-handling the dirty case is caught.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { useFileWatcherIntegration } from '@/hooks/useFileWatcherIntegration';
import { useExternalChangeStore } from '@/stores/external-change-store';

// ---------------------------------------------------------------------------
// Module mocks — the routing logic is independent of real ProseMirror / diffing.
// ---------------------------------------------------------------------------

vi.mock('@/lib/markdown', () => ({
  loadRawMarkdownIntoEditor: vi.fn(),
  getMarkdownFromEditor: vi.fn(() => 'IN-MEMORY MARKDOWN'),
}));

vi.mock('@/lib/notifications', () => ({
  toastExternalChange: vi.fn(),
  toastExternalReload: vi.fn(),
}));

// Keep computeExternalDiff real (external-change-store.addChange uses it to
// decide whether a change is non-trivial) — only the PM mapping is stubbed.
vi.mock('@/lib/external-diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/external-diff')>();
  return {
    ...actual,
    mapExternalChangeToPM: vi.fn(() => [
      { id: 'h1', from: 1, to: 2, deleteText: 'a', insertText: 'b' },
    ]),
  };
});

vi.mock('@/components/editor/extensions', () => ({
  showInlineDiff: vi.fn(),
  clearInlineDiff: vi.fn(),
  acceptAllDiffHunks: vi.fn(),
  rejectAllDiffHunks: vi.fn(),
  acceptDiffHunk: vi.fn(),
  rejectDiffHunk: vi.fn(),
  getInlineDiffHunks: vi.fn(() => []),
}));

import { loadRawMarkdownIntoEditor } from '@/lib/markdown';
import { toastExternalChange, toastExternalReload } from '@/lib/notifications';
import { showInlineDiff } from '@/components/editor/extensions';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const FILE = '/p/a.md';

function makeEditor(): TiptapEditor {
  return { on: vi.fn(), off: vi.fn() } as unknown as TiptapEditor;
}

function makeTab(overrides: Partial<{ isDirty: boolean }> = {}) {
  return {
    id: 't1',
    filePath: FILE,
    fileName: 'a.md',
    isDirty: overrides.isDirty ?? false,
    content: 'IN-MEMORY MARKDOWN',
  };
}

function renderIntegration(params: {
  externalChanges: Record<string, string>;
  isDirty?: boolean;
}) {
  const updateTabContent = vi.fn();
  const clearExternalChange = vi.fn();
  const saveFile = vi.fn().mockResolvedValue(true);
  const cachedEditorStatesRef = { current: new Map() } as unknown as Parameters<
    typeof useFileWatcherIntegration
  >[0]['cachedEditorStatesRef'];

  const result = renderHook(() =>
    useFileWatcherIntegration({
      editor: makeEditor(),
      activeTab: makeTab({ isDirty: params.isDirty }),
      cachedEditorStatesRef,
      updateTabContent,
      clearExternalChange,
      saveFile,
      externalChanges: params.externalChanges,
    }),
  );
  return { ...result, updateTabContent, clearExternalChange, saveFile, cachedEditorStatesRef };
}

beforeEach(() => {
  vi.clearAllMocks();
  useExternalChangeStore.setState({ changes: {} });
  // Run rAF callbacks synchronously so the inline-diff effect resolves in-test.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

describe('useFileWatcherIntegration — external-change routing (A2)', () => {
  it('OFF path: auto-reloads a DIRTY tab from disk (documented data-loss behavior)', () => {
    const { updateTabContent, clearExternalChange } = renderIntegration({
      externalChanges: { [FILE]: 'DISK CONTENT' },
      isDirty: true,
    });

    // In-memory edits are discarded: the disk content is pushed into the editor
    // and the tab is marked clean. This is the OFF default; users opt into the
    // diff-review path to protect dirty tabs.
    expect(loadRawMarkdownIntoEditor).toHaveBeenCalledWith(expect.anything(), 'DISK CONTENT');
    expect(updateTabContent).toHaveBeenCalledWith('t1', 'DISK CONTENT', false);
    expect(clearExternalChange).toHaveBeenCalledWith(FILE);
    expect(toastExternalReload).toHaveBeenCalledWith(FILE);

    // It must NOT route through the diff-review surface.
    expect(toastExternalChange).not.toHaveBeenCalled();
    expect(showInlineDiff).not.toHaveBeenCalled();
  });

  it('OFF path: auto-reloads a CLEAN tab too', () => {
    const { updateTabContent } = renderIntegration({
      externalChanges: { [FILE]: 'DISK CONTENT' },
      isDirty: false,
    });

    expect(updateTabContent).toHaveBeenCalledWith('t1', 'DISK CONTENT', false);
    expect(toastExternalReload).toHaveBeenCalledWith(FILE);
    expect(toastExternalChange).not.toHaveBeenCalled();
  });

  it('ON path: a pending external-change-store entry shows inline diff + sticky toast', () => {
    // Seed the diff-review store (the surface the ON setting populates).
    useExternalChangeStore.getState().addChange(FILE, 'a.md', 'OLD', 'NEW DISK CONTENT');

    renderIntegration({ externalChanges: {} /* OFF surface empty */, isDirty: true });

    expect(showInlineDiff).toHaveBeenCalled();
    expect(toastExternalChange).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: FILE }),
    );

    // It must NOT silently auto-reload (which would drop the in-memory edits).
    expect(toastExternalReload).not.toHaveBeenCalled();
    expect(loadRawMarkdownIntoEditor).not.toHaveBeenCalled();

    // The change is parked as 'deferred' (decorations visible, no re-fire).
    expect(useExternalChangeStore.getState().getChange(FILE)?.status).toBe('deferred');
  });

  it('no external change on either surface: no reload, no diff', () => {
    renderIntegration({ externalChanges: {}, isDirty: true });
    expect(loadRawMarkdownIntoEditor).not.toHaveBeenCalled();
    expect(toastExternalReload).not.toHaveBeenCalled();
    expect(toastExternalChange).not.toHaveBeenCalled();
    expect(showInlineDiff).not.toHaveBeenCalled();
  });

  it('exposes the change list + handlers for the popover', () => {
    const { result } = renderIntegration({ externalChanges: {} });
    expect(result.current).toMatchObject({
      changeListOpen: false,
      handleExternalAcceptAll: expect.any(Function),
      handleExternalRejectAll: expect.any(Function),
      handleExternalAcceptHunk: expect.any(Function),
      handleExternalRejectHunk: expect.any(Function),
    });
    expect(Array.isArray(result.current.externalChangesAll)).toBe(true);
  });
});
