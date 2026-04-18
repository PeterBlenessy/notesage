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
      expect(usePermissionStore.getState().getToolTier('file_read', null, null)).toBe('none');
    });

    it('returns session when session-allowed', () => {
      usePermissionStore.getState().allowSession('file_read');
      expect(usePermissionStore.getState().getToolTier('file_read', null, null)).toBe('session');
    });

    it('returns always when always-allowed', () => {
      usePermissionStore.getState().allowAlways('file_read', null, null);
      expect(usePermissionStore.getState().getToolTier('file_read', null, null)).toBe('always');
    });

    it('always takes precedence over session', () => {
      usePermissionStore.getState().allowSession('file_read');
      usePermissionStore.getState().allowAlways('file_read', null, null);
      expect(usePermissionStore.getState().getToolTier('file_read', null, null)).toBe('always');
    });
  });

  describe('isAutoAllowed', () => {
    it('returns false by default', () => {
      expect(usePermissionStore.getState().isAutoAllowed('file_read', null, null)).toBe(false);
    });

    it('returns true for session-allowed tools', () => {
      usePermissionStore.getState().allowSession('file_read');
      expect(usePermissionStore.getState().isAutoAllowed('file_read', null, null)).toBe(true);
    });

    it('returns true for always-allowed tools', () => {
      usePermissionStore.getState().allowAlways('file_read', null, null);
      expect(usePermissionStore.getState().isAutoAllowed('file_read', null, null)).toBe(true);
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
      expect(usePermissionStore.getState().isAutoAllowed('tool_a', null, null)).toBe(false);
      expect(usePermissionStore.getState().getToolTier('tool_a', null, null)).toBe('none');
    });
  });

  describe('allowAlways / removeAlways', () => {
    it('adds tool to always list', () => {
      usePermissionStore.getState().allowAlways('tool_a', null, null);
      expect(
        usePermissionStore.getState().alwaysAllowed.some((a) => a.toolName === 'tool_a'),
      ).toBe(true);
    });

    it('does not duplicate entries', () => {
      usePermissionStore.getState().allowAlways('tool_a', null, null);
      usePermissionStore.getState().allowAlways('tool_a', null, null);
      expect(
        usePermissionStore
          .getState()
          .alwaysAllowed.filter((a) => a.toolName === 'tool_a'),
      ).toHaveLength(1);
    });

    it('removeAlways revokes access', () => {
      usePermissionStore.getState().allowAlways('tool_a', null, null);
      usePermissionStore.getState().allowAlways('tool_b', null, null);
      usePermissionStore.getState().removeAlways('tool_a', null, null);

      const state = usePermissionStore.getState();
      expect(state.alwaysAllowed.some((a) => a.toolName === 'tool_a')).toBe(false);
      expect(state.alwaysAllowed.some((a) => a.toolName === 'tool_b')).toBe(true);
    });

    it('removeAlways is safe on non-existent tool', () => {
      usePermissionStore.getState().removeAlways('nonexistent', null, null);
      expect(usePermissionStore.getState().alwaysAllowed).toEqual([]);
    });
  });

  describe('ACP vs skill script independence', () => {
    it('ACP permissions do not affect skill script permissions', () => {
      usePermissionStore.getState().allowSession('file_read');
      usePermissionStore.getState().allowAlways('file_write', null, null);
      expect(usePermissionStore.getState().isSkillScriptAllowed('file_read', null, null)).toBe(
        'none',
      );
      expect(usePermissionStore.getState().isSkillScriptAllowed('file_write', null, null)).toBe(
        'none',
      );
    });

    it('skill script permissions do not affect ACP permissions', () => {
      usePermissionStore.getState().allowSkillScriptSession('my-skill');
      usePermissionStore.getState().allowSkillScriptAlways('other-skill', null, null);
      expect(usePermissionStore.getState().getToolTier('my-skill', null, null)).toBe('none');
      expect(usePermissionStore.getState().getToolTier('other-skill', null, null)).toBe('none');
    });
  });

  describe('session permissions are non-persisted', () => {
    it('clearAll resets session permissions but not always', () => {
      usePermissionStore.getState().allowSession('tool_a');
      usePermissionStore.getState().allowAlways('tool_b', null, null);
      usePermissionStore.getState().clearAll();

      const state = usePermissionStore.getState();
      expect(state.sessionAllowed.size).toBe(0);
      expect(state.alwaysAllowed.some((a) => a.toolName === 'tool_b')).toBe(true);
    });
  });
});
