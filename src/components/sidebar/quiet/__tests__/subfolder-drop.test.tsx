// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, renderWithProviders, screen, setMockInvokeHandler } from "@/test/component-harness";
import { ChildRow } from "@/components/sidebar/quiet/ChildRow";
import { FILE_DRAG_MIME } from "@/components/sidebar/quiet/file-drag";

/**
 * Peter, desktop, 2026-09-15: "I could not move files from one sub-folder to
 * sub-folder, I could only move to root folders."
 *
 * He was right twice over. `ChildRow` was a drag SOURCE with no `onDrop`, and
 * the only drop target in the whole sidebar — a top-level project — rejected
 * everything that was not an Inbox selection. So a file picked up inside a
 * project had nowhere at all to land.
 */

/** jsdom has no DataTransfer; the same shim the other drag suites use. */
function dataTransfer(payload: Record<string, string>) {
  return {
    types: Object.keys(payload),
    getData: (type: string) => payload[type] ?? "",
    setData: () => undefined,
    effectAllowed: "copyMove",
    dropEffect: "none",
  };
}

function renderChild(entry: { path: string; name: string; is_directory: boolean }) {
  const full = { ...entry, hidden: false };
  const noop = () => undefined;
  return renderWithProviders(
    <ChildRow
      row={{
        id: full.path,
        kind: "child",
        project: { path: "/lib/Essays", fileTree: [] },
        entry: full,
        depth: 2,
      }}
      level={2}
      isActive={false}
      isFocused={false}
      hasFocusWithin={false}
      isExpanded={full.is_directory ? false : undefined}
      registerRef={noop}
      onKeyDown={noop}
      onFocus={noop}
      onActivate={noop}
      isRenaming={false}
      onStartRename={noop}
      onCommitRename={noop}
      onCancelRename={noop}
    />,
  );
}

describe("a sub-folder row accepts a drop", () => {
  beforeEach(() => {
    setMockInvokeHandler("path_exists", () => false);
    setMockInvokeHandler("rename_path", () => undefined);
    setMockInvokeHandler("mark_self_write", () => undefined);
  });

  it("takes a plain single-file drag — no Inbox selection required", () => {
    renderChild({ path: "/lib/Essays/Drafts", name: "Drafts", is_directory: true });
    const row = screen.getByRole("treeitem");
    const dt = dataTransfer({ [FILE_DRAG_MIME]: "/lib/Essays/old.md" });

    fireEvent.dragOver(row, { dataTransfer: dt });
    // `dropEffect = "move"` is the row saying it will accept — the browser
    // paints the cursor from it, and it was never set before.
    expect(dt.dropEffect).toBe("move");
    expect(row.getAttribute("data-drop-active")).toBe("true");
  });

  it("a FILE row is inert — you cannot drop a note into a note", () => {
    renderChild({ path: "/lib/Essays/note.md", name: "note.md", is_directory: false });
    const row = screen.getByRole("treeitem");
    const dt = dataTransfer({ [FILE_DRAG_MIME]: "/lib/Essays/old.md" });

    fireEvent.dragOver(row, { dataTransfer: dt });
    expect(dt.dropEffect).toBe("none");
    expect(row.getAttribute("data-drop-active")).toBeNull();
  });

  it("clears its drop affordance when the drag leaves", () => {
    renderChild({ path: "/lib/Essays/Drafts", name: "Drafts", is_directory: true });
    const row = screen.getByRole("treeitem");
    const dt = dataTransfer({ [FILE_DRAG_MIME]: "/lib/Essays/old.md" });
    fireEvent.dragOver(row, { dataTransfer: dt });
    expect(row.getAttribute("data-drop-active")).toBe("true");
    fireEvent.dragLeave(row, { dataTransfer: dt, relatedTarget: document.body });
    expect(row.getAttribute("data-drop-active")).toBeNull();
  });
});
