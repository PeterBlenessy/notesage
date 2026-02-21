import { useEffect, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useRoutingStore } from '@/stores/routing-store';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import {
  setGhostText,
  clearGhostText,
  hasActiveGhostText,
  hasActiveInlineDiff,
  GhostTextPluginKey,
} from '@/components/editor/extensions';
import { getMarkdownFromEditor } from '@/lib/markdown';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InlineCompletionItem {
  insert_text: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  command?: { command: string; arguments?: unknown[] };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the Copilot Language Server lifecycle and ghost text completions.
 *
 * - Spawns/stops the LSP based on the `inline_completion` routing slot
 * - Syncs the active document with the LSP (didOpen/didChange/didClose/didFocus)
 * - Requests completions on typing pauses and renders ghost text
 */
export function useCopilotCompletion(editor: Editor | null) {
  const connection = useRoutingStore((s) => s.getConnectionForUseCase('inline_completion'));
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const projects = useWorkspaceStore((s) => s.projects);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const workingDir = projects[0]?.path ?? null;

  // Refs for tracking state across renders without re-triggering effects
  const lspStarted = useRef(false);
  const openDocUri = useRef<string | null>(null);
  const docVersion = useRef(0);
  const completionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestedPos = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // LSP lifecycle: start/stop based on connection + working directory
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!connection || !workingDir) {
      // No connection configured — stop LSP if running
      if (lspStarted.current) {
        invoke('copilot_lsp_stop').catch(() => {});
        lspStarted.current = false;
      }
      return;
    }

    // Start LSP
    if (!lspStarted.current) {
      invoke('copilot_lsp_start', { workingDirectory: workingDir })
        .then(() => {
          lspStarted.current = true;
        })
        .catch((err) => {
          console.error('[copilot] Failed to start LSP:', err);
        });
    }

    return () => {
      if (lspStarted.current) {
        invoke('copilot_lsp_stop').catch(() => {});
        lspStarted.current = false;
      }
    };
  }, [connection?.id, workingDir]);

  // -------------------------------------------------------------------------
  // Document sync: didOpen/didClose/didFocus on tab changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!lspStarted.current || !activeTab) return;

    const uri = activeTab.filePath;

    // Close previous document if different
    if (openDocUri.current && openDocUri.current !== uri) {
      invoke('copilot_lsp_did_close', { uri: openDocUri.current }).catch(() => {});
    }

    // Open new document
    if (openDocUri.current !== uri) {
      docVersion.current = 0;
      invoke('copilot_lsp_did_open', {
        uri,
        content: activeTab.content ?? '',
        version: docVersion.current,
      }).catch(() => {});
      openDocUri.current = uri;
    }

    // Focus
    invoke('copilot_lsp_did_focus', { uri }).catch(() => {});

    // Clear any stale ghost text on tab switch
    if (editor && hasActiveGhostText(editor)) {
      clearGhostText(editor);
    }
  }, [activeTab?.filePath, editor]);

  // Cleanup: close doc on unmount
  useEffect(() => {
    return () => {
      if (openDocUri.current && lspStarted.current) {
        invoke('copilot_lsp_did_close', { uri: openDocUri.current }).catch(() => {});
        openDocUri.current = null;
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // Document sync: didChange on content updates + completion requests
  // -------------------------------------------------------------------------

  const requestCompletion = useCallback(
    async (filePath: string, version: number) => {
      if (!editor || !lspStarted.current) return;

      // Don't request if selection is not collapsed, or inline diff is active
      const { selection } = editor.state;
      if (!selection.empty) return;
      if (hasActiveInlineDiff(editor)) return;

      // Convert ProseMirror position to line/character
      const pos = selection.$from.pos;
      // Convert PM position to line/character for the LSP
      const text = editor.state.doc.textBetween(0, pos, '\n');
      const lines = text.split('\n');
      const line = lines.length - 1;
      const character = lines[lines.length - 1].length;

      // Dedup: don't re-request at the same position
      const posKey = `${filePath}:${version}:${line}:${character}`;
      if (posKey === lastRequestedPos.current) return;
      lastRequestedPos.current = posKey;

      try {
        const items = await invoke<InlineCompletionItem[]>('copilot_lsp_request_completion', {
          uri: filePath,
          line,
          character,
          version,
        });

        // The editor state may have changed while we were waiting
        if (!editor.isFocused || editor.isDestroyed) return;

        if (items && items.length > 0) {
          const item = items[0];
          setGhostText(editor, {
            text: item.insert_text,
            from: pos,
            to: pos,
            command: item.command ? {
              command: item.command.command,
              arguments: item.command.arguments ?? undefined,
            } : undefined,
          });

          // Notify LSP the completion was shown
          invoke('copilot_lsp_did_show_completion', {
            item: {
              insertText: item.insert_text,
              range: item.range,
              command: item.command,
            },
          }).catch(() => {});
        } else {
          // No completions — clear any stale ghost text
          if (hasActiveGhostText(editor)) {
            clearGhostText(editor);
          }
        }
      } catch {
        // Silently ignore completion errors (e.g., cancelled, LSP busy)
      }
    },
    [editor]
  );

  useEffect(() => {
    if (!editor || !connection || !lspStarted.current) return;

    const handleUpdate = () => {
      if (!activeTab || !openDocUri.current) return;

      // Send didChange
      docVersion.current += 1;
      const content = getMarkdownFromEditor(editor);
      invoke('copilot_lsp_did_change', {
        uri: activeTab.filePath,
        content,
        version: docVersion.current,
      }).catch(() => {});

      // Debounce completion request: wait 150ms after typing stops
      if (completionTimeout.current) {
        clearTimeout(completionTimeout.current);
      }
      completionTimeout.current = setTimeout(() => {
        requestCompletion(activeTab.filePath, docVersion.current);
      }, 150);
    };

    editor.on('update', handleUpdate);

    return () => {
      editor.off('update', handleUpdate);
      if (completionTimeout.current) {
        clearTimeout(completionTimeout.current);
      }
    };
  }, [editor, connection?.id, activeTab?.filePath, requestCompletion]);

  // -------------------------------------------------------------------------
  // Accept tracking: when ghost text is accepted via Tab, notify LSP
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!editor || !connection) return;

    const handleTransaction = ({ transaction }: { transaction: any }) => {
      const meta = transaction.getMeta(GhostTextPluginKey);
      if (meta?.ghostTextAccept) {
        // The ghost text was accepted — find the command to track acceptance
        const state = GhostTextPluginKey.getState(editor.state);
        const command = state?.completion?.command;
        if (command) {
          invoke('copilot_lsp_accept_completion', {
            command: command.command,
            arguments: command.arguments ?? [],
          }).catch(() => {});
        }
      }
    };

    editor.on('transaction', handleTransaction);
    return () => {
      editor.off('transaction', handleTransaction);
    };
  }, [editor, connection?.id]);

  // -------------------------------------------------------------------------
  // Listen for status changes (for future UI indicators)
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!connection) return;

    const unlisten = listen<{ message: string; kind: string }>('copilot-status-changed', (event) => {
      // Future: update a status store or show toast
      const { message, kind } = event.payload;
      if (kind === 'Error') {
        console.error('[copilot] Status error:', message);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [connection?.id]);
}
