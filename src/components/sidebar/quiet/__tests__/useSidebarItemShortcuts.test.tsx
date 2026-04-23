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
  it("copies the path to the clipboard on ⌘⌥C", async () => {
    renderWithProviders(<Probe filePath="/abs/path/alpha.md" />);

    const row = screen.getByTestId("row");
    row.focus();
    fireEvent.keyDown(row, {
      key: "c",
      metaKey: true,
      altKey: true,
    });

    await waitFor(() => expect(mockClipboardWrite).toHaveBeenCalled());
    expect(mockClipboardWrite).toHaveBeenCalledWith("/abs/path/alpha.md");
  });

  it("also fires on Ctrl+Alt+C (non-macOS equivalent)", async () => {
    renderWithProviders(<Probe filePath="/abs/path/beta.md" />);

    const row = screen.getByTestId("row");
    row.focus();
    fireEvent.keyDown(row, {
      key: "c",
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
      key: "r",
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
      key: "r",
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
      key: "c",
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
