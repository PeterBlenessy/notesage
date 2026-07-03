/**
 * Marketing-site QUALITY GATE — runs in the default unit suite (CI), no build
 * and no browser required. It asserts the accessibility + structure invariants
 * fixed in the quality pass directly on the page builders' HTML output (stub
 * CSS + stub editor content), so those fixes can't silently regress.
 *
 * The browser-only checks (responsive overflow, visual fidelity) are not here —
 * they need the built app CSS + a real layout engine; run them locally against
 * content/site/ after `pnpm build && pnpm gen:charts && pnpm gen:site`.
 */
import { describe, it, expect } from "vitest";
import { landingHtml } from "./landing";
import { featuresHtml } from "./features";
import { privacyHtml } from "./privacy";
import { gettingStartedHtml } from "./getting-started";
import { aboutHtml } from "./about";
import { BASE_CSS, DOWNLOAD_URL } from "./shell";

// Stub editor content — the quality checks are about page structure, not the
// (separately tested) markdown rendering, so simple placeholders suffice.
const STUB_EDITORS: Record<string, string> = {
  hero: "<h1>Stub</h1><p>body</p>",
  formatting: "<h1>Stub</h1><p>body</p>",
  "quarterly-review": "<h1>Stub</h1><p>body</p>",
  "notes-on-craft": "<h1>Stub</h1><p>Revision is not fixing mistakes. It ends.</p>",
};

const PAGES: Array<[string, string]> = [
  ["index", landingHtml("", STUB_EDITORS)],
  ["features", featuresHtml("")],
  ["getting-started", gettingStartedHtml("")],
  ["privacy", privacyHtml("")],
  ["about", aboutHtml("")],
];

/** Remove decorative `aria-hidden="true"` <div> subtrees (the product-shot
 *  illustrations) so their embedded doc headings don't count toward the page
 *  outline — mirroring how the accessibility tree ignores them. */
function stripDecorative(html: string): string {
  let out = html;
  for (;;) {
    const open = out.match(/<div\b[^>]*aria-hidden="true"[^>]*>/);
    if (!open || open.index === undefined) break;
    const start = open.index;
    const re = /<\/?div\b[^>]*>/g;
    re.lastIndex = start + open[0].length;
    let depth = 1;
    let end = out.length;
    let m: RegExpExecArray | null;
    while ((m = re.exec(out))) {
      depth += m[0].startsWith("</") ? -1 : 1;
      if (depth === 0) { end = m.index + m[0].length; break; }
    }
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

/** Heading levels in document order, ignoring decorative illustrations. */
function headingLevels(html: string): number[] {
  return [...stripDecorative(html).matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
}
/** All opening tags of a given element. */
function tags(html: string, el: string): string[] {
  return [...html.matchAll(new RegExp(`<${el}\\b[^>]*>`, "g"))].map((m) => m[0]);
}

describe("marketing site — quality gate", () => {
  for (const [name, html] of PAGES) {
    describe(name, () => {
      it("is a valid, localized HTML document with a responsive viewport", () => {
        expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
        expect(html).toContain('<html lang="en"');
        expect(html).toContain('name="viewport"');
      });

      it("has a non-empty <title>", () => {
        const m = html.match(/<title>([^<]+)<\/title>/);
        expect(m?.[1]?.trim().length).toBeGreaterThan(0);
      });

      it("has exactly one <h1>", () => {
        expect(headingLevels(html).filter((l) => l === 1)).toHaveLength(1);
      });

      it("has landmarks: skip link, single <main id=main>, nav, footer", () => {
        expect(html).toContain('class="skip-link"');
        expect(tags(html, "main")).toHaveLength(1);
        expect(html).toContain('<main id="main">');
        expect(html).toContain("<nav");
        expect(html).toContain("<footer");
      });

      it("never skips a heading level (a11y outline)", () => {
        const levels = headingLevels(html);
        expect(levels[0]).toBe(1);
        for (let i = 1; i < levels.length; i++) {
          expect(levels[i]).toBeLessThanOrEqual(levels[i - 1] + 1);
        }
      });

      it("gives every <img> an alt attribute", () => {
        for (const tag of tags(html, "img")) expect(tag).toMatch(/\balt=/);
      });

      it("marks decorative product shots aria-hidden", () => {
        // Every `.shot` container is a decorative app illustration.
        for (const tag of tags(html, "div").filter((t) => /class="shot\b/.test(t))) {
          expect(tag).toContain('aria-hidden="true"');
        }
      });

      it("points every Download control at the releases page", () => {
        expect(html).toContain(DOWNLOAD_URL);
        expect(html).not.toMatch(/href="#download"/); // stale in-page anchor
      });

      it("has no unrendered template artifacts", () => {
        for (const bad of ["undefined", "[object Object]", "${", "NaN"]) {
          expect(html).not.toContain(bad);
        }
      });
    });
  }

  describe("shared stylesheet", () => {
    it("defines the AA-contrast accent-ink and uses it for eyebrows", () => {
      expect(BASE_CSS).toContain("--accent-ink:");
      expect(BASE_CSS).toMatch(/\.eyebrow\s*\{[^}]*color:\s*var\(--accent-ink\)/);
    });
    it("provides a visible keyboard focus ring", () => {
      expect(BASE_CSS).toContain(":focus-visible");
    });
    it("scales fixed-size app-window mockups down on narrow screens", () => {
      expect(BASE_CSS).toMatch(/max-width:\s*760px/);
      expect(BASE_CSS).toMatch(/\.shot \.device\s*\{\s*zoom:/);
    });
  });
});
