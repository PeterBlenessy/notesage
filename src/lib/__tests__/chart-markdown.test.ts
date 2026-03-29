/**
 * Tests for the convertChartsToHtml markdown preprocessor function.
 * Pure function — no Tauri mocking needed.
 */
import { describe, it, expect } from "vitest";
import { convertChartsToHtml } from "@/lib/markdown";

describe("convertChartsToHtml", () => {
  it("converts chart JSON image to HTML div", () => {
    const input = "![chart](/.notesage/charts/abc123.json)";
    const result = convertChartsToHtml(input);
    expect(result).toContain('data-chart-id="abc123"');
    expect(result).toContain('data-type="chart"');
    expect(result).toContain('class="chart-block"');
  });

  it("extracts chart ID from path", () => {
    const input = "![chart](/.notesage/charts/my-chart-id.json)";
    const result = convertChartsToHtml(input);
    expect(result).toContain('data-chart-id="my-chart-id"');
  });

  it("does not affect regular images", () => {
    const input = "![photo](images/photo.png)";
    const result = convertChartsToHtml(input);
    expect(result).toBe(input);
  });

  it("does not affect non-chart JSON files", () => {
    const input = "![data](config/settings.json)";
    const result = convertChartsToHtml(input);
    expect(result).toBe(input);
  });

  it("does not affect drawing references", () => {
    const input = "![drawing](/.notesage/drawings/abc123.excalidraw)";
    const result = convertChartsToHtml(input);
    expect(result).toBe(input);
  });

  it("handles multiple charts in same document", () => {
    const input = [
      "![chart](/.notesage/charts/chart1.json)",
      "",
      "Some text",
      "",
      "![chart](/.notesage/charts/chart2.json)",
    ].join("\n");
    const result = convertChartsToHtml(input);
    expect(result).toContain('data-chart-id="chart1"');
    expect(result).toContain('data-chart-id="chart2"');
  });

  it("handles mixed images and charts", () => {
    const input = [
      "![photo](vacation.jpg)",
      "",
      "![chart](/.notesage/charts/data.json)",
    ].join("\n");
    const result = convertChartsToHtml(input);
    expect(result).toContain("![photo](vacation.jpg)");
    expect(result).toContain('data-chart-id="data"');
  });

  it("preserves surrounding content", () => {
    const input = [
      "# Title",
      "",
      "![chart](/.notesage/charts/abc.json)",
      "",
      "Paragraph after.",
    ].join("\n");
    const result = convertChartsToHtml(input);
    expect(result).toContain("# Title");
    expect(result).toContain("Paragraph after.");
    expect(result).toContain('data-chart-id="abc"');
  });

  it("handles chart with empty alt text", () => {
    const input = "![](/.notesage/charts/no-alt.json)";
    const result = convertChartsToHtml(input);
    expect(result).toContain('data-chart-id="no-alt"');
  });

  it("outputs correct full HTML div", () => {
    const input = "![chart](/.notesage/charts/test-id.json)";
    const result = convertChartsToHtml(input);
    expect(result).toBe(
      '<div data-chart-id="test-id" data-type="chart" class="chart-block"></div>'
    );
  });

  it("only matches .notesage/charts/ path", () => {
    const input = "![data](other/charts/file.json)";
    const result = convertChartsToHtml(input);
    expect(result).toBe(input);
  });

  it("does not match .json files outside charts directory", () => {
    const input = "![config](/.notesage/config.json)";
    const result = convertChartsToHtml(input);
    expect(result).toBe(input);
  });
});
