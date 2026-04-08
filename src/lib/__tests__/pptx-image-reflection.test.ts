// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseReflection } from "../pptx-parser";

const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PRES_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";

function makeSpPrWithReflection(attrs: string): Element {
  const xml = `<p:spPr xmlns:p="${PRES_NS}" xmlns:a="${DRAWING_NS}">
    <a:effectLst>
      <a:reflection ${attrs}/>
    </a:effectLst>
  </p:spPr>`;
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

function makeSpPrWithoutReflection(): Element {
  const xml = `<p:spPr xmlns:p="${PRES_NS}" xmlns:a="${DRAWING_NS}">
    <a:effectLst/>
  </p:spPr>`;
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

function makeSpPrNoEffectLst(): Element {
  const xml = `<p:spPr xmlns:p="${PRES_NS}" xmlns:a="${DRAWING_NS}"/>`;
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

describe("Image reflection parsing (VP19)", () => {
  it("parses all reflection attributes correctly", () => {
    const spPr = makeSpPrWithReflection(
      'blurRad="63500" stA="50000" endA="10000" dist="25400" dir="5400000" sy="-50000"'
    );
    const refl = parseReflection(spPr);
    expect(refl).toBeDefined();
    expect(refl!.blurRadius).toBe(5);          // 63500 / 12700
    expect(refl!.startOpacity).toBe(0.5);      // 50000 / 100000
    expect(refl!.endOpacity).toBe(0.1);        // 10000 / 100000
    expect(refl!.distance).toBe(2);            // 25400 / 12700
    expect(refl!.direction).toBe(90);          // 5400000 / 60000
    expect(refl!.size).toBe(50);               // abs(-50000) / 1000
  });

  it("uses default values when attributes are missing", () => {
    const spPr = makeSpPrWithReflection("");
    const refl = parseReflection(spPr);
    expect(refl).toBeDefined();
    expect(refl!.blurRadius).toBe(0);          // default blurRad=0
    expect(refl!.startOpacity).toBe(1);        // default stA=100000 → 1.0
    expect(refl!.endOpacity).toBe(0);          // default endA=0 → 0.0
    expect(refl!.distance).toBe(0);            // default dist=0
    expect(refl!.direction).toBe(90);          // default dir=5400000 → 90
    expect(refl!.size).toBe(100);              // default sy=-100000 → 100
  });

  it("returns undefined when no effectLst exists", () => {
    const spPr = makeSpPrNoEffectLst();
    expect(parseReflection(spPr)).toBeUndefined();
  });

  it("returns undefined when effectLst has no reflection", () => {
    const spPr = makeSpPrWithoutReflection();
    expect(parseReflection(spPr)).toBeUndefined();
  });

  it("handles positive sy (unusual but valid)", () => {
    const spPr = makeSpPrWithReflection('sy="75000"');
    const refl = parseReflection(spPr);
    expect(refl).toBeDefined();
    expect(refl!.size).toBe(75);               // abs(75000) / 1000
  });

  it("parses zero blur radius correctly", () => {
    const spPr = makeSpPrWithReflection('blurRad="0"');
    const refl = parseReflection(spPr);
    expect(refl).toBeDefined();
    expect(refl!.blurRadius).toBe(0);
  });

  it("parses large blur radius", () => {
    const spPr = makeSpPrWithReflection('blurRad="127000"');
    const refl = parseReflection(spPr);
    expect(refl).toBeDefined();
    expect(refl!.blurRadius).toBe(10);         // 127000 / 12700
  });
});
