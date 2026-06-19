// @vitest-environment jsdom

/**
 * Rendering tests for `RelationsPanel` (OKF wiki-navigation tasks #8 + #9).
 *
 * Covers: self-hide when the document has no relations, collapsed handle +
 * count badge when relations exist, stays visible but offset while the command bar is pinned, and
 * the grouped *Linked from* / *Links to* content once the panel is opened
 * (including the unresolved/forward-link distinction).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@/test/tauri-mock";
import {
  setMockInvokeHandler,
  registerDefaultHandlers,
} from "@/test/tauri-mock";

import { RelationsPanel } from "@/components/editor/RelationsPanel";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { BacklinkGroup, LinkRow } from "@/lib/tauri";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  PERF: {},
}));

function openDoc(path: string): void {
  useEditorStore.setState({
    openDocuments: [
      {
        id: "tab-1",
        filePath: path,
        fileName: path.split("/").pop() ?? path,
        isDirty: false,
        content: "",
        frontmatter: null,
        fileType: "markdown",
      },
    ],
    activeTabId: "tab-1",
  });
}

const backlink: BacklinkGroup = {
  source_path: "/p/source.md",
  source_title: "Source Doc",
  source_type: "note",
  source_description: "the source description",
  occurrences: [{ link_text: "active", context: "we mention active here" }],
};

const forwardResolved: LinkRow = {
  source_path: "/p/active.md",
  target_path: "/p/orders.md",
  link_text: "orders",
  context: "ctx",
  is_internal: true,
  resolved: true,
  target_title: "Orders Table",
  target_type: "table",
  target_description: "all orders",
};

const forwardUnresolved: LinkRow = {
  source_path: "/p/active.md",
  target_path: "/p/missing.md",
  link_text: "missing",
  context: "ctx",
  is_internal: true,
  resolved: false,
  target_title: null,
  target_type: null,
  target_description: null,
};

beforeEach(() => {
  registerDefaultHandlers();
  useEditorStore.setState({ openDocuments: [], activeTabId: null });
  useWorkspaceStore.setState({ projects: [], explorerFolders: [] });
  useSettingsStore.setState({ cmdBarPinned: false, relationsPanelHeight: 0.5 });
});

describe("RelationsPanel", () => {
  it("renders nothing when no document is open", async () => {
    setMockInvokeHandler("get_backlinks", () => []);
    setMockInvokeHandler("get_outlinks", () => []);

    const { container } = render(<RelationsPanel />);
    await waitFor(() => {
      expect(screen.queryByTestId("relations-handle")).toBeNull();
    });
    expect(container.firstChild).toBeNull();
  });

  it("self-hides when the document has no relations", async () => {
    openDoc("/p/active.md");
    setMockInvokeHandler("get_backlinks", () => []);
    setMockInvokeHandler("get_outlinks", () => []);

    render(<RelationsPanel />);
    // Give the hook a tick to settle into the empty state.
    await waitFor(() => {
      expect(screen.queryByTestId("relations-handle")).toBeNull();
    });
  });

  it("shows the collapsed handle with a relation count when relations exist", async () => {
    openDoc("/p/active.md");
    setMockInvokeHandler("get_backlinks", () => [backlink]);
    setMockInvokeHandler("get_outlinks", () => [forwardResolved]);

    render(<RelationsPanel />);

    // 1 backlink occurrence + 1 forward link = 2.
    const handle = await screen.findByTestId("relations-handle");
    expect(handle).toBeTruthy();
    expect(screen.getByTestId("relations-handle-count").textContent).toBe("2");
  });

  it("stays visible but offset inward when the command bar is pinned (ADR 0004 coexistence)", async () => {
    openDoc("/p/active.md");
    useSettingsStore.setState({ cmdBarPinned: true });
    setMockInvokeHandler("get_backlinks", () => [backlink]);
    setMockInvokeHandler("get_outlinks", () => [forwardResolved]);

    render(<RelationsPanel />);
    // The panel coexists with the pinned cmd bar by offsetting the handle by
    // the pinned width — it is NOT hidden.
    const handle = await screen.findByTestId("relations-handle");
    expect(handle.style.right).toBe("var(--cmd-bar-pinned-width, 400px)");
  });

  it("renders grouped Linked-from and Links-to content when opened", async () => {
    openDoc("/p/active.md");
    setMockInvokeHandler("get_backlinks", () => [backlink]);
    setMockInvokeHandler("get_outlinks", () => [forwardResolved, forwardUnresolved]);

    render(<RelationsPanel />);

    const handle = await screen.findByTestId("relations-handle");
    fireEvent.click(handle);

    // Section headers.
    await screen.findByText("Links to");
    expect(screen.getByText("Linked from")).toBeTruthy();

    // Backlink source header + context occurrence.
    expect(screen.getByText("Source Doc")).toBeTruthy();
    expect(screen.getByText(/we mention active here/)).toBeTruthy();

    // Forward links — resolved target title + the unresolved "not created" mark.
    expect(screen.getByText("Orders Table")).toBeTruthy();
    expect(screen.getByText("not created")).toBeTruthy();
    // Unresolved target falls back to its basename label.
    expect(screen.getByText("missing.md")).toBeTruthy();
  });
});
