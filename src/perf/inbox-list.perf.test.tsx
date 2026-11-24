// @vitest-environment jsdom

/**
 * Performance benchmarks for the desktop Inbox list at N = 350 — the size
 * of the Inbox the 2026-11 performance review was written against (finding
 * I-X: "no Inbox instrumentation exists").
 *
 * Four scenarios, each with a wall-clock budget AND the structural count
 * that the budget follows from. The counts are the real guard: jsdom timing
 * is noisy, but "17 rows mounted" and "2 rows re-rendered" are exact.
 *
 * - **Mount** — returning to the list. The view unmounts every time an item
 *   opens, so this is paid on every ‹ Inbox. Before the list was windowed it
 *   mounted all 350 rows, each with its own Radix context menu.
 * - **Cursor move** — one `j`. Re-renders the row the cursor left and the
 *   row it landed on.
 * - **⌘A, then a cursor move** — with all 350 selected, membership used to
 *   be `selection.includes(path)` per row: O(items × selection) per render.
 * - **Reload of an unchanged listing** — every watcher batch under the
 *   folder and every open lists it again; nothing changed, so no row may
 *   re-render.
 *
 * jsdom lays nothing out, so `stubInboxLayout` gives the scroller a height
 * and each line a height. Which lines mount is still the real windowing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/component-harness";
import { setMockInvokeHandler, registerDefaultHandlers } from "@/test/tauri-mock";
import { InboxView, resetInboxViewScroll } from "@/components/inbox/InboxView";
import { useInboxStore, resetInboxCaches } from "@/stores/inbox-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { inboxListing, stubInboxLayout, type InboxLayoutStub } from "@/components/inbox/__tests__/inbox-layout-stub";

// Stable across renders, as the real hook's callbacks are: a fresh function
// per render would re-render every row for a reason the app does not have.
const fileOps = vi.hoisted(() => ({ openFile: async () => undefined, renamePath: async () => true }));
vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: () => fileOps,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/lib/desktop-thumbnails", () => ({
  getDesktopThumbnail: async () => ({ kind: "icon" }),
  evictDesktopThumbnail: () => undefined,
}));

// One FileIcon per row render (the thumbnails above are icons) and it is not
// memoised, so its render count is the rows' render count.
let rowRenders = 0;
vi.mock("@/components/sidebar/FileIcon", () => ({
  FileIcon: () => {
    rowRenders += 1;
    return null;
  },
}));

const ROOT = "/Users/peter/Notesage";
const INBOX = `${ROOT}/Inbox`;
const N = 350;

const BUDGET_MULTIPLIER = parseFloat(process.env.PERF_BUDGET_MULTIPLIER || "1");
const ITERATIONS = 5;
const TEST_TIMEOUT_MS = 30_000 * BUDGET_MULTIPLIER;

/**
 * Budgets, in jsdom. Set at roughly three times what the windowed list
 * measures locally, so a regression that brings back per-item work (350
 * rows is ~20× the window) fails loudly without flaking on a busy runner.
 */
const MOUNT_BUDGET_MS = 150;
const CURSOR_BUDGET_MS = 25;
const RELOAD_BUDGET_MS = 60;
/** 800px of 80px rows, plus the overscan each way. */
const MAX_MOUNTED_ROWS = 24;

interface MeasureResult {
  name: string;
  median: number;
  budget: number;
  passed: boolean;
  samples: number[];
}

function logResult(r: MeasureResult): void {
  const verdict = r.passed ? "PASS" : "FAIL";
  console.log(
    `[perf] ${verdict} ${r.name}: ${r.median.toFixed(2)}ms (budget: ${r.budget.toFixed(0)}ms, samples: [${r.samples
      .map((s) => s.toFixed(1))
      .join(", ")}])`,
  );
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function check(name: string, samples: number[], budgetMs: number): void {
  const budget = budgetMs * BUDGET_MULTIPLIER;
  const med = median(samples);
  const result: MeasureResult = { name, median: med, budget, passed: med < budget, samples };
  logResult(result);
  expect(result.passed).toBe(true);
}

function rows(): HTMLElement[] {
  return screen.queryAllByTestId("inbox-row");
}

let layout: InboxLayoutStub;
let listing: ReturnType<typeof inboxListing>;

beforeEach(async () => {
  registerDefaultHandlers();
  resetInboxCaches();
  resetInboxViewScroll();
  layout = stubInboxLayout({ viewport: 800, row: 80, header: 36 });
  listing = inboxListing(INBOX, N);
  setMockInvokeHandler("list_files_shallow", () => listing);
  setMockInvokeHandler("read_file", () => {
    throw new Error("no sidecar");
  });
  setMockInvokeHandler("inbox_card_meta", () => ({ title: "A title", excerpt: "An excerpt.", minutes: 4, site: "example.org", sourceUrl: null }));
  useSettingsStore.setState({ notesRootPath: "~/Notesage", homeDir: "/Users/peter", inboxLayout: "list", inboxCondensed: false, inboxGallerySize: "medium" });
  useWorkspaceStore.setState({ pinnedFiles: [], projects: [{ path: `${ROOT}/Research`, fileTree: [] }] });
  useInboxStore.setState({
    open: true, dir: null, items: [], loading: false, error: null, progress: { version: 2, items: {} },
    meta: {}, filter: "", selection: [], cursor: null, anchor: null, lastDestination: null, activeItem: null,
  });
  // The listing is in the store before the view mounts — as it is in the
  // app, where the sidebar row lists the folder at launch.
  await useInboxStore.getState().load();
  rowRenders = 0;
});

afterEach(() => {
  layout.restore();
});

/** Mount the view over the loaded listing and wait for its window. */
async function mountView(): Promise<{ unmount: () => void }> {
  const view = renderWithProviders(<InboxView />);
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  // Let the mount's own reload and the header batch land.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  return view;
}

describe(`inbox list (N=${N})`, () => {
  it(
    `mount within ${MOUNT_BUDGET_MS}ms, with a window of rows — not ${N}`,
    async () => {
      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i += 1) {
        const t0 = performance.now();
        const view = renderWithProviders(<InboxView />);
        // The window appears in the commit after the viewport is measured,
        // which `render` has flushed.
        const mounted = rows().length;
        samples.push(performance.now() - t0);
        expect(mounted).toBeGreaterThanOrEqual(10);
        expect(mounted).toBeLessThanOrEqual(MAX_MOUNTED_ROWS);
        await act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
        view.unmount();
        resetInboxViewScroll();
      }
      expect(document.querySelectorAll('[data-slot="context-menu-trigger"]')).toHaveLength(0);
      check(`inbox mount (N=${N})`, samples, MOUNT_BUDGET_MS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `cursor move within ${CURSOR_BUDGET_MS}ms, re-rendering 2 rows`,
    async () => {
      const view = await mountView();
      try {
        fireEvent.click(rows()[0]);
        const samples: number[] = [];
        for (let i = 0; i < ITERATIONS; i += 1) {
          rowRenders = 0;
          const t0 = performance.now();
          fireEvent.keyDown(document.activeElement as Element, { key: "j" });
          samples.push(performance.now() - t0);
          expect(rowRenders).toBe(2);
        }
        expect(useInboxStore.getState().cursor).toBe(listing[ITERATIONS].path);
        check(`inbox cursor move (N=${N})`, samples, CURSOR_BUDGET_MS);
      } finally {
        view.unmount();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `cursor move with all ${N} selected (⌘A) within ${CURSOR_BUDGET_MS}ms, re-rendering 2 rows`,
    async () => {
      const view = await mountView();
      try {
        fireEvent.click(rows()[0]);
        fireEvent.keyDown(document.activeElement as Element, { key: "a", metaKey: true });
        expect(useInboxStore.getState().selection).toHaveLength(N);
        const samples: number[] = [];
        for (let i = 0; i < ITERATIONS; i += 1) {
          rowRenders = 0;
          const t0 = performance.now();
          fireEvent.keyDown(document.activeElement as Element, { key: "j" });
          samples.push(performance.now() - t0);
          expect(rowRenders).toBe(2);
        }
        expect(useInboxStore.getState().selection).toHaveLength(N);
        check(`inbox cursor move, all selected (N=${N})`, samples, CURSOR_BUDGET_MS);
      } finally {
        view.unmount();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `reload of an unchanged listing within ${RELOAD_BUDGET_MS}ms, re-rendering 0 rows`,
    async () => {
      const view = await mountView();
      try {
        const samples: number[] = [];
        for (let i = 0; i < ITERATIONS; i += 1) {
          // Fresh objects from the backend each time, same content.
          listing = listing.map((e) => ({ ...e }));
          const before = useInboxStore.getState().items;
          rowRenders = 0;
          const t0 = performance.now();
          await act(async () => {
            await useInboxStore.getState().load();
          });
          samples.push(performance.now() - t0);
          expect(rowRenders).toBe(0);
          expect(useInboxStore.getState().items).toBe(before);
        }
        check(`inbox reload, unchanged (N=${N})`, samples, RELOAD_BUDGET_MS);
      } finally {
        view.unmount();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
