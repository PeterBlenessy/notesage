// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/component-harness";
import { FocusPill } from "@/components/editor/FocusPill";

const useReducedMotionMock = vi.fn<() => boolean>(() => false);

vi.mock("@/hooks/useReducedMotion", () => ({
  useReducedMotion: () => useReducedMotionMock(),
}));

describe("FocusPill (#55)", () => {
  beforeEach(() => {
    useReducedMotionMock.mockReturnValue(false);
  });

  it("renders nothing when active is false", () => {
    const { container } = renderWithProviders(
      <FocusPill active={false} onExit={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the hint text and exit button when active", () => {
    renderWithProviders(<FocusPill active={true} onExit={() => {}} />);

    const root = screen.getByRole("status");
    expect(root.textContent).toContain("Focus");
    expect(root.textContent).toContain("⌘.");
    expect(root.textContent).toContain("to exit");

    expect(
      screen.getByRole("button", { name: "Exit focus mode" }),
    ).toBeTruthy();
  });

  it("calls onExit when the × button is clicked", async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<FocusPill active={true} onExit={onExit} />);

    await user.click(screen.getByRole("button", { name: "Exit focus mode" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("calls onExit when Enter is pressed while the × button is focused", async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<FocusPill active={true} onExit={onExit} />);

    const button = screen.getByRole("button", { name: "Exit focus mode" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("sets aria-label=\"Exit focus mode\" on the × button", () => {
    renderWithProviders(<FocusPill active={true} onExit={() => {}} />);

    const button = screen.getByRole("button", { name: "Exit focus mode" });
    expect(button.getAttribute("aria-label")).toBe("Exit focus mode");
  });

  it("sets role=\"status\" and aria-live=\"polite\" on the root", () => {
    renderWithProviders(<FocusPill active={true} onExit={() => {}} />);

    const root = screen.getByRole("status");
    expect(root.getAttribute("aria-live")).toBe("polite");
  });

  it("omits animation classes when prefers-reduced-motion: reduce matches", () => {
    useReducedMotionMock.mockReturnValue(true);
    renderWithProviders(<FocusPill active={true} onExit={() => {}} />);

    const root = screen.getByRole("status");
    const className = root.className ?? "";
    expect(className).not.toContain("animate-in");
    expect(className).not.toContain("fade-in");
    expect(className).not.toContain("slide-in-from-top");
    expect(className).not.toContain("duration-");
  });

  it("carries the data-focus-pill attribute on the root", () => {
    renderWithProviders(<FocusPill active={true} onExit={() => {}} />);

    const root = screen.getByRole("status");
    expect(root.getAttribute("data-focus-pill")).toBe("true");
  });
});
