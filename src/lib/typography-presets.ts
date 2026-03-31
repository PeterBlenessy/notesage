/**
 * Per-block-type typography presets.
 *
 * Defines the data model for configurable typography per block type
 * (Paragraph, H1-H6, Code Block, Blockquote). Includes default presets,
 * preset bundles (Default, Academic, Report), and merge logic.
 */

import type { EditorFontFamily } from "@/stores/editor-styles-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlockTypeStyle {
  fontFamily: EditorFontFamily;
  fontSize: number;       // px
  fontWeight: number;     // 400, 500, 600, 700
  lineHeight: number;     // multiplier
  spacingBefore: number;  // em
  spacingAfter: number;   // em
  color?: string;         // CSS color or undefined for default foreground
}

export type CodeBlockStyle = Pick<BlockTypeStyle, "fontFamily" | "fontSize">;
export type BlockquoteStyle = Pick<BlockTypeStyle, "fontFamily" | "fontSize" | "fontWeight" | "color">;

export interface TypographyPresets {
  paragraph: BlockTypeStyle;
  heading1: BlockTypeStyle;
  heading2: BlockTypeStyle;
  heading3: BlockTypeStyle;
  heading4: BlockTypeStyle;
  heading5: BlockTypeStyle;
  heading6: BlockTypeStyle;
  codeBlock: CodeBlockStyle;
  blockquote: BlockquoteStyle;
}

/** All block type keys in TypographyPresets. */
export const BLOCK_TYPES = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "codeBlock",
  "blockquote",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/** Block types that have a full BlockTypeStyle (not Pick). */
export const FULL_BLOCK_TYPES = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
] as const;

export type FullBlockType = (typeof FULL_BLOCK_TYPES)[number];

// ---------------------------------------------------------------------------
// Serialized format (typography.json)
// ---------------------------------------------------------------------------

export interface TypographyFile {
  version: number;
  presets: TypographyPresets;
}

export const TYPOGRAPHY_VERSION = 1;

// ---------------------------------------------------------------------------
// Default presets
// ---------------------------------------------------------------------------

export const DEFAULT_PRESETS: TypographyPresets = {
  paragraph: {
    fontFamily: "system",
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.7,
    spacingBefore: 0,
    spacingAfter: 0.75,
  },
  heading1: {
    fontFamily: "system",
    fontSize: 32,
    fontWeight: 700,
    lineHeight: 1.3,
    spacingBefore: 1.0,
    spacingAfter: 0.5,
  },
  heading2: {
    fontFamily: "system",
    fontSize: 24,
    fontWeight: 600,
    lineHeight: 1.3,
    spacingBefore: 0.8,
    spacingAfter: 0.4,
  },
  heading3: {
    fontFamily: "system",
    fontSize: 20,
    fontWeight: 600,
    lineHeight: 1.3,
    spacingBefore: 0.6,
    spacingAfter: 0.3,
  },
  heading4: {
    fontFamily: "system",
    fontSize: 18,
    fontWeight: 600,
    lineHeight: 1.3,
    spacingBefore: 0.5,
    spacingAfter: 0.25,
  },
  heading5: {
    fontFamily: "system",
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 1.3,
    spacingBefore: 0.4,
    spacingAfter: 0.2,
  },
  heading6: {
    fontFamily: "system",
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.3,
    spacingBefore: 0.4,
    spacingAfter: 0.2,
  },
  codeBlock: {
    fontFamily: "jetbrains-mono",
    fontSize: 14,
  },
  blockquote: {
    fontFamily: "system",
    fontSize: 16,
    fontWeight: 400,
  },
};

// ---------------------------------------------------------------------------
// Preset bundles (for document creation)
// ---------------------------------------------------------------------------

export const ACADEMIC_PRESETS: TypographyPresets = {
  ...DEFAULT_PRESETS,
  paragraph: { ...DEFAULT_PRESETS.paragraph, fontFamily: "source-serif", fontSize: 16, lineHeight: 1.8 },
  heading1: { ...DEFAULT_PRESETS.heading1, fontFamily: "source-serif", fontSize: 28, fontWeight: 700 },
  heading2: { ...DEFAULT_PRESETS.heading2, fontFamily: "source-serif", fontSize: 22, fontWeight: 600 },
  heading3: { ...DEFAULT_PRESETS.heading3, fontFamily: "source-serif", fontSize: 18, fontWeight: 600 },
  heading4: { ...DEFAULT_PRESETS.heading4, fontFamily: "source-serif", fontSize: 16, fontWeight: 600 },
  heading5: { ...DEFAULT_PRESETS.heading5, fontFamily: "source-serif", fontSize: 15, fontWeight: 600 },
  heading6: { ...DEFAULT_PRESETS.heading6, fontFamily: "source-serif", fontSize: 14, fontWeight: 600 },
  blockquote: { ...DEFAULT_PRESETS.blockquote, fontFamily: "source-serif" },
};

export const REPORT_PRESETS: TypographyPresets = {
  ...DEFAULT_PRESETS,
  paragraph: { ...DEFAULT_PRESETS.paragraph, fontFamily: "inter", fontSize: 15, lineHeight: 1.6 },
  heading1: { ...DEFAULT_PRESETS.heading1, fontFamily: "inter", fontSize: 30, fontWeight: 700 },
  heading2: { ...DEFAULT_PRESETS.heading2, fontFamily: "inter", fontSize: 22, fontWeight: 600 },
  heading3: { ...DEFAULT_PRESETS.heading3, fontFamily: "inter", fontSize: 18, fontWeight: 600 },
  heading4: { ...DEFAULT_PRESETS.heading4, fontFamily: "inter", fontSize: 16, fontWeight: 600 },
  heading5: { ...DEFAULT_PRESETS.heading5, fontFamily: "inter", fontSize: 15, fontWeight: 600 },
  heading6: { ...DEFAULT_PRESETS.heading6, fontFamily: "inter", fontSize: 14, fontWeight: 600 },
  blockquote: { ...DEFAULT_PRESETS.blockquote, fontFamily: "inter" },
};

/** Named preset bundles for document creation. */
export const PRESET_BUNDLES = {
  default: DEFAULT_PRESETS,
  academic: ACADEMIC_PRESETS,
  report: REPORT_PRESETS,
} as const;

export type PresetBundleName = keyof typeof PRESET_BUNDLES;

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

/** Deep-merge partial presets over a base, filling missing fields from base. */
export function mergePresets(
  partial: Record<string, Partial<BlockTypeStyle>> | undefined,
  base: TypographyPresets = DEFAULT_PRESETS,
): TypographyPresets {
  if (!partial) return { ...base };

  const result = { ...base };
  for (const key of BLOCK_TYPES) {
    if (partial[key]) {
      (result as Record<string, unknown>)[key] = {
        ...base[key],
        ...partial[key],
      };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Migration from editor-styles.json
// ---------------------------------------------------------------------------

interface LegacyEditorStyles {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  paragraphSpacing?: number;
}

/** Heading size ratios relative to paragraph font size. */
const HEADING_SIZE_RATIOS = {
  heading1: 2.0,
  heading2: 1.5,
  heading3: 1.25,
  heading4: 1.125,
  heading5: 1.0,
  heading6: 0.875,
} as const;

/** Migrate flat editor-styles.json values to per-block-type presets. */
export function migrateFromLegacy(legacy: LegacyEditorStyles): TypographyPresets {
  const family = legacy.fontFamily ?? DEFAULT_PRESETS.paragraph.fontFamily;
  const baseFontSize = legacy.fontSize ?? DEFAULT_PRESETS.paragraph.fontSize;
  const baseLineHeight = legacy.lineHeight ?? DEFAULT_PRESETS.paragraph.lineHeight;
  const spacingAfter = legacy.paragraphSpacing ?? DEFAULT_PRESETS.paragraph.spacingAfter;

  const presets = mergePresets(undefined); // clone defaults

  // Apply paragraph overrides
  presets.paragraph = {
    ...presets.paragraph,
    fontFamily: family,
    fontSize: baseFontSize,
    lineHeight: baseLineHeight,
    spacingAfter,
  };

  // Apply heading sizes proportionally, keep headings on the same font
  for (const [key, ratio] of Object.entries(HEADING_SIZE_RATIOS)) {
    const headingKey = key as keyof typeof HEADING_SIZE_RATIOS;
    presets[headingKey] = {
      ...presets[headingKey],
      fontFamily: family,
      fontSize: Math.round(baseFontSize * ratio),
    };
  }

  // Blockquote inherits font family
  presets.blockquote = { ...presets.blockquote, fontFamily: family };

  return presets;
}

// ---------------------------------------------------------------------------
// Backend export format transform
// ---------------------------------------------------------------------------

/** Shape expected by the Rust backend TypographyPresets struct. */
export interface BackendTypographyPresets {
  paragraph: BackendTextStyle;
  heading1: BackendTextStyle;
  heading2: BackendTextStyle;
  heading3: BackendTextStyle;
  heading4: BackendTextStyle;
  heading5: BackendTextStyle;
  heading6: BackendTextStyle;
  codeFontFamily: string;
}

interface BackendTextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  paragraphSpacing: number;
}

/**
 * Transform frontend TypographyPresets to the shape expected by the Rust backend.
 * Maps `spacingAfter` to `paragraphSpacing` and extracts `codeBlock.fontFamily`
 * to `codeFontFamily`.
 */
export function presetsForBackend(presets: TypographyPresets): BackendTypographyPresets {
  const mapStyle = (s: BlockTypeStyle): BackendTextStyle => ({
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    paragraphSpacing: s.spacingAfter,
  });

  return {
    paragraph: mapStyle(presets.paragraph),
    heading1: mapStyle(presets.heading1),
    heading2: mapStyle(presets.heading2),
    heading3: mapStyle(presets.heading3),
    heading4: mapStyle(presets.heading4),
    heading5: mapStyle(presets.heading5),
    heading6: mapStyle(presets.heading6),
    codeFontFamily: presets.codeBlock.fontFamily,
  };
}
