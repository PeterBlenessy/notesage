import { useEffect, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import { useRoutingStore } from '@/stores/routing-store';
import { useEditorStore } from '@/stores/editor-store';
import { tauriApi } from '@/lib/tauri';
import {
  setGhostText,
  clearGhostText,
  hasActiveGhostText,
  hasActiveInlineDiff,
} from '@/components/editor/extensions';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages Ollama Fill-in-the-Middle (FIM) completions as ghost text.
 *
 * Activates when the `inline_completion` routing slot is assigned to a
 * connection with `authMethod === 'local'` (i.e., Ollama).
 *
 * Uses the same `GhostText` ProseMirror extension as the Copilot LSP hook,
 * but calls the Ollama `/api/generate` endpoint with `suffix` for FIM.
 */
export function useOllamaCompletion(editor: Editor | null) {
  const connection = useRoutingStore((s) => s.getConnectionForUseCase('inline_completion'));
  const useCaseModel = useRoutingStore((s) => s.routing.inline_completion?.model);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Only activate for local (Ollama) connections
  const isOllama = connection?.authMethod === 'local';

  const completionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestedPos = useRef<string | null>(null);
  const requestId = useRef(0);

  // Resolve Ollama connection details
  const ollamaUrl = isOllama && connection?.credentials.type === 'local'
    ? connection.credentials.url
    : undefined;
  const model = useCaseModel ?? connection?.config?.model;

  // -------------------------------------------------------------------------
  // Request FIM completion
  // -------------------------------------------------------------------------

  const requestCompletion = useCallback(
    async () => {
      if (!editor || !isOllama) return;

      // Don't request if completions disabled for this tab
      if (activeTab?.copilotDisabled) return;

      // Don't request if selection is not collapsed, or inline diff is active
      const { selection } = editor.state;
      if (!selection.empty) return;
      if (hasActiveInlineDiff(editor)) return;

      const pos = selection.$from.pos;
      const doc = editor.state.doc;
      const docSize = doc.content.size;

      // Extract text before and after cursor
      const prefix = doc.textBetween(0, pos, '\n');
      const suffix = doc.textBetween(pos, docSize, '\n');

      // Dedup: don't re-request at the same position with same content
      const posKey = `${activeTab?.filePath}:${pos}:${prefix.length}`;
      if (posKey === lastRequestedPos.current) return;
      lastRequestedPos.current = posKey;

      // Track this request to discard stale responses
      const thisRequest = ++requestId.current;

      try {
        const completion = await tauriApi.ollamaFimCompletion(
          prefix,
          suffix,
          model,
          ollamaUrl,
        );

        // Discard if a newer request was made while we were waiting
        if (thisRequest !== requestId.current) return;

        // The editor state may have changed while we were waiting
        if (!editor.isFocused || editor.isDestroyed) return;

        const trimmed = completion.trimEnd();
        if (!trimmed) {
          if (hasActiveGhostText(editor)) clearGhostText(editor);
          return;
        }

        const currentPos = editor.state.selection.$from.pos;

        setGhostText(editor, {
          text: trimmed,
          from: currentPos,
          to: currentPos,
        });
      } catch {
        // Silently ignore completion errors (e.g., Ollama not running)
      }
    },
    [editor, isOllama, activeTab?.copilotDisabled, activeTab?.filePath, model, ollamaUrl]
  );

  // -------------------------------------------------------------------------
  // Listen for editor updates and debounce completion requests
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!editor || !isOllama) return;

    const handleUpdate = () => {
      if (!activeTab) return;

      // Skip completion request if disabled for this tab
      if (activeTab.copilotDisabled) return;

      // Debounce: 300ms after typing stops (slower than Copilot's 150ms since local)
      if (completionTimeout.current) {
        clearTimeout(completionTimeout.current);
      }
      completionTimeout.current = setTimeout(() => {
        requestCompletion();
      }, 300);
    };

    editor.on('update', handleUpdate);

    return () => {
      editor.off('update', handleUpdate);
      if (completionTimeout.current) {
        clearTimeout(completionTimeout.current);
      }
    };
  }, [editor, isOllama, activeTab?.filePath, activeTab?.copilotDisabled, requestCompletion]);

  // -------------------------------------------------------------------------
  // Clear ghost text when completions are disabled for the active tab
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (editor && activeTab?.copilotDisabled && hasActiveGhostText(editor)) {
      clearGhostText(editor);
    }
  }, [editor, activeTab?.copilotDisabled]);

  // -------------------------------------------------------------------------
  // Clear ghost text on tab switch
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (editor && hasActiveGhostText(editor)) {
      clearGhostText(editor);
    }
    // Reset dedup key on tab switch
    lastRequestedPos.current = null;
  }, [editor, activeTabId]);
}
