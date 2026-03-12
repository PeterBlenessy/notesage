/**
 * Custom Highlight extension that uses data-color attributes instead of inline
 * background-color styles. This allows highlight colors to adapt to light/dark
 * mode via CSS, rather than being baked-in hex values.
 *
 * Stores semantic color names ("yellow", "green", etc.) as the mark attribute.
 * Backward-compatible: parses old hex-based highlights and maps them to names.
 */
import Highlight from "@tiptap/extension-highlight";

/** Map of old hex values (light and dark) → semantic name for migration. */
const HEX_TO_NAME: Record<string, string> = {
  // Light variants
  "#fef08a": "yellow",
  "#bbf7d0": "green",
  "#bfdbfe": "blue",
  "#fbcfe8": "pink",
  "#fed7aa": "orange",
  "#e5e7eb": "grey",
  // Dark variants
  "#854d0e": "yellow",
  "#166534": "green",
  "#1e40af": "blue",
  "#9d174d": "pink",
  "#9a3412": "orange",
  "#374151": "grey",
};

export const HIGHLIGHT_COLOR_NAMES = [
  "yellow",
  "green",
  "blue",
  "pink",
  "orange",
  "grey",
] as const;

export type HighlightColorName = (typeof HIGHLIGHT_COLOR_NAMES)[number];

export const ThemedHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          // Prefer data-color attribute (new format)
          const dataColor = element.getAttribute("data-color");
          if (dataColor) return dataColor;

          // Fall back to inline style (old format) — map hex to name
          const style = element.getAttribute("style") || "";
          const match = style.match(/background-color:\s*(#[0-9a-fA-F]{6})/);
          if (match) {
            const hex = match[1].toLowerCase();
            return HEX_TO_NAME[hex] || hex;
          }

          return null;
        },
        renderHTML: (attributes: Record<string, string | null>) => {
          if (!attributes.color) return {};

          // If it's a semantic name, use data-color for CSS-based theming
          if (HIGHLIGHT_COLOR_NAMES.includes(attributes.color as HighlightColorName)) {
            return { "data-color": attributes.color };
          }

          // Unknown color (shouldn't happen, but be safe) — fall back to inline style
          return { style: `background-color: ${attributes.color}` };
        },
      },
    };
  },
});
