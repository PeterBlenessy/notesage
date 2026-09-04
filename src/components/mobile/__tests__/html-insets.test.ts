// @vitest-environment jsdom
/**
 * The HTML reader's screen-edge clearance (#722).
 *
 * A report renders in a sandboxed iframe, so the parent cannot pad its scroll
 * area and `env(safe-area-inset-*)` does not resolve inside it. The padding is
 * therefore measured in the parent and injected into the document — which
 * means the injection itself is the only thing standing between a report and
 * the notch.
 */

import { describe, it, expect } from "vitest";
import { measureReaderInsets, withReaderInsets } from "@/components/mobile/html-insets";

describe("withReaderInsets", () => {
  const insets = { top: 108, bottom: 102 };

  it("pads both edges so content clears the islands", () => {
    const out = withReaderInsets("<p>report</p>", insets);
    expect(out).toContain("padding-top: 108px");
    expect(out).toContain("padding-bottom: 102px");
  });

  it("keeps the report's own markup ahead of the injected style", () => {
    // Appended, never rewritten — the report is the document, this is a
    // correction bolted on the end.
    const out = withReaderInsets("<p>report</p>", insets);
    expect(out.indexOf("<p>report</p>")).toBeLessThan(out.indexOf("padding-top"));
  });

  it("wins over a report that sets its own body padding", () => {
    // A generated report styling its own body would otherwise put its first
    // line under the notch, which is the failure this exists to prevent.
    const out = withReaderInsets("<style>body{padding:0}</style>", insets);
    expect(out).toMatch(/padding-top: 108px !important/);
    expect(out).toMatch(/padding-bottom: 102px !important/);
  });

  it("gives a short report enough height for the bottom padding to matter", () => {
    // Without min-height a one-paragraph report has nothing below the fold and
    // the bottom clearance collapses.
    expect(withReaderInsets("<p>hi</p>", insets)).toContain("min-height: 100vh");
  });

  it("uses border-box so the padding does not overflow the viewport", () => {
    expect(withReaderInsets("<p>hi</p>", insets)).toContain("box-sizing: border-box");
  });

  it("rounds to whole pixels", () => {
    const out = withReaderInsets("<p>hi</p>", { top: 107.6666, bottom: 101.3333 });
    expect(out).toContain("padding-top: 108px");
    expect(out).toContain("padding-bottom: 101px");
  });
});

describe("measureReaderInsets", () => {
  it("returns numbers and leaves no probe element behind", () => {
    // jsdom resolves env() to 0, so the chrome allowance is what shows up
    // here; the point of this test is that measuring is non-destructive.
    const before = document.body.childElementCount;
    const { top, bottom } = measureReaderInsets();
    expect(Number.isFinite(top)).toBe(true);
    expect(Number.isFinite(bottom)).toBe(true);
    expect(document.body.childElementCount).toBe(before);
  });
});

describe("withWideContentGuard (a wide table must not widen the page)", () => {
  it("appends rules that make tables and media scroll inside themselves", async () => {
    const { withWideContentGuard } = await import("@/components/mobile/html-insets");
    const out = withWideContentGuard("<html><body><table><tr><td>x</td></tr></table></body></html>");
    expect(out.startsWith("<html><body><table>")).toBe(true);
    expect(out).toMatch(/table \{[^}]*display: block;[^}]*overflow-x: auto/);
    expect(out).toMatch(/video, iframe, canvas, embed, object, img, svg \{ max-width: 100%; \}/);
  });
});
