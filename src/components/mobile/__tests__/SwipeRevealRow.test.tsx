// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/component-harness";
import { SwipeRevealRow, type SwipeRevealAction } from "@/components/mobile/SwipeRevealRow";

function makeAction(overrides: Partial<SwipeRevealAction> = {}): SwipeRevealAction {
  return {
    id: "share",
    label: "Share",
    icon: () => null,
    onSelect: vi.fn(),
    ...overrides,
  };
}

function Row({
  actions,
  onRowClick,
}: {
  actions: SwipeRevealAction[];
  onRowClick: () => void;
}) {
  return (
    <SwipeRevealRow actions={actions}>
      <button type="button" onClick={onRowClick}>
        row content
      </button>
    </SwipeRevealRow>
  );
}

/** Simulate a horizontal drag from `from` to `to` on the given element. */
function swipe(el: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(el, { clientX: from });
  fireEvent.pointerMove(el, { clientX: to });
  fireEvent.pointerUp(el, { clientX: to });
}

describe("SwipeRevealRow (issue #618)", () => {
  it("hides the action until the row is swiped", () => {
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("reveals the action after a leftward swipe past the reveal threshold", () => {
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    swipe(content, 200, 100); // -100px, past half of the single 72px action width
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });

  it("snaps back closed when the swipe distance stays under the reveal threshold", () => {
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    swipe(content, 200, 190); // -10px, well under half of the 72px action width
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("invokes the action's onSelect when tapped after reveal", () => {
    const onSelect = vi.fn();
    renderWithProviders(<Row actions={[makeAction({ onSelect })]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    swipe(content, 200, 100);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("supports a second action without any change to the gesture handling (extensibility for #619)", () => {
    const share = makeAction({ id: "share", label: "Share" });
    const del = makeAction({ id: "delete", label: "Delete", tone: "destructive" });
    renderWithProviders(<Row actions={[share, del]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    swipe(content, 300, 100); // -200px, past half of the 144px two-action width
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("a plain tap with no drag still fires the row's own click handler", () => {
    const onRowClick = vi.fn();
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={onRowClick} />);
    const content = screen.getByText("row content");
    fireEvent.pointerDown(content, { clientX: 200 });
    fireEvent.pointerUp(content, { clientX: 200 });
    fireEvent.click(content);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("tapping an already-revealed row closes it and suppresses the row's click instead of activating", () => {
    const onRowClick = vi.fn();
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={onRowClick} />);
    const content = screen.getByText("row content");
    swipe(content, 200, 100);
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();

    // A plain tap (no drag) on the now-revealed row content.
    fireEvent.pointerDown(content, { clientX: 100 });
    fireEvent.pointerUp(content, { clientX: 100 });
    fireEvent.click(content);

    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });
});
