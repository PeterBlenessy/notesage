// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parsePptx } from "./pptx-parser";

function loadFixture(): Uint8Array {
  const buf = readFileSync(join(__dirname, "../../tests/fixtures/test-presentation.pptx"));
  return new Uint8Array(buf);
}

describe("parsePptx", () => {
  it("parses slide count and dimensions", async () => {
    const pres = await parsePptx(loadFixture());
    expect(pres.slides).toHaveLength(3);
    expect(pres.slideWidth).toBe(12192000);
    expect(pres.slideHeight).toBe(6858000);
  });

  it("parses theme colors and fonts", async () => {
    const pres = await parsePptx(loadFixture());
    expect(pres.theme.colors.dk1).toBe("#1A1A1A");
    expect(pres.theme.colors.lt1).toBe("#FFFFFF");
    expect(pres.theme.colors.accent1).toBe("#4472C4");
    expect(pres.theme.fonts.heading).toBe("Arial");
    expect(pres.theme.fonts.body).toBe("Calibri");
  });

  it("parses text run properties (bold, italic, underline, fontSize, color)", async () => {
    const pres = await parsePptx(loadFixture());
    const slide1 = pres.slides[0];

    // Title text box
    const titleEl = slide1.elements[0];
    expect(titleEl.type).toBe("textbox");
    if (titleEl.type !== "textbox") throw new Error("Expected textbox");
    expect(titleEl.paragraphs).toHaveLength(1);
    expect(titleEl.paragraphs[0].alignment).toBe("center");

    const titleRun = titleEl.paragraphs[0].runs[0];
    expect(titleRun.text).toBe("Test Presentation Title");
    expect(titleRun.bold).toBe(true);
    expect(titleRun.fontSize).toBe(44);
    expect(titleRun.color).toBe("#FFFFFF");
    expect(titleRun.fontFamily).toBe("Arial");

    // Bullet text box
    const bulletEl = slide1.elements[1];
    expect(bulletEl.type).toBe("textbox");
    if (bulletEl.type !== "textbox") throw new Error("Expected textbox");
    expect(bulletEl.paragraphs).toHaveLength(2);

    // First bullet: italic
    expect(bulletEl.paragraphs[0].bulletChar).toBe("•");
    expect(bulletEl.paragraphs[0].runs[0].italic).toBe(true);
    expect(bulletEl.paragraphs[0].runs[0].text).toBe("Bullet item one");

    // Second bullet: underline
    expect(bulletEl.paragraphs[1].runs[0].underline).toBe(true);
    expect(bulletEl.paragraphs[1].runs[0].text).toBe("Bullet item two");
  });

  it("parses gradient background", async () => {
    const pres = await parsePptx(loadFixture());
    const bg = pres.slides[0].background;
    expect(bg).not.toBeNull();
    expect(bg!.fill).not.toBeNull();
    expect(bg!.fill!.type).toBe("linear");
    if (bg!.fill!.type !== "linear") throw new Error("Expected linear");
    expect(bg!.fill!.angle).toBe(90); // 5400000 / 60000 = 90
    expect(bg!.fill!.stops).toHaveLength(3);
    expect(bg!.fill!.stops[0].color).toBe("#1a2b5c");
    expect(bg!.fill!.stops[1].position).toBe(50);
  });

  it("parses images as base64 data URLs", async () => {
    const pres = await parsePptx(loadFixture());
    const slide2 = pres.slides[1];
    const imgEl = slide2.elements.find((e) => e.type === "image");
    expect(imgEl).toBeDefined();
    if (imgEl?.type !== "image") throw new Error("Expected image");
    expect(imgEl.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(imgEl.x).toBe(914400);
    expect(imgEl.y).toBe(914400);
  });

  it("parses tables with merged cells", async () => {
    const pres = await parsePptx(loadFixture());
    const slide2 = pres.slides[1];
    const tableEl = slide2.elements.find((e) => e.type === "table");
    expect(tableEl).toBeDefined();
    if (tableEl?.type !== "table") throw new Error("Expected table");

    expect(tableEl.rows).toHaveLength(2);
    // Header row: 2 cells
    expect(tableEl.rows[0].cells).toHaveLength(2);
    expect(tableEl.rows[0].cells[0].paragraphs[0].runs[0].text).toBe("Header A");
    expect(tableEl.rows[0].cells[0].fill).toBe("#4472C4");

    // Merged row
    const mergedRow = tableEl.rows[1];
    expect(mergedRow.cells[0].colspan).toBe(2);
    expect(mergedRow.cells[0].paragraphs[0].runs[0].text).toBe("Merged cell");
  });

  it("parses speaker notes", async () => {
    const pres = await parsePptx(loadFixture());
    // Slide 1 has no notes
    expect(pres.slides[0].notes).toBe("");
    // Slide 2 has notes
    expect(pres.slides[1].notes).toContain("These are speaker notes for slide 2");
    expect(pres.slides[1].notes).toContain("Second line of notes");
  });

  it("parses chart type, series, and categories", async () => {
    const pres = await parsePptx(loadFixture());
    const slide3 = pres.slides[2];
    const chartEl = slide3.elements.find((e) => e.type === "chart");
    expect(chartEl).toBeDefined();
    if (chartEl?.type !== "chart") throw new Error("Expected chart");

    expect(chartEl.chartType).toBe("bar");
    expect(chartEl.series).toHaveLength(2);
    expect(chartEl.series[0].name).toBe("Sales");
    expect(chartEl.series[0].values).toEqual([100, 200, 150]);
    expect(chartEl.series[1].name).toBe("Profit");
    expect(chartEl.series[1].values).toEqual([50, 80, 60]);
    expect(chartEl.categories).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("extracts searchText per slide", async () => {
    const pres = await parsePptx(loadFixture());
    expect(pres.slides[0].searchText).toContain("Test Presentation Title");
    expect(pres.slides[0].searchText).toContain("Bullet item one");
    expect(pres.slides[1].searchText).toContain("Header A");
    expect(pres.slides[1].searchText).toContain("speaker notes");
  });

  it("throws on corrupted/invalid ZIP", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(parsePptx(garbage)).rejects.toThrow("Invalid or corrupted PPTX");
  });

  it("throws when ppt/presentation.xml is missing", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("dummy.txt", "hello");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(parsePptx(bytes)).rejects.toThrow("missing ppt/presentation.xml");
  });

  it("handles PPTX with 0 slides", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0"?>
       <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
         <p:sldSz cx="9144000" cy="6858000"/>
         <p:sldIdLst/>
       </p:presentation>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const pres = await parsePptx(bytes);
    expect(pres.slides).toHaveLength(0);
    expect(pres.slideWidth).toBe(9144000);
  });
});
