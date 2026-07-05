// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect } from 'vitest';
import { isProjectMetadata } from '../useProjectMetadata';
import { createDefaultMetadata } from '@/stores/project-metadata-store';

describe('isProjectMetadata', () => {
  const valid = createDefaultMetadata('My Project');

  it('accepts the default metadata shape', () => {
    expect(isProjectMetadata(valid)).toBe(true);
  });

  it('accepts a fully-populated metadata object', () => {
    expect(
      isProjectMetadata({
        ...valid,
        citationFormat: 'links',
        ai: { provider: 'conn-1', agentName: 'writer', projectContext: 'ctx' },
        aiLock: { connectionId: 'conn-1', lockedAt: 123, reason: 'compliance' },
        appearance: { icon: 'book', color: 'grey' },
      }),
    ).toBe(true);
  });

  it('accepts null provider / agentName (default shape on disk)', () => {
    expect(
      isProjectMetadata({
        ...valid,
        ai: { provider: null, agentName: null, projectContext: '' },
      }),
    ).toBe(true);
  });

  it('rejects junk primitives', () => {
    expect(isProjectMetadata(null)).toBe(false);
    expect(isProjectMetadata(undefined)).toBe(false);
    expect(isProjectMetadata(42)).toBe(false);
    expect(isProjectMetadata('metadata')).toBe(false);
    expect(isProjectMetadata([valid])).toBe(false);
  });

  it('rejects wrong-typed core fields', () => {
    expect(isProjectMetadata({ ...valid, name: 42 })).toBe(false);
    expect(isProjectMetadata({ ...valid, description: null })).toBe(false);
    expect(isProjectMetadata({ ...valid, ai: 'none' })).toBe(false);
    expect(isProjectMetadata({ ...valid, ai: null })).toBe(false);
  });

  it('rejects wrong-typed ai sub-fields', () => {
    expect(isProjectMetadata({ ...valid, ai: { ...valid.ai, provider: 42 } })).toBe(false);
    expect(isProjectMetadata({ ...valid, ai: { ...valid.ai, agentName: {} } })).toBe(false);
    expect(isProjectMetadata({ ...valid, ai: { ...valid.ai, projectContext: 42 } })).toBe(false);
  });

  it('rejects a malformed aiLock (enforcement data must carry a connection id)', () => {
    expect(isProjectMetadata({ ...valid, aiLock: {} })).toBe(false);
    expect(isProjectMetadata({ ...valid, aiLock: { connectionId: 42 } })).toBe(false);
    expect(isProjectMetadata({ ...valid, aiLock: 'locked' })).toBe(false);
  });
});
