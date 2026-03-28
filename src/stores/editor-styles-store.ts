import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { tauriApi } from "@/lib/tauri";

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

const SETTINGS_FILE = "editor-styles.json";

interface EditorStylesStore extends EditorStyles {
  loaded: boolean;
  systemFonts: SystemFont[];

  loadSettings: (notesagePath: string) => Promise<void>;
  saveSettings: (notesagePath: string) => Promise<void>;
  loadSystemFonts: () => Promise<void>;

  setFontFamily: (family: EditorFontFamily) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setParagraphSpacing: (spacing: number) => void;
  resetToDefaults: () => void;
}

export const useEditorStylesStore = create<EditorStylesStore>()((set, get) => ({
  ...EDITOR_STYLES_DEFAULTS,
  loaded: false,
  systemFonts: [],

  loadSettings: async (notesagePath: string) => {
    try {
      const filePath = `${notesagePath}/.notesage/${SETTINGS_FILE}`;
      const content = await tauriApi.readFile(filePath);
      const parsed = JSON.parse(content) as Partial<EditorStyles>;
      set({
        fontFamily: parsed.fontFamily ?? EDITOR_STYLES_DEFAULTS.fontFamily,
        fontSize: parsed.fontSize ?? EDITOR_STYLES_DEFAULTS.fontSize,
        lineHeight: parsed.lineHeight ?? EDITOR_STYLES_DEFAULTS.lineHeight,
        paragraphSpacing: parsed.paragraphSpacing ?? EDITOR_STYLES_DEFAULTS.paragraphSpacing,
        loaded: true,
      });
    } catch {
      // File doesn't exist yet or is invalid — use defaults
      set({ loaded: true });
    }
  },

  loadSystemFonts: async () => {
    try {
      const fonts = await invoke<SystemFont[]>("list_system_fonts");
      set({ systemFonts: fonts });
    } catch (err) {
      console.error("Failed to load system fonts:", err);
    }
  },

  saveSettings: async (notesagePath: string) => {
    try {
      const { fontFamily, fontSize, lineHeight, paragraphSpacing } = get();
      const data: EditorStyles = { fontFamily, fontSize, lineHeight, paragraphSpacing };
      const filePath = `${notesagePath}/.notesage/${SETTINGS_FILE}`;
      await tauriApi.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("Failed to save editor styles:", err);
    }
  },

  setFontFamily: (family) => set({ fontFamily: family }),
  setFontSize: (size) => set({ fontSize: size }),
  setLineHeight: (height) => set({ lineHeight: height }),
  setParagraphSpacing: (spacing) => set({ paragraphSpacing: spacing }),

  resetToDefaults: () => set({ ...EDITOR_STYLES_DEFAULTS }),
}));
