import { describe, it, expect } from 'vitest';
import {
  ProjectLockViolation,
  getProjectLock,
  findLockConflict,
  getUniqueLockedConnectionIds,
  hasLockedProject,
  describeLockTarget,
} from '@/lib/ai/project-lock';
import type { ProjectMetadata } from '@/stores/project-metadata-store';

function makeMeta(overrides: Partial<ProjectMetadata> = {}): ProjectMetadata {
  return {
    version: 1,
    name: 'P',
    description: '',
    ai: { provider: null, agentName: null, projectContext: '' },
    ...overrides,
  };
}

describe('project-lock utilities', () => {
  describe('getProjectLock', () => {
    it('returns null when no metadata exists', () => {
      expect(getProjectLock('/missing', {})).toBeNull();
    });

    it('returns null when metadata has no lock', () => {
      const map = { '/p': makeMeta() };
      expect(getProjectLock('/p', map)).toBeNull();
    });

    it('returns connectionId when a lock is set', () => {
      const map = {
        '/p': makeMeta({ aiLock: { connectionId: 'conn-x', lockedAt: 1 } }),
      };
      expect(getProjectLock('/p', map)).toEqual({ connectionId: 'conn-x' });
    });
  });

  describe('findLockConflict', () => {
    it('returns null when nothing is locked', () => {
      const map = { '/a': makeMeta() };
      expect(findLockConflict(['/a'], map, 'conn-any')).toBeNull();
    });

    it('returns null when the lock matches the current connection', () => {
      const map = {
        '/a': makeMeta({ aiLock: { connectionId: 'conn-x', lockedAt: 1 } }),
      };
      expect(findLockConflict(['/a'], map, 'conn-x')).toBeNull();
    });

    it('returns a conflict when the lock mismatches the current connection', () => {
      const map = {
        '/a': makeMeta({ aiLock: { connectionId: 'conn-x', lockedAt: 1 } }),
      };
      const conflict = findLockConflict(['/a'], map, 'conn-y');
      expect(conflict).toEqual({ projectPath: '/a', lockedConnectionId: 'conn-x' });
    });

    it('returns a conflict when the current connection is null and a lock exists', () => {
      const map = {
        '/a': makeMeta({ aiLock: { connectionId: 'conn-x', lockedAt: 1 } }),
      };
      const conflict = findLockConflict(['/a'], map, null);
      expect(conflict).not.toBeNull();
    });

    it('reports conflict from any locked project in multi-select', () => {
      const map = {
        '/a': makeMeta(),
        '/b': makeMeta({ aiLock: { connectionId: 'conn-x', lockedAt: 1 } }),
      };
      const conflict = findLockConflict(['/a', '/b'], map, 'conn-y');
      expect(conflict?.projectPath).toBe('/b');
    });
  });

  describe('getUniqueLockedConnectionIds', () => {
    it('returns an empty array when nothing is locked', () => {
      expect(getUniqueLockedConnectionIds(['/a'], { '/a': makeMeta() })).toEqual([]);
    });

    it('deduplicates identical locks', () => {
      const map = {
        '/a': makeMeta({ aiLock: { connectionId: 'conn-x', lockedAt: 1 } }),
        '/b': makeMeta({ aiLock: { connectionId: 'conn-x', lockedAt: 2 } }),
      };
      expect(getUniqueLockedConnectionIds(['/a', '/b'], map)).toEqual(['conn-x']);
    });

    it('returns multiple IDs when locks diverge', () => {
      const map = {
        '/a': makeMeta({ aiLock: { connectionId: 'conn-x', lockedAt: 1 } }),
        '/b': makeMeta({ aiLock: { connectionId: 'conn-y', lockedAt: 2 } }),
      };
      expect(getUniqueLockedConnectionIds(['/a', '/b'], map).sort()).toEqual(['conn-x', 'conn-y']);
    });
  });

  describe('hasLockedProject', () => {
    it('is false when no selected project is locked', () => {
      expect(hasLockedProject(['/a'], { '/a': makeMeta() })).toBe(false);
    });

    it('is true when at least one selected project is locked', () => {
      const map = {
        '/a': makeMeta({ aiLock: { connectionId: 'conn-x', lockedAt: 1 } }),
      };
      expect(hasLockedProject(['/a'], map)).toBe(true);
    });
  });

  describe('ProjectLockViolation', () => {
    it('exposes the locked connection and attempted connection', () => {
      const err = new ProjectLockViolation('/p', 'conn-x', 'conn-y');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ProjectLockViolation');
      expect(err.projectPath).toBe('/p');
      expect(err.lockedConnectionId).toBe('conn-x');
      expect(err.attemptedConnectionId).toBe('conn-y');
    });
  });

  describe('describeLockTarget', () => {
    it('uses the label when available', () => {
      expect(describeLockTarget('conn-x', 'Claude Code')).toBe('Claude Code');
    });

    it('falls back to the connection id when no label is present', () => {
      expect(describeLockTarget('conn-x')).toBe('conn-x');
      expect(describeLockTarget('conn-x', '')).toBe('conn-x');
    });
  });
});
