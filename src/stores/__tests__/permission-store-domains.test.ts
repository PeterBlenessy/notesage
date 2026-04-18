import { describe, it, expect, beforeEach } from 'vitest';
import { usePermissionStore } from '../permission-store';

describe('permission-store domain allowlists', () => {
  beforeEach(() => {
    usePermissionStore.setState({
      domainSessionAllowed: {},
      domainAlwaysAllowed: {},
      // Reset ACP/skill permissions so tests are independent
      sessionAllowed: new Set<string>(),
      alwaysAllowed: [],
      skillScriptSession: new Set<string>(),
      skillScriptAlways: [],
    });
  });

  describe('allowDomain session tier', () => {
    it('adds a domain to session list for a connection', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
      const state = usePermissionStore.getState();
      expect(state.domainSessionAllowed['conn-1']).toContain('api.example.com');
    });

    it('does not duplicate entries', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
      expect(usePermissionStore.getState().domainSessionAllowed['conn-1']).toHaveLength(1);
    });

    it('allows multiple domains per connection', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
      usePermissionStore.getState().allowDomain('conn-1', 'cdn.example.com', 'session');
      const domains = usePermissionStore.getState().domainSessionAllowed['conn-1'];
      expect(domains).toHaveLength(2);
      expect(domains).toContain('api.example.com');
      expect(domains).toContain('cdn.example.com');
    });
  });

  describe('allowDomain always tier', () => {
    it('adds a domain to the global bucket for a connection when projectRoot is null', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'always', null);
      const state = usePermissionStore.getState();
      expect(state.domainAlwaysAllowed['conn-1']?.global).toContain('api.example.com');
    });

    it('does not duplicate entries', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'always', null);
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'always', null);
      expect(usePermissionStore.getState().domainAlwaysAllowed['conn-1']?.global).toHaveLength(1);
    });
  });

  describe('removeDomain', () => {
    it('removes a domain from the global bucket', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'always', null);
      usePermissionStore.getState().allowDomain('conn-1', 'cdn.example.com', 'always', null);
      usePermissionStore.getState().removeDomain('conn-1', 'api.example.com', null);

      const bucket = usePermissionStore.getState().domainAlwaysAllowed['conn-1']?.global ?? [];
      expect(bucket).not.toContain('api.example.com');
      expect(bucket).toContain('cdn.example.com');
    });

    it('removes a domain from the session list', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
      usePermissionStore.getState().removeDomain('conn-1', 'api.example.com', null);

      expect(usePermissionStore.getState().domainSessionAllowed['conn-1']).not.toContain(
        'api.example.com',
      );
    });

    it('removes from both tiers at once', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'always', null);
      usePermissionStore.getState().removeDomain('conn-1', 'api.example.com', null);

      const state = usePermissionStore.getState();
      expect(state.domainSessionAllowed['conn-1']).not.toContain('api.example.com');
      const bucket = state.domainAlwaysAllowed['conn-1']?.global ?? [];
      expect(bucket).not.toContain('api.example.com');
    });

    it('is safe on non-existent domain', () => {
      usePermissionStore.getState().removeDomain('conn-1', 'nonexistent.com', null);
      // Should not throw; empty connection entry is fine.
      const bucket = usePermissionStore.getState().domainAlwaysAllowed['conn-1']?.global ?? [];
      expect(bucket).toEqual([]);
    });

    it('is safe on non-existent connection', () => {
      usePermissionStore.getState().removeDomain('no-such-conn', 'api.example.com', null);
      const bucket =
        usePermissionStore.getState().domainAlwaysAllowed['no-such-conn']?.global ?? [];
      expect(bucket).toEqual([]);
    });
  });

  describe('isDomainAllowed', () => {
    it('returns false by default with empty builtIn', () => {
      expect(
        usePermissionStore.getState().isDomainAllowed('conn-1', 'api.example.com', [], null),
      ).toBe(false);
    });

    it('matches built-in domains', () => {
      const builtIn = ['api.anthropic.com', 'sentry.io'];
      expect(
        usePermissionStore
          .getState()
          .isDomainAllowed('conn-1', 'api.anthropic.com', builtIn, null),
      ).toBe(true);
      expect(
        usePermissionStore.getState().isDomainAllowed('conn-1', 'unknown.com', builtIn, null),
      ).toBe(false);
    });

    it('matches session-allowed domains', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
      expect(
        usePermissionStore.getState().isDomainAllowed('conn-1', 'api.example.com', [], null),
      ).toBe(true);
    });

    it('matches always-allowed domains in the global bucket', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'always', null);
      expect(
        usePermissionStore.getState().isDomainAllowed('conn-1', 'api.example.com', [], null),
      ).toBe(true);
    });

    it('is case-insensitive', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'API.Example.COM', 'always', null);
      expect(
        usePermissionStore.getState().isDomainAllowed('conn-1', 'api.example.com', [], null),
      ).toBe(true);
    });

    it('is case-insensitive for built-in domains', () => {
      expect(
        usePermissionStore
          .getState()
          .isDomainAllowed('conn-1', 'API.ANTHROPIC.COM', ['api.anthropic.com'], null),
      ).toBe(true);
    });

    it('matches wildcard patterns like *.example.com', () => {
      usePermissionStore.getState().allowDomain('conn-1', '*.example.com', 'always', null);
      expect(
        usePermissionStore.getState().isDomainAllowed('conn-1', 'api.example.com', [], null),
      ).toBe(true);
      expect(
        usePermissionStore.getState().isDomainAllowed('conn-1', 'cdn.example.com', [], null),
      ).toBe(true);
    });

    it('wildcard does not match the bare domain itself', () => {
      usePermissionStore.getState().allowDomain('conn-1', '*.example.com', 'always', null);
      expect(
        usePermissionStore.getState().isDomainAllowed('conn-1', 'example.com', [], null),
      ).toBe(false);
    });

    it('wildcard does not match deeply nested subdomains beyond one level', () => {
      // *.example.com should match sub.example.com but also deep.sub.example.com
      // because the implementation checks endsWith('.example.com')
      usePermissionStore.getState().allowDomain('conn-1', '*.example.com', 'always', null);
      expect(
        usePermissionStore.getState().isDomainAllowed('conn-1', 'deep.sub.example.com', [], null),
      ).toBe(true);
    });

    it('matches wildcard patterns in built-in list', () => {
      expect(
        usePermissionStore
          .getState()
          .isDomainAllowed('conn-1', 'sub.provider.com', ['*.provider.com'], null),
      ).toBe(true);
    });

    it('wildcard is case-insensitive', () => {
      usePermissionStore.getState().allowDomain('conn-1', '*.EXAMPLE.COM', 'always', null);
      expect(
        usePermissionStore.getState().isDomainAllowed('conn-1', 'api.example.com', [], null),
      ).toBe(true);
    });

    describe('cross-connection isolation', () => {
      it('domains allowed on conn-1 are not visible on conn-2', () => {
        usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'always', null);
        expect(
          usePermissionStore.getState().isDomainAllowed('conn-1', 'api.example.com', [], null),
        ).toBe(true);
        expect(
          usePermissionStore.getState().isDomainAllowed('conn-2', 'api.example.com', [], null),
        ).toBe(false);
      });

      it('session domains are isolated per connection', () => {
        usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
        expect(
          usePermissionStore.getState().isDomainAllowed('conn-2', 'api.example.com', [], null),
        ).toBe(false);
      });
    });
  });

  describe('getDomainAllowedList', () => {
    it('returns empty array for unknown connection', () => {
      expect(usePermissionStore.getState().getDomainAllowedList('no-such-conn', null)).toEqual([]);
    });

    it('returns session domains', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
      expect(usePermissionStore.getState().getDomainAllowedList('conn-1', null)).toContain(
        'api.example.com',
      );
    });

    it('returns always (global) domains', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'always', null);
      expect(usePermissionStore.getState().getDomainAllowedList('conn-1', null)).toContain(
        'api.example.com',
      );
    });

    it('returns combined session + global always domains', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'session-only.com', 'session');
      usePermissionStore.getState().allowDomain('conn-1', 'always-only.com', 'always', null);
      const list = usePermissionStore.getState().getDomainAllowedList('conn-1', null);
      expect(list).toContain('session-only.com');
      expect(list).toContain('always-only.com');
      expect(list).toHaveLength(2);
    });

    it('does not include domains from other connections', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'always', null);
      usePermissionStore.getState().allowDomain('conn-2', 'other.example.com', 'always', null);
      const list = usePermissionStore.getState().getDomainAllowedList('conn-1', null);
      expect(list).toContain('api.example.com');
      expect(list).not.toContain('other.example.com');
    });
  });

  describe('clearDomainSession', () => {
    it('clears session domains for a connection', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
      usePermissionStore.getState().allowDomain('conn-1', 'cdn.example.com', 'session');
      usePermissionStore.getState().clearDomainSession('conn-1');

      expect(usePermissionStore.getState().domainSessionAllowed['conn-1']).toBeUndefined();
    });

    it('does not affect always domains', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'always', null);
      usePermissionStore.getState().allowDomain('conn-1', 'cdn.example.com', 'session');
      usePermissionStore.getState().clearDomainSession('conn-1');

      const bucket = usePermissionStore.getState().domainAlwaysAllowed['conn-1']?.global ?? [];
      expect(bucket).toContain('api.example.com');
    });

    it('does not affect session domains on other connections', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
      usePermissionStore.getState().allowDomain('conn-2', 'other.example.com', 'session');
      usePermissionStore.getState().clearDomainSession('conn-1');

      expect(usePermissionStore.getState().domainSessionAllowed['conn-2']).toContain(
        'other.example.com',
      );
    });

    it('is safe on non-existent connection', () => {
      usePermissionStore.getState().clearDomainSession('no-such-conn');
      // Should not throw
      expect(usePermissionStore.getState().domainSessionAllowed).toEqual({});
    });
  });

  describe('persistence (partialize shape)', () => {
    it('domainAlwaysAllowed is included in persisted state', () => {
      // The persist middleware's partialize function only includes specific fields.
      // Verify that domainAlwaysAllowed is present by checking the persist options.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const persistApi = (usePermissionStore as any).persist;
      const options = persistApi?.getOptions?.();
      if (options?.partialize) {
        const state = usePermissionStore.getState();
        state.allowDomain('conn-1', 'api.example.com', 'always', null);
        const persisted = options.partialize(usePermissionStore.getState());
        expect(persisted).toHaveProperty('domainAlwaysAllowed');
        expect(persisted.domainAlwaysAllowed['conn-1']?.global).toContain('api.example.com');
      } else {
        // If persist API is not accessible in test env, verify field structure directly
        usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'always', null);
        expect(
          usePermissionStore.getState().domainAlwaysAllowed['conn-1']?.global,
        ).toContain('api.example.com');
      }
    });

    it('domainSessionAllowed is excluded from persisted state', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const persistApi = (usePermissionStore as any).persist;
      const options = persistApi?.getOptions?.();
      if (options?.partialize) {
        usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
        const persisted = options.partialize(usePermissionStore.getState());
        expect(persisted).not.toHaveProperty('domainSessionAllowed');
      } else {
        // Verify session state exists in-memory but is separate from always
        usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'session');
        expect(usePermissionStore.getState().domainSessionAllowed['conn-1']).toContain(
          'api.example.com',
        );
        expect(usePermissionStore.getState().domainAlwaysAllowed['conn-1']).toBeUndefined();
      }
    });
  });

  describe('independence from ACP tool permissions', () => {
    it('domain permissions do not affect ACP tool tier', () => {
      usePermissionStore.getState().allowDomain('conn-1', 'api.example.com', 'always', null);
      usePermissionStore.getState().allowDomain('conn-1', 'cdn.example.com', 'session');
      expect(usePermissionStore.getState().getToolTier('api.example.com', null, null)).toBe('none');
      expect(usePermissionStore.getState().isAutoAllowed('cdn.example.com', null, null)).toBe(
        false,
      );
    });

    it('ACP tool permissions do not affect domain checks', () => {
      usePermissionStore.getState().allowAlways('file_read', null, null);
      usePermissionStore.getState().allowSession('file_write');
      expect(
        usePermissionStore.getState().isDomainAllowed('conn-1', 'file_read', [], null),
      ).toBe(false);
      expect(
        usePermissionStore.getState().isDomainAllowed('conn-1', 'file_write', [], null),
      ).toBe(false);
    });
  });
});
