/**
 * Regression tests for the tab-switch pipeline race conditions found by the
 * deep audit:
 *
 * 1. `previewInFlightRef` must be cleared at the abort site — a Tauri invoke
 *    can't be cancelled, so on a fast A→B→A switch the dedup marker from A's
 *    first activation would otherwise block A's second activation and leave
 *    the tab stuck on its loading/preview state.
 * 2. Unmounting the Editor mid-load must abort the in-flight parse/hydrate
 *    chain (unmount-only cleanup effect).
 *
 * The hook is exercised through `renderHook` with the real editor-store and
 * a mock editor; the backend preview call runs through the tauri-mock invoke
 * layer with a never-resolving promise to model the uncancellable invoke.
 *
 * @vitest-environment jsdom
 */

import { setMockInvokeHandler } from "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useEditorStore, type Tab } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorTabSwitch } from "@/hooks/useEditorTabSwitch";
import { createMockEditor } from "@/test/mock-editor";
import type { EditorStateCache } from "@/lib/editor-state-cache";

const { parseInWorkerMock, loadRawMarkdownIntoEditorMock } = vi.hoisted(() => ({
  parseInWorkerMock: vi.fn(
    (
      _content: string,
      _projectRoot?: string,
      _opts?: { signal?: AbortSignal },
    ): Promise<never> => new Promise<never>(() => {}),
  ),
  loadRawMarkdownIntoEditorMock: vi.fn(),
}));

vi.mock("@/lib/markdown-worker", () => ({
  parseInWorker: parseInWorkerMock,
}));

vi.mock("@/lib/markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/markdown")>();
  return {
    ...actual,
    loadRawMarkdownIntoEditor: loadRawMarkdownIntoEditorMock,
  };
});

// The IDB-backed viewport cache is unavailable in jsdom; a null hit forces
// the preview (render_markdown_preview) path that carries the dedup marker.
vi.mock("@/lib/viewport-cache", () => ({
  getCachedViewport: vi.fn(async () => null),
  setCachedViewport: vi.fn(async () => {}),
  contentFingerprint: vi.fn(() => "fp"),
}));

// The extensions barrel drags in heavy node views; the hook only needs the
// AI-suggestion plugin key lookup (no suggestion saved in these tests).
vi.mock("@/components/editor/extensions", () => ({
  AISuggestionPluginKey: { getState: vi.fn(() => undefined) },
  setSuggestion: vi.fn(),
}));

type Props = Parameters<typeof useEditorTabSwitch>[0];

// Over the 50 KB skip-preview threshold so the activation takes the
// instant-load preview path (the one guarded by `previewInFlightRef`).
const LARGE_CONTENT = "x".repeat(51 * 1024);

const tabA: Tab = {
  id: "tab-a",
  filePath: "/notes/a.md",
  fileName: "a.md",
  isDirty: false,
  content: LARGE_CONTENT,
  frontmatter: null,
  fileType: "markdown",
  contentLoaded: true,
};

// Empty content → not eligible for the fresh-parse pipeline → legacy sync
// path. Keeps the intermediate B activation cheap and deterministic.
const tabB: Tab = {
  id: "tab-b",
  filePath: "/notes/b.md",
  fileName: "b.md",
  isDirty: false,
  content: "",
  frontmatter: null,
  fileType: "markdown",
  contentLoaded: true,
};

function makeFakeStateCache(): EditorStateCache {
  return {
    get: () => undefined,
    set: () => {},
    delete: () => false,
    has: () => false,
    clear: () => {},
    size: () => 0,
  } as unknown as EditorStateCache;
}

function makeHarness(): { props: (tab: Tab) => Props } {
  const editor = createMockEditor() as TiptapEditor;
  const shared: Omit<Props, "activeTab"> = {
    editor,
    cachedEditorStatesRef: { current: makeFakeStateCache() },
    savedSuggestionsRef: { current: new Map() },
    scrollAreaRef: { current: document.createElement("div") },
    isProgrammaticScroll: { current: false },
    lastLoadedTabId: { current: null },
    saveOutgoingTabScroll: vi.fn(),
    restoreScrollRatio: vi.fn(),
    externalChanges: {},
    updateTabContent: vi.fn(),
    clearExternalChange: vi.fn(),
    setImageDialogOpen: vi.fn(),
    isPaperMode: false,
    marginTop: 0,
    marginBottom: 0,
    pageHeight: undefined,
  };
  return { props: (tab: Tab) => ({ ...shared, activeTab: tab }) };
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

describe("useEditorTabSwitch — abort/unmount race conditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseInWorkerMock.mockImplementation(() => new Promise<never>(() => {}));
    useEditorStore.setState({
      openDocuments: [tabA, tabB],
      activeTabId: tabA.id,
      scrollPositions: {},
      externalChanges: {},
    });
    useSettingsStore.setState({ instantLoadPreview: true });
  });

  it("re-fires the preview pipeline on a fast A→B→A switch (dedup marker cleared at the abort site)", async () => {
    // Never resolves — models a Tauri invoke that cannot be cancelled and is
    // still in flight when the user switches away and back.
    const previewInvoke = vi.fn(() => new Promise<never>(() => {}));
    setMockInvokeHandler("render_markdown_preview", previewInvoke);

    const harness = makeHarness();
    const { rerender } = renderHook((p: Props) => useEditorTabSwitch(p), {
      initialProps: harness.props(tabA),
    });
    await flushAsync();
    expect(previewInvoke).toHaveBeenCalledTimes(1);

    // Fast switch away to B (aborts A's pipeline) …
    rerender(harness.props(tabB));
    await flushAsync();

    // … and straight back to A. The dedup marker from the still-in-flight
    // first preview must not block the re-activation.
    rerender(harness.props(tabA));
    await flushAsync();
    expect(previewInvoke).toHaveBeenCalledTimes(2);
  });

  it("aborts the in-flight parse pipeline when the hook unmounts", async () => {
    setMockInvokeHandler("render_markdown_preview", () => "<p>preview</p>");
    let capturedSignal: AbortSignal | undefined;
    parseInWorkerMock.mockImplementation((_content, _projectRoot, opts) => {
      capturedSignal = opts?.signal;
      return new Promise<never>(() => {});
    });

    const harness = makeHarness();
    const { unmount } = renderHook((p: Props) => useEditorTabSwitch(p), {
      initialProps: harness.props(tabA),
    });
    await flushAsync();

    expect(parseInWorkerMock).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });
});
