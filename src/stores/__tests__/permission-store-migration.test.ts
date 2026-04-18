import { describe, it, expect } from 'vitest';
import { _migrateLegacyState } from '../permission-store';
import type { PermissionRequest } from '../permission-store';

interface LegacyShape {
  alwaysAllowed?: string[];
  skillScriptAlways?: string[];
  toolCallAlways?: string[];
  domainAlwaysAllowed?: Record<string, string[]>;
}

describe('permission-store v1 → v2 persist migration', () => {
  it('migrates flat alwaysAllowed[] into the legacy (null, null) bucket', () => {
    const old: LegacyShape = { alwaysAllowed: ['tool_a', 'tool_b'] };
    const next = _migrateLegacyState(old, 0);

    expect(next.alwaysAllowed).toHaveLength(2);
    const a = next.alwaysAllowed.find((e) => e.toolName === 'tool_a');
    const b = next.alwaysAllowed.find((e) => e.toolName === 'tool_b');
    expect(a).toBeDefined();
    expect(a!.connectionId).toBeNull();
    expect(a!.projectRoot).toBeNull();
    expect(a!.grantedAt).toBeTypeOf('number');
    expect(b).toBeDefined();
    expect(b!.connectionId).toBeNull();
    expect(b!.projectRoot).toBeNull();
  });

  it('migrates flat skillScriptAlways[] into the legacy bucket', () => {
    const old: LegacyShape = { skillScriptAlways: ['web-research', 'download'] };
    const next = _migrateLegacyState(old, 0);

    expect(next.skillScriptAlways).toHaveLength(2);
    expect(
      next.skillScriptAlways.every((e) => e.connectionId === null && e.projectRoot === null),
    ).toBe(true);
  });

  it('migrates flat toolCallAlways[] into the legacy bucket', () => {
    const old: LegacyShape = { toolCallAlways: ['write_file', 'execute_skill_script'] };
    const next = _migrateLegacyState(old, 0);

    expect(next.toolCallAlways).toHaveLength(2);
    expect(
      next.toolCallAlways.every((e) => e.connectionId === null && e.projectRoot === null),
    ).toBe(true);
  });

  it('migrates flat domainAlwaysAllowed map into the global bucket per connection', () => {
    const old: LegacyShape = {
      domainAlwaysAllowed: {
        'conn-1': ['x.com', 'y.com'],
        'conn-2': ['z.com'],
      },
    };
    const next = _migrateLegacyState(old, 0);

    expect(next.domainAlwaysAllowed['conn-1']).toEqual({ global: ['x.com', 'y.com'] });
    expect(next.domainAlwaysAllowed['conn-2']).toEqual({ global: ['z.com'] });
  });

  it('sets _pendingLegacyToastCount to the total number of migrated entries', () => {
    const old: LegacyShape = {
      alwaysAllowed: ['a', 'b'],
      skillScriptAlways: ['s1'],
      toolCallAlways: ['t1', 't2', 't3'],
      domainAlwaysAllowed: { 'conn-1': ['x.com', 'y.com'] },
    };
    const next = _migrateLegacyState(old, 0);

    // 2 + 1 + 3 + 2 = 8
    expect(next._pendingLegacyToastCount).toBe(8);
  });

  it('produces an empty migrated state with count undefined when nothing was legacy', () => {
    const next = _migrateLegacyState({}, 0);
    expect(next.alwaysAllowed).toEqual([]);
    expect(next.skillScriptAlways).toEqual([]);
    expect(next.toolCallAlways).toEqual([]);
    expect(next.domainAlwaysAllowed).toEqual({});
    expect(next._pendingLegacyToastCount).toBeUndefined();
  });

  it('passes through v2 state unchanged (version >= 2 branch)', () => {
    // Construct a v2-shaped state; the migrate function should return it as-is.
    const alreadyMigrated = {
      requests: [] as PermissionRequest[],
      sessionAllowed: new Set<string>(),
      alwaysAllowed: [
        { toolName: 'write_file', connectionId: 'c1', projectRoot: '/a', grantedAt: 123 },
      ],
      skillScriptSession: new Set<string>(),
      skillScriptAlways: [],
      domainSessionAllowed: {},
      domainAlwaysAllowed: { 'conn-1': { global: ['x.com'], '/proj-a': ['proj.com'] } },
      toolCallSession: new Set<string>(),
      toolCallAlways: [],
    };

    const result = _migrateLegacyState(alreadyMigrated, 2);
    expect(result).toBe(alreadyMigrated);
  });

  it('is defensive against null / undefined input', () => {
    const next1 = _migrateLegacyState(null, 0);
    expect(next1.alwaysAllowed).toEqual([]);
    expect(next1._pendingLegacyToastCount).toBeUndefined();

    const next2 = _migrateLegacyState(undefined, 0);
    expect(next2.alwaysAllowed).toEqual([]);
    expect(next2._pendingLegacyToastCount).toBeUndefined();
  });

  it('is defensive against garbage (non-object) input', () => {
    const next = _migrateLegacyState('nonsense', 0);
    expect(next.alwaysAllowed).toEqual([]);
    expect(next.skillScriptAlways).toEqual([]);
    expect(next.toolCallAlways).toEqual([]);
    expect(next.domainAlwaysAllowed).toEqual({});
  });

  it('filters non-string entries defensively in legacy arrays', () => {
    const old = {
      alwaysAllowed: ['ok_tool', 42, null, { foo: 'bar' }, 'another_tool'],
    };
    const next = _migrateLegacyState(old, 0);

    expect(next.alwaysAllowed).toHaveLength(2);
    expect(next.alwaysAllowed.map((a) => a.toolName).sort()).toEqual(
      ['another_tool', 'ok_tool'].sort(),
    );
  });

  it('sets initial session fields to empty (session tier is non-persisted)', () => {
    const old: LegacyShape = { alwaysAllowed: ['tool_a'] };
    const next = _migrateLegacyState(old, 0);

    expect(next.sessionAllowed).toBeInstanceOf(Set);
    expect(next.sessionAllowed.size).toBe(0);
    expect(next.skillScriptSession).toBeInstanceOf(Set);
    expect(next.skillScriptSession.size).toBe(0);
    expect(next.toolCallSession).toBeInstanceOf(Set);
    expect(next.toolCallSession.size).toBe(0);
    expect(next.domainSessionAllowed).toEqual({});
    expect(next.requests).toEqual([]);
  });

  it('gives all migrated entries the same (approximately current) grantedAt timestamp', () => {
    const before = Date.now();
    const old: LegacyShape = {
      alwaysAllowed: ['a'],
      skillScriptAlways: ['s'],
      toolCallAlways: ['t'],
    };
    const next = _migrateLegacyState(old, 0);
    const after = Date.now();

    const all = [...next.alwaysAllowed, ...next.skillScriptAlways, ...next.toolCallAlways];
    for (const entry of all) {
      expect(entry.grantedAt).toBeGreaterThanOrEqual(before);
      expect(entry.grantedAt).toBeLessThanOrEqual(after);
    }
  });
});
