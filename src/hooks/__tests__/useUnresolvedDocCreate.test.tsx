// @vitest-environment jsdom

/**
 * Unit tests for `useUnresolvedDocCreate` (OKF wiki-navigation #12, ADR 0007).
 *
 * Focus: after a dangling wikilink target is created via create-on-click, the
 * hook must broadcast `notesage:wikilink-created` so the wiki-link decoration
 * re-resolves and the link stops rendering as unresolved/dashed (BUG 2).
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// `useUnresolvedDocCreate` calls `toast(...)` as a function (with an action
// callback), so we need a CALLABLE toast spy — the shared tauri-mock makes
// `toast` a plain object, which wouldn't capture the create action.
const toastFn = vi.fn((..._args: unknown[]) => undefined);
vi.mock("sonner", () => {
  const t = Object.assign((...args: unknown[]) => toastFn(...args), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  });
  return { toast: t };
});

const createFile = vi.fn(async (_dir: string, name: string) => `/p/${name}`);
vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: () => ({ createFile }),
}));

const tryOpenFile = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/lib/link-utils", () => ({
  tryOpenFile: (...args: unknown[]) => tryOpenFile(...args),
}));

// Editor-store's openTab getter is read inside the hook; stub it out.
vi.mock("@/stores/editor-store", () => ({
  useEditorStore: { getState: () => ({ openTab: vi.fn() }) },
}));

import { useUnresolvedDocCreate } from "@/hooks/useUnresolvedDocCreate";

/** Pull the `action.onClick` callback handed to the most recent `toast(...)`. */
function lastToastAction(): (() => void | Promise<void>) | undefined {
  const calls = (toastFn as unknown as Mock).mock.calls;
  const last = calls[calls.length - 1];
  return last?.[1]?.action?.onClick;
}

beforeEach(() => {
  createFile.mockClear();
  createFile.mockImplementation(async (_dir: string, name: string) => `/p/${name}`);
  tryOpenFile.mockClear();
  toastFn.mockClear();
});

describe("useUnresolvedDocCreate", () => {
  it("dispatches notesage:wikilink-created after creating the target (BUG 2)", async () => {
    renderHook(() => useUnresolvedDocCreate());

    const created = vi.fn();
    window.addEventListener("notesage:wikilink-created", created);

    window.dispatchEvent(
      new CustomEvent("notesage:create-unresolved-doc", {
        detail: { absPath: "/p/Brand New Page.md", href: "./brand-new-page.md" },
      }),
    );

    // The hook prompts via toast; invoke the "Create" action the user clicks.
    const onClick = lastToastAction();
    expect(onClick).toBeTypeOf("function");
    await onClick!();

    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(createFile).toHaveBeenCalledWith("/p", "Brand New Page.md");

    window.removeEventListener("notesage:wikilink-created", created);
  });

  it("does not dispatch when creation fails", async () => {
    createFile.mockRejectedValueOnce(new Error("disk full"));
    renderHook(() => useUnresolvedDocCreate());

    const created = vi.fn();
    window.addEventListener("notesage:wikilink-created", created);

    window.dispatchEvent(
      new CustomEvent("notesage:create-unresolved-doc", {
        detail: { absPath: "/p/Nope.md", href: "./nope.md" },
      }),
    );

    const onClick = lastToastAction();
    await onClick!();

    expect(created).not.toHaveBeenCalled();
    window.removeEventListener("notesage:wikilink-created", created);
  });
});
