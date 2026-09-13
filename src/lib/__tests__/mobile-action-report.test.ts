/**
 * The reporter has to pick the surface the user is actually looking at. Both
 * branches are worth pinning: the native one is the whole point of the file,
 * and the fallback is what keeps desktop dev and every other test honest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const iosContextMenu = vi.fn<(options: unknown) => Promise<string | null>>();
const toastError = vi.fn<(message: string) => void>();
const setChromeStatus = vi.fn<(status: unknown) => void>();

vi.mock("@/lib/ios-api", () => ({ iosContextMenu: (o: unknown) => iosContextMenu(o) }));
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));
vi.mock("@/components/mobile/chrome-status", () => ({
  setChromeStatus: (s: unknown) => setChromeStatus(s),
}));

import {
  reportActionDone,
  reportActionError,
  resetActionReporting,
} from "@/lib/mobile-action-report";

describe("reportActionError", () => {
  beforeEach(() => {
    iosContextMenu.mockReset();
    toastError.mockReset();
  });

  it("shows a native sheet with no actions, so it reads as a message", async () => {
    iosContextMenu.mockResolvedValue(null);
    await reportActionError("Delete failed: no such file");

    expect(iosContextMenu).toHaveBeenCalledTimes(1);
    const options = iosContextMenu.mock.calls[0][0] as {
      title: string;
      items: unknown[];
      cancelLabel: string;
    };
    expect(options.title).toBe("Delete failed: no such file");
    expect(options.items).toEqual([]);
    // "Cancel" on a message the user can only acknowledge invites them to
    // think something is still undoable.
    expect(options.cancelLabel).toBe("OK");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("falls back to a toast where there is no native layer", async () => {
    // What `invoke` does off-iOS: the command does not exist.
    iosContextMenu.mockRejectedValue(new Error("command ios_context_menu not found"));
    await reportActionError("Move failed");

    expect(toastError).toHaveBeenCalledWith("Move failed");
  });

  it("never throws — a failed report must not replace the original error", async () => {
    iosContextMenu.mockRejectedValue(new Error("no presenter"));
    toastError.mockImplementation(() => {
      throw new Error("no toaster mounted either");
    });
    await expect(reportActionError("Rename failed")).resolves.toBeUndefined();
  });
});

describe("reportActionDone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setChromeStatus.mockReset();
    resetActionReporting();
  });
  afterEach(() => {
    resetActionReporting();
    vi.useRealTimers();
  });

  it("publishes a passive status line — no spinner, nothing to dismiss", () => {
    reportActionDone("Moved to Drafts");
    expect(setChromeStatus).toHaveBeenCalledWith({ label: "Moved to Drafts", busy: false });
  });

  it("clears itself, so a confirmation does not become permanent chrome", () => {
    reportActionDone("Moved to Drafts");
    setChromeStatus.mockClear();
    vi.advanceTimersByTime(3000);
    expect(setChromeStatus).toHaveBeenCalledWith(null);
  });

  it("does not let an earlier confirmation clear a later one", () => {
    reportActionDone("Moved to Drafts");
    vi.advanceTimersByTime(2000);
    reportActionDone("Moved to Essays");
    setChromeStatus.mockClear();
    // The first timer would have fired here had it not been cancelled, and
    // would have wiped a message shown 600ms ago.
    vi.advanceTimersByTime(1000);
    expect(setChromeStatus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(setChromeStatus).toHaveBeenCalledWith(null);
  });
});
