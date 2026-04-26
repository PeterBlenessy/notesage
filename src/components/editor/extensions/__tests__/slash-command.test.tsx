/**
 * @vitest-environment jsdom
 *
 * Live-test 2026-04-26 — slash menu must scroll the highlighted row into
 * view as the user arrows past the visible window. Regression lock for the
 * fix that wired `scrollIntoView({ block: "nearest" })` into the
 * selection-change effect inside `CommandList`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef } from "react";
import { render, act, cleanup } from "@testing-library/react";
import { Heading1, List } from "lucide-react";
import {
  CommandList,
  type CommandListRef,
  type CommandItem,
} from "../slash-command";

const makeItems = (count: number): CommandItem[] =>
  Array.from({ length: count }, (_, i) => ({
    title: `Item ${i}`,
    description: `Description ${i}`,
    icon: i % 2 === 0 ? Heading1 : List,
    command: () => {},
  }));

describe("SlashCommand <CommandList>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("scrolls the newly highlighted row into view when ArrowDown advances past the visible window", () => {
    const ref = createRef<CommandListRef>();
    const items = makeItems(20);

    // Stub HTMLElement.prototype.scrollIntoView once — this guarantees the
    // mock is in place for every button regardless of when the ref attaches
    // or how React reconciles the rerender (jsdom doesn't implement
    // scrollIntoView, so without a stub the call would throw rather than
    // silently no-op).
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    const { container } = render(
      <CommandList ref={ref} items={items} command={() => {}} />,
    );

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(20);

    scrollSpy.mockClear();

    // Simulate ArrowDown three times — selection should land on index 3.
    act(() => {
      for (let i = 0; i < 3; i++) {
        ref.current?.onKeyDown({
          event: new KeyboardEvent("keydown", { key: "ArrowDown" }),
        });
      }
    });

    // The effect should have fired scrollIntoView at least once with
    // `{ block: "nearest" }`. We don't assert the exact call count because
    // React 19 may batch or split the renders; what matters is that the
    // scroll-into-view ran on the new selection.
    expect(scrollSpy).toHaveBeenCalled();
    const callArgs = scrollSpy.mock.calls[0]?.[0] as
      | ScrollIntoViewOptions
      | undefined;
    expect(callArgs?.block).toBe("nearest");
  });

  it("scrolls into view when ArrowUp wraps from index 0 to the last item", () => {
    const ref = createRef<CommandListRef>();
    const items = makeItems(20);

    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    render(<CommandList ref={ref} items={items} command={() => {}} />);
    scrollSpy.mockClear();

    // ArrowUp from index 0 wraps to last (index 19) — must scroll there too.
    act(() => {
      ref.current?.onKeyDown({
        event: new KeyboardEvent("keydown", { key: "ArrowUp" }),
      });
    });

    expect(scrollSpy).toHaveBeenCalled();
    const callArgs = scrollSpy.mock.calls[0]?.[0] as
      | ScrollIntoViewOptions
      | undefined;
    expect(callArgs?.block).toBe("nearest");
  });

  it("renders the menu with overflow-y-auto and a bounded max-height so there is something to scroll", () => {
    const { container } = render(
      <CommandList items={makeItems(5)} command={() => {}} />,
    );

    // The component's outermost element is the menu container.
    const menu = container.firstElementChild as HTMLDivElement | null;
    expect(menu).not.toBeNull();
    expect(menu!.className).toMatch(/overflow-y-auto/);
    // Bounded max height (numeric or arbitrary value) — the live-test fix
    // depends on this so the parent isn't unbounded and pushing overflow up
    // to the page level.
    expect(menu!.className).toMatch(/max-h-/);
  });
});
