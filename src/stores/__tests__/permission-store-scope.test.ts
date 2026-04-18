import { describe, it, expect, beforeEach } from 'vitest';
import { usePermissionStore } from '../permission-store';

/**
 * Scope matching semantics for the v2 permission-store.
 *
 * Rule: a stored `ScopedApproval` entry matches a query `(toolName, connId, projRoot)` iff
 *   - tool names are equal AND
 *   - (entry.connectionId is null OR query connId is null OR they're equal) AND
 *   - (entry.projectRoot is null OR query projRoot is null OR they're equal)
 *
 * Removal is strict: `removeAlways` requires exact equality on all three
 * fields — nulls do NOT act as wildcards when removing.
 */
describe('permission-store scope semantics', () => {
  beforeEach(() => {
    usePermissionStore.setState({
      sessionAllowed: new Set<string>(),
      alwaysAllowed: [],
      skillScriptSession: new Set<string>(),
      skillScriptAlways: [],
      toolCallSession: new Set<string>(),
      toolCallAlways: [],
      domainSessionAllowed: {},
      domainAlwaysAllowed: {},
    });
  });

  describe('alwaysAllowed (ACP tool kinds)', () => {
    it('exact-triple: (write_file, c1, /a) matches only (write_file, c1, /a) queries', () => {
      const store = usePermissionStore.getState();
      store.allowAlways('write_file', 'c1', '/a');

      // exact match
      expect(store.isAutoAllowed('write_file', 'c1', '/a')).toBe(true);

      // different tool
      expect(store.isAutoAllowed('read_file', 'c1', '/a')).toBe(false);

      // different connection
      expect(store.isAutoAllowed('write_file', 'c2', '/a')).toBe(false);

      // different project
      expect(store.isAutoAllowed('write_file', 'c1', '/b')).toBe(false);
    });

    it('null connectionId in stored entry matches any queried connection', () => {
      const store = usePermissionStore.getState();
      store.allowAlways('write_file', null, '/a');

      expect(store.isAutoAllowed('write_file', 'c1', '/a')).toBe(true);
      expect(store.isAutoAllowed('write_file', 'c2', '/a')).toBe(true);
      expect(store.isAutoAllowed('write_file', null, '/a')).toBe(true);

      // project still filters
      expect(store.isAutoAllowed('write_file', 'c1', '/b')).toBe(false);
    });

    it('null projectRoot in stored entry matches any queried project', () => {
      const store = usePermissionStore.getState();
      store.allowAlways('write_file', 'c1', null);

      expect(store.isAutoAllowed('write_file', 'c1', '/a')).toBe(true);
      expect(store.isAutoAllowed('write_file', 'c1', '/b')).toBe(true);
      expect(store.isAutoAllowed('write_file', 'c1', null)).toBe(true);

      // connection still filters
      expect(store.isAutoAllowed('write_file', 'c2', '/a')).toBe(false);
    });

    it('legacy (null, null) bucket matches any scoped query (migration fall-through)', () => {
      const store = usePermissionStore.getState();
      store.allowAlways('write_file', null, null);

      expect(store.isAutoAllowed('write_file', 'c1', '/a')).toBe(true);
      expect(store.isAutoAllowed('write_file', 'c2', '/z')).toBe(true);
      expect(store.isAutoAllowed('write_file', null, null)).toBe(true);
    });

    it('null-null query matches any stored entry with the same toolName', () => {
      const store = usePermissionStore.getState();
      store.allowAlways('write_file', 'c1', '/a');

      // A null-null query is the "forward-compat" shape used by callers that
      // don't yet thread scope. Behaviour: query null acts as wildcard too.
      expect(store.isAutoAllowed('write_file', null, null)).toBe(true);
    });

    it('fully-scoped query does NOT match entry with mismatching connectionId', () => {
      const store = usePermissionStore.getState();
      store.allowAlways('write_file', 'c1', '/a');

      expect(store.isAutoAllowed('write_file', 'c2', '/a')).toBe(false);
    });

    it('getToolTier follows the same matching semantics', () => {
      const store = usePermissionStore.getState();
      store.allowAlways('write_file', 'c1', null);

      expect(store.getToolTier('write_file', 'c1', '/a')).toBe('always');
      expect(store.getToolTier('write_file', 'c1', '/b')).toBe('always');
      expect(store.getToolTier('write_file', 'c2', '/a')).toBe('none');
    });

    it('removeAlways is strict: nulls do NOT act as wildcards when removing', () => {
      const store = usePermissionStore.getState();
      store.allowAlways('write_file', 'c1', '/a');
      store.allowAlways('write_file', null, null);

      // Attempt to remove with null-null — only the legacy entry is removed.
      store.removeAlways('write_file', null, null);
      let alwaysAllowed = usePermissionStore.getState().alwaysAllowed;
      expect(
        alwaysAllowed.some(
          (a) => a.toolName === 'write_file' && a.connectionId === 'c1' && a.projectRoot === '/a',
        ),
      ).toBe(true);
      expect(
        alwaysAllowed.some(
          (a) => a.toolName === 'write_file' && a.connectionId === null && a.projectRoot === null,
        ),
      ).toBe(false);

      // Now remove the scoped entry with exact triple.
      usePermissionStore.getState().removeAlways('write_file', 'c1', '/a');
      alwaysAllowed = usePermissionStore.getState().alwaysAllowed;
      expect(alwaysAllowed).toEqual([]);
    });

    it('stored (null, null) coexists with scoped entries — they are not collapsed', () => {
      const store = usePermissionStore.getState();
      store.allowAlways('write_file', null, null);
      store.allowAlways('write_file', 'c1', '/a');

      expect(usePermissionStore.getState().alwaysAllowed).toHaveLength(2);
    });
  });

  describe('skillScriptAlways (skill names)', () => {
    it('applies the same triple-match semantics', () => {
      const store = usePermissionStore.getState();
      store.allowSkillScriptAlways('web-research', 'c1', '/a');

      expect(store.isSkillScriptAllowed('web-research', 'c1', '/a')).toBe('always');
      expect(store.isSkillScriptAllowed('web-research', 'c2', '/a')).toBe('none');
      expect(store.isSkillScriptAllowed('web-research', 'c1', '/b')).toBe('none');
    });

    it('legacy (null, null) bucket matches any scoped query', () => {
      const store = usePermissionStore.getState();
      store.allowSkillScriptAlways('web-research', null, null);

      expect(store.isSkillScriptAllowed('web-research', 'c1', '/a')).toBe('always');
      expect(store.isSkillScriptAllowed('web-research', null, null)).toBe('always');
    });

    it('removeSkillScriptAlways is strict on the triple', () => {
      const store = usePermissionStore.getState();
      store.allowSkillScriptAlways('web-research', 'c1', '/a');
      usePermissionStore.getState().removeSkillScriptAlways('web-research', 'c1', null);

      expect(
        usePermissionStore
          .getState()
          .skillScriptAlways.some((a) => a.toolName === 'web-research'),
      ).toBe(true);
    });
  });

  describe('toolCallAlways (direct-API tool names)', () => {
    it('applies the same triple-match semantics', () => {
      const store = usePermissionStore.getState();
      store.allowToolAlways('execute_skill_script', 'c1', '/a');

      expect(store.isToolAllowed('execute_skill_script', 'c1', '/a')).toBe('always');
      expect(store.isToolAllowed('execute_skill_script', 'c2', '/a')).toBe('none');
    });

    it('isToolAllowed still short-circuits for built-in read-only tools', () => {
      const store = usePermissionStore.getState();
      // read_file is built-in auto-allowed; no scoping applied.
      expect(store.isToolAllowed('read_file', null, null)).toBe('always');
      expect(store.isToolAllowed('read_file', 'c1', '/a')).toBe('always');
    });

    it('legacy (null, null) bucket matches any scoped query', () => {
      const store = usePermissionStore.getState();
      store.allowToolAlways('write_file', null, null);

      expect(store.isToolAllowed('write_file', 'c1', '/a')).toBe('always');
      expect(store.isToolAllowed('write_file', 'c2', '/b')).toBe('always');
    });
  });

  describe('grantedAt timestamp', () => {
    it('entries include a grantedAt millis-since-epoch stamp', () => {
      const before = Date.now();
      usePermissionStore.getState().allowAlways('write_file', 'c1', '/a');
      const after = Date.now();

      const entry = usePermissionStore
        .getState()
        .alwaysAllowed.find((a) => a.toolName === 'write_file');
      expect(entry).toBeDefined();
      expect(entry!.grantedAt).toBeGreaterThanOrEqual(before);
      expect(entry!.grantedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('session tier is scope-less', () => {
    it('session tier approvals apply regardless of query scope', () => {
      const store = usePermissionStore.getState();
      store.allowSession('write_file');

      expect(store.isAutoAllowed('write_file', 'c1', '/a')).toBe(true);
      expect(store.isAutoAllowed('write_file', 'c2', '/b')).toBe(true);
      expect(store.isAutoAllowed('write_file', null, null)).toBe(true);
    });
  });

  describe('domains — per-project buckets', () => {
    it('global bucket domains are visible for any project query', () => {
      const store = usePermissionStore.getState();
      store.allowDomain('c1', 'example.com', 'always', null);

      expect(store.isDomainAllowed('c1', 'example.com', [], '/proj-a')).toBe(true);
      expect(store.isDomainAllowed('c1', 'example.com', [], '/proj-b')).toBe(true);
      expect(store.isDomainAllowed('c1', 'example.com', [], null)).toBe(true);
    });

    it('per-project domains are only visible when querying that project', () => {
      const store = usePermissionStore.getState();
      store.allowDomain('c1', 'proj-a.only.com', 'always', '/proj-a');

      expect(store.isDomainAllowed('c1', 'proj-a.only.com', [], '/proj-a')).toBe(true);
      expect(store.isDomainAllowed('c1', 'proj-a.only.com', [], '/proj-b')).toBe(false);
      // null project query only sees global + session buckets
      expect(store.isDomainAllowed('c1', 'proj-a.only.com', [], null)).toBe(false);
    });

    it('per-project and global buckets coexist per connection', () => {
      const store = usePermissionStore.getState();
      store.allowDomain('c1', 'global.com', 'always', null);
      store.allowDomain('c1', 'proj-a.com', 'always', '/proj-a');

      const state = usePermissionStore.getState();
      expect(state.domainAlwaysAllowed['c1']?.global).toContain('global.com');
      expect(state.domainAlwaysAllowed['c1']?.['/proj-a']).toContain('proj-a.com');
    });

    it('getDomainAllowedList combines session + global + queried project bucket', () => {
      const store = usePermissionStore.getState();
      store.allowDomain('c1', 'session.com', 'session');
      store.allowDomain('c1', 'global.com', 'always', null);
      store.allowDomain('c1', 'proj-a.com', 'always', '/proj-a');
      store.allowDomain('c1', 'proj-b.com', 'always', '/proj-b');

      const listForA = usePermissionStore.getState().getDomainAllowedList('c1', '/proj-a');
      expect(listForA).toContain('session.com');
      expect(listForA).toContain('global.com');
      expect(listForA).toContain('proj-a.com');
      expect(listForA).not.toContain('proj-b.com');

      const listForNull = usePermissionStore.getState().getDomainAllowedList('c1', null);
      expect(listForNull).toContain('session.com');
      expect(listForNull).toContain('global.com');
      expect(listForNull).not.toContain('proj-a.com');
      expect(listForNull).not.toContain('proj-b.com');
    });

    it('getDomainAllowedList deduplicates domains present in multiple buckets', () => {
      const store = usePermissionStore.getState();
      store.allowDomain('c1', 'shared.com', 'session');
      store.allowDomain('c1', 'shared.com', 'always', null);
      store.allowDomain('c1', 'shared.com', 'always', '/proj-a');

      const list = usePermissionStore.getState().getDomainAllowedList('c1', '/proj-a');
      expect(list.filter((d) => d === 'shared.com')).toHaveLength(1);
    });

    it('removeDomain targets the requested bucket only', () => {
      const store = usePermissionStore.getState();
      store.allowDomain('c1', 'shared.com', 'always', null);
      store.allowDomain('c1', 'shared.com', 'always', '/proj-a');

      usePermissionStore.getState().removeDomain('c1', 'shared.com', '/proj-a');

      const state = usePermissionStore.getState();
      expect(state.domainAlwaysAllowed['c1']?.global).toContain('shared.com');
      expect(state.domainAlwaysAllowed['c1']?.['/proj-a']).toBeUndefined();
    });

    it('removeDomain always clears the session bucket for that domain', () => {
      const store = usePermissionStore.getState();
      store.allowDomain('c1', 'shared.com', 'session');
      store.allowDomain('c1', 'shared.com', 'always', '/proj-a');

      usePermissionStore.getState().removeDomain('c1', 'shared.com', '/proj-a');

      expect(usePermissionStore.getState().domainSessionAllowed['c1']).not.toContain(
        'shared.com',
      );
    });
  });
});
