import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the heavy Excalidraw package — we only care that the wrapper forces
// `skipInliningFonts: true` (the fix for the main-thread font-subsetting hang on
// docs with drawings; see error-logs-20260617).
interface ExportSvgArg {
  elements?: unknown;
  appState?: Record<string, unknown>;
  files?: unknown;
  skipInliningFonts?: boolean;
}
const exportToSvgMock = vi.fn((_opts: ExportSvgArg) =>
  Promise.resolve({ tagName: "svg" } as unknown as SVGSVGElement),
);
vi.mock("@excalidraw/excalidraw", () => ({
  exportToSvg: exportToSvgMock,
}));

import { exportDrawingToSvg } from "@/lib/excalidraw-export";

beforeEach(() => {
  exportToSvgMock.mockClear();
});

describe("exportDrawingToSvg", () => {
  it("forces skipInliningFonts: true (no CDN fetch / main-thread subsetting hang)", async () => {
    await exportDrawingToSvg({
      elements: [] as never,
      appState: { exportBackground: false },
      files: {} as never,
    });

    expect(exportToSvgMock).toHaveBeenCalledTimes(1);
    expect(exportToSvgMock.mock.calls[0][0]).toMatchObject({ skipInliningFonts: true });
  });

  it("forwards the caller's options unchanged", async () => {
    await exportDrawingToSvg({
      elements: [{ id: "a" }] as never,
      appState: { exportWithDarkMode: true, exportBackground: false },
      files: { f1: {} } as never,
    });

    const opts = exportToSvgMock.mock.calls[0][0];
    expect(opts.elements).toEqual([{ id: "a" }]);
    expect(opts.appState).toMatchObject({ exportWithDarkMode: true, exportBackground: false });
    expect(opts.files).toEqual({ f1: {} });
  });

  it("returns the exported SVG element", async () => {
    const svg = await exportDrawingToSvg({ elements: [] as never, files: null });
    expect(svg).toMatchObject({ tagName: "svg" });
  });
});
