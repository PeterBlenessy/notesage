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

  describe('content-pinned approvals (security audit HIGH #2)', () => {
    it('matches only when the queried hash equals the pinned hash', () => {
      usePermissionStore.getState().allowSkillScriptAlways('web-research', null, null, 'HASH_A');
      // Same body → always.
      expect(
        usePermissionStore.getState().isSkillScriptAllowed('web-research', null, null, 'HASH_A'),
      ).toBe('always');
      // Rewritten body → none (re-prompt).
      expect(
        usePermissionStore.getState().isSkillScriptAllowed('web-research', null, null, 'HASH_B'),
      ).toBe('none');
    });

    it('a pinned grant still satisfies a hash-less (legacy) query', () => {
      usePermissionStore.getState().allowSkillScriptAlways('web-research', null, null, 'HASH_A');
      expect(
        usePermissionStore.getState().isSkillScriptAllowed('web-research', null, null),
      ).toBe('always');
    });

    it('an UNpinned grant does NOT satisfy a hashed query', () => {
      // Legacy/unpinned "allow always" must not auto-approve a content-checked
      // run — that is the exact TOCTOU the fix closes.
      usePermissionStore.getState().allowSkillScriptAlways('web-research', null, null);
      expect(
        usePermissionStore.getState().isSkillScriptAllowed('web-research', null, null, 'HASH_A'),
      ).toBe('none');
    });

    it('re-granting the same scope updates the pinned hash', () => {
      usePermissionStore.getState().allowSkillScriptAlways('web-research', null, null, 'OLD');
      usePermissionStore.getState().allowSkillScriptAlways('web-research', null, null, 'NEW');
      const entries = usePermissionStore
        .getState()
        .skillScriptAlways.filter((a) => a.toolName === 'web-research');
      expect(entries).toHaveLength(1);
      expect(
        usePermissionStore.getState().isSkillScriptAllowed('web-research', null, null, 'NEW'),
      ).toBe('always');
      expect(
        usePermissionStore.getState().isSkillScriptAllowed('web-research', null, null, 'OLD'),
      ).toBe('none');
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
