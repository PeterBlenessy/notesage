import { useEffect, useRef, useCallback, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { log } from '@/lib/logger';
import { useRoutingStore } from '@/stores/routing-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import {
  setGhostText,
  clearGhostText,
  hasActiveGhostText,
  hasActiveInlineDiff,
  GhostTextPluginKey,
} from '@/components/editor/extensions';
import { requestCopilotCompletion, notifyCompletionAccepted } from '@/lib/copilot-shared';
import { isUriInScope, type UriScope } from '@/lib/ai/uri-scope';

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
  const openDocuments = useEditorStore((s) => s.openDocuments);
  const projects = useWorkspaceStore((s) => s.projects);

  // Only activate for agent_managed connections (Copilot LSP).
  // Non-LSP providers (e.g., Ollama local) use their own hooks.
  const connection = rawConnection?.authMethod === 'agent_managed' ? rawConnection : null;

  const activeTab = openDocuments.find((t) => t.id === activeTabId);
  // Working directory for the LSP must reflect the chat footer's project
  // selection (Track 1 isolation — task #15). Falling back to the first
  // workspace folder only when no conversation is active keeps the LSP
  // bootable before any chat is opened.
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const workingDir = selectedProjectPaths[0] ?? projects[0]?.path ?? null;

  // lspReady as state so dependent effects re-run when it changes
  const [lspReady, setLspReady] = useState(false);
  const openDocUri = useRef<string | null>(null);
  const docVersion = useRef(0);
  const completionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestedPos = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // LSP lifecycle: start/stop based on connection + working directory
  // All LSP invoke().catch(() => {}) calls below are fire-and-forget
  // notifications — failures are expected when LSP is not running or
  // shutting down, and are harmless (no data loss, no user impact).
  // -------------------------------------------------------------------------

  // Track the last workingDir we sent to the LSP so we can detect changes
  // and notify via `workspace/didChangeWorkspaceFolders`. The backend's
  // `copilot_lsp_start` is idempotent: calling it again with a new
  // directory emits the notification rather than restarting the process.
  const sentWorkingDir = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!connection || !workingDir) {
      // No connection configured — stop LSP if running
      if (lspReady) {
        invoke('copilot_lsp_stop').catch(() => {});
        setLspReady(false);
        sentWorkingDir.current = null;
      }
      return;
    }

    // Start LSP — or, if already running, notify of workspace folder change.
    // Task #15 (Track 1 isolation): the working directory must follow the
    // chat footer's project selection. When the selection changes while the
    // LSP is up, we re-invoke `copilot_lsp_start` so the backend emits
    // `workspace/didChangeWorkspaceFolders`.
    if (!lspReady) {
      // Reset doc tracking — new LSP session has no open documents
      openDocUri.current = null;
      docVersion.current = 0;

      invoke('copilot_lsp_start', { workingDirectory: workingDir })
        .then(() => {
          if (!cancelled) {
            sentWorkingDir.current = workingDir;
            setLspReady(true);
          }
        })
        .catch((err) => {
          log.error('copilot', 'Failed to start LSP', err);
        });
    } else if (sentWorkingDir.current !== workingDir) {
      sentWorkingDir.current = workingDir;
      invoke('copilot_lsp_start', { workingDirectory: workingDir }).catch((err) => {
        log.error('copilot', 'Failed to update LSP workspace folder', err);
      });
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.id, workingDir, lspReady]);

  // Stop the LSP when the connection changes or the hook unmounts.
  // Pulled out of the start effect so a working-directory change does NOT
  // trigger a stop — the backend handles folder updates in-place.
  useEffect(() => {
    if (!connection) return;
    return () => {
      invoke('copilot_lsp_stop').catch(() => {});
      setLspReady(false);
      sentWorkingDir.current = null;
    };
  }, [connection?.id]);

  // -------------------------------------------------------------------------
  // Document sync: didOpen/didClose/didFocus on tab changes
  // (Skipped in source mode — useCopilotCompletionCM handles its own sync)
  // -------------------------------------------------------------------------

  // Task #16 — URI scope gate. didOpen/didChange/didFocus for tabs OUTSIDE
  // the selected projects (+ notes root) must produce NO LSP traffic — that
  // content is not the agent's to see. `notesRootPath` is included because
  // the user's personal notes library is a legitimate workspace location.
  //
  // Task #17 extends this with the `completionsOnOutOfScope` escape hatch:
  // users who want the pre-isolation behaviour back can flip a single
  // setting and the gate becomes a no-op.
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const homeDir = useSettingsStore((s) => s.homeDir);
  const completionsOnOutOfScope = useSettingsStore((s) => s.completionsOnOutOfScope);
  const resolvedNotesRoot =
    notesRootPath && notesRootPath.startsWith('~')
      ? homeDir
        ? notesRootPath.replace('~', homeDir)
        : null
      : notesRootPath || null;
  const scope: UriScope = {
    projectRoots: selectedProjectPaths,
    notesRootPath: resolvedNotesRoot,
  };
  const uriAllowed = (uri: string): boolean =>
    completionsOnOutOfScope || isUriInScope(uri, scope);

  // Once-per-session toast suppression. Live-test 2026-04-26 — the previous
  // per-tab Set was too chatty: every restored tab on cold start, every
  // tab-switch back to an out-of-scope file, and every reload re-fired the
  // toast. The user's complaint is the WITHIN-SESSION repeat, so we collapse
  // the dedup to a single boolean and re-arm only when the relevant inputs
  // change (scope or the `completionsOnOutOfScope` setting). A stable sonner
  // id is preserved as belt-and-suspenders so any race that bypasses the
  // dedup still collapses visually.
  const hasShownOutOfScopeToast = useRef(false);

  const notifyOutOfScope = useCallback(() => {
    if (hasShownOutOfScopeToast.current) return;
    hasShownOutOfScopeToast.current = true;
    toast.info('Completions disabled for this file — outside selected project scope', {
      id: 'copilot-scope-out-of-scope',
    });
  }, []);

  // Re-arm the once-per-session toast when the inputs that determine scope
  // change. A user who flips `completionsOnOutOfScope` or changes the
  // selected project paths in the chat footer should see the toast again
  // the next time they activate an out-of-scope tab — the new scope is a
  // fresh decision worth surfacing once.
  useEffect(() => {
    hasShownOutOfScopeToast.current = false;
  }, [completionsOnOutOfScope, selectedProjectPaths, resolvedNotesRoot]);

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

    // Close previous document if different. We ALWAYS close the previously
    // tracked URI even if the new URI is out of scope — the LSP otherwise
    // keeps stale content from a prior in-scope tab.
    if (openDocUri.current && openDocUri.current !== uri) {
      invoke('copilot_lsp_did_close', { uri: openDocUri.current }).catch(() => {});
      openDocUri.current = null;
    }

    // Task #16 scope gate — no LSP traffic for out-of-scope tabs.
    // Task #17 — the `completionsOnOutOfScope` setting bypasses this gate
    // (legacy behaviour). Gate short-circuits via `uriAllowed`.
    if (!uriAllowed(uri)) {
      notifyOutOfScope();
      // Also clear any stale ghost text — a leftover decoration from a
      // previous in-scope tab must not linger on the blocked one.
      if (editor && hasActiveGhostText(editor)) {
        clearGhostText(editor);
      }
      return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lspReady, activeTab?.filePath, isSourceMode, editor, selectedProjectPaths, resolvedNotesRoot, completionsOnOutOfScope]);

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
      if (useSettingsStore.getState().inlineCompletionsDisabled) return;

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
        const result = await requestCopilotCompletion(filePath, line, character, version);

        // The editor state may have changed while we were waiting
        if (!editor.isFocused || editor.isDestroyed) return;

        if (result) {
          const currentPos = editor.state.selection.$from.pos;
          setGhostText(editor, {
            text: result.text,
            from: currentPos,
            to: currentPos,
            command: result.command,
          });
        } else {
          if (hasActiveGhostText(editor)) {
            clearGhostText(editor);
          }
        }
      } catch {
        // Expected: completion requests may fail when LSP is restarting or document changed
      }
    },
    [editor, lspReady, useSettingsStore.getState().inlineCompletionsDisabled]
  );

  useEffect(() => {
    if (!editor || !connection || !lspReady || isSourceMode) return;

    const handleUpdate = () => {
      if (!activeTab || !openDocUri.current) return;

      // Ensure document is opened before sending changes
      if (openDocUri.current !== activeTab.filePath) return;

      // Task #16 scope gate — belt-and-suspenders. The didOpen gate above
      // is the primary enforcement (no in-scope didOpen → openDocUri stays
      // null → handleUpdate returns early on the check above). This check
      // covers the rare race where an in-flight tab's scope changed since
      // didOpen was sent. Task #17 — `completionsOnOutOfScope` restores the
      // legacy behaviour via `uriAllowed`.
      if (!uriAllowed(activeTab.filePath)) {
        return;
      }

      // Send didChange — use ProseMirror plain text so positions match
      docVersion.current += 1;
      const content = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');
      const changeVersion = docVersion.current;
      const changePromise = invoke('copilot_lsp_did_change', {
        uri: activeTab.filePath,
        content,
        version: changeVersion,
      }).catch(() => {});

      // Skip completion request if disabled for this tab
      if (useSettingsStore.getState().inlineCompletionsDisabled) return;

      // Debounce completion request: wait 150ms after typing stops.
      // Await didChange completion before requesting to avoid stale document version.
      if (completionTimeout.current) {
        clearTimeout(completionTimeout.current);
      }
      completionTimeout.current = setTimeout(async () => {
        await changePromise;
        requestCompletion(activeTab.filePath, changeVersion);
      }, 150);
    };

    editor.on('update', handleUpdate);

    return () => {
      editor.off('update', handleUpdate);
      if (completionTimeout.current) {
        clearTimeout(completionTimeout.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, connection?.id, lspReady, isSourceMode, activeTab?.filePath, requestCompletion, selectedProjectPaths, resolvedNotesRoot, completionsOnOutOfScope]);

  // -------------------------------------------------------------------------
  // Clear ghost text when completions are disabled for the active tab
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (editor && useSettingsStore.getState().inlineCompletionsDisabled && hasActiveGhostText(editor)) {
      clearGhostText(editor);
    }
  }, [editor, useSettingsStore.getState().inlineCompletionsDisabled]);

  // -------------------------------------------------------------------------
  // Accept tracking: when ghost text is accepted via Tab, notify LSP
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!editor || !connection) return;

    const handleTransaction = ({ transaction }: { transaction: unknown }) => {
      const tr = transaction as { getMeta: (key: unknown) => unknown };
      const meta = tr.getMeta(GhostTextPluginKey) as { ghostTextAccept?: boolean } | undefined;
      if (meta?.ghostTextAccept) {
        const state = GhostTextPluginKey.getState(editor.state);
        const command = state?.completion?.command;
        if (command) {
          notifyCompletionAccepted(command);
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

    let mounted = true;
    let unlistenFn: (() => void) | null = null;

    listen<{ message: string; kind: string }>('copilot-status-changed', (event) => {
      const { kind, message } = event.payload;
      if (kind === 'Error') {
        log.error('copilot', 'Status error', { kind, message });
      }
    }).then((fn) => {
      if (mounted) {
        unlistenFn = fn;
      } else {
        fn();
      }
    });

    return () => {
      mounted = false;
      unlistenFn?.();
    };
  }, [connection?.id]);
}
