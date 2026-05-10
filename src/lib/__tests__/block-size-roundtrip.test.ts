// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import {
  convertChartsToHtml,
  convertDrawingsToHtml,
  convertInlineChartsToHtml,
  convertInlineDrawingsToHtml,
  convertImagesWithMetaToHtml,
} from "@/lib/markdown";

// Round-trip test for #173 follow-up: width/align settings on chart and
// drawing nodes must persist across save → reopen, including for legacy
// sidecar references that haven't been auto-migrated to inline form yet.
//
// The serialiser writes a trailing `<!--blockWidth:N,align:X-->` HTML comment
// after the sidecar image; the parser reads it back into the
// `data-block-width` / `data-align` attributes that the chart and drawing
// node extensions consume.

describe("Sidecar block metadata round-trip", () => {
  describe("convertDrawingsToHtml", () => {
    it("parses sidecar reference without metadata", () => {
      const md = "![drawing](/.notesage/drawings/abc.excalidraw)";
      const html = convertDrawingsToHtml(md);
      expect(html).toContain('data-drawing-id="abc"');
      expect(html).not.toContain("data-block-width");
      expect(html).not.toContain("data-align");
    });

    it("parses sidecar reference with blockWidth+align metadata", () => {
      const md =
        "![drawing](/.notesage/drawings/abc.excalidraw) <!--blockWidth:75,align:center-->";
      const html = convertDrawingsToHtml(md);
      expect(html).toContain('data-drawing-id="abc"');
      expect(html).toContain('data-block-width="75"');
      expect(html).toContain('data-align="center"');
    });

    it("parses metadata in either order (align first)", () => {
      const md =
        "![drawing](/.notesage/drawings/abc.excalidraw) <!--align:right,blockWidth:50-->";
      const html = convertDrawingsToHtml(md);
      expect(html).toContain('data-block-width="50"');
      expect(html).toContain('data-align="right"');
    });

    it("parses metadata with only blockWidth", () => {
      const md =
        "![drawing](/.notesage/drawings/abc.excalidraw) <!--blockWidth:100-->";
      const html = convertDrawingsToHtml(md);
      expect(html).toContain('data-block-width="100"');
      expect(html).not.toContain("data-align");
    });

    it("parses metadata with only align", () => {
      const md =
        "![drawing](/.notesage/drawings/abc.excalidraw) <!--align:left-->";
      const html = convertDrawingsToHtml(md);
      expect(html).not.toContain("data-block-width");
      expect(html).toContain('data-align="left"');
    });
  });

  describe("convertChartsToHtml", () => {
    it("parses sidecar reference without metadata", () => {
      const md = "![chart](/.notesage/charts/abc.json)";
      const html = convertChartsToHtml(md);
      expect(html).toContain('data-chart-id="abc"');
      expect(html).not.toContain("data-block-width");
      expect(html).not.toContain("data-align");
    });

    it("parses sidecar reference with blockWidth+align metadata", () => {
      const md =
        "![chart](/.notesage/charts/abc.json) <!--blockWidth:50,align:right-->";
      const html = convertChartsToHtml(md);
      expect(html).toContain('data-chart-id="abc"');
      expect(html).toContain('data-block-width="50"');
      expect(html).toContain('data-align="right"');
    });

    it("does not match comments on later, unrelated images", () => {
      // Comment is far from the chart and shouldn't be consumed.
      const md = `![chart](/.notesage/charts/abc.json)

![other](/some/other/image.png) <!--blockWidth:75-->`;
      const html = convertChartsToHtml(md);
      expect(html).toContain('data-chart-id="abc"');
      // The comment after `other` belongs to nothing; the chart line shouldn't
      // pick it up.
      expect(html).not.toContain('data-block-width="75"');
    });
  });

  describe("convertInlineChartsToHtml — `{width=N align=X}` suffix", () => {
    it("parses inline chart with no suffix", () => {
      const md = "```chart\n{\"type\":\"bar\"}\n```";
      const html = convertInlineChartsToHtml(md);
      expect(html).toContain("data-chart-json");
      expect(html).not.toContain("data-block-width");
      expect(html).not.toContain("data-align");
    });

    it("parses inline chart with width suffix", () => {
      const md = "```chart {width=50}\n{\"type\":\"bar\"}\n```";
      const html = convertInlineChartsToHtml(md);
      expect(html).toContain('data-block-width="50"');
    });

    it("parses inline chart with width+align suffix", () => {
      const md = "```chart {width=75 align=right}\n{\"type\":\"bar\"}\n```";
      const html = convertInlineChartsToHtml(md);
      expect(html).toContain('data-block-width="75"');
      expect(html).toContain('data-align="right"');
    });

    it("parses inline chart with align-only suffix", () => {
      const md = "```chart {align=center}\n{\"type\":\"bar\"}\n```";
      const html = convertInlineChartsToHtml(md);
      expect(html).not.toContain("data-block-width");
      expect(html).toContain('data-align="center"');
    });

    it("survives realistic multiline JSON body", () => {
      const md = "```chart {width=50}\n{\n  \"type\": \"bar\",\n  \"data\": [\n    {\"x\": 1, \"y\": 2}\n  ]\n}\n```";
      const html = convertInlineChartsToHtml(md);
      expect(html).toContain('data-block-width="50"');
    });
  });

  describe("convertInlineDrawingsToHtml — `{width=N align=X}` suffix", () => {
    it("parses inline drawing with width+align suffix", () => {
      const md = "```excalidraw {width=100 align=center}\n{\"elements\":[]}\n```";
      const html = convertInlineDrawingsToHtml(md);
      expect(html).toContain('data-block-width="100"');
      expect(html).toContain('data-align="center"');
    });
  });

  describe("convertImagesWithMetaToHtml", () => {
    it("leaves a plain image alone (no metadata comment)", () => {
      const md = "![photo](photo.png)";
      // No metadata → no rewrite, markdown-it parses natively.
      expect(convertImagesWithMetaToHtml(md)).toBe(md);
    });

    it("converts an image with blockWidth+align metadata to an HTML <img>", () => {
      const md = "![photo](photo.png) <!--blockWidth:50,align:center-->";
      const html = convertImagesWithMetaToHtml(md);
      expect(html).toContain('<img src="photo.png"');
      expect(html).toContain('alt="photo"');
      expect(html).toContain('data-block-width="50"');
      expect(html).toContain('data-align="center"');
      expect(html).not.toContain("![photo]");
    });

    it("preserves the title attribute when present", () => {
      const md = '![photo](photo.png "Caption") <!--blockWidth:75-->';
      const html = convertImagesWithMetaToHtml(md);
      expect(html).toContain('title="Caption"');
      expect(html).toContain('data-block-width="75"');
    });

    it("handles align-only metadata", () => {
      const md = "![photo](photo.png) <!--align:right-->";
      const html = convertImagesWithMetaToHtml(md);
      expect(html).toContain('data-align="right"');
      expect(html).not.toContain("data-block-width");
    });

    it("does not consume comments separated by blank lines", () => {
      const md = `![photo](photo.png)

<!--blockWidth:50-->`;
      // Blank line between image and comment → comment belongs to nothing.
      const html = convertImagesWithMetaToHtml(md);
      expect(html).toContain("![photo]"); // markdown left intact
      expect(html).not.toContain('data-block-width');
    });
  });
});
