// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/component-harness";
import { InboxCard, RecordingsCard } from "@/components/mobile/InboxCard";

/**
 * The two pinned cards share one `PinnedFolderCard`, so anything Inbox-specific
 * inside it is a seam the second card inherits (#930). The badge's test id is
 * named by the caller for exactly that reason.
 */
describe("pinned folder cards", () => {
  it("labels the Inbox badge with the Inbox's own test id", () => {
    renderWithProviders(<InboxCard count={5} unread={2} onOpen={vi.fn()} />);
    expect(screen.getByTestId("inbox-unread").textContent).toBe("2");
  });

  it("shows the total, not the badge, when nothing is unread", () => {
    renderWithProviders(<InboxCard count={5} unread={0} onOpen={vi.fn()} />);
    expect(screen.queryByTestId("inbox-unread")).toBeNull();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("does not hand Recordings the Inbox's test id", () => {
    renderWithProviders(<RecordingsCard count={3} onOpen={vi.fn()} />);
    expect(screen.queryByTestId("inbox-unread")).toBeNull();
    expect(screen.getByText("3")).toBeTruthy();
  });
});
