// @vitest-environment jsdom

/**
 * Loading `project.json` must never turn "could not read it" into "it is
 * empty" (audit 2026-11-22 §10): defaults are written only when the file is
 * confirmed absent, and an unreadable file fails the provider lock CLOSED.
 */

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), perf: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createDirectory: vi.fn(),
    renamePath: vi.fn(),
    icloudEnsureDownloaded: vi.fn(),
  },
}));

import { loadProjectMetadata } from '../useProjectMetadata';
import {
  useProjectMetadataStore,
  createDefaultMetadata,
  METADATA_UNAVAILABLE_LOCK_ID,
  type ProjectMetadata,
} from '@/stores/project-metadata-store';
import { findLockConflict, getProjectLock } from '@/lib/ai/project-lock';
import { tauriApi } from '@/lib/tauri';
import { toast } from 'sonner';

const api = vi.mocked(tauriApi);

const PROJECT = '/notes/Client';
const DIR = `${PROJECT}/.notesage`;
const FILE = `${DIR}/project.json`;
const PLACEHOLDER = `${DIR}/.project.json.icloud`;

const LOCKED: ProjectMetadata = {
  ...createDefaultMetadata('Client'),
  aiLock: { connectionId: 'conn-local', lockedAt: 1 },
};

/** `pathExists` answers from the set of paths that are on disk. */
function onDisk(...paths: string[]) {
  const present = new Set(paths);
  api.pathExists.mockImplementation(async (p: string) => present.has(p));
}

const store = () => useProjectMetadataStore.getState();
const load = () => loadProjectMetadata(PROJECT, store().setMetadata);

beforeEach(() => {
  vi.clearAllMocks();
  api.pathExists.mockReset();
  api.readFile.mockReset();
  api.writeFile.mockReset().mockResolvedValue(undefined);
  api.createDirectory.mockReset().mockResolvedValue(undefined);
  api.icloudEnsureDownloaded.mockReset().mockResolvedValue('downloading');
  useProjectMetadataStore.setState({
    metadataMap: {},
    dirtyPaths: new Set(),
    unavailablePaths: new Set(),
  });
});

describe('loadProjectMetadata', () => {
  it('writes defaults when project.json is absent and there is no iCloud placeholder', async () => {
    onDisk(PROJECT, DIR);

    await load();

    expect(api.writeFile).toHaveBeenCalledWith(FILE, expect.any(String));
    expect(store().metadataMap[PROJECT]).toEqual(createDefaultMetadata('Client'));
    expect(store().unavailablePaths.has(PROJECT)).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does NOT write defaults over an evicted project.json, and fails the lock closed', async () => {
    onDisk(PROJECT, DIR, PLACEHOLDER);

    await load();

    expect(api.writeFile).not.toHaveBeenCalled();
    expect(api.icloudEnsureDownloaded).toHaveBeenCalledWith(FILE);
    expect(store().unavailablePaths.has(PROJECT)).toBe(true);
    expect(getProjectLock(PROJECT, store().metadataMap)).toEqual({
      connectionId: METADATA_UNAVAILABLE_LOCK_ID,
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('fails the lock closed when the read throws: no connection may send', async () => {
    onDisk(PROJECT, DIR, FILE);
    api.readFile.mockRejectedValue(new Error('Operation not permitted'));

    await load();

    expect(api.writeFile).not.toHaveBeenCalled();
    const map = store().metadataMap;
    for (const attempted of ['conn-local', 'conn-cloud', null]) {
      expect(findLockConflict([PROJECT], map, attempted)).toEqual({
        projectPath: PROJECT,
        lockedConnectionId: METADATA_UNAVAILABLE_LOCK_ID,
      });
    }
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('fails closed on unparseable JSON (a half-synced file)', async () => {
    onDisk(PROJECT, DIR, FILE);
    api.readFile.mockResolvedValue('{"version":1,"name":"Cli');

    await load();

    expect(store().unavailablePaths.has(PROJECT)).toBe(true);
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it('fails closed when an invalid file carries an aiLock, rather than dropping the lock', async () => {
    onDisk(PROJECT, DIR, FILE);
    api.readFile.mockResolvedValue(JSON.stringify({ name: 'Client', aiLock: { connectionId: 'conn-local' } }));

    await load();

    expect(getProjectLock(PROJECT, store().metadataMap)).not.toBeNull();
    expect(store().unavailablePaths.has(PROJECT)).toBe(true);
  });

  it('the toast offers a retry, and a successful retry restores the real lock', async () => {
    onDisk(PROJECT, DIR, FILE);
    api.readFile.mockRejectedValueOnce(new Error('busy'));
    await load();

    const options = vi.mocked(toast.error).mock.calls[0][1] as unknown as {
      action: { onClick: () => void };
    };
    api.readFile.mockResolvedValue(JSON.stringify(LOCKED));
    options.action.onClick();
    await vi.waitFor(() => expect(store().unavailablePaths.has(PROJECT)).toBe(false));

    expect(getProjectLock(PROJECT, store().metadataMap)).toEqual({ connectionId: 'conn-local' });
    expect(findLockConflict([PROJECT], store().metadataMap, 'conn-local')).toBeNull();
    expect(api.writeFile).not.toHaveBeenCalled();
  });
});

describe('an unavailable project cannot be edited into a save', () => {
  it('ignores every mutator, so the stand-in never becomes dirty', () => {
    store().setMetadataUnavailable(PROJECT, 'unreadable');

    store().clearAiLock(PROJECT);
    store().setAiLock(PROJECT, 'conn-cloud');
    store().updateMetadata(PROJECT, { name: 'Renamed' });
    store().updateAI(PROJECT, { projectContext: 'x' });
    store().setAppearance(PROJECT, { iconName: 'Star', colorIndex: 1 });
    store().clearAppearance(PROJECT);

    expect(store().dirtyPaths.has(PROJECT)).toBe(false);
    expect(store().metadataMap[PROJECT].aiLock?.connectionId).toBe(METADATA_UNAVAILABLE_LOCK_ID);
    expect(store().metadataMap[PROJECT].name).toBe('Client');
  });

  it('setMetadata and removeMetadata clear the unavailable mark', () => {
    store().setMetadataUnavailable(PROJECT, 'unreadable');
    store().setMetadata(PROJECT, LOCKED);
    expect(store().unavailablePaths.has(PROJECT)).toBe(false);

    store().setMetadataUnavailable(PROJECT, 'unreadable');
    store().removeMetadata(PROJECT);
    expect(store().unavailablePaths.has(PROJECT)).toBe(false);
  });
});
