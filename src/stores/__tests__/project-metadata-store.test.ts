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
    const { setMetadata, updateMetadata } = useProjectMetadataStore.getState();
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
    const { setMetadata, removeMetadata, getMetadata } = useProjectMetadataStore.getState();
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
