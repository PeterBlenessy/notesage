// @vitest-environment jsdom

// Polyfill ResizeObserver for jsdom
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/component-harness";
import * as binaryCache from "@/lib/binary-cache";

// Mock the parser module
vi.mock("@/lib/pptx-parser", () => ({
  parsePptx: vi.fn(),
}));

// Mock binary-cache
vi.mock("@/lib/binary-cache", () => ({
  getBinaryData: vi.fn(),
}));

// Mock recharts to avoid SVG rendering issues in jsdom
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  BarChart: () => <div data-testid="bar-chart" />,
  Bar: () => null,
  LineChart: () => <div data-testid="line-chart" />,
  Line: () => null,
  PieChart: () => <div data-testid="pie-chart" />,
  Pie: () => null,
  Cell: () => null,
  AreaChart: () => <div data-testid="area-chart" />,
  Area: () => null,
  ScatterChart: () => <div data-testid="scatter-chart" />,
  Scatter: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
}));

import type { PptxPresentation } from "@/lib/pptx-types";

function makeMockPresentation(overrides?: Partial<PptxPresentation>): PptxPresentation {
  return {
    slideWidth: 12192000,
    slideHeight: 6858000,
    theme: {
      colors: { dk1: "#1A1A1A", lt1: "#FFFFFF" },
      fonts: { heading: "Arial", body: "Calibri" },
    },
    slides: [
      {
        index: 0,
        elements: [
          {
            type: "textbox" as const,
            x: 0,
            y: 0,
            width: 9144000,
            height: 1143000,
            rotation: 0,
            paragraphs: [
              {
                alignment: "center" as const,
                runs: [
                  {
                    text: "Slide One Title",
                    bold: true,
                    italic: false,
                    underline: false,
                    fontSize: 44,
                    fontFamily: "Arial",
                    color: "#000000",
                  },
                ],
                bulletChar: null,
                bulletLevel: 0,
              },
            ],
          },
        ],
        background: null,
        notes: "Notes for slide 1",
        searchText: "Slide One Title Notes for slide 1",
      },
      {
        index: 1,
        elements: [
          {
            type: "textbox" as const,
            x: 0,
            y: 0,
            width: 9144000,
            height: 1143000,
            rotation: 0,
            paragraphs: [
              {
                alignment: "left" as const,
                runs: [
                  {
                    text: "Slide Two Content",
                    bold: false,
                    italic: false,
                    underline: false,
                    fontSize: 24,
                    fontFamily: "Calibri",
                    color: "#333333",
                  },
                ],
                bulletChar: null,
                bulletLevel: 0,
              },
            ],
          },
        ],
        background: null,
        notes: "",
        searchText: "Slide Two Content",
      },
      {
        index: 2,
        elements: [],
        background: null,
        notes: "Third slide notes",
        searchText: "Third slide notes",
      },
    ],
    masters: [],
    layouts: [],
    ...overrides,
  };
}

describe("PptxViewer", () => {
  let PptxViewer: typeof import("./PptxViewer")["PptxViewer"];
  let parsePptxMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear any persisted slide position from previous tests
    const { useEditorStore } = await import("@/stores/editor-store");
    useEditorStore.getState().setScrollPosition("/test.pptx", 0);
    const parser = await import("@/lib/pptx-parser");
    parsePptxMock = parser.parsePptx as unknown as ReturnType<typeof vi.fn>;
    const mod = await import("./PptxViewer");
    PptxViewer = mod.PptxViewer;
  });

  it("shows loading state then renders slide content", async () => {
    const mockPres = makeMockPresentation();
    parsePptxMock.mockResolvedValue(mockPres);
    (binaryCache.getBinaryData as ReturnType<typeof vi.fn>).mockReturnValue(new Uint8Array([1]));

    render(<PptxViewer filePath="/test.pptx" fileName="test.pptx" />);

    // Should show loading initially
    expect(screen.getByText("Loading presentation...")).toBeTruthy();

    // Wait for content
    expect(await screen.findByText("Slide One Title")).toBeTruthy();
    expect(screen.getByText("Slide 1 of 3")).toBeTruthy();
  });

  it("navigates between slides with buttons", async () => {
    const mockPres = makeMockPresentation();
    parsePptxMock.mockResolvedValue(mockPres);
    (binaryCache.getBinaryData as ReturnType<typeof vi.fn>).mockReturnValue(new Uint8Array([1]));

    render(<PptxViewer filePath="/test.pptx" fileName="test.pptx" />);
    await screen.findByText("Slide One Title");

    // Click next
    fireEvent.click(screen.getByTitle("Next slide"));
    expect(await screen.findByText("Slide Two Content")).toBeTruthy();
    expect(screen.getByText("Slide 2 of 3")).toBeTruthy();

    // Click prev
    fireEvent.click(screen.getByTitle("Previous slide"));
    expect(await screen.findByText("Slide One Title")).toBeTruthy();
  });

  it("disables prev on first slide and next on last slide", async () => {
    const mockPres = makeMockPresentation();
    parsePptxMock.mockResolvedValue(mockPres);
    (binaryCache.getBinaryData as ReturnType<typeof vi.fn>).mockReturnValue(new Uint8Array([1]));

    render(<PptxViewer filePath="/test.pptx" fileName="test.pptx" />);
    await screen.findByText("Slide One Title");

    // First slide — prev should be disabled
    const prevBtn = screen.getByTitle("Previous slide");
    expect(prevBtn.hasAttribute("disabled")).toBe(true);

    // Go to last slide
    fireEvent.click(screen.getByTitle("Next slide"));
    fireEvent.click(screen.getByTitle("Next slide"));
    expect(await screen.findByText("Slide 3 of 3")).toBeTruthy();

    const nextBtn = screen.getByTitle("Next slide");
    expect(nextBtn.hasAttribute("disabled")).toBe(true);
  });

  it("toggles speaker notes panel", async () => {
    const mockPres = makeMockPresentation();
    parsePptxMock.mockResolvedValue(mockPres);
    (binaryCache.getBinaryData as ReturnType<typeof vi.fn>).mockReturnValue(new Uint8Array([1]));

    render(<PptxViewer filePath="/test.pptx" fileName="test.pptx" />);
    await screen.findByText("Slide One Title");

    // Notes not visible initially
    expect(screen.queryByText("Notes for slide 1")).toBeNull();

    // Toggle notes on
    fireEvent.click(screen.getByTitle("Speaker notes"));
    expect(screen.getByText("Notes for slide 1")).toBeTruthy();

    // Toggle notes off
    fireEvent.click(screen.getByTitle("Speaker notes"));
    expect(screen.queryByText("Notes for slide 1")).toBeNull();
  });

  it("shows empty state for slides without notes", async () => {
    const mockPres = makeMockPresentation();
    parsePptxMock.mockResolvedValue(mockPres);
    (binaryCache.getBinaryData as ReturnType<typeof vi.fn>).mockReturnValue(new Uint8Array([1]));

    render(<PptxViewer filePath="/test.pptx" fileName="test.pptx" />);
    await screen.findByText("Slide One Title");

    // Navigate to slide 2 (no notes)
    fireEvent.click(screen.getByTitle("Next slide"));
    await screen.findByText("Slide Two Content");

    // Open notes panel
    fireEvent.click(screen.getByTitle("Speaker notes"));
    expect(screen.getByText("No notes for this slide")).toBeTruthy();
  });

  it("shows unsupported message for .ppt files", async () => {
    render(<PptxViewer filePath="/old.ppt" fileName="old.ppt" />);
    expect(screen.getByText("Legacy .ppt format is not supported")).toBeTruthy();
    expect(parsePptxMock).not.toHaveBeenCalled();
  });

  it("shows error state for corrupted files", async () => {
    parsePptxMock.mockRejectedValue(new Error("Invalid or corrupted PPTX file"));
    (binaryCache.getBinaryData as ReturnType<typeof vi.fn>).mockReturnValue(new Uint8Array([1]));

    render(<PptxViewer filePath="/bad.pptx" fileName="bad.pptx" />);
    expect(await screen.findByText("Invalid or corrupted PPTX file")).toBeTruthy();
  });

  it("shows error when no binary data available", async () => {
    (binaryCache.getBinaryData as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    render(<PptxViewer filePath="/missing.pptx" fileName="missing.pptx" />);
    expect(await screen.findByText("No PPTX data available")).toBeTruthy();
  });
});
