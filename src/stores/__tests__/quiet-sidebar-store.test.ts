import { describe, it, expect, beforeEach } from 'vitest';
import { useQuietSidebarStore } from '../quiet-sidebar-store';

beforeEach(() => {
  useQuietSidebarStore.setState({
    pendingCreate: null,
    pendingCreateProject: false,
  });
});

describe('quiet-sidebar-store', () => {
  it('defaults to no pending create', () => {
    expect(useQuietSidebarStore.getState().pendingCreate).toBeNull();
  });

  it('setPendingCreate stores a parentDir target', () => {
    useQuietSidebarStore.getState().setPendingCreate({
      parentDir: '/Users/me/Notesage/alpha',
    });
    expect(useQuietSidebarStore.getState().pendingCreate).toEqual({
      parentDir: '/Users/me/Notesage/alpha',
    });
  });

  it('setPendingCreate(null) clears the pending signal', () => {
    useQuietSidebarStore.getState().setPendingCreate({
      parentDir: '/Users/me/Notesage/alpha',
    });
    useQuietSidebarStore.getState().setPendingCreate(null);
    expect(useQuietSidebarStore.getState().pendingCreate).toBeNull();
  });

  it('setPendingCreate replaces an existing pending target', () => {
    useQuietSidebarStore.getState().setPendingCreate({
      parentDir: '/Users/me/Notesage/alpha',
    });
    useQuietSidebarStore.getState().setPendingCreate({
      parentDir: '/Users/me/Notesage/beta',
    });
    expect(useQuietSidebarStore.getState().pendingCreate).toEqual({
      parentDir: '/Users/me/Notesage/beta',
    });
  });
});

// ---------------------------------------------------------------------------
// Task #42 — project-create signal
// ---------------------------------------------------------------------------

describe('quiet-sidebar-store — pendingCreateProject (#42)', () => {
  it('defaults pendingCreateProject to false', () => {
    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(false);
  });

  it('setPendingCreateProject(true) flips the flag', () => {
    useQuietSidebarStore.getState().setPendingCreateProject(true);
    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(true);
  });

  it('setPendingCreateProject(false) clears the flag', () => {
    useQuietSidebarStore.getState().setPendingCreateProject(true);
    useQuietSidebarStore.getState().setPendingCreateProject(false);
    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(false);
  });

  it('pendingCreateProject is independent of pendingCreate', () => {
    useQuietSidebarStore.getState().setPendingCreate({
      parentDir: '/Users/me/Notesage/alpha',
    });
    useQuietSidebarStore.getState().setPendingCreateProject(true);

    expect(useQuietSidebarStore.getState().pendingCreate).toEqual({
      parentDir: '/Users/me/Notesage/alpha',
    });
    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(true);

    // Clearing one does not clear the other.
    useQuietSidebarStore.getState().setPendingCreate(null);
    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(true);
  });
});
