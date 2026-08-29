// @vitest-environment jsdom
/**
 * Repairing a saved article's missing doctype when it is opened on DESKTOP
 * (#805 follow-up).
 *
 * The mobile Reader does the same thing, and relying on it alone was the
 * original plan: the library is iCloud-synced, so a file repaired on the phone
 * is repaired everywhere. Peter's call was that "most files" is not the bar —
 * an article only ever opened on desktop would stay in quirks mode forever,
 * and these documents are meant to be portable (opened in a browser, Quick
 * Looked, sent to someone). So both readers repair.
 *
 * What is pinned here is the orchestration, not the decision — the decision is
 * Rust's `repair_missing_doctype`, unit-tested on the host in `preview.rs`.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

import "@/test/tauri-mock";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { HtmlViewer } from "../HtmlViewer";
import { setMockInvokeHandler } from "@/test/tauri-mock";

const DAMAGED = "<html><body><h1>Hello</h1></body></html>";
const REPAIRED = `<!doctype html>\n${DAMAGED}`;

let repairCalls: string[] = [];

beforeEach(() => {
  repairCalls = [];
  setMockInvokeHandler("html_preview_register", () => undefined);
  setMockInvokeHandler("html_preview_unregister", () => undefined);
});

/** Make the backend answer as the real Rust command would for this input. */
function mockRepair(answer: (content: string) => string | null) {
  setMockInvokeHandler("repair_html_doctype", (args) => {
    const content = String((args as { content?: string })?.content ?? "");
    repairCalls.push(content);
    return answer(content);
  });
}

function renderViewer(props: Partial<React.ComponentProps<typeof HtmlViewer>> = {}) {
  const updateTabContent = vi.fn();
  const saveFileWithContent = vi.fn();
  render(
    <HtmlViewer
      content={DAMAGED}
      fileName="page.html"
      filePath="/path/to/page.html"
      tabId="tab-1"
      isDirty={false}
      updateTabContent={updateTabContent}
      saveFileWithContent={saveFileWithContent}
      {...props}
    />,
  );
  return { updateTabContent, saveFileWithContent };
}

describe("HtmlViewer doctype repair", () => {
  it("writes the repaired document back to the file", async () => {
    mockRepair(() => REPAIRED);
    const { updateTabContent, saveFileWithContent } = renderViewer();

    await waitFor(() => expect(saveFileWithContent).toHaveBeenCalledWith(REPAIRED));
    // The open tab has to be updated too, or the viewer keeps rendering the
    // stale text until the file is reopened.
    expect(updateTabContent).toHaveBeenCalledWith(REPAIRED);
  });

  it("does not write a document that needs no repair", async () => {
    // The normal case. Writing here would churn the modification date of every
    // healthy article each time it is opened, and re-sync it through iCloud.
    mockRepair(() => null);
    const { updateTabContent, saveFileWithContent } = renderViewer({ content: REPAIRED });

    await waitFor(() => expect(repairCalls.length).toBe(1));
    expect(saveFileWithContent).not.toHaveBeenCalled();
    expect(updateTabContent).not.toHaveBeenCalled();
  });

  it("leaves a dirty tab alone", async () => {
    // `content` carries the user's unsaved edits while the tab is dirty, so
    // saving to fix fifteen bytes would silently commit those edits too.
    mockRepair(() => REPAIRED);
    const { saveFileWithContent } = renderViewer({ isDirty: true });

    await new Promise((r) => setTimeout(r, 20));
    expect(repairCalls).toEqual([]);
    expect(saveFileWithContent).not.toHaveBeenCalled();
  });

  it("still renders when the repair command is unavailable", async () => {
    setMockInvokeHandler("repair_html_doctype", () => {
      throw new Error("no such command");
    });
    const { saveFileWithContent } = renderViewer();

    await waitFor(() => expect(document.body.textContent).toContain("Hello"));
    expect(saveFileWithContent).not.toHaveBeenCalled();
  });
});
