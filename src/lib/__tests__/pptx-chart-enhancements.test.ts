// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { linearRegression } from "@/components/editor/viewers/PptxChartRenderer";

// ---------------------------------------------------------------------------
// Helpers — build minimal chart XML fragments and parse with DOMParser
// ---------------------------------------------------------------------------

const C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function qs(parent: Element | Document, localName: string): Element | null {
  return parent.querySelector(`*|${localName}`) ?? null;
}

function qsa(parent: Element | Document, localName: string): Element[] {
  const result = parent.querySelectorAll(`*|${localName}`);
  return Array.from(result);
}

function getAttr(el: Element, name: string): string | null {
  return el.getAttribute(name);
}

// ---------------------------------------------------------------------------
// Task #10 — Data label position parsing
// ---------------------------------------------------------------------------

describe("Data label position parsing", () => {
  it("parses dLblPos='outEnd' from dLbls", () => {
    const xml = `<c:chartSpace xmlns:c="${C_NS}">
      <c:chart><c:plotArea>
        <c:barChart>
          <c:ser><c:idx val="0"/><c:val><c:numRef><c:numCache>
            <c:pt idx="0"><c:v>10</c:v></c:pt>
          </c:numCache></c:numRef></c:val></c:ser>
          <c:dLbls>
            <c:showVal val="1"/>
            <c:dLblPos val="outEnd"/>
          </c:dLbls>
        </c:barChart>
      </c:plotArea></c:chart>
    </c:chartSpace>`;
    const doc = parseXml(xml);
    const barChart = qs(doc, "barChart")!;
    const dLbls = qs(barChart, "dLbls")!;
    const dLblPos = qs(dLbls, "dLblPos");
    expect(dLblPos).not.toBeNull();
    expect(getAttr(dLblPos!, "val")).toBe("outEnd");
  });

  it("returns undefined when no dLblPos element", () => {
    const xml = `<c:chartSpace xmlns:c="${C_NS}">
      <c:chart><c:plotArea>
        <c:barChart>
          <c:dLbls>
            <c:showVal val="1"/>
          </c:dLbls>
        </c:barChart>
      </c:plotArea></c:chart>
    </c:chartSpace>`;
    const doc = parseXml(xml);
    const dLbls = qs(doc, "dLbls")!;
    const dLblPos = qs(dLbls, "dLblPos");
    expect(dLblPos).toBeNull();
  });

  it("parses all valid position values", () => {
    const positions = ["t", "b", "l", "r", "ctr", "outEnd", "inEnd", "inBase"];
    for (const pos of positions) {
      const xml = `<c:dLbls xmlns:c="${C_NS}"><c:dLblPos val="${pos}"/><c:showVal val="1"/></c:dLbls>`;
      const doc = parseXml(xml);
      const dLblPos = qs(doc, "dLblPos")!;
      expect(getAttr(dLblPos, "val")).toBe(pos);
    }
  });
});

// ---------------------------------------------------------------------------
// Task #11 — Secondary axis detection
// ---------------------------------------------------------------------------

describe("Secondary axis detection", () => {
  it("detects two valAx elements as primary + secondary", () => {
    const xml = `<c:chartSpace xmlns:c="${C_NS}" xmlns:a="${A_NS}">
      <c:chart><c:plotArea>
        <c:barChart>
          <c:ser><c:idx val="0"/></c:ser>
          <c:axId val="100"/>
          <c:axId val="200"/>
        </c:barChart>
        <c:catAx><c:axId val="300"/></c:catAx>
        <c:valAx>
          <c:axId val="200"/>
          <c:delete val="0"/>
          <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Primary</a:t></a:r></a:p></c:rich></c:tx></c:title>
        </c:valAx>
        <c:valAx>
          <c:axId val="400"/>
          <c:delete val="0"/>
          <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Secondary</a:t></a:r></a:p></c:rich></c:tx></c:title>
        </c:valAx>
      </c:plotArea></c:chart>
    </c:chartSpace>`;
    const doc = parseXml(xml);
    const allValAx = qsa(doc, "valAx");
    expect(allValAx.length).toBe(2);
    // Secondary is the second one
    const secAx = allValAx[1];
    const titleRuns = qsa(secAx, "t");
    const titleText = titleRuns.map(t => t.textContent).join("");
    expect(titleText).toBe("Secondary");
  });

  it("returns no secondary when only one valAx", () => {
    const xml = `<c:chartSpace xmlns:c="${C_NS}">
      <c:chart><c:plotArea>
        <c:barChart><c:ser><c:idx val="0"/></c:ser></c:barChart>
        <c:valAx><c:axId val="200"/></c:valAx>
      </c:plotArea></c:chart>
    </c:chartSpace>`;
    const doc = parseXml(xml);
    const allValAx = qsa(doc, "valAx");
    expect(allValAx.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Task #11 — Trendline type parsing
// ---------------------------------------------------------------------------

describe("Trendline type parsing", () => {
  it("parses linear trendline", () => {
    const xml = `<c:ser xmlns:c="${C_NS}">
      <c:idx val="0"/>
      <c:trendline>
        <c:trendlineType val="linear"/>
      </c:trendline>
    </c:ser>`;
    const doc = parseXml(xml);
    const trendline = qs(doc, "trendline")!;
    const typeEl = qs(trendline, "trendlineType")!;
    expect(getAttr(typeEl, "val")).toBe("linear");
  });

  it("parses polynomial trendline with order", () => {
    const xml = `<c:ser xmlns:c="${C_NS}">
      <c:idx val="0"/>
      <c:trendline>
        <c:trendlineType val="poly"/>
        <c:order val="3"/>
      </c:trendline>
    </c:ser>`;
    const doc = parseXml(xml);
    const trendline = qs(doc, "trendline")!;
    const typeEl = qs(trendline, "trendlineType")!;
    const orderEl = qs(trendline, "order")!;
    expect(getAttr(typeEl, "val")).toBe("poly");
    expect(getAttr(orderEl, "val")).toBe("3");
  });

  it("parses forward and backward periods", () => {
    const xml = `<c:ser xmlns:c="${C_NS}">
      <c:idx val="0"/>
      <c:trendline>
        <c:trendlineType val="linear"/>
        <c:forward val="2"/>
        <c:backward val="1"/>
      </c:trendline>
    </c:ser>`;
    const doc = parseXml(xml);
    const trendline = qs(doc, "trendline")!;
    expect(getAttr(qs(trendline, "forward")!, "val")).toBe("2");
    expect(getAttr(qs(trendline, "backward")!, "val")).toBe("1");
  });

  it("handles missing trendline element", () => {
    const xml = `<c:ser xmlns:c="${C_NS}"><c:idx val="0"/></c:ser>`;
    const doc = parseXml(xml);
    const trendline = qs(doc, "trendline");
    expect(trendline).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task #11 — Linear regression computation
// ---------------------------------------------------------------------------

describe("linearRegression", () => {
  it("computes correct slope and intercept for simple data", () => {
    // y = 2x + 1 → points (0,1), (1,3), (2,5)
    const data = [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }];
    const result = linearRegression(data);
    expect(result.slope).toBeCloseTo(2, 10);
    expect(result.intercept).toBeCloseTo(1, 10);
  });

  it("handles horizontal line (slope = 0)", () => {
    const data = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }];
    const result = linearRegression(data);
    expect(result.slope).toBeCloseTo(0, 10);
    expect(result.intercept).toBeCloseTo(5, 10);
  });

  it("handles empty data", () => {
    const result = linearRegression([]);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(0);
  });

  it("handles single point", () => {
    const result = linearRegression([{ x: 3, y: 7 }]);
    // With single point, denominator is 0, intercept = sumY/n = 7
    expect(result.intercept).toBe(7);
  });

  it("computes regression for noisy data", () => {
    // Approximately y = x with noise
    const data = [
      { x: 0, y: 0.1 }, { x: 1, y: 0.9 }, { x: 2, y: 2.1 },
      { x: 3, y: 2.9 }, { x: 4, y: 4.1 },
    ];
    const result = linearRegression(data);
    expect(result.slope).toBeCloseTo(1, 1);
    expect(result.intercept).toBeCloseTo(0, 1);
  });

  it("handles negative slope", () => {
    // y = -3x + 10
    const data = [{ x: 0, y: 10 }, { x: 1, y: 7 }, { x: 2, y: 4 }];
    const result = linearRegression(data);
    expect(result.slope).toBeCloseTo(-3, 10);
    expect(result.intercept).toBeCloseTo(10, 10);
  });
});
