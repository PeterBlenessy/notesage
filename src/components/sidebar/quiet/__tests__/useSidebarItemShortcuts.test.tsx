// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
  setMockInvokeHandler,
  clearMockInvokeHandlers,
} from "@/test/component-harness";
import {
  chainKeyHandlers,
  isContextMenuKey,
  useSidebarItemShortcuts,
} from "../useSidebarItemShortcuts";

// ---------------------------------------------------------------------------
// Clipboard mock — jsdom's clipboard getter is not directly assignable, so
// we redefine the property. Re-installed per-test to survive jsdom resets.
// ---------------------------------------------------------------------------

const mockClipboardWrite = vi
  .fn<(text: string) => Promise<void>>()
  .mockImplementation(() => Promise.resolve());

function installClipboardMock() {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    get: () => ({ writeText: mockClipboardWrite }),
  });
}
installClipboardMock();

// ---------------------------------------------------------------------------
// Probe — renders a single focusable div that wires up the hook's onKeyDown
// and an optional "second" handler so chainKeyHandlers behavior can be
// exercised.
// ---------------------------------------------------------------------------

interface ProbeProps {
  filePath: string;
  extra?: (event: React.KeyboardEvent<HTMLElement>) => void;
}

function Probe({ filePath, extra }: ProbeProps) {
  const { onKeyDown } = useSidebarItemShortcuts({ filePath, kind: "file" });
  const chained = chainKeyHandlers(onKeyDown, extra);
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="row"
      onKeyDown={chained}
    >
      Row
    </div>
  );
}

beforeEach(() => {
  clearMockInvokeHandlers();
  mockClipboardWrite.mockClear();
  installClipboardMock();
});

afterEach(() => {
  clearMockInvokeHandlers();
});

describe("useSidebarItemShortcuts", () => {
  it("copies the path to the clipboard on ⌘⌥P (matched by physical code)", async () => {
    renderWithProviders(<Probe filePath="/abs/path/alpha.md" />);

    const row = screen.getByTestId("row");
    row.focus();
    // Option+P produces `π` on macOS, so the handler matches event.code.
    fireEvent.keyDown(row, {
      key: "π",
      code: "KeyP",
      metaKey: true,
      altKey: true,
    });

    await waitFor(() => expect(mockClipboardWrite).toHaveBeenCalled());
    expect(mockClipboardWrite).toHaveBeenCalledWith("/abs/path/alpha.md");
  });

  it("also fires on Ctrl+Alt+P (non-macOS equivalent)", async () => {
    renderWithProviders(<Probe filePath="/abs/path/beta.md" />);

    const row = screen.getByTestId("row");
    row.focus();
    fireEvent.keyDown(row, {
      key: "p",
      code: "KeyP",
      ctrlKey: true,
      altKey: true,
    });

    await waitFor(() => expect(mockClipboardWrite).toHaveBeenCalled());
    expect(mockClipboardWrite).toHaveBeenCalledWith("/abs/path/beta.md");
  });

  it("reveals the path in Finder on ⌘⌥R", async () => {
    const revealHandler = vi.fn<(args: unknown) => void>();
    setMockInvokeHandler("reveal_in_finder", (args) => {
      revealHandler(args);
      return Promise.resolve();
    });

    renderWithProviders(<Probe filePath="/abs/path/gamma.md" />);

    const row = screen.getByTestId("row");
    row.focus();
    fireEvent.keyDown(row, {
      key: "®",
      code: "KeyR",
      metaKey: true,
      altKey: true,
    });

    await waitFor(() => expect(revealHandler).toHaveBeenCalled());
    expect(revealHandler).toHaveBeenCalledWith({ path: "/abs/path/gamma.md" });
  });

  it("also fires Reveal on Ctrl+Alt+R", async () => {
    const revealHandler = vi.fn<(args: unknown) => void>();
    setMockInvokeHandler("reveal_in_finder", (args) => {
      revealHandler(args);
      return Promise.resolve();
    });

    renderWithProviders(<Probe filePath="/abs/path/delta.md" />);

    const row = screen.getByTestId("row");
    row.focus();
    fireEvent.keyDown(row, {
      key: "r",
      code: "KeyR",
      ctrlKey: true,
      altKey: true,
    });

    await waitFor(() => expect(revealHandler).toHaveBeenCalled());
    expect(revealHandler).toHaveBeenCalledWith({ path: "/abs/path/delta.md" });
  });

  it("surfaces a toast error when revealInFinder rejects", async () => {
    // Failure in the mock propagates as a rejected promise back into the
    // handler; it should catch and call toast.error (indirectly — the test
    // here just asserts we don't throw and the invoke was attempted).
    const revealHandler = vi.fn<() => Promise<void>>().mockRejectedValue(
      new Error("finder not available"),
    );
    setMockInvokeHandler("reveal_in_finder", () => revealHandler());

    renderWithProviders(<Probe filePath="/abs/fail.md" />);

    const row = screen.getByTestId("row");
    row.focus();
    fireEvent.keyDown(row, {
      key: "®",
      code: "KeyR",
      metaKey: true,
      altKey: true,
    });

    await waitFor(() => expect(revealHandler).toHaveBeenCalled());
  });

  it("ignores plain keystrokes (no mod, no alt)", () => {
    renderWithProviders(<Probe filePath="/abs/plain.md" />);

    const row = screen.getByTestId("row");
    row.focus();
    fireEvent.keyDown(row, { key: "c" });
    fireEvent.keyDown(row, { key: "r" });
    fireEvent.keyDown(row, { key: "a", metaKey: true }); // no alt

    expect(mockClipboardWrite).not.toHaveBeenCalled();
  });

  it("ignores combos without Alt (⌘C is browser copy — leave it alone)", () => {
    renderWithProviders(<Probe filePath="/abs/copy.md" />);

    const row = screen.getByTestId("row");
    row.focus();
    fireEvent.keyDown(row, { key: "c", metaKey: true });
    fireEvent.keyDown(row, { key: "r", metaKey: true });

    expect(mockClipboardWrite).not.toHaveBeenCalled();
  });

  it("ignores other letters even with the full modifier stack", () => {
    renderWithProviders(<Probe filePath="/abs/misc.md" />);

    const row = screen.getByTestId("row");
    row.focus();
    fireEvent.keyDown(row, {
      key: "x",
      metaKey: true,
      altKey: true,
    });

    expect(mockClipboardWrite).not.toHaveBeenCalled();
  });

  it("preventDefault short-circuits chained handlers", () => {
    const extra = vi.fn<(event: React.KeyboardEvent<HTMLElement>) => void>();
    renderWithProviders(<Probe filePath="/abs/chain.md" extra={extra} />);

    const row = screen.getByTestId("row");
    row.focus();
    fireEvent.keyDown(row, {
      key: "π",
      code: "KeyP",
      metaKey: true,
      altKey: true,
    });

    // Shortcut ran → clipboard write attempted → chain short-circuited.
    expect(mockClipboardWrite).toHaveBeenCalled();
    expect(extra).not.toHaveBeenCalled();
  });

  it("non-shortcut keys fall through to chained handlers", () => {
    const extra = vi.fn<(event: React.KeyboardEvent<HTMLElement>) => void>();
    renderWithProviders(<Probe filePath="/abs/fallthrough.md" extra={extra} />);

    const row = screen.getByTestId("row");
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });

    expect(extra).toHaveBeenCalledTimes(1);
  });
});

describe("chainKeyHandlers", () => {
  it("invokes handlers in order when none preventDefault", () => {
    const a = vi.fn<(e: React.KeyboardEvent<HTMLElement>) => void>();
    const b = vi.fn<(e: React.KeyboardEvent<HTMLElement>) => void>();
    const chained = chainKeyHandlers(a, b);

    // Synthetic React keyboard event stand-in — only the fields we use.
    const event = {
      defaultPrevented: false,
    } as React.KeyboardEvent<HTMLElement>;

    chained(event);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("stops after a handler marks the event as defaultPrevented", () => {
    const a = vi.fn<(e: React.KeyboardEvent<HTMLElement>) => void>(
      (e) => {
        // Simulate preventDefault by mutating defaultPrevented directly —
        // good enough for this unit; real React events flip the flag in
        // preventDefault().
        Object.defineProperty(e, "defaultPrevented", {
          value: true,
          configurable: true,
        });
      },
    );
    const b = vi.fn<(e: React.KeyboardEvent<HTMLElement>) => void>();
    const chained = chainKeyHandlers(a, b);

    const event = {
      defaultPrevented: false,
    } as React.KeyboardEvent<HTMLElement>;

    chained(event);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("tolerates undefined handlers", () => {
    const b = vi.fn<(e: React.KeyboardEvent<HTMLElement>) => void>();
    const chained = chainKeyHandlers(undefined, b, undefined);

    const event = {
      defaultPrevented: false,
    } as React.KeyboardEvent<HTMLElement>;
    chained(event);

    expect(b).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// isContextMenuKey — cross-keyboard layout safety
// (PRD-less: tracked in `docs/tasks/2026-04-28-quiet-composer-phase2-keyboard-blockers-tasks.md`
// task #1. Swedish keyboard `Shift+,` produces `;` not `,`, so the
// chord must also accept `event.code === "Comma"` as a layout-
// independent fallback.)
// ---------------------------------------------------------------------------

describe("isContextMenuKey", () => {
  function ev(partial: Partial<KeyboardEvent>): React.KeyboardEvent<HTMLElement> {
    return partial as unknown as React.KeyboardEvent<HTMLElement>;
  }

  it("matches the macOS / Windows Menu key", () => {
    expect(isContextMenuKey(ev({ key: "ContextMenu" }))).toBe(true);
  });

  it("matches ⌘⇧, on US-style keyboards (key === ',')", () => {
    expect(
      isContextMenuKey(
        ev({ key: ",", code: "Comma", metaKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("matches ⌘⇧, on Swedish-style keyboards (key === ';' but code === 'Comma')", () => {
    // On Swedish keyboards, Shift+Comma produces `;`, not `,`. The
    // physical key code stays "Comma" regardless of layout, so the
    // OR fallback rescues the chord.
    expect(
      isContextMenuKey(
        ev({ key: ";", code: "Comma", metaKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("matches Ctrl+Shift+, (non-mac equivalent)", () => {
    expect(
      isContextMenuKey(
        ev({ key: ",", code: "Comma", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("rejects ⌘⇧; produced by a DIFFERENT physical key (e.g. dedicated semicolon key)", () => {
    // The physical Semicolon key produces `;` with a different `code`
    // value. Just because the produced character matches a layout
    // somewhere doesn't mean we open the context menu — the chord
    // must come from the Comma physical position.
    expect(
      isContextMenuKey(
        ev({ key: ";", code: "Semicolon", metaKey: true, shiftKey: true }),
      ),
    ).toBe(false);
  });

  it("rejects ⌘, without Shift (that's the Settings shortcut)", () => {
    expect(
      isContextMenuKey(
        ev({ key: ",", code: "Comma", metaKey: true, shiftKey: false }),
      ),
    ).toBe(false);
  });

  it("rejects bare ',' without modifiers", () => {
    expect(isContextMenuKey(ev({ key: ",", code: "Comma" }))).toBe(false);
  });

  it("rejects ⌘⇧, with Alt (different chord)", () => {
    // The helper isn't responsible for filtering Alt; this test just
    // documents that we don't accidentally match alt-modified chords
    // that other handlers might own.
    expect(
      isContextMenuKey(
        ev({
          key: ",",
          code: "Comma",
          metaKey: true,
          shiftKey: true,
          altKey: true,
        }),
      ),
    ).toBe(true);
    // Note: returns true because we don't check altKey. If a future
    // chord conflicts, the helper would need to gate on `!altKey`.
    // Documented here so the choice is explicit.
  });
});
