import { describe, it, expect, beforeEach } from 'vitest';
import { usePermissionStore } from '../permission-store';

describe('permission-store tool call permissions', () => {
  beforeEach(() => {
    usePermissionStore.setState({
      toolCallSession: new Set<string>(),
      toolCallAlways: [],
    });
  });

  describe('isToolAutoAllowed', () => {
    it('returns true for read_file', () => {
      expect(usePermissionStore.getState().isToolAutoAllowed('read_file')).toBe(true);
    });

    it('returns true for read_skill_content', () => {
      expect(usePermissionStore.getState().isToolAutoAllowed('read_skill_content')).toBe(true);
    });

    it('returns false for execute_skill_script', () => {
      expect(usePermissionStore.getState().isToolAutoAllowed('execute_skill_script')).toBe(false);
    });

    it('returns false for write_file', () => {
      expect(usePermissionStore.getState().isToolAutoAllowed('write_file')).toBe(false);
    });
  });

  describe('isToolAllowed', () => {
    it('returns always for auto-allowed tools (read_file)', () => {
      expect(usePermissionStore.getState().isToolAllowed('read_file', null, null)).toBe('always');
    });

    it('returns none for unknown tools initially', () => {
      expect(usePermissionStore.getState().isToolAllowed('write_file', null, null)).toBe('none');
    });

    it('returns session after allowToolSession', () => {
      usePermissionStore.getState().allowToolSession('write_file');
      expect(usePermissionStore.getState().isToolAllowed('write_file', null, null)).toBe('session');
    });

    it('returns always after allowToolAlways', () => {
      usePermissionStore.getState().allowToolAlways('execute_skill_script', null, null);
      expect(
        usePermissionStore.getState().isToolAllowed('execute_skill_script', null, null),
      ).toBe('always');
    });

    it('always takes precedence over session', () => {
      usePermissionStore.getState().allowToolSession('write_file');
      usePermissionStore.getState().allowToolAlways('write_file', null, null);
      expect(usePermissionStore.getState().isToolAllowed('write_file', null, null)).toBe('always');
    });
  });

  describe('allowToolSession', () => {
    it('adds tool to session set', () => {
      usePermissionStore.getState().allowToolSession('tool-a');
      usePermissionStore.getState().allowToolSession('tool-b');
      const state = usePermissionStore.getState();
      expect(state.toolCallSession.has('tool-a')).toBe(true);
      expect(state.toolCallSession.has('tool-b')).toBe(true);
    });

    it('is idempotent', () => {
      usePermissionStore.getState().allowToolSession('tool-a');
      usePermissionStore.getState().allowToolSession('tool-a');
      expect(usePermissionStore.getState().toolCallSession.size).toBe(1);
    });
  });

  describe('allowToolAlways', () => {
    it('adds tool to always list', () => {
      usePermissionStore.getState().allowToolAlways('tool-a', null, null);
      expect(
        usePermissionStore.getState().toolCallAlways.some((a) => a.toolName === 'tool-a'),
      ).toBe(true);
    });

    it('does not duplicate entries', () => {
      usePermissionStore.getState().allowToolAlways('tool-a', null, null);
      usePermissionStore.getState().allowToolAlways('tool-a', null, null);
      expect(
        usePermissionStore.getState().toolCallAlways.filter((a) => a.toolName === 'tool-a'),
      ).toHaveLength(1);
    });
  });

  describe('removeToolAlways', () => {
    it('removes tool from always list', () => {
      usePermissionStore.getState().allowToolAlways('tool-a', null, null);
      usePermissionStore.getState().allowToolAlways('tool-b', null, null);
      usePermissionStore.getState().removeToolAlways('tool-a', null, null);

      const state = usePermissionStore.getState();
      expect(state.toolCallAlways.some((a) => a.toolName === 'tool-a')).toBe(false);
      expect(state.toolCallAlways.some((a) => a.toolName === 'tool-b')).toBe(true);
    });

    it('is safe to call on non-existent tool', () => {
      usePermissionStore.getState().removeToolAlways('nonexistent', null, null);
      expect(usePermissionStore.getState().toolCallAlways).toEqual([]);
    });
  });
});
