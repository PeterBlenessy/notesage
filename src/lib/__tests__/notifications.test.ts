/**
 * Unit tests for external-change toast helpers in `src/lib/notifications.ts`.
 *
 * These helpers wrap sonner's `toast` primitive with the stable ids, duration,
 * and action shape that the external-change flow expects. The test double
 * replaces `sonner` with a `vi.fn` so we can inspect the exact call shape
 * without rendering the toast DOM.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock sonner BEFORE importing the module under test
// ---------------------------------------------------------------------------

const toastMock = Object.assign(vi.fn(), {
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
});

vi.mock('sonner', () => ({ toast: toastMock }));

// Dynamic import happens after the mock is in place.
let toastExternalChange: typeof import('@/lib/notifications').toastExternalChange;
let toastExternalReload: typeof import('@/lib/notifications').toastExternalReload;
let toastExternalRename: typeof import('@/lib/notifications').toastExternalRename;

describe('notifications — external-change helpers', () => {
  beforeEach(async () => {
    toastMock.mockClear();
    toastMock.info.mockClear();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
    toastMock.warning.mockClear();
    toastMock.loading.mockClear();
    toastMock.dismiss.mockClear();

    const mod = await import('@/lib/notifications');
    toastExternalChange = mod.toastExternalChange;
    toastExternalReload = mod.toastExternalReload;
    toastExternalRename = mod.toastExternalRename;
  });

  // ==========================================================================
  // toastExternalChange
  // ==========================================================================

  describe('toastExternalChange', () => {
    it('fires sonner toast with filename-based message and stable id', () => {
      const onAccept = vi.fn();
      const onReject = vi.fn();

      toastExternalChange({
        filePath: '/project/notes/hello.md',
        onAccept,
        onReject,
      });

      expect(toastMock).toHaveBeenCalledTimes(1);
      const [message, opts] = toastMock.mock.calls[0];
      expect(message).toBe('hello.md changed externally');
      expect(opts.id).toBe('external-change:/project/notes/hello.md');
    });

    it('is sticky (duration: Infinity) so it does not auto-dismiss', () => {
      toastExternalChange({
        filePath: '/a.md',
        onAccept: vi.fn(),
        onReject: vi.fn(),
      });

      const [, opts] = toastMock.mock.calls[0];
      expect(opts.duration).toBe(Infinity);
    });

    it('exposes Accept action that invokes onAccept', () => {
      const onAccept = vi.fn();
      const onReject = vi.fn();

      toastExternalChange({ filePath: '/a.md', onAccept, onReject });

      const [, opts] = toastMock.mock.calls[0];
      expect(opts.action.label).toBe('Accept');
      opts.action.onClick();
      expect(onAccept).toHaveBeenCalledTimes(1);
      expect(onReject).not.toHaveBeenCalled();
    });

    it('exposes Reject (cancel) action that invokes onReject', () => {
      const onAccept = vi.fn();
      const onReject = vi.fn();

      toastExternalChange({ filePath: '/a.md', onAccept, onReject });

      const [, opts] = toastMock.mock.calls[0];
      expect(opts.cancel.label).toBe('Reject');
      opts.cancel.onClick();
      expect(onReject).toHaveBeenCalledTimes(1);
      expect(onAccept).not.toHaveBeenCalled();
    });

    it('wires onDismiss through when provided', () => {
      const onDismiss = vi.fn();

      toastExternalChange({
        filePath: '/a.md',
        onAccept: vi.fn(),
        onReject: vi.fn(),
        onDismiss,
      });

      const [, opts] = toastMock.mock.calls[0];
      opts.onDismiss?.();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('tolerates bare filenames without a directory prefix', () => {
      toastExternalChange({
        filePath: 'readme.md',
        onAccept: vi.fn(),
        onReject: vi.fn(),
      });

      const [message] = toastMock.mock.calls[0];
      expect(message).toBe('readme.md changed externally');
    });

    it('repeated calls for the same file reuse the stable id (sonner collapses)', () => {
      toastExternalChange({ filePath: '/a.md', onAccept: vi.fn(), onReject: vi.fn() });
      toastExternalChange({ filePath: '/a.md', onAccept: vi.fn(), onReject: vi.fn() });

      const id1 = toastMock.mock.calls[0][1].id;
      const id2 = toastMock.mock.calls[1][1].id;
      expect(id1).toBe(id2);
    });
  });

  // ==========================================================================
  // toastExternalReload
  // ==========================================================================

  describe('toastExternalReload', () => {
    it('fires info toast with "<name> reloaded from disk"', () => {
      toastExternalReload('/project/notes/hello.md');

      expect(toastMock.info).toHaveBeenCalledTimes(1);
      const [message, opts] = toastMock.info.mock.calls[0];
      expect(message).toBe('hello.md reloaded from disk');
      expect(opts.duration).toBe(3000);
    });

    it('uses a stable id so rapid reloads collapse', () => {
      toastExternalReload('/a.md');
      toastExternalReload('/a.md');

      const id1 = toastMock.info.mock.calls[0][1].id;
      const id2 = toastMock.info.mock.calls[1][1].id;
      expect(id1).toBe(id2);
      expect(id1).toBe('external-change:/a.md');
    });

    it('does not attach Accept/Reject actions (info toast only)', () => {
      toastExternalReload('/a.md');

      const [, opts] = toastMock.info.mock.calls[0];
      expect(opts.action).toBeUndefined();
      expect(opts.cancel).toBeUndefined();
    });

    it('tolerates bare filenames', () => {
      toastExternalReload('readme.md');

      const [message] = toastMock.info.mock.calls[0];
      expect(message).toBe('readme.md reloaded from disk');
    });
  });

  // ==========================================================================
  // toastExternalRename
  // ==========================================================================

  describe('toastExternalRename', () => {
    it('shows info toast when no onSave callback (clean tab)', () => {
      toastExternalRename({ oldPath: '/project/foo.md', newPath: '/project/bar.md' });

      expect(toastMock.info).toHaveBeenCalledTimes(1);
      const [message, opts] = toastMock.info.mock.calls[0];
      expect(message).toContain('foo.md');
      expect(message).toContain('bar.md');
      expect(opts.duration).toBe(3000);
    });

    it('shows sticky toast with Save now action when onSave is provided (dirty tab)', () => {
      const onSave = vi.fn();
      toastExternalRename({ oldPath: '/project/foo.md', newPath: '/project/bar.md', onSave });

      expect(toastMock).toHaveBeenCalledTimes(1);
      expect(toastMock.info).not.toHaveBeenCalled();
      const [, opts] = toastMock.mock.calls[0];
      expect(opts.duration).toBe(Infinity);
      expect(opts.action.label).toBe('Save now');
    });

    it('invoking Save now action calls the onSave callback', () => {
      const onSave = vi.fn();
      toastExternalRename({ oldPath: '/project/foo.md', newPath: '/project/bar.md', onSave });

      const [, opts] = toastMock.mock.calls[0];
      opts.action.onClick();
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('uses a stable id based on the old path', () => {
      toastExternalRename({ oldPath: '/project/foo.md', newPath: '/project/bar.md' });

      const [, opts] = toastMock.info.mock.calls[0];
      expect(opts.id).toBe('external-rename:/project/foo.md');
    });

    it('info toast does not have a Save now action (no unsaved edits)', () => {
      toastExternalRename({ oldPath: '/a.md', newPath: '/b.md' });

      const [, opts] = toastMock.info.mock.calls[0];
      expect(opts.action).toBeUndefined();
    });
  });
});
