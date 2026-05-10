import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { tauriApi } from "@/lib/tauri";
import {
  DEFAULT_PRESETS,
  TYPOGRAPHY_VERSION,
  mergePresets,
  migrateFromLegacy,
  type BlockType,
  type BlockTypeStyle,
  type FullBlockType,
  type TypographyPresets,
  type TypographyFile,
} from "@/lib/typography-presets";

// Re-export types from typography-presets for convenience
export type { BlockType, BlockTypeStyle, FullBlockType, TypographyPresets };

/** Font family key — either a preset key (e.g. "system") or a system font family name (e.g. "Fira Sans"). */
export type EditorFontFamily = string;

export interface SystemFont {
  family: string;
  category: "sans" | "serif" | "mono" | "other";
}

export interface FontPreset {
  value: string;
  label: string;
  css: string;
  category: "sans" | "serif" | "mono";
}

export const FONT_PRESETS: FontPreset[] = [
  // Sans-serif
  { value: "system",         label: "System (SF Pro)",  css: '"SF Pro Text", "SF Pro Display", system-ui, -apple-system, sans-serif', category: "sans" },
  { value: "helvetica-neue", label: "Helvetica Neue",   css: '"Helvetica Neue", "Helvetica", "Arial", sans-serif',                   category: "sans" },
  { value: "avenir-next",    label: "Avenir Next",      css: '"Avenir Next", "Avenir", "Helvetica Neue", sans-serif',                category: "sans" },
  { value: "inter",          label: "Inter",            css: '"Inter", system-ui, sans-serif',                                        category: "sans" },
  // Serif
  { value: "source-serif",   label: "Source Serif 4",   css: '"Source Serif 4", "Source Serif Pro", "Georgia", serif',                category: "serif" },
  { value: "georgia",        label: "Georgia",          css: '"Georgia", "Times New Roman", serif',                                   category: "serif" },
  { value: "palatino",       label: "Palatino",         css: '"Palatino", "Palatino Linotype", "Book Antiqua", serif',                category: "serif" },
  { value: "baskerville",    label: "Baskerville",      css: '"Baskerville", "Baskerville Old Face", "Georgia", serif',               category: "serif" },
  { value: "charter",        label: "Charter",          css: '"Charter", "Bitstream Charter", "Georgia", serif',                      category: "serif" },
  { value: "times",          label: "Times New Roman",  css: '"Times New Roman", "Times", serif',                                     category: "serif" },
  // Monospace
  { value: "jetbrains-mono", label: "JetBrains Mono",   css: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',                  category: "mono" },
  { value: "sf-mono",        label: "SF Mono",          css: '"SF Mono", "Menlo", "Consolas", monospace',                             category: "mono" },
  { value: "menlo",          label: "Menlo",            css: '"Menlo", "Monaco", "Consolas", monospace',                              category: "mono" },
  { value: "courier-new",    label: "Courier New",      css: '"Courier New", "Courier", monospace',                                   category: "mono" },
];

const FONT_CSS_MAP = Object.fromEntries(FONT_PRESETS.map((f) => [f.value, f.css]));

/** Resolve a font family key to its CSS font-family string.
 *  Preset keys map to their full CSS stacks. System font names pass through directly.
 *  Falls back to the system preset if key is empty/undefined. */
export function fontFamilyCSS(key: string): string {
  return FONT_CSS_MAP[key] ?? (key || FONT_CSS_MAP["system"]);
}

// ---------------------------------------------------------------------------
// Font-size keyboard shortcut constants
// ---------------------------------------------------------------------------

/** Minimum editor font size (pt), enforced by the keyboard shortcuts. */
export const FONT_SIZE_MIN = 10;
/** Maximum editor font size (pt), enforced by the keyboard shortcuts. */
export const FONT_SIZE_MAX = 24;

// ---------------------------------------------------------------------------
// Legacy flat interface (kept for backwards compatibility)
// ---------------------------------------------------------------------------

export interface EditorStyles {
  fontFamily: EditorFontFamily;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
}

export const EDITOR_STYLES_DEFAULTS: EditorStyles = {
  fontFamily: "system",
  fontSize: 16,
  lineHeight: 1.7,
  paragraphSpacing: 0.75,
};

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

const LEGACY_SETTINGS_FILE = "editor-styles.json";
const TYPOGRAPHY_FILE = "typography.json";

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface EditorStylesStore extends EditorStyles {
  loaded: boolean;
  systemFonts: SystemFont[];
  presets: TypographyPresets;
  /** Per-document typography overrides from `style:` frontmatter. Merged over global presets. */
  documentPresets: TypographyPresets | null;

  // New per-block-type API
  loadTypography: (notesagePath: string) => Promise<void>;
  saveTypography: (notesagePath: string) => Promise<void>;
  updatePreset: (blockType: BlockType, style: Partial<BlockTypeStyle>) => void;
  getEffectiveStyle: (blockType: BlockType) => BlockTypeStyle;
  /** Set per-document presets (from frontmatter style:). Pass null to clear. */
  setDocumentPresets: (presets: TypographyPresets | null) => void;
  /** Get the effective presets (documentPresets if set, otherwise global presets). */
  getEffectivePresets: () => TypographyPresets;

  // Legacy API (delegates to presets.paragraph)
  loadSettings: (notesagePath: string) => Promise<void>;
  saveSettings: (notesagePath: string) => Promise<void>;
  loadSystemFonts: () => Promise<void>;
  setFontFamily: (family: EditorFontFamily) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setParagraphSpacing: (spacing: number) => void;
  resetToDefaults: () => void;
  /** Increase or decrease the paragraph font size by `delta` pt, clamped to [FONT_SIZE_MIN, FONT_SIZE_MAX]. */
  adjustFontSize: (delta: number) => void;
  /** Reset the paragraph font size to the application default. */
  resetFontSize: () => void;
}

/** Derive legacy flat fields from presets for backwards compatibility. */
function flatFromPresets(presets: TypographyPresets): EditorStyles {
  return {
    fontFamily: presets.paragraph.fontFamily,
    fontSize: presets.paragraph.fontSize,
    lineHeight: presets.paragraph.lineHeight,
    paragraphSpacing: presets.paragraph.spacingAfter,
  };
}

export const useEditorStylesStore = create<EditorStylesStore>()((set, get) => ({
  ...EDITOR_STYLES_DEFAULTS,
  loaded: false,
  systemFonts: [],
  presets: { ...DEFAULT_PRESETS },
  documentPresets: null,

  // -----------------------------------------------------------------------
  // New per-block-type API
  // -----------------------------------------------------------------------

  loadTypography: async (notesagePath: string) => {
    const basePath = `${notesagePath}/.notesage`;

    // Try typography.json first
    try {
      const content = await tauriApi.readFile(`${basePath}/${TYPOGRAPHY_FILE}`);
      const file = JSON.parse(content) as TypographyFile;
      if (file.version === TYPOGRAPHY_VERSION && file.presets) {
        const presets = mergePresets(file.presets as unknown as Record<string, Partial<BlockTypeStyle>>, DEFAULT_PRESETS);
        set({ presets, ...flatFromPresets(presets), loaded: true });
        return;
      }
    } catch {
      // typography.json doesn't exist — try legacy migration
    }

    // Try legacy editor-styles.json — migrate to typography.json
    try {
      const content = await tauriApi.readFile(`${basePath}/${LEGACY_SETTINGS_FILE}`);
      const legacy = JSON.parse(content) as Partial<EditorStyles>;
      const presets = migrateFromLegacy(legacy);
      set({ presets, ...flatFromPresets(presets), loaded: true });
      // Write new format so subsequent loads use typography.json directly
      const file: TypographyFile = { version: TYPOGRAPHY_VERSION, presets };
      tauriApi.writeFile(`${basePath}/${TYPOGRAPHY_FILE}`, JSON.stringify(file, null, 2)).catch(() => {});
      return;
    } catch {
      // No settings files — use defaults
    }

    set({ presets: { ...DEFAULT_PRESETS }, ...EDITOR_STYLES_DEFAULTS, loaded: true });
  },

  saveTypography: async (notesagePath: string) => {
    try {
      const { presets } = get();
      const file: TypographyFile = { version: TYPOGRAPHY_VERSION, presets };
      const filePath = `${notesagePath}/.notesage/${TYPOGRAPHY_FILE}`;
      await tauriApi.writeFile(filePath, JSON.stringify(file, null, 2));
    } catch (err) {
      console.error("Failed to save typography presets:", err);
    }
  },

  updatePreset: (blockType, style) => {
    const { presets } = get();
    const updated = {
      ...presets,
      [blockType]: { ...presets[blockType], ...style },
    };
    set({ presets: updated, ...flatFromPresets(updated) });
  },

  getEffectiveStyle: (blockType) => {
    const { documentPresets, presets } = get();
    const effectivePresets = documentPresets ?? presets;
    const preset = effectivePresets[blockType];
    // Return a full BlockTypeStyle — fill in defaults for partial types (codeBlock, blockquote)
    return {
      fontFamily: preset.fontFamily,
      fontSize: preset.fontSize,
      fontWeight: "fontWeight" in preset ? (preset as BlockTypeStyle).fontWeight : 400,
      lineHeight: "lineHeight" in preset ? (preset as BlockTypeStyle).lineHeight : DEFAULT_PRESETS.paragraph.lineHeight,
      spacingBefore: "spacingBefore" in preset ? (preset as BlockTypeStyle).spacingBefore : 0,
      spacingAfter: "spacingAfter" in preset ? (preset as BlockTypeStyle).spacingAfter : 0,
      color: "color" in preset ? (preset as BlockTypeStyle).color : undefined,
    };
  },

  setDocumentPresets: (docPresets) => {
    set({ documentPresets: docPresets });
  },

  getEffectivePresets: () => {
    const { documentPresets, presets } = get();
    return documentPresets ?? presets;
  },

  // -----------------------------------------------------------------------
  // Legacy API — delegates to presets.paragraph
  // -----------------------------------------------------------------------

  loadSettings: async (notesagePath: string) => {
    await get().loadTypography(notesagePath);
  },

  saveSettings: async (notesagePath: string) => {
    await get().saveTypography(notesagePath);
  },

  loadSystemFonts: async () => {
    try {
      const fonts = await invoke<SystemFont[]>("list_system_fonts");
      set({ systemFonts: fonts });
    } catch (err) {
      console.error("Failed to load system fonts:", err);
    }
  },

  setFontFamily: (family) => {
    get().updatePreset("paragraph", { fontFamily: family });
  },

  setFontSize: (size) => {
    get().updatePreset("paragraph", { fontSize: size });
  },

  setLineHeight: (height) => {
    get().updatePreset("paragraph", { lineHeight: height });
  },

  setParagraphSpacing: (spacing) => {
    get().updatePreset("paragraph", { spacingAfter: spacing });
  },

  resetToDefaults: () => {
    set({ presets: { ...DEFAULT_PRESETS }, ...EDITOR_STYLES_DEFAULTS });
  },

  adjustFontSize: (delta) => {
    const current = get().fontSize;
    const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, current + delta));
    get().setFontSize(next);
  },

  resetFontSize: () => {
    get().setFontSize(EDITOR_STYLES_DEFAULTS.fontSize);
  },
}));
