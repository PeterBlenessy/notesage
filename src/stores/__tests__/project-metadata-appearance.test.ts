// @vitest-environment node

/**
 * Unit tests for folder appearance support in project-metadata-store (issue #140).
 *
 * Covers the new `appearance` field on ProjectMetadata: reading, writing,
 * updating, and JSON round-tripping (the project.json on-disk shape).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import {
  useProjectMetadataStore,
  createDefaultMetadata,
  type ProjectMetadata,
} from '../project-metadata-store';

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

beforeEach(() => {
  useProjectMetadataStore.setState({
    metadataMap: {},
    dirtyPaths: new Set<string>(),
  });
});

describe('ProjectMetadata — appearance field', () => {
  it('createDefaultMetadata omits appearance by default (backward compat)', () => {
    const meta = createDefaultMetadata('my-project');
    expect(meta.appearance).toBeUndefined();
  });

  it('setMetadata round-trips appearance via store', () => {
    const meta = makeMetadata({
      appearance: { iconName: 'Star', colorIndex: 2 },
    });
    useProjectMetadataStore.getState().setMetadata('/project/a', meta);

    const loaded = useProjectMetadataStore.getState().getMetadata('/project/a');
    expect(loaded?.appearance).toEqual({ iconName: 'Star', colorIndex: 2 });
  });

  it('appearance is preserved when updating other fields', () => {
    const meta = makeMetadata({
      appearance: { iconName: 'Moon', colorIndex: 5 },
    });
    useProjectMetadataStore.getState().setMetadata('/project/a', meta);
    useProjectMetadataStore.getState().updateMetadata('/project/a', { name: 'Renamed' });

    const loaded = useProjectMetadataStore.getState().getMetadata('/project/a');
    expect(loaded?.name).toBe('Renamed');
    expect(loaded?.appearance).toEqual({ iconName: 'Moon', colorIndex: 5 });
  });

  it('setAppearance stores iconName and colorIndex and marks project dirty', () => {
    const path = '/project/b';
    useProjectMetadataStore.getState().setMetadata(path, makeMetadata());
    useProjectMetadataStore.getState().setClean(path);
    expect(useProjectMetadataStore.getState().isDirty(path)).toBe(false);

    useProjectMetadataStore.getState().setAppearance(path, { iconName: 'Zap', colorIndex: 0 });

    const loaded = useProjectMetadataStore.getState().getMetadata(path);
    expect(loaded?.appearance).toEqual({ iconName: 'Zap', colorIndex: 0 });
    expect(useProjectMetadataStore.getState().isDirty(path)).toBe(true);
  });

  it('setAppearance is a no-op for non-existent paths', () => {
    useProjectMetadataStore.getState().setAppearance('/no/path', { iconName: 'Star', colorIndex: 1 });
    expect(useProjectMetadataStore.getState().getMetadata('/no/path')).toBeUndefined();
  });

  it('clearAppearance removes the appearance field and marks project dirty', () => {
    const path = '/project/c';
    useProjectMetadataStore.getState().setMetadata(path, makeMetadata({
      appearance: { iconName: 'Sun', colorIndex: 3 },
    }));
    useProjectMetadataStore.getState().setClean(path);

    useProjectMetadataStore.getState().clearAppearance(path);

    const loaded = useProjectMetadataStore.getState().getMetadata(path);
    expect(loaded?.appearance).toBeUndefined();
    expect(useProjectMetadataStore.getState().isDirty(path)).toBe(true);
  });

  it('clearAppearance is a no-op when no appearance is set', () => {
    const path = '/project/d';
    useProjectMetadataStore.getState().setMetadata(path, makeMetadata());
    useProjectMetadataStore.getState().setClean(path);

    useProjectMetadataStore.getState().clearAppearance(path);

    expect(useProjectMetadataStore.getState().isDirty(path)).toBe(false);
  });

  it('appearance round-trips through JSON (project.json shape)', () => {
    const meta = makeMetadata({
      appearance: { iconName: 'Briefcase', colorIndex: 7 },
    });
    const serialized = JSON.stringify(meta, null, 2);
    const parsed = JSON.parse(serialized) as ProjectMetadata;

    expect(parsed.appearance?.iconName).toBe('Briefcase');
    expect(parsed.appearance?.colorIndex).toBe(7);
  });

  it('appearance colorIndex can be null in JSON round-trip', () => {
    const meta = makeMetadata({
      appearance: { iconName: 'Book', colorIndex: null },
    });
    const parsed = JSON.parse(JSON.stringify(meta)) as ProjectMetadata;
    expect(parsed.appearance?.iconName).toBe('Book');
    expect(parsed.appearance?.colorIndex).toBeNull();
  });

  it('metadata without appearance round-trips unchanged (backward compat)', () => {
    const meta = makeMetadata();
    const parsed = JSON.parse(JSON.stringify(meta)) as ProjectMetadata;
    expect(parsed.appearance).toBeUndefined();
    expect(parsed).toEqual(meta);
  });
});
