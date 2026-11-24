import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { tauriApi } from "@/lib/tauri";
import { t } from "@/lib/i18n";
import { log } from "@/lib/logger";
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

type SettingsRead =
  | { kind: "ok"; content: string }
  /** Confirmed absent: no file and no iCloud placeholder for it. */
  | { kind: "missing" }
  /** There, or possibly there, and not readable right now. */
  | { kind: "failed"; error: unknown };

/**
 * Read a settings file, keeping "there is no file" apart from "the file could
 * not be read". Only the first may fall back to defaults that are later
 * saved; `pathExists` alone cannot tell them apart, because it is also false
 * for a file iCloud has evicted to a `.name.icloud` placeholder.
 */
async function readSettingsFile(dir: string, name: string): Promise<SettingsRead> {
  try {
    return { kind: "ok", content: await tauriApi.readFile(`${dir}/${name}`) };
  } catch (error) {
    try {
      if (await tauriApi.pathExists(`${dir}/${name}`)) return { kind: "failed", error };
      if (await tauriApi.pathExists(`${dir}/.${name}.icloud`)) return { kind: "failed", error };
      return { kind: "missing" };
    } catch {
      return { kind: "failed", error };
    }
  }
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface EditorStylesStore extends EditorStyles {
  loaded: boolean;
  /**
   * True when `typography.json` exists (or may exist) but could not be
   * loaded. The presets in memory are defaults the user did not choose, so
   * `saveTypography` refuses to write them over the file.
   */
  typographyLoadFailed: boolean;
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
  typographyLoadFailed: false,
  systemFonts: [],
  presets: { ...DEFAULT_PRESETS },
  documentPresets: null,

  // -----------------------------------------------------------------------
  // New per-block-type API
  // -----------------------------------------------------------------------

  loadTypography: async (notesagePath: string) => {
    const basePath = `${notesagePath}/.notesage`;

    // Defaults, shown but NOT saveable: the real file is still on disk.
    const failLoad = (error: unknown) => {
      log.warn("typography", `Could not load ${basePath}/${TYPOGRAPHY_FILE}; using defaults and leaving the file untouched`, error);
      set({
        presets: { ...DEFAULT_PRESETS },
        ...EDITOR_STYLES_DEFAULTS,
        loaded: true,
        typographyLoadFailed: true,
      });
      toast.warning(t("toast.typographyLoadFailed"), { id: "typography-load-failed" });
    };

    // Try typography.json first
    const typography = await readSettingsFile(basePath, TYPOGRAPHY_FILE);
    if (typography.kind === "failed") {
      failLoad(typography.error);
      return;
    }
    if (typography.kind === "ok") {
      let file: TypographyFile | null = null;
      try {
        file = JSON.parse(typography.content) as TypographyFile;
      } catch {
        file = null;
      }
      if (file && file.version === TYPOGRAPHY_VERSION && file.presets) {
        const presets = mergePresets(file.presets as unknown as Record<string, Partial<BlockTypeStyle>>, DEFAULT_PRESETS);
        set({ presets, ...flatFromPresets(presets), loaded: true, typographyLoadFailed: false });
        return;
      }
      // Readable but not usable (damaged, or a format this build does not
      // know). Everything below may write typography.json, so keep a copy of
      // what is there first; without the copy, do not write at all.
      try {
        await tauriApi.writeFile(`${basePath}/${TYPOGRAPHY_FILE}.corrupt`, typography.content);
        log.warn("typography", `${TYPOGRAPHY_FILE} is not usable; kept a copy as ${TYPOGRAPHY_FILE}.corrupt`);
      } catch (error) {
        failLoad(error);
        return;
      }
    }

    // Try legacy editor-styles.json — migrate to typography.json
    const legacyRead = await readSettingsFile(basePath, LEGACY_SETTINGS_FILE);
    if (legacyRead.kind === "ok") {
      try {
        const legacy = JSON.parse(legacyRead.content) as Partial<EditorStyles>;
        const presets = migrateFromLegacy(legacy);
        set({ presets, ...flatFromPresets(presets), loaded: true, typographyLoadFailed: false });
        // Write new format so subsequent loads use typography.json directly
        const file: TypographyFile = { version: TYPOGRAPHY_VERSION, presets };
        tauriApi.writeFile(`${basePath}/${TYPOGRAPHY_FILE}`, JSON.stringify(file, null, 2)).catch((err: unknown) => {
          log.warn("typography", "Could not write migrated typography.json", err);
        });
        return;
      } catch {
        // Legacy file is not JSON — use defaults
      }
    } else if (legacyRead.kind === "failed") {
      log.warn("typography", `Could not read ${LEGACY_SETTINGS_FILE}; skipping its migration`, legacyRead.error);
    }

    set({ presets: { ...DEFAULT_PRESETS }, ...EDITOR_STYLES_DEFAULTS, loaded: true, typographyLoadFailed: false });
  },

  saveTypography: async (notesagePath: string) => {
    if (get().typographyLoadFailed) {
      // What is in memory is defaults, not the user's saved presets.
      log.warn("typography", "Refusing to save typography: the saved presets could not be loaded");
      toast.error(t("toast.typographySaveBlocked"), { id: "typography-save-blocked" });
      return;
    }
    try {
      const { presets } = get();
      const file: TypographyFile = { version: TYPOGRAPHY_VERSION, presets };
      const filePath = `${notesagePath}/.notesage/${TYPOGRAPHY_FILE}`;
      await tauriApi.writeFile(filePath, JSON.stringify(file, null, 2));
    } catch (err) {
      log.error("typography", "Failed to save typography presets", err);
      toast.error(t("toast.typographySaveFailed", { error: String(err) }), { id: "typography-save-failed" });
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
}));
