// @vitest-environment jsdom

/**
 * The document carries whether the native stack owns screen transitions.
 *
 * One consumer today: the `.view-enter` zoom, which must not run while UIKit
 * is already animating a push or a pop. Two animations for one navigation is
 * one too many, and the second reads as "a bump or zoom effect when returning
 * to the list" (Peter, device, the build after #997) — the pop drops its
 * frozen snapshot two frames in, which lands at the very start of a 340ms
 * zoom, so the tail of it is what shows.
 *
 * Pinned here rather than left to the stylesheet because the flag is the
 * contract: a rule keyed on an attribute nothing writes fails silently, and
 * silently is how this whole family of bugs has behaved.
 */
import { describe, it, expect, afterEach } from "vitest";
import { setNavShellPresented } from "@/components/mobile/nav-shell-state";

afterEach(() => setNavShellPresented(false));

describe("the nav-shell flag on the document", () => {
  it("is written when the stack presents", () => {
    setNavShellPresented(true);
    expect(document.documentElement.dataset.navShell).toBe("true");
  });

  it("is written when it goes away, not merely removed", () => {
    // An absent attribute and a false one select differently; the rule keys on
    // `="true"`, so either works — but leaving it stale would not.
    setNavShellPresented(true);
    setNavShellPresented(false);
    expect(document.documentElement.dataset.navShell).toBe("false");
  });

  it("is written even when the value has not changed", () => {
    // Same reasoning as `writeTopInset`: the default state is the common one,
    // and an early return before the write would leave it never written.
    document.documentElement.removeAttribute("data-nav-shell");
    setNavShellPresented(false);
    expect(document.documentElement.dataset.navShell).toBe("false");
  });
});
