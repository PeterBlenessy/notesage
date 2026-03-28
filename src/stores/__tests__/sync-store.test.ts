/**
 * Unit tests for sync-store.
 *
 * Covers: initial state defaults, loadSettings (success, null, error),
 * saveSettings, simple setters (icloudEnabled, syncQuickNotes),
 * addSyncedProject (including dedup), removeSyncedProject,
 * setMigrating / isMigrating, isProjectSynced, setSyncedProjectPaths,
 * updateProjectPath.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    readSyncSettings: vi.fn(),
    writeSyncSettings: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import store + mocked tauriApi after mocks are in place
// ---------------------------------------------------------------------------

import { useSyncStore } from '../sync-store';
import { tauriApi } from '@/lib/tauri';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const initialState = () => ({
  icloudEnabled: false,
  syncQuickNotes: true,
  syncedProjectPaths: [],
  migrating: null,
  loaded: false,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sync-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSyncStore.setState(initialState());
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  describe('initial state', () => {
    it('has correct defaults', () => {
      const state = useSyncStore.getState();
      expect(state.icloudEnabled).toBe(false);
      expect(state.syncQuickNotes).toBe(true);
      expect(state.syncedProjectPaths).toEqual([]);
      expect(state.migrating).toBeNull();
      expect(state.loaded).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // loadSettings
  // -----------------------------------------------------------------------

  describe('loadSettings', () => {
    it('reads from Tauri and updates state', async () => {
      vi.mocked(tauriApi.readSyncSettings).mockResolvedValue({
        version: 1,
        icloudEnabled: true,
        syncQuickNotes: false,
        syncedProjects: ['/path/a', '/path/b'],
      });

      await useSyncStore.getState().loadSettings('/home/.notesage');

      const state = useSyncStore.getState();
      expect(tauriApi.readSyncSettings).toHaveBeenCalledWith('/home/.notesage');
      expect(state.icloudEnabled).toBe(true);
      expect(state.syncQuickNotes).toBe(false);
      expect(state.syncedProjectPaths).toEqual(['/path/a', '/path/b']);
      expect(state.loaded).toBe(true);
    });

    it('sets loaded: true when readSyncSettings returns null', async () => {
      vi.mocked(tauriApi.readSyncSettings).mockResolvedValue(null);

      await useSyncStore.getState().loadSettings('/home/.notesage');

      const state = useSyncStore.getState();
      expect(state.icloudEnabled).toBe(false); // unchanged
      expect(state.syncQuickNotes).toBe(true); // unchanged
      expect(state.syncedProjectPaths).toEqual([]); // unchanged
      expect(state.loaded).toBe(true);
    });

    it('logs error and sets loaded: true on failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(tauriApi.readSyncSettings).mockRejectedValue(new Error('disk error'));

      await useSyncStore.getState().loadSettings('/home/.notesage');

      const state = useSyncStore.getState();
      expect(state.loaded).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load sync settings');
      consoleSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // saveSettings
  // -----------------------------------------------------------------------

  describe('saveSettings', () => {
    it('writes current state to Tauri', async () => {
      useSyncStore.setState({
        icloudEnabled: true,
        syncQuickNotes: false,
        syncedProjectPaths: ['/project/one'],
      });
      vi.mocked(tauriApi.writeSyncSettings).mockResolvedValue(undefined);

      await useSyncStore.getState().saveSettings('/home/.notesage');

      expect(tauriApi.writeSyncSettings).toHaveBeenCalledWith('/home/.notesage', {
        version: 1,
        icloudEnabled: true,
        syncQuickNotes: false,
        syncedProjects: ['/project/one'],
      });
    });

    it('logs error on failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(tauriApi.writeSyncSettings).mockRejectedValue(new Error('write failed'));

      await useSyncStore.getState().saveSettings('/home/.notesage');

      expect(consoleSpy).toHaveBeenCalledWith('Failed to save sync settings');
      consoleSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // Simple setters
  // -----------------------------------------------------------------------

  describe('setICloudEnabled', () => {
    it('updates icloudEnabled', () => {
      useSyncStore.getState().setICloudEnabled(true);
      expect(useSyncStore.getState().icloudEnabled).toBe(true);

      useSyncStore.getState().setICloudEnabled(false);
      expect(useSyncStore.getState().icloudEnabled).toBe(false);
    });
  });

  describe('setSyncQuickNotes', () => {
    it('updates syncQuickNotes', () => {
      useSyncStore.getState().setSyncQuickNotes(false);
      expect(useSyncStore.getState().syncQuickNotes).toBe(false);

      useSyncStore.getState().setSyncQuickNotes(true);
      expect(useSyncStore.getState().syncQuickNotes).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // addSyncedProject
  // -----------------------------------------------------------------------

  describe('addSyncedProject', () => {
    it('adds a project path to the list', () => {
      useSyncStore.getState().addSyncedProject('/project/alpha');
      expect(useSyncStore.getState().syncedProjectPaths).toEqual(['/project/alpha']);
    });

    it('appends to existing paths', () => {
      useSyncStore.setState({ syncedProjectPaths: ['/project/alpha'] });
      useSyncStore.getState().addSyncedProject('/project/beta');
      expect(useSyncStore.getState().syncedProjectPaths).toEqual(['/project/alpha', '/project/beta']);
    });

    it('deduplicates — does not add an already-present path', () => {
      useSyncStore.setState({ syncedProjectPaths: ['/project/alpha'] });
      useSyncStore.getState().addSyncedProject('/project/alpha');
      expect(useSyncStore.getState().syncedProjectPaths).toEqual(['/project/alpha']);
    });
  });

  // -----------------------------------------------------------------------
  // removeSyncedProject
  // -----------------------------------------------------------------------

  describe('removeSyncedProject', () => {
    it('removes a project path from the list', () => {
      useSyncStore.setState({ syncedProjectPaths: ['/project/alpha', '/project/beta'] });
      useSyncStore.getState().removeSyncedProject('/project/alpha');
      expect(useSyncStore.getState().syncedProjectPaths).toEqual(['/project/beta']);
    });

    it('no-ops when path is not in the list', () => {
      useSyncStore.setState({ syncedProjectPaths: ['/project/alpha'] });
      useSyncStore.getState().removeSyncedProject('/project/nope');
      expect(useSyncStore.getState().syncedProjectPaths).toEqual(['/project/alpha']);
    });
  });

  // -----------------------------------------------------------------------
  // setMigrating / isMigrating
  // -----------------------------------------------------------------------

  describe('setMigrating / isMigrating', () => {
    it('tracks the currently migrating path', () => {
      expect(useSyncStore.getState().isMigrating()).toBe(false);

      useSyncStore.getState().setMigrating('/project/alpha');
      expect(useSyncStore.getState().migrating).toBe('/project/alpha');
      expect(useSyncStore.getState().isMigrating()).toBe(true);

      useSyncStore.getState().setMigrating(null);
      expect(useSyncStore.getState().migrating).toBeNull();
      expect(useSyncStore.getState().isMigrating()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // isProjectSynced
  // -----------------------------------------------------------------------

  describe('isProjectSynced', () => {
    it('returns true for synced paths', () => {
      useSyncStore.setState({ syncedProjectPaths: ['/project/alpha', '/project/beta'] });
      expect(useSyncStore.getState().isProjectSynced('/project/alpha')).toBe(true);
      expect(useSyncStore.getState().isProjectSynced('/project/beta')).toBe(true);
    });

    it('returns false for non-synced paths', () => {
      useSyncStore.setState({ syncedProjectPaths: ['/project/alpha'] });
      expect(useSyncStore.getState().isProjectSynced('/project/nope')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // setSyncedProjectPaths
  // -----------------------------------------------------------------------

  describe('setSyncedProjectPaths', () => {
    it('replaces the entire paths list', () => {
      useSyncStore.setState({ syncedProjectPaths: ['/old'] });
      useSyncStore.getState().setSyncedProjectPaths(['/new/a', '/new/b']);
      expect(useSyncStore.getState().syncedProjectPaths).toEqual(['/new/a', '/new/b']);
    });

    it('can set to empty array', () => {
      useSyncStore.setState({ syncedProjectPaths: ['/old'] });
      useSyncStore.getState().setSyncedProjectPaths([]);
      expect(useSyncStore.getState().syncedProjectPaths).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // updateProjectPath
  // -----------------------------------------------------------------------

  describe('updateProjectPath', () => {
    it('replaces old path with new path', () => {
      useSyncStore.setState({ syncedProjectPaths: ['/old/path', '/other'] });
      useSyncStore.getState().updateProjectPath('/old/path', '/new/path');
      expect(useSyncStore.getState().syncedProjectPaths).toEqual(['/new/path', '/other']);
    });

    it('leaves list unchanged when old path is not found', () => {
      useSyncStore.setState({ syncedProjectPaths: ['/a', '/b'] });
      useSyncStore.getState().updateProjectPath('/nope', '/new');
      expect(useSyncStore.getState().syncedProjectPaths).toEqual(['/a', '/b']);
    });

    it('preserves order of other paths', () => {
      useSyncStore.setState({ syncedProjectPaths: ['/x', '/y', '/z'] });
      useSyncStore.getState().updateProjectPath('/y', '/Y');
      expect(useSyncStore.getState().syncedProjectPaths).toEqual(['/x', '/Y', '/z']);
    });
  });
});
