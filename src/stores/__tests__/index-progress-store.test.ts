import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HIDE_GRACE_MS,
  SHOW_DELAY_MS,
  resetIndexProgressForTests,
  useIndexProgressStore,
} from '../index-progress-store';

const WORK = '/lib/Work';
const HOME = '/lib/Home';

const store = () => useIndexProgressStore.getState();
const status = () => store().status;

/** Startup is over, so only what the test starts counts as indexing. */
function settled(projects: string[] = [WORK, HOME]) {
  store().setProjects(projects);
  store().setStartupSettled(true);
}

describe('index-progress-store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetIndexProgressForTests();
  });

  afterEach(() => {
    resetIndexProgressForTests();
    vi.useRealTimers();
  });

  it('shows nothing for a pass that is over before the show delay', () => {
    settled();
    store().begin(WORK);
    store().progress({ project_path: WORK, current: 0, total: 3 });
    vi.advanceTimersByTime(SHOW_DELAY_MS - 1);
    expect(status().active).toBe(false);

    store().ready(WORK);
    store().settle(WORK);
    vi.advanceTimersByTime(SHOW_DELAY_MS * 4);
    expect(status().active).toBe(false);
  });

  it('shows a pass that outlasts the show delay, with one total across scopes', () => {
    settled();
    store().begin(WORK);
    store().begin(HOME);
    store().progress({ project_path: WORK, current: 100, total: 2000 });
    store().progress({ project_path: HOME, current: 50, total: 1000 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);

    expect(status()).toMatchObject({
      active: true,
      filesDone: 150,
      filesTotal: 3000,
      pendingScopes: 0,
      currentScopes: [WORK, HOME],
    });
    expect(status().fraction).toBeCloseTo(0.05);
  });

  it('lingers for the grace period after the last pass, at 100%, then goes idle', () => {
    settled();
    store().begin(WORK);
    store().progress({ project_path: WORK, current: 10, total: 400 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    store().ready(WORK);
    store().settle(WORK);

    expect(status()).toMatchObject({ active: true, filesDone: 400, filesTotal: 400, fraction: 1 });
    vi.advanceTimersByTime(HIDE_GRACE_MS - 1);
    expect(status().active).toBe(true);
    vi.advanceTimersByTime(1);
    expect(status().active).toBe(false);
  });

  it('does not flicker off when the next pass starts inside the grace period', () => {
    settled();
    store().begin(WORK);
    store().progress({ project_path: WORK, current: 0, total: 400 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    store().settle(WORK);

    vi.advanceTimersByTime(HIDE_GRACE_MS - 100);
    store().begin(HOME);
    store().progress({ project_path: HOME, current: 0, total: 100 });
    vi.advanceTimersByTime(HIDE_GRACE_MS * 2);

    // Still showing, and the two passes read as one burst.
    expect(status()).toMatchObject({ active: true, filesDone: 400, filesTotal: 500 });
  });

  it('starts the next burst from zero once the indicator has gone', () => {
    settled();
    store().begin(WORK);
    store().progress({ project_path: WORK, current: 0, total: 400 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    store().settle(WORK);
    vi.advanceTimersByTime(HIDE_GRACE_MS);
    expect(status().active).toBe(false);

    store().begin(HOME);
    store().progress({ project_path: HOME, current: 20, total: 100 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(status()).toMatchObject({ active: true, filesDone: 20, filesTotal: 100 });
  });

  it('at startup stays on from the first pass until startup has settled, across the gap between passes', () => {
    store().setProjects([WORK, HOME]);
    store().begin(null);
    store().progress({ project_path: null, current: 0, total: 100 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(status()).toMatchObject({ active: true, pendingScopes: 2, fraction: null });

    // Global pass done; the projects have not begun. Not over.
    store().ready(null);
    store().settle(null);
    vi.advanceTimersByTime(HIDE_GRACE_MS * 3);
    expect(status().active).toBe(true);

    store().begin(WORK);
    store().begin(HOME);
    store().progress({ project_path: WORK, current: 0, total: 600 });
    store().progress({ project_path: HOME, current: 0, total: 300 });
    expect(status()).toMatchObject({ pendingScopes: 0, filesDone: 100, filesTotal: 1000 });
    expect(status().fraction).toBeCloseTo(0.1);

    for (const path of [WORK, HOME]) {
      store().ready(path);
      store().settle(path);
    }
    // Every scope is ready but `indexReady` is not true yet.
    vi.advanceTimersByTime(HIDE_GRACE_MS * 3);
    expect(status().active).toBe(true);

    store().setStartupSettled(true);
    expect(status()).toMatchObject({ active: true, filesDone: 1000, filesTotal: 1000, fraction: 1 });
    vi.advanceTimersByTime(HIDE_GRACE_MS);
    expect(status().active).toBe(false);
  });

  it('is not indexing when startup never began a pass, before or after it settles', () => {
    store().setProjects([WORK]);
    vi.advanceTimersByTime(SHOW_DELAY_MS * 3);
    expect(status().active).toBe(false);
    store().setStartupSettled(true);
    vi.advanceTimersByTime(SHOW_DELAY_MS * 3);
    expect(status().active).toBe(false);
  });

  it('an index-ready with no pass before it starts nothing', () => {
    settled();
    store().ready(WORK);
    store().ready(null);
    vi.advanceTimersByTime(SHOW_DELAY_MS * 3);
    expect(status().active).toBe(false);
  });

  it('a pass that fails, and so never reports ready, ends when its command returns', () => {
    settled();
    store().begin(WORK);
    store().progress({ project_path: WORK, current: 50, total: 400 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(status().active).toBe(true);

    store().settle(WORK);
    vi.advanceTimersByTime(HIDE_GRACE_MS);
    expect(status().active).toBe(false);
  });

  it('a scope that never reports ready and has no command running ends when startup settles', () => {
    store().setProjects([WORK]);
    store().progress({ project_path: WORK, current: 50, total: 400 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(status().active).toBe(true);

    store().setStartupSettled(true);
    vi.advanceTimersByTime(HIDE_GRACE_MS);
    expect(status().active).toBe(false);
  });

  it('a mid-session pass with its command still running survives startup settling', () => {
    store().setProjects([WORK]);
    store().begin(WORK);
    store().progress({ project_path: WORK, current: 50, total: 400 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    store().setStartupSettled(true);
    vi.advanceTimersByTime(HIDE_GRACE_MS * 3);
    expect(status()).toMatchObject({ active: true, filesDone: 50, filesTotal: 400 });
  });

  it('drops a project removed mid-pass, and ignores what its pass goes on to report', () => {
    settled();
    store().begin(WORK);
    store().begin(HOME);
    store().progress({ project_path: WORK, current: 100, total: 2000 });
    store().progress({ project_path: HOME, current: 50, total: 1000 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);

    store().setProjects([HOME]);
    expect(status()).toMatchObject({ filesDone: 50, filesTotal: 1000, currentScopes: [HOME] });

    // The backend does not know the project is gone and keeps reporting.
    store().progress({ project_path: WORK, current: 150, total: 2000 });
    expect(status()).toMatchObject({ filesDone: 50, filesTotal: 1000 });
    store().ready(WORK);
    store().settle(WORK);

    // Added back later, it is an ordinary scope again.
    store().setProjects([HOME, WORK]);
    store().begin(WORK);
    store().progress({ project_path: WORK, current: 0, total: 2000 });
    expect(status()).toMatchObject({ filesDone: 50, filesTotal: 3000 });
  });

  it('a project added mid-session shows, after indexReady is already true', () => {
    settled([WORK]);
    store().setProjects([WORK, '/lib/Added']);
    store().begin('/lib/Added');
    store().progress({ project_path: '/lib/Added', current: 0, total: 80 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(status()).toMatchObject({
      active: true,
      filesTotal: 80,
      currentScopes: ['/lib/Added'],
      pendingScopes: 0,
    });
  });

  it('reads a payload without project_path (an older backend) as the global pass', () => {
    settled();
    store().progress({ current: 1, total: 4 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(status()).toMatchObject({ active: true, filesDone: 1, filesTotal: 4, currentScopes: [''] });
  });

  it('publishes nothing new for an event that changes nothing visible', () => {
    settled();
    store().progress({ project_path: WORK, current: 50, total: 400 });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    const before = status();
    store().progress({ project_path: WORK, current: 50, total: 400 });
    expect(status()).toBe(before);
  });
});
