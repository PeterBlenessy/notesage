import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageNodeView } from "@/components/editor/ImageNodeView";

/**
 * Extends the Tiptap Image extension with:
 *  - `documentDir` storage (used by `ImageNodeView` to resolve relative
 *    paths via the Tauri asset protocol).
 *  - `blockWidth` and `align` attributes so the user can size + align an
 *    image inline (consistent with chart / drawing / link-preview blocks
 *    — same `BlockSizeControls` hover overlay).
 *  - A React NodeView (`ImageNodeView`) — replaces the prior vanilla DOM
 *    NodeView so the hover overlay can use React state.
 *  - A markdown serializer that appends a trailing
 *    `<!--blockWidth:N,align:X-->` HTML comment when those attrs are set,
 *    mirroring the chart and drawing sidecar metadata pattern. The
 *    matching parser lives in `markdown.ts` (`convertImagesToHtml`).
 *
 * Set the document directory on the editor after creation or on tab switch:
 *   editor.storage.image.documentDir = getDocumentDir(filePath)
 */
export const LocalImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockWidth: {
        default: null as number | null,
        parseHTML: (element: HTMLElement) => {
          const v = element.getAttribute("data-block-width");
          return v ? Number(v) : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          if (attributes.blockWidth == null) return {};
          return { "data-block-width": String(attributes.blockWidth) };
        },
      },
      align: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-align") || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.align) return {};
          return { "data-align": attributes.align as string };
        },
      },
    };
  },

  addStorage() {
    return {
      documentDir: "",
      /** Callback set by Editor.tsx — opens the image insert dialog. */
      openInsertDialog: null as (() => void) | null,
      // Markdown serializer override — tiptap-markdown reads `storage.markdown`
      // for per-node serialization. Default would emit `![alt](src "title")`
      // and drop blockWidth/align; we extend it to append a trailing
      // `<!--blockWidth:N,align:X-->` HTML comment when those attrs are set.
      markdown: {
        serialize(
          state: { write: (text: string) => void },
          node: {
            attrs: {
              src: string;
              alt: string | null;
              title: string | null;
              blockWidth: number | null;
              align: string | null;
            };
          },
        ) {
          const { src, alt, title, blockWidth, align } = node.attrs;
          if (!src) return;

          // Escape `[` `]` in alt text; backslash-escape any embedded `"` in title.
          const safeAlt = (alt ?? "").replace(/[\[\]]/g, "\\$&");
          const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";

          const meta: string[] = [];
          if (blockWidth != null) meta.push(`blockWidth:${blockWidth}`);
          if (align != null) meta.push(`align:${align}`);
          const metaSuffix =
            meta.length > 0 ? ` <!--${meta.join(",")}-->` : "";

          state.write(`![${safeAlt}](${src}${titlePart})${metaSuffix}`);
        },
        parse: {
          // Parsing is handled by the preprocessor in markdown.ts
          // (`convertImagesToHtml`).
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});
