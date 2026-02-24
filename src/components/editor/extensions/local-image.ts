import Image from "@tiptap/extension-image";
import { resolveImageSrc } from "@/lib/image-utils";

/**
 * Extends the Tiptap Image extension to resolve local file paths via the
 * Tauri asset protocol. The ProseMirror document stores the original path
 * (relative or absolute); only the rendered DOM uses the resolved asset URL.
 *
 * Set the document directory on the editor after creation or on tab switch:
 *   editor.storage.image.documentDir = getDocumentDir(filePath)
 */
export const LocalImage = Image.extend({
  addStorage() {
    return {
      documentDir: "",
      /** Callback set by Editor.tsx — opens the image insert dialog. */
      openInsertDialog: null as (() => void) | null,
    };
  },

  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement("img");
      dom.className = "rounded-lg max-w-full";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getDocDir = () => (editor.storage as any).image?.documentDir as string | undefined;
      const resolve = (src: string) => resolveImageSrc(src, getDocDir());

      dom.src = resolve(node.attrs.src);
      if (node.attrs.alt) dom.alt = node.attrs.alt;
      if (node.attrs.title) dom.title = node.attrs.title;

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "image") return false;
          dom.src = resolve(updatedNode.attrs.src);
          dom.alt = updatedNode.attrs.alt || "";
          dom.title = updatedNode.attrs.title || "";
          return true;
        },
      };
    };
  },
});
