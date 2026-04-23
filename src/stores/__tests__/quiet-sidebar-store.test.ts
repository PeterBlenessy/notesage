import { describe, it, expect, beforeEach } from 'vitest';
import { useQuietSidebarStore } from '../quiet-sidebar-store';

beforeEach(() => {
  useQuietSidebarStore.setState({ pendingCreate: null });
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
