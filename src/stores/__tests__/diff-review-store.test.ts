/**
 * Unit tests for diff-review-store.
 *
 * Covers: startReview, endReview, resolveHunk, getFileDiff, hasUnresolvedHunks.
 *
 * Non-persisted store — no localStorage mocking needed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGitDiffFiles = vi.fn();
const mockGitDiffFile = vi.fn();

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    gitDiffFiles: (...args: unknown[]) => mockGitDiffFiles(...args),
    gitDiffFile: (...args: unknown[]) => mockGitDiffFile(...args),
  },
}));

import { useDiffReviewStore } from '../diff-review-store';
import type { DiffHunk } from '@/lib/tauri';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    old_start: 1,
    old_lines: 3,
    new_start: 1,
    new_lines: 5,
    delete_text: 'old line',
    insert_text: 'new line',
    ...overrides,
  };
}

function resetStore() {
  useDiffReviewStore.setState({
    compareBranch: null,
    baseBranch: null,
    changedFiles: [],
    reviewActive: false,
    isLoading: false,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('diff-review-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  it('has correct initial state', () => {
    const state = useDiffReviewStore.getState();
    expect(state.compareBranch).toBeNull();
    expect(state.baseBranch).toBeNull();
    expect(state.changedFiles).toEqual([]);
    expect(state.reviewActive).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  // -----------------------------------------------------------------------
  // startReview
  // -----------------------------------------------------------------------

  describe('startReview', () => {
    it('fetches files and hunks, sets reviewActive', async () => {
      const hunk1 = makeHunk({ old_start: 1 });
      const hunk2 = makeHunk({ old_start: 10 });

      mockGitDiffFiles.mockResolvedValue(['src/a.ts', 'src/b.ts']);
      mockGitDiffFile
        .mockResolvedValueOnce([hunk1])
        .mockResolvedValueOnce([hunk2]);

      await useDiffReviewStore.getState().startReview('/repo', 'main', 'feature');

      const state = useDiffReviewStore.getState();
      expect(state.reviewActive).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.baseBranch).toBe('main');
      expect(state.compareBranch).toBe('feature');
      expect(state.changedFiles).toHaveLength(2);

      expect(state.changedFiles[0].filePath).toBe('src/a.ts');
      expect(state.changedFiles[0].hunks).toEqual([hunk1]);
      expect(state.changedFiles[0].resolved).toEqual([null]);

      expect(state.changedFiles[1].filePath).toBe('src/b.ts');
      expect(state.changedFiles[1].hunks).toEqual([hunk2]);
      expect(state.changedFiles[1].resolved).toEqual([null]);
    });

    it('passes correct arguments to tauriApi', async () => {
      mockGitDiffFiles.mockResolvedValue([]);

      await useDiffReviewStore.getState().startReview('/my/repo', 'develop', 'hotfix');

      expect(mockGitDiffFiles).toHaveBeenCalledWith('/my/repo', 'develop', 'hotfix');
    });

    it('fetches hunks per file with correct arguments', async () => {
      mockGitDiffFiles.mockResolvedValue(['file1.ts', 'file2.ts']);
      mockGitDiffFile.mockResolvedValue([]);

      await useDiffReviewStore.getState().startReview('/repo', 'main', 'feat');

      expect(mockGitDiffFile).toHaveBeenCalledTimes(2);
      expect(mockGitDiffFile).toHaveBeenCalledWith('/repo', 'main', 'feat', 'file1.ts');
      expect(mockGitDiffFile).toHaveBeenCalledWith('/repo', 'main', 'feat', 'file2.ts');
    });

    it('initializes resolved array with nulls matching hunk count', async () => {
      const hunks = [makeHunk(), makeHunk(), makeHunk()];
      mockGitDiffFiles.mockResolvedValue(['multi.ts']);
      mockGitDiffFile.mockResolvedValue(hunks);

      await useDiffReviewStore.getState().startReview('/repo', 'main', 'branch');

      const fd = useDiffReviewStore.getState().changedFiles[0];
      expect(fd.resolved).toEqual([null, null, null]);
      expect(fd.resolved).toHaveLength(3);
    });

    it('handles empty file list', async () => {
      mockGitDiffFiles.mockResolvedValue([]);

      await useDiffReviewStore.getState().startReview('/repo', 'main', 'branch');

      const state = useDiffReviewStore.getState();
      expect(state.changedFiles).toEqual([]);
      expect(state.reviewActive).toBe(true);
      expect(state.isLoading).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // startReview — error handling
  // -----------------------------------------------------------------------

  describe('startReview error', () => {
    it('sets error and keeps isLoading false on gitDiffFiles failure', async () => {
      mockGitDiffFiles.mockRejectedValue(new Error('git not found'));

      await useDiffReviewStore.getState().startReview('/repo', 'main', 'branch');

      const state = useDiffReviewStore.getState();
      expect(state.error).toBe('Error: git not found');
      expect(state.isLoading).toBe(false);
      expect(state.reviewActive).toBe(false);
      expect(state.changedFiles).toEqual([]);
    });

    it('sets error when gitDiffFile fails', async () => {
      mockGitDiffFiles.mockResolvedValue(['file.ts']);
      mockGitDiffFile.mockRejectedValue('failed to read diff');

      await useDiffReviewStore.getState().startReview('/repo', 'main', 'branch');

      const state = useDiffReviewStore.getState();
      expect(state.error).toBe('failed to read diff');
      expect(state.isLoading).toBe(false);
      expect(state.reviewActive).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // endReview
  // -----------------------------------------------------------------------

  describe('endReview', () => {
    it('resets all state to initial values', async () => {
      mockGitDiffFiles.mockResolvedValue(['file.ts']);
      mockGitDiffFile.mockResolvedValue([makeHunk()]);
      await useDiffReviewStore.getState().startReview('/repo', 'main', 'feat');

      // Confirm review is active
      expect(useDiffReviewStore.getState().reviewActive).toBe(true);

      useDiffReviewStore.getState().endReview();

      const state = useDiffReviewStore.getState();
      expect(state.compareBranch).toBeNull();
      expect(state.baseBranch).toBeNull();
      expect(state.changedFiles).toEqual([]);
      expect(state.reviewActive).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // resolveHunk
  // -----------------------------------------------------------------------

  describe('resolveHunk', () => {
    beforeEach(async () => {
      const hunks = [makeHunk({ old_start: 1 }), makeHunk({ old_start: 10 })];
      mockGitDiffFiles.mockResolvedValue(['src/app.ts']);
      mockGitDiffFile.mockResolvedValue(hunks);
      await useDiffReviewStore.getState().startReview('/repo', 'main', 'feat');
    });

    it('marks a specific hunk as accepted', () => {
      useDiffReviewStore.getState().resolveHunk('src/app.ts', 0, 'accept');

      const fd = useDiffReviewStore.getState().getFileDiff('src/app.ts');
      expect(fd!.resolved[0]).toBe('accept');
      expect(fd!.resolved[1]).toBeNull();
    });

    it('marks a specific hunk as rejected', () => {
      useDiffReviewStore.getState().resolveHunk('src/app.ts', 1, 'reject');

      const fd = useDiffReviewStore.getState().getFileDiff('src/app.ts');
      expect(fd!.resolved[0]).toBeNull();
      expect(fd!.resolved[1]).toBe('reject');
    });

    it('can resolve all hunks in a file', () => {
      useDiffReviewStore.getState().resolveHunk('src/app.ts', 0, 'accept');
      useDiffReviewStore.getState().resolveHunk('src/app.ts', 1, 'reject');

      const fd = useDiffReviewStore.getState().getFileDiff('src/app.ts');
      expect(fd!.resolved).toEqual(['accept', 'reject']);
    });

    it('ignores out-of-bounds hunk index', () => {
      useDiffReviewStore.getState().resolveHunk('src/app.ts', 99, 'accept');

      const fd = useDiffReviewStore.getState().getFileDiff('src/app.ts');
      expect(fd!.resolved).toEqual([null, null]);
    });

    it('ignores negative hunk index', () => {
      useDiffReviewStore.getState().resolveHunk('src/app.ts', -1, 'accept');

      const fd = useDiffReviewStore.getState().getFileDiff('src/app.ts');
      expect(fd!.resolved).toEqual([null, null]);
    });

    it('does not affect other files', async () => {
      // Add a second file
      mockGitDiffFiles.mockResolvedValue(['src/app.ts', 'src/util.ts']);
      mockGitDiffFile.mockResolvedValue([makeHunk()]);
      await useDiffReviewStore.getState().startReview('/repo', 'main', 'feat');

      useDiffReviewStore.getState().resolveHunk('src/app.ts', 0, 'accept');

      const util = useDiffReviewStore.getState().getFileDiff('src/util.ts');
      expect(util!.resolved).toEqual([null]);
    });
  });

  // -----------------------------------------------------------------------
  // getFileDiff
  // -----------------------------------------------------------------------

  describe('getFileDiff', () => {
    it('returns FileDiff for an existing file', async () => {
      mockGitDiffFiles.mockResolvedValue(['src/a.ts']);
      mockGitDiffFile.mockResolvedValue([makeHunk()]);
      await useDiffReviewStore.getState().startReview('/repo', 'main', 'feat');

      const fd = useDiffReviewStore.getState().getFileDiff('src/a.ts');
      expect(fd).not.toBeNull();
      expect(fd!.filePath).toBe('src/a.ts');
    });

    it('returns null for non-existent file', () => {
      const fd = useDiffReviewStore.getState().getFileDiff('nonexistent.ts');
      expect(fd).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // hasUnresolvedHunks
  // -----------------------------------------------------------------------

  describe('hasUnresolvedHunks', () => {
    beforeEach(async () => {
      mockGitDiffFiles.mockResolvedValue(['src/file.ts']);
      mockGitDiffFile.mockResolvedValue([makeHunk(), makeHunk()]);
      await useDiffReviewStore.getState().startReview('/repo', 'main', 'feat');
    });

    it('returns true when file has null entries in resolved array', () => {
      expect(useDiffReviewStore.getState().hasUnresolvedHunks('src/file.ts')).toBe(true);
    });

    it('returns true when some hunks are resolved but not all', () => {
      useDiffReviewStore.getState().resolveHunk('src/file.ts', 0, 'accept');

      expect(useDiffReviewStore.getState().hasUnresolvedHunks('src/file.ts')).toBe(true);
    });

    it('returns false when all hunks are resolved', () => {
      useDiffReviewStore.getState().resolveHunk('src/file.ts', 0, 'accept');
      useDiffReviewStore.getState().resolveHunk('src/file.ts', 1, 'reject');

      expect(useDiffReviewStore.getState().hasUnresolvedHunks('src/file.ts')).toBe(false);
    });

    it('returns false for non-existent file', () => {
      expect(useDiffReviewStore.getState().hasUnresolvedHunks('nonexistent.ts')).toBe(false);
    });
  });
});
