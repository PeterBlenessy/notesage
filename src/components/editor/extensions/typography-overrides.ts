/**
 * Typography override attributes for Heading and Paragraph nodes.
 *
 * Adds optional `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, and
 * `color` attributes to both node types. When non-null these render as inline
 * styles on the DOM element, overriding the global CSS-variable-based styles
 * from editor-styles-store.
 *
 * These attributes are **not serialized to markdown** — they exist only in
 * ProseMirror. The `prosemirror-markdown` serializer only handles known
 * markdown attributes (like `level` for headings), so custom attrs with
 * `null` defaults are naturally ignored.
 *
 * Also provides a `clearTypographyOverrides` command that removes all
 * override attributes from the current node.
 */

import { Extension } from "@tiptap/core";
import Heading from "@tiptap/extension-heading";
import Paragraph from "@tiptap/extension-paragraph";
import { mergeAttributes } from "@tiptap/core";
import { fontFamilyCSS } from "@/stores/editor-styles-store";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The set of override attribute names added to heading/paragraph nodes. */
const OVERRIDE_ATTR_NAMES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "color",
] as const;

type OverrideAttrName = (typeof OVERRIDE_ATTR_NAMES)[number];

/** Attribute definitions shared by both Heading and Paragraph extensions. */
function typographyOverrideAttrs(): Record<
  OverrideAttrName,
  { default: null; parseHTML: () => null; renderHTML: () => Record<string, never> }
> {
  const defs = {} as Record<
    OverrideAttrName,
    { default: null; parseHTML: () => null; renderHTML: () => Record<string, never> }
  >;
  for (const name of OVERRIDE_ATTR_NAMES) {
    defs[name] = {
      default: null,
      // Never parse from HTML — these are transient ProseMirror-only attrs
      parseHTML: () => null,
      // Per-attribute renderHTML returns empty — we build the combined style
      // string in the extension-level renderHTML override instead.
      renderHTML: () => ({}),
    };
  }
  return defs;
}

/**
 * Build a CSS style string from the non-null typography override attributes
 * on a ProseMirror node.
 *
 * Returns `null` when no overrides are set.
 */
export function buildOverrideStyles(
  attrs: Record<string, unknown>,
): string | null {
  const parts: string[] = [];
  if (attrs.fontFamily) {
    parts.push(`font-family: ${fontFamilyCSS(attrs.fontFamily as string)}`);
  }
  if (attrs.fontSize) {
    parts.push(`font-size: ${attrs.fontSize as number}px`);
  }
  if (attrs.fontWeight) {
    parts.push(`font-weight: ${attrs.fontWeight as number}`);
  }
  if (attrs.lineHeight) {
    parts.push(`line-height: ${attrs.lineHeight as number}`);
  }
  if (attrs.color) {
    parts.push(`color: ${attrs.color as string}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

// ---------------------------------------------------------------------------
// Extended Heading
// ---------------------------------------------------------------------------

export const HeadingWithOverrides = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...typographyOverrideAttrs(),
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const hasLevel = this.options.levels.includes(node.attrs.level);
    const level = hasLevel ? node.attrs.level : this.options.levels[0];

    const overrideStyle = buildOverrideStyles(node.attrs);
    const attrs = overrideStyle
      ? mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          style: overrideStyle,
        })
      : mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);

    return [`h${level}`, attrs, 0];
  },
});

// ---------------------------------------------------------------------------
// Extended Paragraph
// ---------------------------------------------------------------------------

export const ParagraphWithOverrides = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...typographyOverrideAttrs(),
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const overrideStyle = buildOverrideStyles(node.attrs);
    const attrs = overrideStyle
      ? mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          style: overrideStyle,
        })
      : mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);

    return ["p", attrs, 0];
  },
});

// ---------------------------------------------------------------------------
// clearTypographyOverrides command extension
// ---------------------------------------------------------------------------

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    typographyOverrides: {
      /** Remove all typography override attributes from the current node. */
      clearTypographyOverrides: () => ReturnType;
    };
  }
}

/**
 * Standalone extension that registers the `clearTypographyOverrides` command.
 * Must be included alongside HeadingWithOverrides and ParagraphWithOverrides.
 */
export const TypographyOverrides = Extension.create({
  name: "typographyOverrides",

  addCommands() {
    return {
      clearTypographyOverrides:
        () =>
        ({ tr, state, dispatch }) => {
          const { $from } = state.selection;
          const node = $from.node($from.depth);
          if (
            node.type.name !== "heading" &&
            node.type.name !== "paragraph"
          ) {
            return false;
          }
          const pos = $from.before($from.depth);
          const cleared: Record<string, null> = {};
          for (const name of OVERRIDE_ATTR_NAMES) {
            cleared[name] = null;
          }
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            ...cleared,
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
