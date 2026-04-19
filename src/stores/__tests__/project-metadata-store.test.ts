/**
 * Unit tests for project-metadata-store.
 *
 * Covers: createDefaultMetadata factory, setMetadata, getMetadata,
 * removeMetadata, updateMetadata, updateAI, isDirty, setClean.
 *
 * This store is NOT persisted (no Zustand persist middleware),
 * so no localStorage mocking is needed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  useProjectMetadataStore,
  createDefaultMetadata,
  type ProjectMetadata,
} from '../project-metadata-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetadata(overrides: Partial<ProjectMetadata> = {}): ProjectMetadata {
  return {
    version: 1,
    name: 'Test Project',
    description: 'A test project',
    ai: {
      provider: null,
      agentName: null,
      projectContext: '',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  useProjectMetadataStore.setState({
    metadataMap: {},
    dirtyPaths: new Set<string>(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createDefaultMetadata', () => {
  it('returns metadata with the given folder name', () => {
    const meta = createDefaultMetadata('my-project');
    expect(meta).toEqual({
      version: 1,
      name: 'my-project',
      description: '',
      ai: {
        provider: null,
        agentName: null,
        projectContext: '',
      },
    });
  });

  it('uses the folder name as-is without transformation', () => {
    const meta = createDefaultMetadata('Folder With Spaces');
    expect(meta.name).toBe('Folder With Spaces');
  });
});

describe('setMetadata', () => {
  it('stores metadata by path', () => {
    const meta = makeMetadata({ name: 'Alpha' });
    useProjectMetadataStore.getState().setMetadata('/path/a', meta);

    expect(useProjectMetadataStore.getState().metadataMap['/path/a']).toEqual(meta);
  });

  it('stores multiple projects independently', () => {
    const metaA = makeMetadata({ name: 'Alpha' });
    const metaB = makeMetadata({ name: 'Beta' });
    const { setMetadata } = useProjectMetadataStore.getState();

    setMetadata('/path/a', metaA);
    setMetadata('/path/b', metaB);

    const map = useProjectMetadataStore.getState().metadataMap;
    expect(map['/path/a']?.name).toBe('Alpha');
    expect(map['/path/b']?.name).toBe('Beta');
  });

  it('overwrites existing metadata for the same path', () => {
    const { setMetadata } = useProjectMetadataStore.getState();
    setMetadata('/path/a', makeMetadata({ name: 'Old' }));
    setMetadata('/path/a', makeMetadata({ name: 'New' }));

    expect(useProjectMetadataStore.getState().metadataMap['/path/a']?.name).toBe('New');
  });

  it('clears dirty flag for the path', () => {
    const { setMetadata } = useProjectMetadataStore.getState();
    setMetadata('/path/a', makeMetadata());
    // Make it dirty
    useProjectMetadataStore.getState().updateMetadata('/path/a', { name: 'Changed' });
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(true);

    // setMetadata should clear dirty
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata({ name: 'Reset' }));
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(false);
  });
});

describe('getMetadata', () => {
  it('returns metadata for an existing path', () => {
    const meta = makeMetadata({ name: 'Found' });
    useProjectMetadataStore.getState().setMetadata('/path/a', meta);

    expect(useProjectMetadataStore.getState().getMetadata('/path/a')).toEqual(meta);
  });

  it('returns undefined for a non-existent path', () => {
    expect(useProjectMetadataStore.getState().getMetadata('/no/such/path')).toBeUndefined();
  });
});

describe('removeMetadata', () => {
  it('deletes metadata for a path', () => {
    const { setMetadata, removeMetadata } = useProjectMetadataStore.getState();
    setMetadata('/path/a', makeMetadata());
    removeMetadata('/path/a');

    expect(useProjectMetadataStore.getState().getMetadata('/path/a')).toBeUndefined();
  });

  it('does not affect other paths', () => {
    const { setMetadata, removeMetadata } = useProjectMetadataStore.getState();
    setMetadata('/path/a', makeMetadata({ name: 'A' }));
    setMetadata('/path/b', makeMetadata({ name: 'B' }));
    removeMetadata('/path/a');

    expect(useProjectMetadataStore.getState().getMetadata('/path/a')).toBeUndefined();
    expect(useProjectMetadataStore.getState().getMetadata('/path/b')?.name).toBe('B');
  });

  it('is a no-op for non-existent paths', () => {
    const stateBefore = { ...useProjectMetadataStore.getState().metadataMap };
    useProjectMetadataStore.getState().removeMetadata('/no/such/path');
    expect(useProjectMetadataStore.getState().metadataMap).toEqual(stateBefore);
  });

  it('clears dirty flag for the removed path', () => {
    const { setMetadata } = useProjectMetadataStore.getState();
    setMetadata('/path/a', makeMetadata());
    useProjectMetadataStore.getState().updateMetadata('/path/a', { name: 'Dirty' });
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(true);

    useProjectMetadataStore.getState().removeMetadata('/path/a');
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(false);
  });
});

describe('updateMetadata', () => {
  it('partially updates top-level fields', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata({ name: 'Old', description: 'Old desc' }));
    useProjectMetadataStore.getState().updateMetadata('/path/a', { name: 'New' });

    const meta = useProjectMetadataStore.getState().getMetadata('/path/a');
    expect(meta?.name).toBe('New');
    expect(meta?.description).toBe('Old desc');
  });

  it('preserves fields not included in the update', () => {
    const original = makeMetadata({
      name: 'Original',
      description: 'Keep me',
      citationFormat: 'footnotes',
    });
    useProjectMetadataStore.getState().setMetadata('/path/a', original);
    useProjectMetadataStore.getState().updateMetadata('/path/a', { description: 'Updated' });

    const meta = useProjectMetadataStore.getState().getMetadata('/path/a');
    expect(meta?.name).toBe('Original');
    expect(meta?.description).toBe('Updated');
    expect(meta?.citationFormat).toBe('footnotes');
  });

  it('marks the path as dirty', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(false);

    useProjectMetadataStore.getState().updateMetadata('/path/a', { name: 'Changed' });
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(true);
  });

  it('is a no-op for non-existent paths', () => {
    useProjectMetadataStore.getState().updateMetadata('/no/such/path', { name: 'Ghost' });
    expect(useProjectMetadataStore.getState().getMetadata('/no/such/path')).toBeUndefined();
  });

  it('updates citationFormat', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    useProjectMetadataStore.getState().updateMetadata('/path/a', { citationFormat: 'academic' });

    expect(useProjectMetadataStore.getState().getMetadata('/path/a')?.citationFormat).toBe('academic');
  });

  it('updates citationStyle', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    useProjectMetadataStore.getState().updateMetadata('/path/a', { citationStyle: 'mla' });

    expect(useProjectMetadataStore.getState().getMetadata('/path/a')?.citationStyle).toBe('mla');
  });
});

describe('updateAI', () => {
  it('updates AI provider', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    useProjectMetadataStore.getState().updateAI('/path/a', { provider: 'conn-123' });

    expect(useProjectMetadataStore.getState().getMetadata('/path/a')?.ai.provider).toBe('conn-123');
  });

  it('updates AI agentName', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    useProjectMetadataStore.getState().updateAI('/path/a', { agentName: 'creative-writer' });

    expect(useProjectMetadataStore.getState().getMetadata('/path/a')?.ai.agentName).toBe('creative-writer');
  });

  it('updates AI projectContext', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    useProjectMetadataStore.getState().updateAI('/path/a', { projectContext: 'Write in formal tone' });

    expect(useProjectMetadataStore.getState().getMetadata('/path/a')?.ai.projectContext).toBe('Write in formal tone');
  });

  it('preserves other AI fields when updating one', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata({
      ai: { provider: 'conn-old', agentName: 'editor', projectContext: 'existing context' },
    }));
    useProjectMetadataStore.getState().updateAI('/path/a', { provider: 'conn-new' });

    const ai = useProjectMetadataStore.getState().getMetadata('/path/a')?.ai;
    expect(ai?.provider).toBe('conn-new');
    expect(ai?.agentName).toBe('editor');
    expect(ai?.projectContext).toBe('existing context');
  });

  it('marks the path as dirty', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(false);

    useProjectMetadataStore.getState().updateAI('/path/a', { provider: 'conn-123' });
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(true);
  });

  it('is a no-op for non-existent paths', () => {
    useProjectMetadataStore.getState().updateAI('/no/such/path', { provider: 'conn-123' });
    expect(useProjectMetadataStore.getState().getMetadata('/no/such/path')).toBeUndefined();
  });
});

describe('isDirty', () => {
  it('returns false for a freshly set path', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(false);
  });

  it('returns true after updateMetadata', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    useProjectMetadataStore.getState().updateMetadata('/path/a', { name: 'Changed' });
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(true);
  });

  it('returns true after updateAI', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    useProjectMetadataStore.getState().updateAI('/path/a', { agentName: 'bot' });
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(true);
  });

  it('returns false for a non-existent path', () => {
    expect(useProjectMetadataStore.getState().isDirty('/no/such/path')).toBe(false);
  });
});

describe('setClean', () => {
  it('clears dirty flag for a path', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    useProjectMetadataStore.getState().updateMetadata('/path/a', { name: 'Dirty' });
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(true);

    useProjectMetadataStore.getState().setClean('/path/a');
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(false);
  });

  it('does not affect other dirty paths', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    useProjectMetadataStore.getState().setMetadata('/path/b', makeMetadata());
    useProjectMetadataStore.getState().updateMetadata('/path/a', { name: 'Dirty A' });
    useProjectMetadataStore.getState().updateMetadata('/path/b', { name: 'Dirty B' });

    useProjectMetadataStore.getState().setClean('/path/a');
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(false);
    expect(useProjectMetadataStore.getState().isDirty('/path/b')).toBe(true);
  });

  it('is a no-op for non-existent or already-clean paths', () => {
    useProjectMetadataStore.getState().setMetadata('/path/a', makeMetadata());
    // Already clean — should not throw
    useProjectMetadataStore.getState().setClean('/path/a');
    expect(useProjectMetadataStore.getState().isDirty('/path/a')).toBe(false);

    // Non-existent — should not throw
    useProjectMetadataStore.getState().setClean('/no/such/path');
    expect(useProjectMetadataStore.getState().isDirty('/no/such/path')).toBe(false);
  });
});

describe('aiLock', () => {
  it('createDefaultMetadata omits aiLock by default', () => {
    const meta = createDefaultMetadata('new-project');
    expect(meta.aiLock).toBeUndefined();
  });

  it('setMetadata + getMetadata round-trips aiLock', () => {
    const lockedAt = 1_713_456_789_000;
    const meta = makeMetadata({
      aiLock: {
        connectionId: 'conn-claude-code',
        lockedAt,
        reason: 'legal workload',
      },
    });
    useProjectMetadataStore.getState().setMetadata('/path/locked', meta);

    const loaded = useProjectMetadataStore.getState().getMetadata('/path/locked');
    expect(loaded?.aiLock).toEqual({
      connectionId: 'conn-claude-code',
      lockedAt,
      reason: 'legal workload',
    });
  });

  it('persists and rehydrates via JSON round-trip (project.json shape)', () => {
    const meta = makeMetadata({
      aiLock: {
        connectionId: 'conn-xyz',
        lockedAt: 1_713_000_000_000,
        reason: 'sensitive data',
      },
    });
    // Mirrors what useProjectMetadata does when writing/reading project.json
    const serialized = JSON.stringify(meta, null, 2);
    const parsed = JSON.parse(serialized) as ProjectMetadata;

    expect(parsed.aiLock?.connectionId).toBe('conn-xyz');
    expect(parsed.aiLock?.lockedAt).toBe(1_713_000_000_000);
    expect(parsed.aiLock?.reason).toBe('sensitive data');
  });

  it('round-trips aiLock without the optional reason field', () => {
    const meta = makeMetadata({
      aiLock: {
        connectionId: 'conn-minimal',
        lockedAt: 1_713_000_000_000,
      },
    });
    const parsed = JSON.parse(JSON.stringify(meta)) as ProjectMetadata;

    expect(parsed.aiLock).toEqual({
      connectionId: 'conn-minimal',
      lockedAt: 1_713_000_000_000,
    });
    expect(parsed.aiLock).not.toHaveProperty('reason');
  });

  it('metadata without aiLock round-trips unchanged (backward compat)', () => {
    const meta = makeMetadata();
    const parsed = JSON.parse(JSON.stringify(meta)) as ProjectMetadata;
    expect(parsed.aiLock).toBeUndefined();
    expect(parsed).toEqual(meta);
  });

  it('ai.provider and aiLock are independent fields', () => {
    // The PRD distinction: ai.provider is a soft default; aiLock is a hard
    // enforcement. Setting one must not touch the other.
    const meta = makeMetadata({
      ai: { provider: 'conn-default', agentName: null, projectContext: '' },
      aiLock: { connectionId: 'conn-locked', lockedAt: 1 },
    });
    const parsed = JSON.parse(JSON.stringify(meta)) as ProjectMetadata;

    expect(parsed.ai.provider).toBe('conn-default');
    expect(parsed.aiLock?.connectionId).toBe('conn-locked');
  });

  it('setAiLock writes the lock with current timestamp and marks the project dirty', () => {
    const path = '/path/lockable';
    useProjectMetadataStore.getState().setMetadata(path, makeMetadata());

    const before = Date.now();
    useProjectMetadataStore.getState().setAiLock(path, 'conn-claude', 'sensitive');
    const after = Date.now();

    const meta = useProjectMetadataStore.getState().getMetadata(path);
    expect(meta?.aiLock?.connectionId).toBe('conn-claude');
    expect(meta?.aiLock?.reason).toBe('sensitive');
    expect(meta?.aiLock?.lockedAt).toBeGreaterThanOrEqual(before);
    expect(meta?.aiLock?.lockedAt).toBeLessThanOrEqual(after);
    expect(useProjectMetadataStore.getState().isDirty(path)).toBe(true);
  });

  it('setAiLock omits the reason field when the input is empty or whitespace', () => {
    const path = '/path/lockable-no-reason';
    useProjectMetadataStore.getState().setMetadata(path, makeMetadata());

    useProjectMetadataStore.getState().setAiLock(path, 'conn-claude', '   ');

    const meta = useProjectMetadataStore.getState().getMetadata(path);
    expect(meta?.aiLock?.connectionId).toBe('conn-claude');
    expect(meta?.aiLock).not.toHaveProperty('reason');
  });

  it('clearAiLock removes the aiLock field and marks the project dirty', () => {
    const path = '/path/unlockable';
    useProjectMetadataStore.getState().setMetadata(
      path,
      makeMetadata({ aiLock: { connectionId: 'conn-claude', lockedAt: 1 } }),
    );
    useProjectMetadataStore.getState().setClean(path);
    expect(useProjectMetadataStore.getState().isDirty(path)).toBe(false);

    useProjectMetadataStore.getState().clearAiLock(path);

    const meta = useProjectMetadataStore.getState().getMetadata(path);
    expect(meta?.aiLock).toBeUndefined();
    expect(useProjectMetadataStore.getState().isDirty(path)).toBe(true);
  });

  it('clearAiLock is a no-op when the project is not locked', () => {
    const path = '/path/no-lock';
    useProjectMetadataStore.getState().setMetadata(path, makeMetadata());
    useProjectMetadataStore.getState().setClean(path);

    useProjectMetadataStore.getState().clearAiLock(path);

    expect(useProjectMetadataStore.getState().isDirty(path)).toBe(false);
  });
});
