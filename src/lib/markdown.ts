import type { Editor } from "@tiptap/core";

/**
 * Encode spaces in local image paths so markdown-it can parse them.
 * CommonMark doesn't allow spaces in bare link/image destinations.
 * We encode them as %20 before parsing and decode on serialization
 * so the on-disk markdown is unchanged.
 */
export function encodeImagePathSpaces(markdown: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, dest: string) => {
      if (!dest.includes(" ")) return match;
      // Angle-bracket destinations are already valid with spaces
      if (dest.startsWith("<") && dest.endsWith(">")) return match;
      // Remote URLs and data URIs — leave as-is
      if (/^https?:\/\//.test(dest) || dest.startsWith("data:")) return match;
      // Split optional title: path "title" or path 'title'
      const titleMatch = dest.match(/^(.+?)(\s+["'].*["'])$/);
      if (titleMatch) {
        const path = titleMatch[1].replace(/ /g, "%20");
        return `![${alt}](${path}${titleMatch[2]})`;
      }
      return `![${alt}](${dest.replace(/ /g, "%20")})`;
    },
  );
}

/**
 * Decode %20 back to spaces in local image paths for saving.
 */
export function decodeImagePathSpaces(markdown: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, dest: string) => {
      if (!dest.includes("%20")) return match;
      if (/^https?:\/\//.test(dest) || dest.startsWith("data:")) return match;
      return `![${alt}](${dest.replace(/%20/g, " ")})`;
    },
  );
}

export function getMarkdownFromEditor(editor: Editor): string {
  // Try to use the Markdown extension's getMarkdown method
  try {
    const markdownExt = editor.extensionManager.extensions.find(
      (ext) => ext.name === "markdown"
    );
    if (markdownExt && typeof (markdownExt as any).storage?.getMarkdown === "function") {
      return decodeImagePathSpaces((markdownExt as any).storage.getMarkdown());
    }
  } catch (error) {
    console.warn("Failed to get markdown from extension:", error);
  }

  // Fallback: try editor storage
  try {
    if (editor.storage && typeof (editor.storage as any).markdown?.getMarkdown === "function") {
      return decodeImagePathSpaces((editor.storage as any).markdown.getMarkdown());
    }
  } catch (error) {
    console.warn("Failed to get markdown from storage:", error);
  }

  // Last resort: get HTML and convert or just get text
  // For now, just return text as a fallback
  return editor.getText();
}

export function setMarkdownInEditor(editor: Editor, markdown: string): void {
  setContentWithoutHistory(editor, encodeImagePathSpaces(markdown));
}

/**
 * Replace the editor's document content without adding to undo history.
 * Uses Tiptap's chain API to set `addToHistory: false` on the transaction
 * so Cmd+Z won't undo file loads, tab switches, or external change reloads.
 */
export function setContentWithoutHistory(editor: Editor, content: string): void {
  editor.chain().setMeta('addToHistory', false).setContent(content).run();
}
