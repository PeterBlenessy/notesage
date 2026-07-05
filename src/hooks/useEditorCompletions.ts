import type { Editor } from "@tiptap/core";
import type { EditorView as CMEditorView } from "@codemirror/view";
import { useCopilotCompletion } from "@/hooks/useCopilotCompletion";
import { useCopilotCompletionCM } from "@/hooks/useCopilotCompletionCM";
import { useLocalCompletion } from "@/hooks/useLocalCompletion";

/**
 * Inline-completion controller.
 *
 * Groups the three completion hooks that render ghost text:
 *  - `useCopilotCompletion`   — Copilot LSP for the Tiptap (WYSIWYG) editor
 *  - `useCopilotCompletionCM` — Copilot LSP for the CodeMirror source editor
 *  - `useLocalCompletion`     — local / OpenAI-compatible FIM providers
 *
 * Call order matches the previous inline calls in Editor.tsx. Pure side-effect
 * controller — returns nothing.
 */
export function useEditorCompletions(editor: Editor | null, cmView: CMEditorView | null): void {
  useCopilotCompletion(editor);
  useCopilotCompletionCM(cmView);
  useLocalCompletion(editor);
}
