/**
 * Tests for typography-presets: type definitions, default presets,
 * preset bundles, merge logic, and legacy migration.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_PRESETS,
  ACADEMIC_PRESETS,
  REPORT_PRESETS,
  PRESET_BUNDLES,
  BLOCK_TYPES,
  FULL_BLOCK_TYPES,
  mergePresets,
  migrateFromLegacy,
  presetsForBackend,
  TYPOGRAPHY_VERSION,
  type BlockTypeStyle,
  type TypographyPresets,
} from "../typography-presets";

describe("DEFAULT_PRESETS", () => {
  it("has all block types", () => {
    for (const key of BLOCK_TYPES) {
      expect(DEFAULT_PRESETS[key]).toBeDefined();
    }
  });

  it("paragraph uses system font at 16px", () => {
    expect(DEFAULT_PRESETS.paragraph.fontFamily).toBe("system");
    expect(DEFAULT_PRESETS.paragraph.fontSize).toBe(16);
    expect(DEFAULT_PRESETS.paragraph.fontWeight).toBe(400);
    expect(DEFAULT_PRESETS.paragraph.lineHeight).toBe(1.7);
  });

  it("headings have descending font sizes", () => {
    const sizes = FULL_BLOCK_TYPES
      .filter((t) => t.startsWith("heading"))
      .map((t) => DEFAULT_PRESETS[t].fontSize);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
    }
  });

  it("codeBlock uses monospace font", () => {
    expect(DEFAULT_PRESETS.codeBlock.fontFamily).toBe("jetbrains-mono");
    expect(DEFAULT_PRESETS.codeBlock.fontSize).toBe(14);
  });

  it("blockquote has fontFamily, fontSize, fontWeight", () => {
    expect(DEFAULT_PRESETS.blockquote.fontFamily).toBe("system");
    expect(DEFAULT_PRESETS.blockquote.fontSize).toBe(16);
    expect(DEFAULT_PRESETS.blockquote.fontWeight).toBe(400);
  });
});

describe("ACADEMIC_PRESETS", () => {
  it("uses Source Serif for paragraph and headings", () => {
    expect(ACADEMIC_PRESETS.paragraph.fontFamily).toBe("source-serif");
    expect(ACADEMIC_PRESETS.heading1.fontFamily).toBe("source-serif");
    expect(ACADEMIC_PRESETS.heading3.fontFamily).toBe("source-serif");
  });

  it("keeps monospace for code blocks", () => {
    expect(ACADEMIC_PRESETS.codeBlock.fontFamily).toBe("jetbrains-mono");
  });
});

describe("REPORT_PRESETS", () => {
  it("uses Inter for paragraph and headings", () => {
    expect(REPORT_PRESETS.paragraph.fontFamily).toBe("inter");
    expect(REPORT_PRESETS.heading1.fontFamily).toBe("inter");
  });
});

describe("PRESET_BUNDLES", () => {
  it("has three bundles", () => {
    expect(Object.keys(PRESET_BUNDLES)).toEqual(["default", "academic", "report"]);
  });

  it("default bundle matches DEFAULT_PRESETS", () => {
    expect(PRESET_BUNDLES.default).toEqual(DEFAULT_PRESETS);
  });
});

describe("TYPOGRAPHY_VERSION", () => {
  it("is 1", () => {
    expect(TYPOGRAPHY_VERSION).toBe(1);
  });
});

describe("mergePresets", () => {
  it("returns clone of base when partial is undefined", () => {
    const result = mergePresets(undefined);
    expect(result).toEqual(DEFAULT_PRESETS);
    expect(result).not.toBe(DEFAULT_PRESETS);
  });

  it("returns clone of base when partial is empty", () => {
    const result = mergePresets({});
    expect(result).toEqual(DEFAULT_PRESETS);
  });

  it("overrides specific block type fields", () => {
    const result = mergePresets({
      paragraph: { fontSize: 20 },
    });
    expect(result.paragraph.fontSize).toBe(20);
    expect(result.paragraph.fontFamily).toBe("system"); // kept from base
    expect(result.heading1).toEqual(DEFAULT_PRESETS.heading1); // untouched
  });

  it("overrides multiple block types", () => {
    const result = mergePresets({
      heading1: { fontFamily: "georgia", fontSize: 36 },
      codeBlock: { fontSize: 16 },
    });
    expect(result.heading1.fontFamily).toBe("georgia");
    expect(result.heading1.fontSize).toBe(36);
    expect(result.heading1.fontWeight).toBe(DEFAULT_PRESETS.heading1.fontWeight);
    expect(result.codeBlock.fontSize).toBe(16);
  });

  it("uses custom base when provided", () => {
    const result = mergePresets({ paragraph: { fontSize: 18 } }, ACADEMIC_PRESETS);
    expect(result.paragraph.fontFamily).toBe("source-serif"); // from academic base
    expect(result.paragraph.fontSize).toBe(18); // overridden
    expect(result.heading1).toEqual(ACADEMIC_PRESETS.heading1);
  });

  it("ignores unknown keys", () => {
    const result = mergePresets({ bogus: { fontSize: 99 } } as unknown as Record<string, Partial<BlockTypeStyle>>);
    expect(result).toEqual(DEFAULT_PRESETS);
  });
});

describe("migrateFromLegacy", () => {
  it("maps fontFamily to all block types", () => {
    const presets = migrateFromLegacy({ fontFamily: "georgia" });
    expect(presets.paragraph.fontFamily).toBe("georgia");
    expect(presets.heading1.fontFamily).toBe("georgia");
    expect(presets.heading6.fontFamily).toBe("georgia");
    expect(presets.blockquote.fontFamily).toBe("georgia");
    // Code block keeps its own default
    expect(presets.codeBlock.fontFamily).toBe("jetbrains-mono");
  });

  it("maps fontSize to paragraph and scales headings proportionally", () => {
    const presets = migrateFromLegacy({ fontSize: 20 });
    expect(presets.paragraph.fontSize).toBe(20);
    expect(presets.heading1.fontSize).toBe(40);   // 2.0x
    expect(presets.heading2.fontSize).toBe(30);   // 1.5x
    expect(presets.heading3.fontSize).toBe(25);   // 1.25x
    expect(presets.heading4.fontSize).toBe(23);   // 1.125x (rounded)
    expect(presets.heading5.fontSize).toBe(20);   // 1.0x
    expect(presets.heading6.fontSize).toBe(18);   // 0.875x (rounded)
  });

  it("maps lineHeight to paragraph", () => {
    const presets = migrateFromLegacy({ lineHeight: 2.0 });
    expect(presets.paragraph.lineHeight).toBe(2.0);
    // Headings keep their own defaults
    expect(presets.heading1.lineHeight).toBe(DEFAULT_PRESETS.heading1.lineHeight);
  });

  it("maps paragraphSpacing to paragraph spacingAfter", () => {
    const presets = migrateFromLegacy({ paragraphSpacing: 1.2 });
    expect(presets.paragraph.spacingAfter).toBe(1.2);
  });

  it("uses defaults for missing fields", () => {
    const presets = migrateFromLegacy({});
    expect(presets.paragraph.fontFamily).toBe("system");
    expect(presets.paragraph.fontSize).toBe(16);
  });

  it("handles system font family names", () => {
    const presets = migrateFromLegacy({ fontFamily: "Fira Sans" });
    expect(presets.paragraph.fontFamily).toBe("Fira Sans");
    expect(presets.heading1.fontFamily).toBe("Fira Sans");
  });
});

describe("presetsForBackend", () => {
  it("maps spacingAfter to paragraphSpacing", () => {
    const result = presetsForBackend(DEFAULT_PRESETS);
    expect(result.paragraph.paragraphSpacing).toBe(DEFAULT_PRESETS.paragraph.spacingAfter);
  });

  it("extracts codeBlock fontFamily to codeFontFamily", () => {
    const result = presetsForBackend(DEFAULT_PRESETS);
    expect(result.codeFontFamily).toBe(DEFAULT_PRESETS.codeBlock.fontFamily);
  });

  it("preserves all heading levels with correct font sizes", () => {
    const result = presetsForBackend(DEFAULT_PRESETS);
    expect(result.heading1.fontSize).toBe(32);
    expect(result.heading2.fontSize).toBe(24);
    expect(result.heading3.fontSize).toBe(20);
    expect(result.heading4.fontSize).toBe(18);
    expect(result.heading5.fontSize).toBe(16);
    expect(result.heading6.fontSize).toBe(14);
  });

  it("preserves font family and weight for each block type", () => {
    const result = presetsForBackend(DEFAULT_PRESETS);
    expect(result.paragraph.fontFamily).toBe("system");
    expect(result.paragraph.fontWeight).toBe(400);
    expect(result.heading1.fontFamily).toBe("system");
    expect(result.heading1.fontWeight).toBe(700);
  });

  it("preserves lineHeight for each block type", () => {
    const result = presetsForBackend(DEFAULT_PRESETS);
    expect(result.paragraph.lineHeight).toBe(1.7);
    expect(result.heading1.lineHeight).toBe(1.3);
  });

  it("works with academic presets", () => {
    const result = presetsForBackend(ACADEMIC_PRESETS);
    expect(result.paragraph.fontFamily).toBe("source-serif");
    expect(result.heading1.fontFamily).toBe("source-serif");
    expect(result.codeFontFamily).toBe("jetbrains-mono");
    expect(result.paragraph.paragraphSpacing).toBe(ACADEMIC_PRESETS.paragraph.spacingAfter);
  });

  it("works with report presets", () => {
    const result = presetsForBackend(REPORT_PRESETS);
    expect(result.paragraph.fontFamily).toBe("inter");
    expect(result.paragraph.fontSize).toBe(15);
  });

  it("maps spacingAfter from each heading to paragraphSpacing", () => {
    const result = presetsForBackend(DEFAULT_PRESETS);
    expect(result.heading1.paragraphSpacing).toBe(DEFAULT_PRESETS.heading1.spacingAfter);
    expect(result.heading2.paragraphSpacing).toBe(DEFAULT_PRESETS.heading2.spacingAfter);
    expect(result.heading3.paragraphSpacing).toBe(DEFAULT_PRESETS.heading3.spacingAfter);
  });

  it("result has exactly the expected keys", () => {
    const result = presetsForBackend(DEFAULT_PRESETS);
    const keys = Object.keys(result).sort();
    expect(keys).toEqual([
      "codeFontFamily",
      "heading1",
      "heading2",
      "heading3",
      "heading4",
      "heading5",
      "heading6",
      "paragraph",
    ]);
  });

  it("each text style has exactly the expected keys", () => {
    const result = presetsForBackend(DEFAULT_PRESETS);
    const styleKeys = Object.keys(result.paragraph).sort();
    expect(styleKeys).toEqual([
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "paragraphSpacing",
    ]);
  });

  it("round-trip: custom presets transform correctly", () => {
    const custom: TypographyPresets = {
      ...DEFAULT_PRESETS,
      paragraph: { ...DEFAULT_PRESETS.paragraph, fontFamily: "Georgia", fontSize: 18, spacingAfter: 1.2 },
      heading1: { ...DEFAULT_PRESETS.heading1, fontFamily: "Georgia", fontSize: 36 },
      codeBlock: { fontFamily: "Fira Code", fontSize: 15 },
    };
    const result = presetsForBackend(custom);
    expect(result.paragraph.fontFamily).toBe("Georgia");
    expect(result.paragraph.fontSize).toBe(18);
    expect(result.paragraph.paragraphSpacing).toBe(1.2);
    expect(result.heading1.fontSize).toBe(36);
    expect(result.codeFontFamily).toBe("Fira Code");
  });
});
