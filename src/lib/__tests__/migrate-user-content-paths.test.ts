// @vitest-environment jsdom
/**
 * RED tests for the user-content path migration (issue #172).
 *
 * User research files and PPTX templates were previously stored inside
 * `.notesage/research/` and `.notesage/pptx-templates/` — hidden dot
 * folders that users can't easily find in Finder or share with others.
 *
 * The migration moves them to visible sibling folders:
 *   - `<folder>/.notesage/research/`     → `<folder>/research/`
 *   - `<folder>/.notesage/pptx-templates/` → `<folder>/templates/`
 *   - `~/.notesage/pptx-templates/`      → `~/Notesage/templates/`
 *
 * These tests verify:
 * 1. `tauriApi.migrateUserContentPaths(folder)` is called per folder
 * 2. A success toast is shown when files are actually migrated
 * 3. A warning toast is shown when the destination already has content (collision)
 * 4. Silent no-op when nothing to migrate
 * 5. Best-effort: one failing folder does not prevent others from migrating
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() so the mocks are available when vi.mock factories run.
const { mockMigrateUserContentPaths, mockToast } = vi.hoisted(() => ({
  mockMigrateUserContentPaths: vi.fn(),
  mockToast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    migrateUserContentPaths: mockMigrateUserContentPaths,
  },
}));

vi.mock('sonner', () => ({ toast: mockToast }));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  setLogLevel: vi.fn(),
}));

import { migrateUserContentPathsForFolders } from '@/lib/migrate-user-content-paths';

describe('migrateUserContentPathsForFolders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls migrateUserContentPaths for each folder', async () => {
    mockMigrateUserContentPaths.mockResolvedValue({ migrated: 0, collisions: [] });

    await migrateUserContentPathsForFolders(['/projects/A', '/projects/B']);

    expect(mockMigrateUserContentPaths).toHaveBeenCalledTimes(2);
    expect(mockMigrateUserContentPaths).toHaveBeenCalledWith('/projects/A');
    expect(mockMigrateUserContentPaths).toHaveBeenCalledWith('/projects/B');
  });

  it('shows an info toast when files are migrated in at least one folder', async () => {
    mockMigrateUserContentPaths
      .mockResolvedValueOnce({ migrated: 3, collisions: [] })
      .mockResolvedValueOnce({ migrated: 0, collisions: [] });

    await migrateUserContentPathsForFolders(['/projects/A', '/projects/B']);

    expect(mockToast.info).toHaveBeenCalledWith(
      expect.stringContaining('research'),
      expect.anything(),
    );
  });

  it('shows no toast when nothing was migrated', async () => {
    mockMigrateUserContentPaths.mockResolvedValue({ migrated: 0, collisions: [] });

    await migrateUserContentPathsForFolders(['/projects/A']);

    expect(mockToast.info).not.toHaveBeenCalled();
    expect(mockToast.warning).not.toHaveBeenCalled();
  });

  it('shows a warning toast for each collision folder', async () => {
    mockMigrateUserContentPaths.mockResolvedValue({
      migrated: 0,
      collisions: ['research'],
    });

    await migrateUserContentPathsForFolders(['/projects/A']);

    expect(mockToast.warning).toHaveBeenCalledWith(
      expect.stringContaining('/projects/A'),
      expect.anything(),
    );
  });

  it('is a no-op for an empty folder list', async () => {
    await migrateUserContentPathsForFolders([]);

    expect(mockMigrateUserContentPaths).not.toHaveBeenCalled();
    expect(mockToast.info).not.toHaveBeenCalled();
    expect(mockToast.warning).not.toHaveBeenCalled();
  });

  it('skips folders where migration rejects with an error (best-effort)', async () => {
    mockMigrateUserContentPaths
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce({ migrated: 2, collisions: [] });

    // Should not throw
    await expect(
      migrateUserContentPathsForFolders(['/projects/A', '/projects/B']),
    ).resolves.not.toThrow();

    // B still migrated and toast shown
    expect(mockToast.info).toHaveBeenCalled();
  });
});
