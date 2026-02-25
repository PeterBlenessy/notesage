import { useEffect, useRef, useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { useRoutingStore } from "@/stores/routing-store";
import { useEditorStore } from "@/stores/editor-store";
import {
  setGhostTextCM,
  clearGhostTextCM,
  hasActiveGhostTextCM,
  ghostTextAcceptCallbackCM,
  type CMGhostTextCompletion,
} from "@/components/editor/codemirror-ghost-text";

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
 * Manages Copilot completions for the CodeMirror source editor.
 *
 * Shares the LSP process with `useCopilotCompletion` (which manages lifecycle).
 * This hook handles document sync and completions when source mode is active.
 */
export function useCopilotCompletionCM(cmView: EditorView | null) {
  const connection = useRoutingStore((s) =>
    s.getConnectionForUseCase("inline_completion"),
  );
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const openDocUri = useRef<string | null>(null);
  const docVersion = useRef(0);
  const completionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestedPos = useRef<string | null>(null);
  const lastContentRef = useRef<string | null>(null);

  const isSourceMode = activeTab?.viewMode === "source";
  const isActive = !!cmView && !!connection && isSourceMode;

  // -------------------------------------------------------------------------
  // Document sync: didOpen / didClose on tab or mode changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isActive || !activeTab || !cmView) return;

    const uri = activeTab.filePath;

    // Close previous document if switching tabs
    if (openDocUri.current && openDocUri.current !== uri) {
      invoke("copilot_lsp_did_close", { uri: openDocUri.current }).catch(
        () => {},
      );
    }

    // Always close then open to ensure clean state
    // (the LSP may have a stale version from WYSIWYG mode)
    invoke("copilot_lsp_did_close", { uri }).catch(() => {});

    docVersion.current = 0;
    const content = cmView.state.doc.toString();
    lastContentRef.current = content;
    invoke("copilot_lsp_did_open", {
      uri,
      content,
      version: docVersion.current,
    }).catch(() => {});
    openDocUri.current = uri;

    invoke("copilot_lsp_did_focus", { uri }).catch(() => {});

    // Clear stale ghost text on tab switch
    if (hasActiveGhostTextCM(cmView)) {
      clearGhostTextCM(cmView);
    }

    return () => {
      if (openDocUri.current) {
        invoke("copilot_lsp_did_close", { uri: openDocUri.current }).catch(
          () => {},
        );
        openDocUri.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, activeTab?.filePath]);

  // -------------------------------------------------------------------------
  // Completion request
  // -------------------------------------------------------------------------

  const requestCompletion = useCallback(
    async (filePath: string, version: number) => {
      if (!cmView || !isActive) return;
      if (activeTab?.copilotDisabled) return;

      const sel = cmView.state.selection.main;
      if (!sel.empty) return;

      // Get line/character from CodeMirror (LSP uses 0-indexed lines)
      const pos = sel.head;
      const line = cmView.state.doc.lineAt(pos);
      const lineNumber = line.number - 1;
      const character = pos - line.from;

      // Dedup: don't re-request at the same position
      const posKey = `${filePath}:${version}:${lineNumber}:${character}`;
      if (posKey === lastRequestedPos.current) return;
      lastRequestedPos.current = posKey;

      try {
        const items = await invoke<InlineCompletionItem[]>(
          "copilot_lsp_request_completion",
          { uri: filePath, line: lineNumber, character, version },
        );

        // Editor may have changed while awaiting
        if (!cmView.hasFocus) return;

        if (items && items.length > 0) {
          const item = items[0];

          // Strip already-typed prefix
          let ghostText = item.insert_text;
          if (item.range) {
            const alreadyTypedLen = character - item.range.start.character;
            if (alreadyTypedLen > 0 && alreadyTypedLen < ghostText.length) {
              ghostText = ghostText.slice(alreadyTypedLen);
            }
          }

          if (!ghostText) {
            if (hasActiveGhostTextCM(cmView)) clearGhostTextCM(cmView);
            return;
          }

          // Use current cursor position (may have changed during await)
          const currentPos = cmView.state.selection.main.head;
          setGhostTextCM(cmView, {
            text: ghostText,
            pos: currentPos,
            command: item.command
              ? {
                  command: item.command.command,
                  arguments: item.command.arguments ?? undefined,
                }
              : undefined,
          });

          // Notify LSP the completion was shown
          invoke("copilot_lsp_did_show_completion", {
            item: {
              insertText: item.insert_text,
              range: item.range,
              command: item.command,
            },
          }).catch(() => {});
        } else {
          if (hasActiveGhostTextCM(cmView)) {
            clearGhostTextCM(cmView);
          }
        }
      } catch {
        // Silently ignore completion errors
      }
    },
    [cmView, isActive, activeTab?.copilotDisabled],
  );

  // -------------------------------------------------------------------------
  // Document sync: didChange on content updates + completion scheduling
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isActive || !activeTab || !cmView) return;
    if (!openDocUri.current || openDocUri.current !== activeTab.filePath) return;

    // Skip if content hasn't actually changed (e.g. initial render after didOpen)
    if (activeTab.content === lastContentRef.current) return;
    lastContentRef.current = activeTab.content;

    docVersion.current += 1;
    const version = docVersion.current;
    invoke("copilot_lsp_did_change", {
      uri: activeTab.filePath,
      content: activeTab.content,
      version,
    }).catch(() => {});

    if (activeTab.copilotDisabled) return;

    if (completionTimeout.current) clearTimeout(completionTimeout.current);
    completionTimeout.current = setTimeout(() => {
      requestCompletion(activeTab.filePath, version);
    }, 150);

    return () => {
      if (completionTimeout.current) {
        clearTimeout(completionTimeout.current);
        completionTimeout.current = null;
      }
    };
    // Only re-run when content changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.content]);

  // -------------------------------------------------------------------------
  // Acceptance tracking: notify LSP when ghost text is accepted via Tab
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isActive || !connection) return;

    ghostTextAcceptCallbackCM.current = (
      completion: CMGhostTextCompletion,
    ) => {
      if (completion.command) {
        invoke("copilot_lsp_accept_completion", {
          command: completion.command.command,
          arguments: completion.command.arguments ?? [],
        }).catch(() => {});
      }
    };

    return () => {
      ghostTextAcceptCallbackCM.current = null;
    };
  }, [isActive, connection?.id]);

  // -------------------------------------------------------------------------
  // Clear ghost text when completions are disabled for the active tab
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (cmView && activeTab?.copilotDisabled && hasActiveGhostTextCM(cmView)) {
      clearGhostTextCM(cmView);
    }
  }, [cmView, activeTab?.copilotDisabled]);
}
