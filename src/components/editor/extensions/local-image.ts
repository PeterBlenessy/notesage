import Image from "@tiptap/extension-image";
import { resolveImageSrc } from "@/lib/image-utils";

/**
 * Extends the Tiptap Image extension with:
 *  - `documentDir` storage (used for resolving relative paths via the Tauri
 *    asset protocol).
 *  - `blockWidth` attribute for sizing the image.
 *  - `textAlign` is provided globally by the TextAlign extension (configured
 *    in `useEditor.ts` to cover this node type) — toolbar align button writes
 *    the same attribute that gets serialised to markdown.
 *  - A vanilla DOM NodeView. We tried a React NodeView (with hover-revealed
 *    BlockSizeControls) but the per-image React-mount cost made large
 *    image-heavy markdown files 2–3x slower to open. Hover controls for image
 *    are deferred to a follow-up; sizing/aligning still works via the
 *    toolbar's TextAlign command.
 *  - A markdown serializer that writes `<!--blockWidth:N,align:X-->` after
 *    the image when those attrs are set. Matching parser lives in
 *    `markdown.ts` (`convertImagesWithMetaToHtml`).
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
    };
  },

  addStorage() {
    return {
      documentDir: "",
      /** Callback set by Editor.tsx — opens the image insert dialog. */
      openInsertDialog: null as (() => void) | null,
      markdown: {
        serialize(
          state: { write: (text: string) => void },
          node: {
            attrs: {
              src: string;
              alt: string | null;
              title: string | null;
              blockWidth: number | null;
              textAlign: string | null;
            };
          },
        ) {
          const { src, alt, title, blockWidth, textAlign } = node.attrs;
          if (!src) return;

          const safeAlt = (alt ?? "").replace(/[\[\]]/g, "\\$&");
          const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";

          const meta: string[] = [];
          if (blockWidth != null) meta.push(`blockWidth:${blockWidth}`);
          if (textAlign != null) meta.push(`align:${textAlign}`);
          const metaSuffix =
            meta.length > 0 ? ` <!--${meta.join(",")}-->` : "";

          state.write(`![${safeAlt}](${src}${titlePart})${metaSuffix}`);
        },
        parse: {
          // Parsing is handled by the preprocessor in markdown.ts
          // (`convertImagesWithMetaToHtml`).
        },
      },
    };
  },

  addNodeView() {
    return ({ node, editor }) => {
      // Vanilla DOM NodeView — much cheaper than React per-image mount on
      // image-heavy documents (revert from React NodeView in 408f1894 after
      // it caused a 2-3x slowdown on the user's 494 KB book).
      const dom = document.createElement("img");
      dom.className = "rounded-lg max-w-full block";

      const getDocDir = () =>
        (
          editor.storage as unknown as Record<
            string,
            { documentDir?: string } | undefined
          >
        ).image?.documentDir;
      const resolve = (src: string) => resolveImageSrc(src, getDocDir());

      const applyAttrs = (attrs: Record<string, unknown>) => {
        dom.src = resolve(attrs.src as string);
        if (attrs.alt) dom.alt = attrs.alt as string;
        else dom.removeAttribute("alt");
        if (attrs.title) dom.title = attrs.title as string;
        else dom.removeAttribute("title");

        const blockWidth = attrs.blockWidth as number | null;
        const textAlign = attrs.textAlign as string | null;

        // Width + alignment via inline style on the img element so the
        // change is visible without React. Auto-margins follow the same
        // pattern as ChartNodeView / DrawingPreview.
        if (blockWidth != null) {
          dom.style.width = `${blockWidth}%`;
          dom.style.height = "auto";
          if (textAlign === "center") {
            dom.style.marginLeft = "auto";
            dom.style.marginRight = "auto";
            dom.style.display = "block";
          } else if (textAlign === "right") {
            dom.style.marginLeft = "auto";
            dom.style.marginRight = "0";
            dom.style.display = "block";
          } else {
            dom.style.marginLeft = "0";
            dom.style.marginRight = "auto";
            dom.style.display = "block";
          }
        } else {
          dom.style.removeProperty("width");
          dom.style.removeProperty("margin-left");
          dom.style.removeProperty("margin-right");
        }
      };

      applyAttrs(node.attrs);

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "image") return false;
          applyAttrs(updatedNode.attrs);
          return true;
        },
      };
    };
  },
});
