import { useEffect, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import { useRoutingStore } from '@/stores/routing-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';
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
 * Manages inline completions as ghost text for local/compatible providers.
 *
 * Activates when the `inline_completion` routing slot is assigned to:
 * - `local` (Ollama) — uses native `/api/generate` FIM endpoint
 * - `local_bundled` (Local AI) — uses `/v1/completions` on the bundled server
 * - `openai_compatible` — uses `/v1/completions` on the configured endpoint
 *
 * Uses the same `GhostText` ProseMirror extension as the Copilot LSP hook.
 */
export function useLocalCompletion(editor: Editor | null) {
  const connection = useRoutingStore((s) => s.getConnectionForUseCase('inline_completion'));
  const useCaseModel = useRoutingStore((s) => s.routing.inline_completion?.model);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const fimContextChars = useSettingsStore((s) => s.fimContextChars);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Activate for local (Ollama), local_bundled, or openai_compatible connections
  const isActive =
    connection?.authMethod === 'local' ||
    connection?.authMethod === 'local_bundled' ||
    (connection?.provider === 'openai_compatible' && connection?.authMethod === 'api_key');

  const completionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestedPos = useRef<string | null>(null);
  const requestId = useRef(0);
  const consecutiveErrors = useRef(0);

  // Resolve connection details
  const ollamaUrl =
    connection?.authMethod === 'local' && connection?.credentials.type === 'local'
      ? connection.credentials.url
      : undefined;

  const baseUrl =
    connection?.provider === 'openai_compatible'
      ? connection?.config?.baseUrl
      : undefined;

  const connectionId = connection?.id;

  const model = useCaseModel ?? connection?.config?.model;

  // Reset error counter when connection or model changes (e.g., server restart)
  useEffect(() => {
    consecutiveErrors.current = 0;
    lastRequestedPos.current = null;
  }, [connection?.id, model]);

  // -------------------------------------------------------------------------
  // Request completion
  // -------------------------------------------------------------------------

  const requestCompletion = useCallback(
    async () => {
      if (!editor || !isActive) return;

      // Back off after repeated errors (e.g., server loading, model doesn't support FIM)
      if (consecutiveErrors.current >= 5) return;

      // Don't request if completions disabled for this tab
      if (useSettingsStore.getState().inlineCompletionsDisabled) return;

      // Don't request if selection is not collapsed, or inline diff is active
      const { selection } = editor.state;
      if (!selection.empty) return;
      if (hasActiveInlineDiff(editor)) return;

      const pos = selection.$from.pos;
      const doc = editor.state.doc;
      const docSize = doc.content.size;

      // Extract text before and after cursor, limited by context setting
      const fullPrefix = doc.textBetween(0, pos, '\n');
      const fullSuffix = doc.textBetween(pos, docSize, '\n');
      const ctxChars = fimContextChars || 500;
      const prefix = fullPrefix.length > ctxChars ? fullPrefix.slice(-ctxChars) : fullPrefix;
      const suffix = fullSuffix.length > ctxChars ? fullSuffix.slice(0, ctxChars) : fullSuffix;

      // Dedup: don't re-request at the same position with same content
      const posKey = `${activeTab?.filePath}:${pos}:${fullPrefix.length}`;
      if (posKey === lastRequestedPos.current) return;
      lastRequestedPos.current = posKey;

      // Track this request to discard stale responses
      const thisRequest = ++requestId.current;

      try {
        let completion: string;

        if (connection?.authMethod === 'local') {
          // Ollama — native FIM endpoint
          completion = await tauriApi.ollamaFimCompletion(prefix, suffix, model, ollamaUrl);
        } else if (connection?.authMethod === 'local_bundled') {
          // Local AI — completions on bundled server (FIM with fallback)
          completion = await tauriApi.localBundledFimCompletion(prefix, suffix, model);
        } else if (baseUrl && model) {
          // OpenAI-compatible — generic completions endpoint
          completion = await tauriApi.openaiCompatibleFimCompletion(baseUrl, connectionId, model, prefix, suffix);
        } else {
          return;
        }

        // Success — reset error counter
        consecutiveErrors.current = 0;

        log.debug('local-completion', `Got completion: ${JSON.stringify(completion).slice(0, 100)}`);

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

        // Ensure proper spacing: if cursor is after a non-space character and
        // the completion doesn't start with space/punctuation, prepend a space.
        let text = trimmed;
        if (currentPos > 0) {
          const charBefore = doc.textBetween(currentPos - 1, currentPos);
          const needsSpace =
            charBefore && !/\s/.test(charBefore) &&
            !/^[\s.,;:!?'")\]}>\/\-]/.test(text);
          if (needsSpace) {
            text = ' ' + text;
          }
        }

        setGhostText(editor, {
          text,
          from: currentPos,
          to: currentPos,
        });
      } catch (err) {
        consecutiveErrors.current++;
        if (consecutiveErrors.current <= 3) {
          log.warn('local-completion', `Completion error (${consecutiveErrors.current}/5)`, err);
        }
      }
    },
    [editor, isActive, useSettingsStore.getState().inlineCompletionsDisabled, activeTab?.filePath, model, ollamaUrl, baseUrl, connectionId, connection?.authMethod, fimContextChars]
  );

  // -------------------------------------------------------------------------
  // Listen for editor updates and debounce completion requests
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!editor || !isActive) return;

    const handleUpdate = () => {
      if (!activeTab) return;

      // Skip completion request if disabled for this tab
      if (useSettingsStore.getState().inlineCompletionsDisabled) return;

      // Debounce: 300ms after typing stops
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
  }, [editor, isActive, activeTab?.filePath, useSettingsStore.getState().inlineCompletionsDisabled, requestCompletion]);

  // -------------------------------------------------------------------------
  // Clear ghost text when completions are disabled for the active tab
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (editor && useSettingsStore.getState().inlineCompletionsDisabled && hasActiveGhostText(editor)) {
      clearGhostText(editor);
    }
  }, [editor, useSettingsStore.getState().inlineCompletionsDisabled]);

  // -------------------------------------------------------------------------
  // Clear ghost text on tab switch
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (editor && hasActiveGhostText(editor)) {
      clearGhostText(editor);
    }
    // Reset dedup key and error counter on tab switch
    lastRequestedPos.current = null;
    consecutiveErrors.current = 0;
  }, [editor, activeTabId]);
}
