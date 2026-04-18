import { describe, it, expect, beforeEach } from 'vitest';
import { usePermissionStore } from '../permission-store';

describe('permission-store skill script permissions', () => {
  beforeEach(() => {
    usePermissionStore.setState({
      skillScriptSession: new Set<string>(),
      skillScriptAlways: [],
    });
  });

  describe('isSkillScriptAllowed', () => {
    it('returns none by default', () => {
      expect(usePermissionStore.getState().isSkillScriptAllowed('web-research', null, null)).toBe(
        'none',
      );
    });

    it('returns session when session-allowed', () => {
      usePermissionStore.getState().allowSkillScriptSession('web-research');
      expect(usePermissionStore.getState().isSkillScriptAllowed('web-research', null, null)).toBe(
        'session',
      );
    });

    it('returns always when always-allowed', () => {
      usePermissionStore.getState().allowSkillScriptAlways('web-research', null, null);
      expect(usePermissionStore.getState().isSkillScriptAllowed('web-research', null, null)).toBe(
        'always',
      );
    });

    it('always takes precedence over session', () => {
      usePermissionStore.getState().allowSkillScriptSession('web-research');
      usePermissionStore.getState().allowSkillScriptAlways('web-research', null, null);
      expect(usePermissionStore.getState().isSkillScriptAllowed('web-research', null, null)).toBe(
        'always',
      );
    });
  });

  describe('allowSkillScriptSession', () => {
    it('adds skill to session set', () => {
      usePermissionStore.getState().allowSkillScriptSession('skill-a');
      usePermissionStore.getState().allowSkillScriptSession('skill-b');
      const state = usePermissionStore.getState();
      expect(state.skillScriptSession.has('skill-a')).toBe(true);
      expect(state.skillScriptSession.has('skill-b')).toBe(true);
    });

    it('is idempotent', () => {
      usePermissionStore.getState().allowSkillScriptSession('skill-a');
      usePermissionStore.getState().allowSkillScriptSession('skill-a');
      expect(usePermissionStore.getState().skillScriptSession.size).toBe(1);
    });
  });

  describe('allowSkillScriptAlways', () => {
    it('adds skill to always list', () => {
      usePermissionStore.getState().allowSkillScriptAlways('skill-a', null, null);
      expect(
        usePermissionStore.getState().skillScriptAlways.some((a) => a.toolName === 'skill-a'),
      ).toBe(true);
    });

    it('does not duplicate entries', () => {
      usePermissionStore.getState().allowSkillScriptAlways('skill-a', null, null);
      usePermissionStore.getState().allowSkillScriptAlways('skill-a', null, null);
      expect(
        usePermissionStore
          .getState()
          .skillScriptAlways.filter((a) => a.toolName === 'skill-a'),
      ).toHaveLength(1);
    });
  });

  describe('removeSkillScriptAlways', () => {
    it('removes skill from always list', () => {
      usePermissionStore.getState().allowSkillScriptAlways('skill-a', null, null);
      usePermissionStore.getState().allowSkillScriptAlways('skill-b', null, null);
      usePermissionStore.getState().removeSkillScriptAlways('skill-a', null, null);

      const state = usePermissionStore.getState();
      expect(state.skillScriptAlways.some((a) => a.toolName === 'skill-a')).toBe(false);
      expect(state.skillScriptAlways.some((a) => a.toolName === 'skill-b')).toBe(true);
    });

    it('is safe to call on non-existent skill', () => {
      usePermissionStore.getState().removeSkillScriptAlways('nonexistent', null, null);
      expect(usePermissionStore.getState().skillScriptAlways).toEqual([]);
    });
  });
});
