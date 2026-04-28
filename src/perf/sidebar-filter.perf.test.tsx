// @vitest-environment jsdom

/**
 * Performance benchmarks for the QuietSidebar type-to-filter behavior
 * (PRD `2026-04-21-ui-refresh`, task #43 / perf task #91).
 *
 * Drives a single keystroke into the focused sidebar `<nav>`, which sets a
 * local `filter` string and re-renders all four sections (Pinned / Projects /
 * Recent / Tags). Each section applies the filter to its own data.
 *
 * Two scenarios per dataset size:
 *
 * - **First keystroke** — filter starts empty. Measures the cost of the
 *   first re-render where the filter prop transitions from "" to one
 *   character. Each iteration unmounts + remounts so every measurement
 *   starts from the same cold state. Budget: 50 ms.
 * - **Subsequent keystroke** — filter is already non-empty. Measures the
 *   steady-state per-keystroke re-render where the filtered-list memo
 *   path was already active. Budget: 20 ms.
 *
 * Dataset sizes: N ∈ {100, 500, 2000} pinned items (the dominant section).
 * Recent / Projects / Tags also seeded so the benchmark exercises every
 * filter consumer in QuietSidebar — Recent is capped at the section's
 * default of 5 visible rows by `sidebarRecentCap`, Tags is stubbed empty
 * via the mocked `tauriApi.indexTags`, Projects is left empty.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/component-harness";
import {
  setMockInvokeHandler,
  registerDefaultHandlers,
} from "@/test/tauri-mock";
import { QuietSidebar } from "@/components/sidebar/quiet/QuietSidebar";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";

// ---------------------------------------------------------------------------
// Mocks — keep async side-effects of the heavier sections quiet so we only
// measure the filter re-render cost. Mirrors the patterns used by the
// per-section unit tests in src/components/sidebar/quiet/__tests__.
// ---------------------------------------------------------------------------

vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: () => ({
    openFile: vi.fn(),
    openFileAtTag: vi.fn(),
    openFileAtText: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    deletePath: vi.fn(),
    refreshFileTree: vi.fn(),
  }),
}));

// Stub `tauriApi.indexTags` — TagsSection's mount effect would otherwise
// throw against the test invoke mock, and we don't want index latency in the
// keystroke measurement anyway.
vi.mock("@/lib/tauri", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/tauri")>("@/lib/tauri");
  return {
    ...actual,
    tauriApi: {
      ...actual.tauriApi,
      indexTags: vi.fn().mockResolvedValue([]),
      listDirectory: vi.fn().mockResolvedValue([]),
    },
  };
});

// ---------------------------------------------------------------------------
// Seeders
// ---------------------------------------------------------------------------

function seedPinnedAndRecent(count: number): void {
  // Build an alphabetically diverse pool — every file gets a distinct
  // basename so substring matches against single characters return a
  // non-trivial subset.
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const pinned: string[] = [];
  const recentFiles: { path: string; name: string }[] = [];
  for (let i = 0; i < count; i++) {
    const letter = letters[i % letters.length];
    const name = `${letter}-note-${i}.md`;
    const path = `/project/${letter}/${name}`;
    pinned.push(path);
    recentFiles.push({ path, name });
  }
  useWorkspaceStore.setState({ pinnedFiles: pinned });
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    recentFiles,
    persistedTabs: [],
  });
}

function fullReset(): void {
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
  });
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    recentFiles: [],
    persistedTabs: [],
  });
  useSettingsStore.setState({
    sidebarRecentCap: 5,
    sidebarTagsCap: 5,
    sidebarMentionsCap: 5,
  });
}

// ---------------------------------------------------------------------------
// Benchmark setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  registerDefaultHandlers();
  // The few index/research commands that the sidebar surface might ping —
  // make them no-ops so nothing throws during the keystroke.
  setMockInvokeHandler("index_tags", () => []);
  setMockInvokeHandler("index_mentions", () => []);
  setMockInvokeHandler("index_search", () => []);
  setMockInvokeHandler("search_research", () => []);
  fullReset();
});

/**
 * Render `<QuietSidebar />`, locate its `<nav>` element, and focus it so the
 * filter `keydown` handler is the first to receive printable keys.
 */
function mountAndFocus(): { nav: HTMLElement; cleanup: () => void } {
  const { container, unmount } = renderWithProviders(<QuietSidebar />);
  const nav = container.querySelector(
    'nav[aria-label="Workspace sidebar"]',
  ) as HTMLElement | null;
  if (!nav) throw new Error("QuietSidebar nav not found");
  nav.focus();
  return { nav, cleanup: unmount };
}

/**
 * Drive a single character keystroke into the sidebar `<nav>`. RTL's
 * `fireEvent` runs the React event handler synchronously and flushes the
 * resulting state update + re-render before returning, so the elapsed time
 * around this call is the keystroke-to-paint cost we care about.
 */
function dispatchKey(nav: HTMLElement, key: string): void {
  fireEvent.keyDown(nav, { key });
}

/**
 * Budget multiplier applied to the spec budgets in CI / on slower hardware.
 * Mirrors the convention used by `harness.ts`. PERF_BUDGET_MULTIPLIER=1.5
 * is set in `.github/workflows/test.yml` for the perf job.
 */
const BUDGET_MULTIPLIER = parseFloat(
  process.env.PERF_BUDGET_MULTIPLIER || "1",
);

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

// ---------------------------------------------------------------------------
// Sizes & budgets
// ---------------------------------------------------------------------------

/**
 * Per-size budgets for the first keystroke (cold filter transition empty → "a").
 *
 * The user-facing spec target is 50ms regardless of N (per PRD task #43),
 * but the cost of this keystroke is dominated by React unmounting roughly
 * (N − filtered_count) PinnedRow + RecentRow components, which scales linearly
 * with N. Hitting 50ms at N=2000 needs windowed virtualization; until that
 * lands, the budgets below cap the regression at ~2x current measured cost
 * so any future change that doubles render time fails CI loudly.
 *
 * Sidebar #23 — PinnedRow is now wrapped in `React.memo` and every
 * handler the parent passes is `useCallback`-stable. That makes the
 * subsequent-keystroke path (where the filter only narrows) skip
 * re-rendering rows whose props are unchanged. The first-keystroke
 * cost is unchanged — it's bottlenecked on unmounting filtered-out
 * rows, not on rendering the survivors.
 *
 * Sidebar #24 — budgets tightened from the historical jsdom-ceiling
 * values (50 / 500 / 8000ms) to ~2x current measured cost (50 / 100 /
 * 400ms). Real Chromium is ~5–10x faster than jsdom, so a Chromium
 * regression that bumps cost by 2x in the user's hands would still
 * trip the CI guard. RecentRow / ChildRow / ProjectRow / FolderRow
 * are NOT yet memoized — that's tracked as a follow-up; the budget
 * leaves headroom for them landing later without churn.
 */
const FIRST_KEYSTROKE_BUDGETS = {
  100: 50,
  500: 100,
  2000: 400,
} as const;

/**
 * Subsequent-keystroke budget. Unchanged across sizes — once the filter is
 * non-empty the visible list stays small, so per-keystroke cost stays
 * within the spec target regardless of the underlying dataset size.
 */
const SUBSEQUENT_KEYSTROKE_BUDGET_MS = 20;

const SIZES = [100, 500, 2000] as const;
/**
 * 5 iterations for stability (median-of-5). Matches the convention used by
 * `harness.ts` for higher-noise benchmarks. Each first-keystroke iteration
 * costs a full QuietSidebar mount (≈1s at N=2000 in jsdom), so the per-test
 * timeout is bumped explicitly below to absorb the wall-clock cost.
 */
const ITERATIONS = 5;
/**
 * Per-test timeout. The N=2000 first-keystroke run mounts QuietSidebar 5
 * times (~1s each in jsdom) → ~5s of mount cost outside the timing window
 * + the iterations themselves. Vitest's default 5000ms is just under that.
 */
const TEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("sidebar type-to-filter", () => {
  for (const N of SIZES) {
    const firstBudget = FIRST_KEYSTROKE_BUDGETS[N];
    it(
      `first keystroke (N=${N}) within ${firstBudget}ms budget`,
      () => {
        seedPinnedAndRecent(N);

        // Fresh mount per iteration so every measurement isolates the
        // empty → "a" transition. Mount cost is excluded — only the
        // keydown dispatch (and React's resulting re-render) is timed.
        const samples: number[] = [];
        for (let i = 0; i < ITERATIONS; i++) {
          const { nav, cleanup } = mountAndFocus();
          try {
            const t0 = performance.now();
            act(() => {
              dispatchKey(nav, "a");
            });
            samples.push(performance.now() - t0);
          } finally {
            cleanup();
          }
        }

        const budget = firstBudget * BUDGET_MULTIPLIER;
        const med = median(samples);
        const result: MeasureResult = {
          name: `sidebar-filter first keystroke (N=${N})`,
          median: med,
          budget,
          passed: med < budget,
          samples,
        };
        logResult(result);
        expect(result.passed).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      `subsequent keystroke (N=${N}) within ${SUBSEQUENT_KEYSTROKE_BUDGET_MS}ms budget`,
      () => {
        seedPinnedAndRecent(N);
        const { nav, cleanup } = mountAndFocus();

        try {
          // Warm-up: get the filter to "a" so all subsequent measurements
          // start from a populated-filter steady state. Excluded from samples.
          act(() => {
            dispatchKey(nav, "a");
          });

          // Each iteration: extend "a" → "ab" (timed), then revert via
          // Backspace (untimed) so the next iteration starts from "a" again.
          const samples: number[] = [];
          for (let i = 0; i < ITERATIONS; i++) {
            const t0 = performance.now();
            act(() => {
              dispatchKey(nav, "b");
            });
            samples.push(performance.now() - t0);

            // Reset outside the timed window.
            act(() => {
              dispatchKey(nav, "Backspace");
            });
          }

          const budget = SUBSEQUENT_KEYSTROKE_BUDGET_MS * BUDGET_MULTIPLIER;
          const med = median(samples);
          const result: MeasureResult = {
            name: `sidebar-filter subsequent keystroke (N=${N})`,
            median: med,
            budget,
            passed: med < budget,
            samples,
          };
          logResult(result);
          expect(result.passed).toBe(true);
        } finally {
          cleanup();
        }
      },
      TEST_TIMEOUT_MS,
    );
  }
});
