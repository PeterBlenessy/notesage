// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseBodyProperties } from "../pptx-parser";

// ---------------------------------------------------------------------------
// Helper: create a txBody XML element
// ---------------------------------------------------------------------------

function createTxBody(bodyPrContent: string): Element {
  const xml = `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <a:txBody>
      <a:bodyPr${bodyPrContent ? " " : ""}${bodyPrContent}/>
      <a:p><a:r><a:t>text</a:t></a:r></a:p>
    </a:txBody>
  </root>`;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/drawingml/2006/main",
    "txBody",
  )[0];
}

function createTxBodyWithChildren(bodyPrAttrs: string, bodyPrChildren: string): Element {
  const xml = `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <a:txBody>
      <a:bodyPr${bodyPrAttrs ? " " : ""}${bodyPrAttrs}>${bodyPrChildren}</a:bodyPr>
      <a:p><a:r><a:t>text</a:t></a:r></a:p>
    </a:txBody>
  </root>`;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/drawingml/2006/main",
    "txBody",
  )[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseBodyProperties — autoFit", () => {
  it("returns autoFit: true when <a:spAutoFit/> is present", () => {
    const txBody = createTxBodyWithChildren("", "<a:spAutoFit/>");
    const result = parseBodyProperties(txBody);
    expect(result?.autoFit).toBe(true);
  });

  it("returns autoFit: false when <a:spAutoFit/> is absent", () => {
    const txBody = createTxBody("");
    const result = parseBodyProperties(txBody);
    expect(result?.autoFit).toBe(false);
  });

  it("returns autoFit: false when <a:noAutofit/> is present", () => {
    const txBody = createTxBodyWithChildren("", "<a:noAutofit/>");
    const result = parseBodyProperties(txBody);
    expect(result?.autoFit).toBe(false);
  });

  it("handles spAutoFit with normAutofit (fontScale takes priority for scaling)", () => {
    const txBody = createTxBodyWithChildren("", '<a:spAutoFit/><a:normAutofit fontScale="75000"/>');
    const result = parseBodyProperties(txBody);
    // spAutoFit is present, so autoFit is true
    expect(result?.autoFit).toBe(true);
    // normAutofit fontScale is also applied
    expect(result?.fontScale).toBeCloseTo(0.75);
  });
});

describe("parseBodyProperties — fontScale", () => {
  it("defaults fontScale to 1 when no normAutofit", () => {
    const txBody = createTxBody("");
    const result = parseBodyProperties(txBody);
    expect(result?.fontScale).toBe(1);
  });

  it("parses fontScale from normAutofit", () => {
    const txBody = createTxBodyWithChildren("", '<a:normAutofit fontScale="75000"/>');
    const result = parseBodyProperties(txBody);
    expect(result?.fontScale).toBeCloseTo(0.75);
  });

  it("parses fontScale 50%", () => {
    const txBody = createTxBodyWithChildren("", '<a:normAutofit fontScale="50000"/>');
    const result = parseBodyProperties(txBody);
    expect(result?.fontScale).toBeCloseTo(0.5);
  });

  it("defaults to 100% when normAutofit has no fontScale attr", () => {
    const txBody = createTxBodyWithChildren("", "<a:normAutofit/>");
    const result = parseBodyProperties(txBody);
    expect(result?.fontScale).toBe(1);
  });
});

describe("parseBodyProperties — wrap and anchor", () => {
  it('defaults wrap to true', () => {
    const txBody = createTxBody("");
    const result = parseBodyProperties(txBody);
    expect(result?.wrap).toBe(true);
  });

  it('sets wrap to false when wrap="none"', () => {
    const txBody = createTxBody('wrap="none"');
    const result = parseBodyProperties(txBody);
    expect(result?.wrap).toBe(false);
  });

  it('defaults anchor to "top"', () => {
    const txBody = createTxBody("");
    const result = parseBodyProperties(txBody);
    expect(result?.anchor).toBe("top");
  });

  it('parses anchor="ctr" as "center"', () => {
    const txBody = createTxBody('anchor="ctr"');
    const result = parseBodyProperties(txBody);
    expect(result?.anchor).toBe("center");
  });

  it('parses anchor="b" as "bottom"', () => {
    const txBody = createTxBody('anchor="b"');
    const result = parseBodyProperties(txBody);
    expect(result?.anchor).toBe("bottom");
  });
});

describe("parseBodyProperties — missing bodyPr", () => {
  it("returns undefined when txBody has no bodyPr", () => {
    const xml = `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:txBody>
        <a:p><a:r><a:t>text</a:t></a:r></a:p>
      </a:txBody>
    </root>`;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const txBody = doc.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/drawingml/2006/main",
      "txBody",
    )[0];
    const result = parseBodyProperties(txBody);
    expect(result).toBeUndefined();
  });
});
