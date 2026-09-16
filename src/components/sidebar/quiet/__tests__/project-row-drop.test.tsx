// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { createEvent, fireEvent, renderWithProviders, screen, setMockInvokeHandler } from "@/test/component-harness";
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

function renderRow() {
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
    />,
  );
}

describe("ProjectRow as a drop target (file to a project)", () => {
  beforeEach(() => {
    // A drop MOVES now, so the row reaches the filesystem. Without these the
    // move rejects into nothing, and vitest fails the run on an unhandled
    // rejection while reporting all 7948 tests as passed — which is exactly
    // how this reached CI.
    setMockInvokeHandler("path_exists", () => false);
    setMockInvokeHandler("rename_path", () => undefined);
    setMockInvokeHandler("mark_self_write", () => undefined);
  });

  it("accepts an Inbox selection", () => {
    renderRow();
    const row = screen.getByRole("treeitem", { name: /Research/ });
    const dt = dataTransfer({
      [FILE_DRAG_MIME]: "/Users/peter/Notesage/Inbox/a.html",
      [FILE_DRAG_PATHS_MIME]: JSON.stringify([
        "/Users/peter/Notesage/Inbox/a.html",
        "/Users/peter/Notesage/Inbox/b.pdf",
      ]),
    });
    const over = createEvent.dragOver(row, { dataTransfer: dt } as unknown as EventInit);
    Object.defineProperty(over, "dataTransfer", { value: dt });
    fireEvent(row, over);
    expect(over.defaultPrevented).toBe(true);
    expect(row.getAttribute("data-drop-active")).toBe("true");
    const drop = createEvent.drop(row, { dataTransfer: dt } as unknown as EventInit);
    Object.defineProperty(drop, "dataTransfer", { value: dt });
    fireEvent(row, drop);
    expect(row.getAttribute("data-drop-active")).toBeNull();
  });

  it("now accepts a single sidebar file too — dropping on a folder means MOVE", () => {
    // Behaviour change, 2026-09-15, on Peter's instruction. This used to be
    // refused: `file-drag.ts` warned that dropping a Recent or Pinned row on a
    // project would "silently MOVE a file that already lives somewhere else".
    // That was right while moving was not something you could do here at all —
    // the sidebar had exactly one drop target and the Move to... menu offered
    // roots only. Now a drop on a folder IS the move, so refusing the payload
    // refused the gesture.
    renderRow();
    const row = screen.getByRole("treeitem", { name: /Research/ });
    const dt = dataTransfer({ [FILE_DRAG_MIME]: "/Users/peter/Notesage/Other/notes.md" });
    const over = createEvent.dragOver(row, {} as EventInit);
    Object.defineProperty(over, "dataTransfer", { value: dt });
    fireEvent(row, over);
    expect(over.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe("move");
  });

  it("ignores drags that are not Notesage files (Finder, text)", () => {

    renderRow();
    const row = screen.getByRole("treeitem", { name: /Research/ });
    const dt = dataTransfer({ "text/plain": "hello" });
    const over = createEvent.dragOver(row, {} as EventInit);
    Object.defineProperty(over, "dataTransfer", { value: dt });
    fireEvent(row, over);
    expect(over.defaultPrevented).toBe(false);
    const drop = createEvent.drop(row, {} as EventInit);
    Object.defineProperty(drop, "dataTransfer", { value: dt });
    fireEvent(row, drop);
    
  });

  // The "inert without an onDropFiles handler" case went with the prop: a
  // project row no longer needs to be handed a filing callback, because
  // `useMoveIntoFolder` knows both routes — Inbox filing and a plain move —
  // and picks by looking at the payload. Nothing is left to forget to wire.
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
