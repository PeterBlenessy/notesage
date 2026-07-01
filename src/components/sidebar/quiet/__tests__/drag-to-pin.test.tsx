// @vitest-environment jsdom

/**
 * Task #44 — drag-to-pin + drag-to-reorder Pinned.
 *
 * Covers HTML5 drag-and-drop wiring between RecentSection, ProjectsSection
 * (file children), and PinnedSection. jsdom does not implement DataTransfer
 * so we construct a small mock with the subset of the API our handlers use
 * (`types`, `getData`, `setData`, `effectAllowed`, `dropEffect`) and feed
 * it via `fireEvent.dragStart / dragOver / drop`.
 *
 * Reorder math (`computeReorderTarget`) has its own unit tests in
 * `file-drag.test.ts`; these tests exercise the end-to-end flow through
 * the Zustand store.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEvent } from "@testing-library/react";
import {
  renderWithProviders,
  screen,
  fireEvent,
} from "@/test/component-harness";
import { PinnedSection } from "../PinnedSection";
import { RecentSection } from "../RecentSection";
import { FILE_DRAG_MIME } from "../file-drag";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore, type RecentFile } from "@/stores/editor-store";

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: () => ({
    openFile: vi.fn().mockResolvedValue(undefined),
  }),
}));

function resetStores() {
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
    expandedFolders: new Set<string>(),
    explorerCollapsed: false,
    projectsCollapsed: false,
    notesCollapsed: false,
  });
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    recentFiles: [],
  });
}

/**
 * Minimal DataTransfer mock. The real browser object is more featureful,
 * but our handlers only touch the members below.
 */
function makeDataTransfer(
  initial: Record<string, string> = {},
): DataTransfer {
  const data = new Map<string, string>(Object.entries(initial));
  const dt = {
    effectAllowed: "uninitialized" as DataTransfer["effectAllowed"],
    dropEffect: "none" as DataTransfer["dropEffect"],
    get types(): readonly string[] {
      return Array.from(data.keys());
    },
    getData(type: string): string {
      return data.get(type) ?? "";
    },
    setData(type: string, value: string): void {
      data.set(type, value);
    },
    clearData(type?: string): void {
      if (type === undefined) data.clear();
      else data.delete(type);
    },
  } satisfies Partial<DataTransfer> as unknown as DataTransfer;
  return dt;
}

function recent(name: string): RecentFile {
  return { path: `/w/${name}`, name };
}

function setRecentFiles(entries: RecentFile[]) {
  useEditorStore.setState({ recentFiles: entries });
}

function getRowByText(text: string): HTMLElement {
  return screen.getByText(text).closest("[role=\"button\"]") as HTMLElement;
}

function rect(top: number, height = 28) {
  // jsdom defaults getBoundingClientRect() to all zeros; we stub it so
  // `isBelowMidpoint` has something non-trivial to compare.
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 200,
    width: 200,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function stubRect(el: HTMLElement, top: number, height = 28) {
  el.getBoundingClientRect = () => rect(top, height);
}

/**
 * Construct a drag-family event and force `clientY` onto it. jsdom's
 * DragEvent constructor ignores `clientY` in its init dict, and
 * testing-library's `fireEvent.drop(el, { clientY })` does not bridge
 * through either — so we define the property after creation and dispatch
 * it ourselves via `fireEvent(node, event)`.
 */
function fireDragEvent(
  kind: "dragOver" | "drop" | "dragStart" | "dragEnd" | "dragLeave",
  node: HTMLElement,
  init: { dataTransfer: DataTransfer; clientY?: number },
) {
  const event = createEvent[kind](node, {
    dataTransfer: init.dataTransfer,
  } as unknown as object);
  if (init.clientY !== undefined) {
    Object.defineProperty(event, "clientY", {
      configurable: true,
      value: init.clientY,
    });
  }
  fireEvent(node, event);
}

beforeEach(() => {
  resetStores();
});

// ---------------------------------------------------------------------------
// Recent row is a drag source
// ---------------------------------------------------------------------------

describe("RecentSection — drag source (#44)", () => {
  it("marks recent rows as draggable", () => {
    setRecentFiles([recent("alpha.md")]);
    renderWithProviders(<RecentSection />);
    const row = getRowByText("alpha.md");
    expect(row.getAttribute("draggable")).toBe("true");
  });

  it("writes the file path to dataTransfer under FILE_DRAG_MIME on dragstart", () => {
    setRecentFiles([recent("beta.md")]);
    renderWithProviders(<RecentSection />);
    const row = getRowByText("beta.md");
    const dt = makeDataTransfer();
    fireEvent.dragStart(row, { dataTransfer: dt });
    expect(dt.types).toContain(FILE_DRAG_MIME);
    expect(dt.getData(FILE_DRAG_MIME)).toBe("/w/beta.md");
  });
});

// ---------------------------------------------------------------------------
// Dropping onto the Pinned section (empty and container)
// ---------------------------------------------------------------------------

describe("PinnedSection — drop target (#44)", () => {
  it("appends a new pin when a Recent path is dropped on the container", () => {
    // The empty section is hidden now, so drag-to-pin targets a non-empty list.
    useWorkspaceStore.setState({ pinnedFiles: ["/w/alpha.md"] });
    renderWithProviders(<PinnedSection />);
    const dropZone = screen.getByTestId("pinned-drop-zone");

    const dt = makeDataTransfer({ [FILE_DRAG_MIME]: "/w/gamma.md" });
    fireEvent.dragOver(dropZone, { dataTransfer: dt });
    fireEvent.drop(dropZone, { dataTransfer: dt });

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      "/w/alpha.md",
      "/w/gamma.md",
    ]);
  });

  it("rejects drops that do not carry the FILE_DRAG_MIME type", () => {
    useWorkspaceStore.setState({ pinnedFiles: ["/w/alpha.md"] });
    renderWithProviders(<PinnedSection />);
    const dropZone = screen.getByTestId("pinned-drop-zone");

    const dt = makeDataTransfer({ "text/plain": "/etc/passwd" });
    fireEvent.dragOver(dropZone, { dataTransfer: dt });
    fireEvent.drop(dropZone, { dataTransfer: dt });

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual(["/w/alpha.md"]);
  });

  it("ignores a duplicate drop when the path is already pinned", () => {
    useWorkspaceStore.setState({ pinnedFiles: ["/w/delta.md"] });
    renderWithProviders(<PinnedSection />);
    const dropZone = screen.getByTestId("pinned-drop-zone");

    const dt = makeDataTransfer({ [FILE_DRAG_MIME]: "/w/delta.md" });
    fireEvent.dragOver(dropZone, { dataTransfer: dt });
    fireEvent.drop(dropZone, { dataTransfer: dt });

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      "/w/delta.md",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Row-level drop — above/below midpoint insertion
// ---------------------------------------------------------------------------

describe("PinnedSection — row-level insertion (#44)", () => {
  it("inserts a new pin BEFORE a row when dropped above midpoint", () => {
    useWorkspaceStore.setState({
      pinnedFiles: ["/w/one.md", "/w/two.md"],
    });
    renderWithProviders(<PinnedSection />);

    const twoRow = getRowByText("two.md");
    stubRect(twoRow, 100); // midpoint = 114

    const dt = makeDataTransfer({ [FILE_DRAG_MIME]: "/w/new.md" });
    fireDragEvent("dragOver", twoRow, { dataTransfer: dt, clientY: 102 });
    fireDragEvent("drop", twoRow, { dataTransfer: dt, clientY: 102 });

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      "/w/one.md",
      "/w/new.md",
      "/w/two.md",
    ]);
  });

  it("inserts a new pin AFTER a row when dropped below midpoint", () => {
    useWorkspaceStore.setState({
      pinnedFiles: ["/w/one.md", "/w/two.md"],
    });
    renderWithProviders(<PinnedSection />);

    const oneRow = getRowByText("one.md");
    stubRect(oneRow, 0); // midpoint = 14

    const dt = makeDataTransfer({ [FILE_DRAG_MIME]: "/w/mid.md" });
    fireDragEvent("dragOver", oneRow, { dataTransfer: dt, clientY: 20 });
    fireDragEvent("drop", oneRow, { dataTransfer: dt, clientY: 20 });

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      "/w/one.md",
      "/w/mid.md",
      "/w/two.md",
    ]);
  });

  it("reorders an existing pin when dragged within Pinned", () => {
    useWorkspaceStore.setState({
      pinnedFiles: ["/w/a.md", "/w/b.md", "/w/c.md"],
    });
    renderWithProviders(<PinnedSection />);

    const aRow = getRowByText("a.md");
    const cRow = getRowByText("c.md");
    stubRect(aRow, 0);
    stubRect(cRow, 56); // midpoint = 70

    // Simulate: dragstart on "a", drop on "c" below midpoint → a goes after c.
    const dt = makeDataTransfer();
    fireDragEvent("dragStart", aRow, { dataTransfer: dt });
    fireDragEvent("dragOver", cRow, { dataTransfer: dt, clientY: 80 });
    fireDragEvent("drop", cRow, { dataTransfer: dt, clientY: 80 });

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      "/w/b.md",
      "/w/c.md",
      "/w/a.md",
    ]);
  });

  it("is a no-op when dropping a pinned row onto itself", () => {
    useWorkspaceStore.setState({
      pinnedFiles: ["/w/x.md", "/w/y.md"],
    });
    renderWithProviders(<PinnedSection />);

    const xRow = getRowByText("x.md");
    stubRect(xRow, 0);

    const dt = makeDataTransfer();
    fireDragEvent("dragStart", xRow, { dataTransfer: dt });
    fireDragEvent("dragOver", xRow, { dataTransfer: dt, clientY: 5 });
    fireDragEvent("drop", xRow, { dataTransfer: dt, clientY: 5 });

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      "/w/x.md",
      "/w/y.md",
    ]);
  });

  it("rejects a row drop whose dataTransfer lacks FILE_DRAG_MIME", () => {
    useWorkspaceStore.setState({ pinnedFiles: ["/w/only.md"] });
    renderWithProviders(<PinnedSection />);

    const row = getRowByText("only.md");
    stubRect(row, 0);

    const dt = makeDataTransfer({ "text/plain": "junk" });
    fireDragEvent("dragOver", row, { dataTransfer: dt, clientY: 5 });
    fireDragEvent("drop", row, { dataTransfer: dt, clientY: 5 });

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      "/w/only.md",
    ]);
  });
});
