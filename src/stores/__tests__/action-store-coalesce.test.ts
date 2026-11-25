// @vitest-environment jsdom

/**
 * How many scans a burst of changes costs (performance review 2026-11, S-5).
 *
 * Every save and every watched `.md`/`.json` path used to re-query its whole
 * project (3 IPC calls) on its own. A burst now costs one scan per project
 * per debounce window, and a path that cannot hold actions costs nothing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import '@/test/tauri-mock';

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    indexTasks: vi.fn(),
    indexGoals: vi.fn(),
    scanActions: vi.fn(),
  },
}));

vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), perf: vi.fn() },
  };
});

import { useActionStore, canHoldActions, ACTION_SCAN_DEBOUNCE_MS } from '../action-store';
import { useWorkspaceStore } from '../workspace-store';
import { useSettingsStore } from '../settings-store';
import { tauriApi } from '@/lib/tauri';

const api = vi.mocked(tauriApi);

const A = '/lib/Alpha';
const B = '/lib/Beta';

const task = (path: string, text: string) => ({
  path,
  position: 0,
  text,
  done: false,
  project_name: 'p',
  context_before: '',
  context_after: '',
});

/** Total IPC calls made by scans. One scan is three. */
const ipcCalls = () =>
  api.indexTasks.mock.calls.length + api.indexGoals.mock.calls.length + api.scanActions.mock.calls.length;

async function passWindow() {
  await vi.advanceTimersByTimeAsync(ACTION_SCAN_DEBOUNCE_MS + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  api.indexTasks.mockImplementation(async (roots: string[]) =>
    roots.map((r) => task(`${r}/todo.md`, `task in ${r}`)) as never,
  );
  api.indexGoals.mockResolvedValue([]);
  api.scanActions.mockResolvedValue([]);
  useWorkspaceStore.setState({
    projects: [
      { path: A, fileTree: [] },
      { path: B, fileTree: [] },
      { path: '/lib/Gamma', fileTree: [] },
      { path: '/lib/Delta', fileTree: [] },
    ],
    explorerFolders: [],
  });
  useSettingsStore.setState({ notesRootPath: '/notes', indexReady: true });
  useActionStore.setState({ actionCache: {}, actions: [], _consecutiveFailures: 0, _scanDisabled: false });
});

afterEach(async () => {
  // Drain any window a test left open so it cannot fire in the next test.
  await vi.advanceTimersByTimeAsync(ACTION_SCAN_DEBOUNCE_MS * 2);
  vi.useRealTimers();
});

describe('canHoldActions', () => {
  it('is true for markdown and for comment sidecars only', () => {
    expect(canHoldActions(`${A}/notes/todo.md`)).toBe(true);
    expect(canHoldActions(`${A}/.notesage/comments/3f2a.json`)).toBe(true);
    expect(canHoldActions(`${A}/.notesage/research/topic.md`)).toBe(true);

    expect(canHoldActions(`${A}/.notesage/project.json`)).toBe(false);
    expect(canHoldActions(`${A}/.notesage/doc-index.json`)).toBe(false);
    expect(canHoldActions('/lib/Inbox/.notesage/reading-progress.json')).toBe(false);
    expect(canHoldActions('/lib/Inbox/saved-page.html')).toBe(false);
    expect(canHoldActions(`${A}/photo.png`)).toBe(false);
    expect(canHoldActions(`${A}/data.json`)).toBe(false);
  });
});

describe('incrementalUpdate', () => {
  it('turns N saves in a burst into one scan of the project', async () => {
    const store = useActionStore.getState();
    for (let i = 0; i < 12; i++) void store.incrementalUpdate(`${A}/doc-${i}.md`);

    // Nothing yet: the window is still open.
    expect(ipcCalls()).toBe(0);

    await passWindow();

    expect(api.indexTasks).toHaveBeenCalledTimes(1);
    expect(api.indexTasks).toHaveBeenCalledWith([A]);
    expect(api.indexGoals).toHaveBeenCalledTimes(1);
    expect(api.scanActions).toHaveBeenCalledTimes(1);
    expect(useActionStore.getState().actions.map((a) => a.text)).toEqual([`task in ${A}`]);
  });

  it('scans each project once when a burst spans two of them', async () => {
    const store = useActionStore.getState();
    for (let i = 0; i < 5; i++) {
      void store.incrementalUpdate(`${A}/a-${i}.md`);
      void store.incrementalUpdate(`${B}/b-${i}.md`);
    }

    await passWindow();

    expect(api.indexTasks.mock.calls.map((c) => c[0])).toEqual([[A], [B]]);
    expect(ipcCalls()).toBe(6);
  });

  it('a save and the reindex notice that follows it end in one scan', async () => {
    const store = useActionStore.getState();
    void store.incrementalUpdate(`${A}/todo.md`); // the save itself
    // The backend's watcher debounce (500 ms) plus the reindex, then
    // `links-reindexed`, which `useActionScanner` reports as the same path.
    await vi.advanceTimersByTimeAsync(600);
    expect(ipcCalls()).toBe(0);
    void store.incrementalUpdate(`${A}/todo.md`);

    await passWindow();

    expect(api.indexTasks).toHaveBeenCalledTimes(1);
  });

  it('updates the Actions view within the debounce window after a single save', async () => {
    const done = useActionStore.getState().incrementalUpdate(`${A}/todo.md`);

    await vi.advanceTimersByTimeAsync(ACTION_SCAN_DEBOUNCE_MS);
    await done;

    expect(ACTION_SCAN_DEBOUNCE_MS).toBeLessThanOrEqual(1000);
    expect(useActionStore.getState().actions).toHaveLength(1);
  });

  it('scans again for a change that arrives after the window has closed', async () => {
    const store = useActionStore.getState();
    void store.incrementalUpdate(`${A}/todo.md`);
    await passWindow();
    void store.incrementalUpdate(`${A}/todo.md`);
    await passWindow();

    expect(api.indexTasks).toHaveBeenCalledTimes(2);
  });

  it('makes no IPC call and opens no window for paths that cannot hold actions', async () => {
    const store = useActionStore.getState();
    await store.incrementalUpdate('/lib/Inbox/saved-page.html');
    await store.incrementalUpdate(`${A}/photo.png`);
    await store.incrementalUpdate(`${A}/.notesage/project.json`);
    await store.incrementalUpdate(`${A}/.notesage/doc-index.json`);

    expect(vi.getTimerCount()).toBe(0);
    await passWindow();
    expect(ipcCalls()).toBe(0);
  });

  it('makes no IPC call for a markdown file outside every scanned root', async () => {
    await useActionStore.getState().incrementalUpdate('/somewhere/else/todo.md');

    await passWindow();
    expect(ipcCalls()).toBe(0);
  });

  it('falls back to one full scan when a burst touches many projects', async () => {
    const store = useActionStore.getState();
    for (const root of [A, B, '/lib/Gamma', '/lib/Delta']) {
      void store.incrementalUpdate(`${root}/todo.md`);
    }

    await passWindow();

    // One query across everything, not four project scans.
    expect(api.indexTasks).toHaveBeenCalledTimes(1);
    expect(api.indexTasks.mock.calls[0][0]).toEqual([A, B, '/lib/Gamma', '/lib/Delta', '/notes']);
    expect(ipcCalls()).toBe(3);
  });

  it('does not overlap a scan that is still running: the next burst waits for it', async () => {
    let releaseFirst!: () => void;
    api.scanActions.mockImplementationOnce(
      () => new Promise((resolve) => { releaseFirst = () => resolve([]); }),
    );
    const store = useActionStore.getState();

    void store.incrementalUpdate(`${A}/todo.md`);
    await passWindow();
    expect(api.indexTasks).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) void store.incrementalUpdate(`${A}/todo.md`);
    await passWindow();
    // The first scan has not returned, so the second has not started.
    expect(api.indexTasks).toHaveBeenCalledTimes(1);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.indexTasks).toHaveBeenCalledTimes(2);
  });
});

describe('refreshRoot', () => {
  it('scans the whole root once, with no changed file to point at', async () => {
    void useActionStore.getState().refreshRoot(A);
    expect(ipcCalls()).toBe(0);

    await passWindow();

    expect(api.indexTasks).toHaveBeenCalledTimes(1);
    expect(api.indexTasks).toHaveBeenCalledWith([A]);
    expect(ipcCalls()).toBe(3);
    expect(useActionStore.getState().actions.map((a) => a.text)).toEqual([`task in ${A}`]);
  });

  it('shares its window with the saves of the same project', async () => {
    const store = useActionStore.getState();
    void store.incrementalUpdate(`${A}/doc.md`);
    void store.refreshRoot(A);

    await passWindow();

    expect(ipcCalls()).toBe(3);
  });

  it('makes no IPC call for a root that is not scanned (a project removed meanwhile)', async () => {
    await useActionStore.getState().refreshRoot('/lib/Removed');
    await passWindow();

    expect(ipcCalls()).toBe(0);
  });
});

describe('while the startup index pass is still running', () => {
  beforeEach(() => {
    useSettingsStore.setState({ indexReady: false });
    useActionStore.setState({
      actions: [{ id: 'task:/lib/Alpha/todo.md:0', source_type: 'task', status: 'open', text: 'from last session', file_path: `${A}/todo.md` }],
    });
  });

  it('fullScan keeps the cached actions instead of replacing them with a partial answer', async () => {
    await useActionStore.getState().fullScan();

    expect(ipcCalls()).toBe(0);
    expect(useActionStore.getState().actions.map((a) => a.text)).toEqual(['from last session']);
    expect(useActionStore.getState().isScanning).toBe(false);
  });

  it('refreshRoot is dropped: the full scan at index-ready covers it', async () => {
    await useActionStore.getState().refreshRoot(A);
    await passWindow();

    expect(ipcCalls()).toBe(0);
  });

  it('incrementalUpdate is dropped: the full scan at index-ready covers it', async () => {
    await useActionStore.getState().incrementalUpdate(`${A}/todo.md`);
    await passWindow();

    expect(ipcCalls()).toBe(0);
  });

  it('fullScan runs once the index is ready', async () => {
    useSettingsStore.setState({ indexReady: true });

    await useActionStore.getState().fullScan();

    expect(ipcCalls()).toBe(3);
  });
});
