import { useEffect, useRef, useCallback, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { log } from '@/lib/logger';
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
  const rawConnection = useRoutingStore((s) => s.getConnectionForUseCase('inline_completion'));
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const projects = useWorkspaceStore((s) => s.projects);

  // Only activate for agent_managed connections (Copilot LSP).
  // Non-LSP providers (e.g., Ollama local) use their own hooks.
  const connection = rawConnection?.authMethod === 'agent_managed' ? rawConnection : null;

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const workingDir = projects[0]?.path ?? null;

  // lspReady as state so dependent effects re-run when it changes
  const [lspReady, setLspReady] = useState(false);
  const openDocUri = useRef<string | null>(null);
  const docVersion = useRef(0);
  const completionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestedPos = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // LSP lifecycle: start/stop based on connection + working directory
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    if (!connection || !workingDir) {
      // No connection configured — stop LSP if running
      if (lspReady) {
        invoke('copilot_lsp_stop').catch(() => {});
        setLspReady(false);
      }
      return;
    }

    // Start LSP
    if (!lspReady) {
      // Reset doc tracking — new LSP session has no open documents
      openDocUri.current = null;
      docVersion.current = 0;

      invoke('copilot_lsp_start', { workingDirectory: workingDir })
        .then(() => {
          if (!cancelled) {
            setLspReady(true);
          }
        })
        .catch((err) => {
          log.error('copilot', 'Failed to start LSP', err);
        });
    }

    return () => {
      cancelled = true;
      if (lspReady) {
        invoke('copilot_lsp_stop').catch(() => {});
        setLspReady(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.id, workingDir]);

  // -------------------------------------------------------------------------
  // Document sync: didOpen/didClose/didFocus on tab changes
  // (Skipped in source mode — useCopilotCompletionCM handles its own sync)
  // -------------------------------------------------------------------------

  const isSourceMode = activeTab?.viewMode === 'source';

  useEffect(() => {
    if (!lspReady || !activeTab) return;

    // In source mode, the CM hook manages document sync.
    // Close our tracked document so the CM hook can open it with raw markdown.
    if (isSourceMode) {
      if (openDocUri.current) {
        invoke('copilot_lsp_did_close', { uri: openDocUri.current }).catch(() => {});
        openDocUri.current = null;
      }
      return;
    }

    const uri = activeTab.filePath;

    // Close previous document if different
    if (openDocUri.current && openDocUri.current !== uri) {
      invoke('copilot_lsp_did_close', { uri: openDocUri.current }).catch(() => {});
    }

    // Open new document — send ProseMirror plain text so positions match.
    // Also re-open when returning from source mode (openDocUri.current is null).
    if (openDocUri.current !== uri) {
      docVersion.current = 0;
      const content = editor
        ? editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n')
        : activeTab.content ?? '';
      invoke('copilot_lsp_did_open', {
        uri,
        content,
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
  }, [lspReady, activeTab?.filePath, isSourceMode, editor]);

  // Cleanup: close doc on unmount
  useEffect(() => {
    return () => {
      if (openDocUri.current) {
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
      if (!editor || !lspReady) return;

      // Don't request if completions disabled for this tab
      if (activeTab?.copilotDisabled) return;

      // Don't request if selection is not collapsed, or inline diff is active
      const { selection } = editor.state;
      if (!selection.empty) return;
      if (hasActiveInlineDiff(editor)) return;

      // Calculate line/character from the same text sent to the LSP via didChange.
      // We use ProseMirror's textContent (plain text with \n separators) as the
      // document content, so textBetween(0, pos) gives consistent positions.
      const pos = selection.$from.pos;
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
          const currentPos = editor.state.selection.$from.pos;

          // The LSP returns a range + full replacement text. Strip the prefix
          // that's already typed so we only show the NEW text as ghost text.
          let ghostText = item.insert_text;
          if (item.range) {
            // Characters from range.start to cursor are already in the document
            const alreadyTypedLen = character - item.range.start.character;
            if (alreadyTypedLen > 0 && alreadyTypedLen < ghostText.length) {
              ghostText = ghostText.slice(alreadyTypedLen);
            }
          }

          // Skip if nothing new to show
          if (!ghostText) {
            if (hasActiveGhostText(editor)) clearGhostText(editor);
            return;
          }

          setGhostText(editor, {
            text: ghostText,
            from: currentPos,
            to: currentPos,
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
        // Silently ignore completion errors
      }
    },
    [editor, lspReady, activeTab?.copilotDisabled]
  );

  useEffect(() => {
    if (!editor || !connection || !lspReady || isSourceMode) return;

    const handleUpdate = () => {
      if (!activeTab || !openDocUri.current) return;

      // Ensure document is opened before sending changes
      if (openDocUri.current !== activeTab.filePath) return;

      // Send didChange — use ProseMirror plain text so positions match
      docVersion.current += 1;
      const content = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');
      invoke('copilot_lsp_did_change', {
        uri: activeTab.filePath,
        content,
        version: docVersion.current,
      }).catch(() => {});

      // Skip completion request if disabled for this tab
      if (activeTab.copilotDisabled) return;

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
  }, [editor, connection?.id, lspReady, isSourceMode, activeTab?.filePath, requestCompletion]);

  // -------------------------------------------------------------------------
  // Clear ghost text when completions are disabled for the active tab
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (editor && activeTab?.copilotDisabled && hasActiveGhostText(editor)) {
      clearGhostText(editor);
    }
  }, [editor, activeTab?.copilotDisabled]);

  // -------------------------------------------------------------------------
  // Accept tracking: when ghost text is accepted via Tab, notify LSP
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!editor || !connection) return;

    const handleTransaction = ({ transaction }: { transaction: unknown }) => {
      const tr = transaction as { getMeta: (key: unknown) => unknown };
      const meta = tr.getMeta(GhostTextPluginKey) as { ghostTextAccept?: boolean } | undefined;
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
      const { kind, message } = event.payload;
      if (kind === 'Error') {
        log.error('copilot', 'Status error', { kind, message });
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [connection?.id]);
}
