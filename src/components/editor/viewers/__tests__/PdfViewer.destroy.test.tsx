// @vitest-environment jsdom
/**
 * Regression test for audit 2026-11-22 §1 (HIGH): PdfViewer must destroy the
 * pdf.js loading task it created.
 *
 * `getDocument()` spawns a dedicated worker per document; only
 * `loadingTask.destroy()` terminates it and releases the parsed document. The
 * load effect's cleanup used to only set a `cancelled` flag, so every mount
 * and every `filePath` change leaked a worker plus the document.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

interface FakeLoadTask {
  promise: Promise<unknown>;
  destroy: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

const { loadTasks, getDocumentMock } = vi.hoisted(() => {
  const loadTasks: FakeLoadTask[] = [];
  const getDocumentMock = vi.fn((): FakeLoadTask => {
    const viewport = { width: 600, height: 800 };
    const page = {
      getViewport: () => viewport,
      render: () => ({ promise: Promise.resolve() }),
      getTextContent: async () => ({ items: [] }),
    };
    const doc = { numPages: 1, getPage: async () => page };
    const task: FakeLoadTask = {
      promise: Promise.resolve(doc),
      destroy: vi.fn(async () => {}),
    };
    loadTasks.push(task);
    return task;
  });
  return { loadTasks, getDocumentMock };
});

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: getDocumentMock,
  TextLayer: class {
    render(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock("@/lib/readablestream-asynciterator-polyfill", () => ({}));

const mockGetBinaryData = vi.fn();
vi.mock("@/lib/binary-cache", () => ({
  getBinaryData: (path: string) => mockGetBinaryData(path),
}));

class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = MockObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver = MockObserver as unknown as typeof IntersectionObserver;

import { PdfViewer } from "../PdfViewer";

describe("PdfViewer — pdf.js loading task lifetime", () => {
  beforeEach(() => {
    loadTasks.length = 0;
    getDocumentMock.mockClear();
    mockGetBinaryData.mockReturnValue(new Uint8Array([1, 2, 3]));
    // The worker-blob fetch falls back to the direct URL when it fails.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  });

  it("destroys the loading task when the viewer unmounts", async () => {
    const { unmount } = render(<PdfViewer filePath="/docs/a.pdf" fileName="a.pdf" />);
    await waitFor(() => expect(loadTasks).toHaveLength(1));
    expect(loadTasks[0].destroy).not.toHaveBeenCalled();

    unmount();

    expect(loadTasks[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the superseded document when filePath changes, and keeps the new one", async () => {
    const { rerender, unmount } = render(<PdfViewer filePath="/docs/a.pdf" fileName="a.pdf" />);
    await waitFor(() => expect(loadTasks).toHaveLength(1));

    rerender(<PdfViewer filePath="/docs/b.pdf" fileName="b.pdf" />);
    await waitFor(() => expect(loadTasks).toHaveLength(2));

    expect(loadTasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(loadTasks[1].destroy).not.toHaveBeenCalled();

    unmount();
    expect(loadTasks[1].destroy).toHaveBeenCalledTimes(1);
  });

  it("does not start a load for a viewer that unmounted before the worker was ready", async () => {
    const { unmount } = render(<PdfViewer filePath="/docs/a.pdf" fileName="a.pdf" />);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getDocumentMock).not.toHaveBeenCalled();
  });
});
