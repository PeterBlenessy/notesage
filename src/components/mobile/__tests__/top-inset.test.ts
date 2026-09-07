// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from "vitest";

import { setNavShellPresented, TOP_INSET } from "../nav-shell-state";
import { CONTENT_INSETS } from "../Chrome";

/**
 * How much room the top of the screen owes to chrome.
 *
 * The two chromes are NOT the same height, and the bug this locks was adding
 * them together: floating islands hover over the content, so the web layer
 * reserves their height itself; a real navigation bar belongs to the view
 * controller, so UIKit has already put it in the safe area. Reserving the
 * island allowance ON TOP of a safe area that includes the bar left a
 * bar-height band of dead space under the title and cost the list its last
 * row (Peter, 2026-09-07) — which is invisible in a unit test unless the
 * arithmetic itself is the thing asserted.
 */
describe("the top chrome allowance", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--ns-top-inset");
    setNavShellPresented(false);
  });

  it("reserves the island height when the islands are what is up there", () => {
    setNavShellPresented(false);
    expect(document.documentElement.style.getPropertyValue("--ns-top-inset")).toBe(
      "calc(3.75rem + env(safe-area-inset-top))",
    );
  });

  it("reserves nothing beyond the safe area once the navigation bar is up", () => {
    // The bar IS the safe area's top inset here. Anything added to it is the
    // gap Peter saw.
    setNavShellPresented(true);
    expect(document.documentElement.style.getPropertyValue("--ns-top-inset")).toBe(
      "env(safe-area-inset-top)",
    );
  });

  it("falls back to the island allowance before anything has been written", () => {
    // A scroller can render before the shell has answered; reading an unset
    // custom property must not collapse the padding to zero and put the first
    // row under the notch.
    expect(TOP_INSET).toContain("3.75rem + env(safe-area-inset-top)");
    expect(TOP_INSET.startsWith("var(--ns-top-inset,")).toBe(true);
  });

  it("is what the scrollers actually pad with, so one edit moves all of them", () => {
    // The sticky group header, the pull spinner, three scrollers and the
    // injected report stylesheet must agree; a literal copied into any one of
    // them is how they drift apart again.
    expect(CONTENT_INSETS.paddingTop).toBe(TOP_INSET);
  });
});
