// @vitest-environment jsdom

/**
 * `initIndexWithRecovery` tells the indexing indicator when a pass begins and
 * when it is over. The backend's `index-ready` cannot be the only "over":
 * a pass that fails does not emit it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import "@/test/tauri-mock";

const { indexInit } = vi.hoisted(() => ({
  indexInit: { impl: (async () => undefined) as (projectPath?: string) => Promise<unknown> },
}));

vi.mock("@/lib/tauri", () => ({
  tauriApi: {
    indexInit: vi.fn((projectPath?: string) => indexInit.impl(projectPath)),
    indexReset: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), perf: vi.fn() },
  };
});

import { initIndexWithRecovery } from "../project-index-sync";
import {
  HIDE_GRACE_MS,
  SHOW_DELAY_MS,
  resetIndexProgressForTests,
  useIndexProgressStore,
} from "@/stores/index-progress-store";

const status = () => useIndexProgressStore.getState().status;

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("initIndexWithRecovery and the indexing indicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetIndexProgressForTests();
    useIndexProgressStore.getState().setProjects(["/lib/Work"]);
    useIndexProgressStore.getState().setStartupSettled(true);
  });

  afterEach(() => {
    resetIndexProgressForTests();
    vi.useRealTimers();
  });

  it("is indexing while index_init runs, before any progress event, and over when it returns", async () => {
    const pass = deferred();
    indexInit.impl = () => pass.promise;

    const done = initIndexWithRecovery("/lib/Work");
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(status()).toMatchObject({ active: true, filesTotal: 0, fraction: null });

    pass.resolve();
    expect(await done).toBe(true);
    vi.advanceTimersByTime(HIDE_GRACE_MS);
    expect(status().active).toBe(false);
  });

  it("is over when the pass fails for good, although no index-ready was ever emitted", async () => {
    indexInit.impl = async () => {
      throw new Error("database disk image is malformed");
    };
    const store = useIndexProgressStore.getState();
    const settle = vi.spyOn(store, "settle");

    const done = initIndexWithRecovery("/lib/Work");
    store.progress({ project_path: "/lib/Work", current: 10, total: 400 });
    expect(await done).toBe(false);

    vi.advanceTimersByTime(SHOW_DELAY_MS + HIDE_GRACE_MS);
    expect(status().active).toBe(false);
    settle.mockRestore();
  });

  it("brackets the recovery retry as one pass: still indexing between the failure and the retry", async () => {
    const retry = deferred();
    let attempt = 0;
    indexInit.impl = () => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error("corrupt")) : retry.promise;
    };

    const done = initIndexWithRecovery();
    await vi.advanceTimersByTimeAsync(SHOW_DELAY_MS);
    expect(attempt).toBe(2);
    expect(status().active).toBe(true);

    retry.resolve();
    expect(await done).toBe(true);
    vi.advanceTimersByTime(HIDE_GRACE_MS);
    expect(status().active).toBe(false);
  });
});
