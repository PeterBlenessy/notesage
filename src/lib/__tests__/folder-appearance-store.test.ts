// @vitest-environment node

/**
 * Unit tests for folder-appearance-store (issue #140).
 *
 * The global path-keyed registry stores custom icon + color for
 * external/explorer folders (Notesage project folders use project.json
 * instead). Tests cover the read/write paths and the reset path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import {
  useFolderAppearanceStore,
  type FolderAppearance,
} from '../../stores/folder-appearance-store';

beforeEach(() => {
  useFolderAppearanceStore.getState().reset();
});

describe('useFolderAppearanceStore', () => {
  describe('setAppearance', () => {
    it('stores an appearance entry by path', () => {
      const appearance: FolderAppearance = { iconName: 'Star', colorIndex: 2 };
      useFolderAppearanceStore.getState().setAppearance('/some/folder', appearance);

      expect(useFolderAppearanceStore.getState().registry['/some/folder']).toEqual(appearance);
    });

    it('stores entries for multiple different paths independently', () => {
      useFolderAppearanceStore.getState().setAppearance('/folder/a', { iconName: 'Star', colorIndex: 1 });
      useFolderAppearanceStore.getState().setAppearance('/folder/b', { iconName: 'Heart', colorIndex: 3 });

      const reg = useFolderAppearanceStore.getState().registry;
      expect(reg['/folder/a']).toEqual({ iconName: 'Star', colorIndex: 1 });
      expect(reg['/folder/b']).toEqual({ iconName: 'Heart', colorIndex: 3 });
    });

    it('overwrites an existing appearance for the same path', () => {
      useFolderAppearanceStore.getState().setAppearance('/folder', { iconName: 'Star', colorIndex: 0 });
      useFolderAppearanceStore.getState().setAppearance('/folder', { iconName: 'Moon', colorIndex: 7 });

      expect(useFolderAppearanceStore.getState().registry['/folder']).toEqual({ iconName: 'Moon', colorIndex: 7 });
    });

    it('supports appearance with only iconName set (colorIndex can be null)', () => {
      const appearance: FolderAppearance = { iconName: 'Briefcase', colorIndex: null };
      useFolderAppearanceStore.getState().setAppearance('/folder', appearance);

      expect(useFolderAppearanceStore.getState().registry['/folder']?.iconName).toBe('Briefcase');
      expect(useFolderAppearanceStore.getState().registry['/folder']?.colorIndex).toBeNull();
    });

    it('supports appearance with only colorIndex set (iconName can be null)', () => {
      const appearance: FolderAppearance = { iconName: null, colorIndex: 5 };
      useFolderAppearanceStore.getState().setAppearance('/folder', appearance);

      expect(useFolderAppearanceStore.getState().registry['/folder']?.iconName).toBeNull();
      expect(useFolderAppearanceStore.getState().registry['/folder']?.colorIndex).toBe(5);
    });
  });

  describe('clearAppearance', () => {
    it('removes the appearance entry for a path', () => {
      useFolderAppearanceStore.getState().setAppearance('/folder', { iconName: 'Star', colorIndex: 1 });
      useFolderAppearanceStore.getState().clearAppearance('/folder');

      expect(useFolderAppearanceStore.getState().registry['/folder']).toBeUndefined();
    });

    it('is a no-op for a path with no stored appearance', () => {
      // Should not throw
      expect(() => {
        useFolderAppearanceStore.getState().clearAppearance('/no/such/folder');
      }).not.toThrow();
    });

    it('does not affect other paths', () => {
      useFolderAppearanceStore.getState().setAppearance('/folder/a', { iconName: 'Star', colorIndex: 1 });
      useFolderAppearanceStore.getState().setAppearance('/folder/b', { iconName: 'Moon', colorIndex: 2 });
      useFolderAppearanceStore.getState().clearAppearance('/folder/a');

      expect(useFolderAppearanceStore.getState().registry['/folder/a']).toBeUndefined();
      expect(useFolderAppearanceStore.getState().registry['/folder/b']).toBeDefined();
    });
  });

  describe('getAppearance', () => {
    it('returns the stored appearance for a known path', () => {
      const appearance: FolderAppearance = { iconName: 'Zap', colorIndex: 4 };
      useFolderAppearanceStore.getState().setAppearance('/folder', appearance);

      expect(useFolderAppearanceStore.getState().getAppearance('/folder')).toEqual(appearance);
    });

    it('returns undefined for a path with no stored appearance', () => {
      expect(useFolderAppearanceStore.getState().getAppearance('/no/such/folder')).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('clears all stored entries', () => {
      useFolderAppearanceStore.getState().setAppearance('/folder/a', { iconName: 'Star', colorIndex: 1 });
      useFolderAppearanceStore.getState().setAppearance('/folder/b', { iconName: 'Moon', colorIndex: 2 });
      useFolderAppearanceStore.getState().reset();

      expect(useFolderAppearanceStore.getState().registry).toEqual({});
    });
  });
});
