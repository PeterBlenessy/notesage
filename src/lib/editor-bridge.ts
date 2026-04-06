import type { Editor } from '@tiptap/core';

let editorRef: Editor | null = null;

export function setEditorRef(editor: Editor | null): void {
  editorRef = editor;
}

export function getEditorRef(): Editor | null {
  return editorRef;
}
