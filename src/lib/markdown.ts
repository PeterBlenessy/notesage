import type { Editor } from "@tiptap/core";

export function getMarkdownFromEditor(editor: Editor): string {
  // Try to use the Markdown extension's getMarkdown method
  try {
    const markdownExt = editor.extensionManager.extensions.find(
      (ext) => ext.name === "markdown"
    );
    if (markdownExt && typeof (markdownExt as any).storage?.getMarkdown === "function") {
      return (markdownExt as any).storage.getMarkdown();
    }
  } catch (error) {
    console.warn("Failed to get markdown from extension:", error);
  }

  // Fallback: try editor storage
  try {
    if (editor.storage && typeof (editor.storage as any).markdown?.getMarkdown === "function") {
      return (editor.storage as any).markdown.getMarkdown();
    }
  } catch (error) {
    console.warn("Failed to get markdown from storage:", error);
  }

  // Last resort: get HTML and convert or just get text
  // For now, just return text as a fallback
  return editor.getText();
}

export function setMarkdownInEditor(editor: Editor, markdown: string): void {
  editor.commands.setContent(markdown);
}
