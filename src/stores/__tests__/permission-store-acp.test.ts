import { describe, it, expect, beforeEach } from 'vitest';
import { usePermissionStore } from '../permission-store';

describe('permission-store ACP tool permissions', () => {
  beforeEach(() => {
    usePermissionStore.setState({
      sessionAllowed: new Set<string>(),
      alwaysAllowed: [],
      // Reset skill permissions too so tests are independent
      skillScriptSession: new Set<string>(),
      skillScriptAlways: [],
    });
  });

  describe('getToolTier', () => {
    it('returns none by default', () => {
      expect(usePermissionStore.getState().getToolTier('file_read')).toBe('none');
    });

    it('returns session when session-allowed', () => {
      usePermissionStore.getState().allowSession('file_read');
      expect(usePermissionStore.getState().getToolTier('file_read')).toBe('session');
    });

    it('returns always when always-allowed', () => {
      usePermissionStore.getState().allowAlways('file_read');
      expect(usePermissionStore.getState().getToolTier('file_read')).toBe('always');
    });

    it('always takes precedence over session', () => {
      usePermissionStore.getState().allowSession('file_read');
      usePermissionStore.getState().allowAlways('file_read');
      expect(usePermissionStore.getState().getToolTier('file_read')).toBe('always');
    });
  });

  describe('isAutoAllowed', () => {
    it('returns false by default', () => {
      expect(usePermissionStore.getState().isAutoAllowed('file_read')).toBe(false);
    });

    it('returns true for session-allowed tools', () => {
      usePermissionStore.getState().allowSession('file_read');
      expect(usePermissionStore.getState().isAutoAllowed('file_read')).toBe(true);
    });

    it('returns true for always-allowed tools', () => {
      usePermissionStore.getState().allowAlways('file_read');
      expect(usePermissionStore.getState().isAutoAllowed('file_read')).toBe(true);
    });
  });

  describe('allowSession / removeSession', () => {
    it('adds tool to session set', () => {
      usePermissionStore.getState().allowSession('tool_a');
      usePermissionStore.getState().allowSession('tool_b');
      const state = usePermissionStore.getState();
      expect(state.sessionAllowed.has('tool_a')).toBe(true);
      expect(state.sessionAllowed.has('tool_b')).toBe(true);
    });

    it('is idempotent', () => {
      usePermissionStore.getState().allowSession('tool_a');
      usePermissionStore.getState().allowSession('tool_a');
      expect(usePermissionStore.getState().sessionAllowed.size).toBe(1);
    });

    it('removeSession revokes access', () => {
      usePermissionStore.getState().allowSession('tool_a');
      usePermissionStore.getState().removeSession('tool_a');
      expect(usePermissionStore.getState().isAutoAllowed('tool_a')).toBe(false);
      expect(usePermissionStore.getState().getToolTier('tool_a')).toBe('none');
    });
  });

  describe('allowAlways / removeAlways', () => {
    it('adds tool to always list', () => {
      usePermissionStore.getState().allowAlways('tool_a');
      expect(usePermissionStore.getState().alwaysAllowed).toContain('tool_a');
    });

    it('does not duplicate entries', () => {
      usePermissionStore.getState().allowAlways('tool_a');
      usePermissionStore.getState().allowAlways('tool_a');
      expect(usePermissionStore.getState().alwaysAllowed.filter(t => t === 'tool_a')).toHaveLength(1);
    });

    it('removeAlways revokes access', () => {
      usePermissionStore.getState().allowAlways('tool_a');
      usePermissionStore.getState().allowAlways('tool_b');
      usePermissionStore.getState().removeAlways('tool_a');

      const state = usePermissionStore.getState();
      expect(state.alwaysAllowed).not.toContain('tool_a');
      expect(state.alwaysAllowed).toContain('tool_b');
    });

    it('removeAlways is safe on non-existent tool', () => {
      usePermissionStore.getState().removeAlways('nonexistent');
      expect(usePermissionStore.getState().alwaysAllowed).toEqual([]);
    });
  });

  describe('ACP vs skill script independence', () => {
    it('ACP permissions do not affect skill script permissions', () => {
      usePermissionStore.getState().allowSession('file_read');
      usePermissionStore.getState().allowAlways('file_write');
      expect(usePermissionStore.getState().isSkillScriptAllowed('file_read')).toBe('none');
      expect(usePermissionStore.getState().isSkillScriptAllowed('file_write')).toBe('none');
    });

    it('skill script permissions do not affect ACP permissions', () => {
      usePermissionStore.getState().allowSkillScriptSession('my-skill');
      usePermissionStore.getState().allowSkillScriptAlways('other-skill');
      expect(usePermissionStore.getState().getToolTier('my-skill')).toBe('none');
      expect(usePermissionStore.getState().getToolTier('other-skill')).toBe('none');
    });
  });

  describe('session permissions are non-persisted', () => {
    it('clearAll resets session permissions but not always', () => {
      usePermissionStore.getState().allowSession('tool_a');
      usePermissionStore.getState().allowAlways('tool_b');
      usePermissionStore.getState().clearAll();

      const state = usePermissionStore.getState();
      expect(state.sessionAllowed.size).toBe(0);
      expect(state.alwaysAllowed).toContain('tool_b');
    });
  });
});
