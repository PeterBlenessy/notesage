/**
 * Tests for chart data types, color palettes, and chart type metadata.
 */
import { describe, it, expect } from "vitest";
import {
  CHART_TYPES,
  COLOR_PALETTES,
  COLOR_SCHEME_OPTIONS,
  DEFAULT_CHART_CONFIG,
  DEFAULT_CHART_DATA,
  createEmptyChartData,
  getChartTypeMeta,
  type ChartType,
  type ColorScheme,
} from "@/lib/chart-types";

describe("CHART_TYPES", () => {
  it("defines six chart types", () => {
    expect(CHART_TYPES).toHaveLength(6);
  });

  it("covers all expected types", () => {
    const types = CHART_TYPES.map((t) => t.type);
    expect(types).toContain("bar");
    expect(types).toContain("line");
    expect(types).toContain("area");
    expect(types).toContain("pie");
    expect(types).toContain("donut");
    expect(types).toContain("horizontal_bar");
  });

  it("each type has required fields", () => {
    for (const meta of CHART_TYPES) {
      expect(meta.name).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(meta.icon).toBeDefined();
      expect(["cartesian", "radial"]).toContain(meta.dataShape);
    }
  });

  it("pie and donut are radial, others are cartesian", () => {
    for (const meta of CHART_TYPES) {
      if (meta.type === "pie" || meta.type === "donut") {
        expect(meta.dataShape).toBe("radial");
      } else {
        expect(meta.dataShape).toBe("cartesian");
      }
    }
  });
});

describe("getChartTypeMeta", () => {
  it("returns correct metadata for each type", () => {
    const meta = getChartTypeMeta("bar");
    expect(meta.type).toBe("bar");
    expect(meta.name).toBe("Bar");
  });

  it("returns first type as fallback for unknown type", () => {
    const meta = getChartTypeMeta("unknown" as ChartType);
    expect(meta.type).toBe(CHART_TYPES[0].type);
  });
});

describe("COLOR_PALETTES", () => {
  const schemes: ColorScheme[] = ["neutral", "monochrome", "warm", "cool"];

  it("defines all four palettes", () => {
    for (const scheme of schemes) {
      expect(COLOR_PALETTES[scheme]).toBeDefined();
    }
  });

  it("each palette has 5 colors for both light and dark", () => {
    for (const scheme of schemes) {
      const palette = COLOR_PALETTES[scheme];
      expect(palette.light).toHaveLength(5);
      expect(palette.dark).toHaveLength(5);
    }
  });

  it("each palette has a label", () => {
    for (const scheme of schemes) {
      expect(COLOR_PALETTES[scheme].label).toBeTruthy();
    }
  });

  it("monochrome palette has zero chroma", () => {
    const mono = COLOR_PALETTES.monochrome;
    for (const color of [...mono.light, ...mono.dark]) {
      expect(color).toMatch(/oklch\(\d+% 0 0\)/);
    }
  });
});

describe("COLOR_SCHEME_OPTIONS", () => {
  it("has four options matching palette keys", () => {
    expect(COLOR_SCHEME_OPTIONS).toHaveLength(4);
    const values = COLOR_SCHEME_OPTIONS.map((o) => o.value);
    expect(values).toContain("neutral");
    expect(values).toContain("monochrome");
    expect(values).toContain("warm");
    expect(values).toContain("cool");
  });
});

describe("DEFAULT_CHART_CONFIG", () => {
  it("has expected defaults", () => {
    expect(DEFAULT_CHART_CONFIG.showGrid).toBe(true);
    expect(DEFAULT_CHART_CONFIG.showLegend).toBe(false);
    expect(DEFAULT_CHART_CONFIG.colorScheme).toBe("neutral");
    expect(DEFAULT_CHART_CONFIG.xLabel).toBe("");
    expect(DEFAULT_CHART_CONFIG.yLabel).toBe("");
  });
});

describe("DEFAULT_CHART_DATA", () => {
  it("has four sample data points", () => {
    expect(DEFAULT_CHART_DATA).toHaveLength(4);
  });

  it("each point has category and value", () => {
    for (const point of DEFAULT_CHART_DATA) {
      expect(point.category).toBeTruthy();
      expect(typeof point.value).toBe("number");
    }
  });
});

describe("createEmptyChartData", () => {
  it("creates a chart with default type bar", () => {
    const data = createEmptyChartData();
    expect(data.type).toBe("bar");
    expect(data.title).toBe("");
    expect(data.data).toHaveLength(4);
    expect(data.config.colorScheme).toBe("neutral");
  });

  it("creates a chart with specified type", () => {
    const data = createEmptyChartData("pie");
    expect(data.type).toBe("pie");
  });

  it("returns a new object each time (no shared references)", () => {
    const a = createEmptyChartData();
    const b = createEmptyChartData();
    expect(a).not.toBe(b);
    expect(a.data).not.toBe(b.data);
    expect(a.config).not.toBe(b.config);

    a.data[0].category = "changed";
    expect(b.data[0].category).not.toBe("changed");
  });
});
