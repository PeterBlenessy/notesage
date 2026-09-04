// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, vi } from "vitest";
import { createEvent, fireEvent, renderWithProviders, screen } from "@/test/component-harness";
import { ProjectRow } from "@/components/sidebar/quiet/ProjectRow";
import { droppedFilePaths, FILE_DRAG_MIME, FILE_DRAG_PATHS_MIME } from "@/components/sidebar/quiet/file-drag";

/** jsdom has no DataTransfer; the same shim the drag-to-pin suite uses. */
function dataTransfer(payload: Record<string, string>) {
  return {
    types: Object.keys(payload),
    getData: (type: string) => payload[type] ?? "",
    setData: () => undefined,
    effectAllowed: "copyMove",
    dropEffect: "none",
  };
}

function renderRow(onDropFiles?: (paths: string[]) => void) {
  const noop = () => undefined;
  return renderWithProviders(
    <ProjectRow
      project={{ path: "/Users/peter/Notesage/Research", fileTree: [] }}
      isActive={false}
      isExpanded={false}
      isFocused={false}
      hasFocusWithin={false}
      isRenaming={false}
      onOpen={noop}
      onKeyDown={noop}
      onFocus={noop}
      onAddNote={noop}
      onStartRename={noop}
      onCommitRename={noop}
      onCancelRename={noop}
      registerRef={noop}
      onDropFiles={onDropFiles}
    />,
  );
}

describe("ProjectRow as a drop target (file to a project)", () => {
  it("accepts a Notesage file drag and hands over every dropped path", () => {
    const onDropFiles = vi.fn();
    renderRow(onDropFiles);
    const row = screen.getByRole("treeitem", { name: /Research/ });
    const dt = dataTransfer({
      [FILE_DRAG_MIME]: "/Users/peter/Notesage/Inbox/a.html",
      [FILE_DRAG_PATHS_MIME]: JSON.stringify(["/Users/peter/Notesage/Inbox/a.html", "/Users/peter/Notesage/Inbox/b.pdf"]),
    });
    const over = createEvent.dragOver(row, { dataTransfer: dt } as unknown as EventInit);
    Object.defineProperty(over, "dataTransfer", { value: dt });
    fireEvent(row, over);
    expect(over.defaultPrevented).toBe(true);
    expect(row.getAttribute("data-drop-active")).toBe("true");
    const drop = createEvent.drop(row, { dataTransfer: dt } as unknown as EventInit);
    Object.defineProperty(drop, "dataTransfer", { value: dt });
    fireEvent(row, drop);
    expect(onDropFiles).toHaveBeenCalledWith(["/Users/peter/Notesage/Inbox/a.html", "/Users/peter/Notesage/Inbox/b.pdf"]);
    expect(row.getAttribute("data-drop-active")).toBeNull();
  });

  it("ignores a single sidebar file (Recent, Pinned) — filing is for Inbox items", () => {
    const onDropFiles = vi.fn();
    renderRow(onDropFiles);
    const row = screen.getByRole("treeitem", { name: /Research/ });
    const dt = dataTransfer({ [FILE_DRAG_MIME]: "/Users/peter/Notesage/Research/notes.md" });
    const over = createEvent.dragOver(row, {} as EventInit);
    Object.defineProperty(over, "dataTransfer", { value: dt });
    fireEvent(row, over);
    expect(over.defaultPrevented).toBe(false);
    const drop = createEvent.drop(row, {} as EventInit);
    Object.defineProperty(drop, "dataTransfer", { value: dt });
    fireEvent(row, drop);
    expect(onDropFiles).not.toHaveBeenCalled();
  });

  it("ignores drags that are not Notesage files (Finder, text)", () => {
    const onDropFiles = vi.fn();
    renderRow(onDropFiles);
    const row = screen.getByRole("treeitem", { name: /Research/ });
    const dt = dataTransfer({ "text/plain": "hello" });
    const over = createEvent.dragOver(row, {} as EventInit);
    Object.defineProperty(over, "dataTransfer", { value: dt });
    fireEvent(row, over);
    expect(over.defaultPrevented).toBe(false);
    const drop = createEvent.drop(row, {} as EventInit);
    Object.defineProperty(drop, "dataTransfer", { value: dt });
    fireEvent(row, drop);
    expect(onDropFiles).not.toHaveBeenCalled();
  });

  it("is inert without an onDropFiles handler", () => {
    renderRow(undefined);
    const row = screen.getByRole("treeitem", { name: /Research/ });
    const dt = dataTransfer({ [FILE_DRAG_MIME]: "/x/a.html", [FILE_DRAG_PATHS_MIME]: '["/x/a.html"]' });
    const over = createEvent.dragOver(row, {} as EventInit);
    Object.defineProperty(over, "dataTransfer", { value: dt });
    fireEvent(row, over);
    expect(over.defaultPrevented).toBe(false);
  });
});

describe("droppedFilePaths", () => {
  it("prefers the multi-path payload and falls back to the single file", () => {
    expect(droppedFilePaths({ dataTransfer: dataTransfer({ [FILE_DRAG_MIME]: "/a" }) as unknown as DataTransfer })).toEqual(["/a"]);
    expect(
      droppedFilePaths({ dataTransfer: dataTransfer({ [FILE_DRAG_MIME]: "/a", [FILE_DRAG_PATHS_MIME]: '["/a","/b"]' }) as unknown as DataTransfer }),
    ).toEqual(["/a", "/b"]);
    expect(
      droppedFilePaths({ dataTransfer: dataTransfer({ [FILE_DRAG_MIME]: "/a", [FILE_DRAG_PATHS_MIME]: "not json" }) as unknown as DataTransfer }),
    ).toEqual(["/a"]);
    expect(droppedFilePaths({ dataTransfer: dataTransfer({}) as unknown as DataTransfer })).toEqual([]);
  });
});
