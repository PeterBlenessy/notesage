import { useEffect, useCallback, useRef, useState, useMemo, type MutableRefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorStateCache } from "@/lib/editor-state-cache";
import { useExternalChangeStore } from "@/stores/external-change-store";
import {
  showInlineDiff,
  clearInlineDiff,
  acceptAllDiffHunks,
  rejectAllDiffHunks,
  acceptDiffHunk,
  rejectDiffHunk,
  getInlineDiffHunks,
} from "@/components/editor/extensions";
import { mapExternalChangeToPM } from "@/lib/external-diff";
import { getMarkdownFromEditor, loadRawMarkdownIntoEditor } from "@/lib/markdown";
import { toastExternalChange, toastExternalReload } from "@/lib/notifications";

interface Tab {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  content: string;
}

interface UseFileWatcherIntegrationParams {
  editor: TiptapEditor | null;
  activeTab: Tab | null | undefined;
  cachedEditorStatesRef: MutableRefObject<EditorStateCache>;
  updateTabContent: (tabId: string, content: string, isDirty: boolean) => void;
  clearExternalChange: (filePath: string) => void;
  saveFile: (filePath: string, content: string, tabId: string) => Promise<unknown>;
  externalChanges: Record<string, string>;
}

export function useFileWatcherIntegration({
  editor,
  activeTab,
  cachedEditorStatesRef,
  updateTabContent,
  clearExternalChange,
  saveFile,
  externalChanges,
}: UseFileWatcherIntegrationParams) {
  // External change detection via editor-store
  const activeExternalContent = activeTab ? externalChanges[activeTab.filePath] : undefined;

  // "Review external diff" OFF (default): silent auto-reload + info toast for
  // both clean and dirty tabs. Users who want to protect in-memory edits turn
  // the setting ON (which routes through the external-change-store path below).
  useEffect(() => {
    if (!editor || !activeTab || activeExternalContent === undefined) return;

    cachedEditorStatesRef.current.delete(activeTab.filePath);
    loadRawMarkdownIntoEditor(editor, activeExternalContent);
    updateTabContent(activeTab.id, activeExternalContent, false);
    clearExternalChange(activeTab.filePath);
    toastExternalReload(activeTab.filePath);
  }, [editor, activeTab?.id, activeTab?.isDirty, activeExternalContent, updateTabContent, clearExternalChange, cachedEditorStatesRef]);

  // Listen for content refreshes from non-editor sources (e.g., actions dashboard task toggle).
  // These writes go through the backend and update Zustand, but ProseMirror needs an explicit push.
  useEffect(() => {
    if (!editor || !activeTab) return;
    const handler = (e: Event) => {
      const { filePath, content } = (e as CustomEvent).detail;
      if (!content) return;

      if (filePath === activeTab.filePath) {
        // Active tab: push content into ProseMirror immediately
        loadRawMarkdownIntoEditor(editor, content);
      } else {
        // Non-active tab: invalidate cached EditorState so the next tab switch
        // loads the fresh content from the store instead of the stale cached state.
        cachedEditorStatesRef.current.delete(filePath);
      }
    };
    window.addEventListener('notesage:refresh-editor-content', handler);
    return () => window.removeEventListener('notesage:refresh-editor-content', handler);
  }, [editor, activeTab?.filePath]);

  // External file change for a file whose ProseMirror EditorState is still
  // cached but whose tab has been evicted from `openDocuments` (Quiet
  // Composer single-doc shell). Drop the cached state so the next reopen
  // re-parses from the fresh on-disk content.
  useEffect(() => {
    const handler = (e: Event) => {
      const { filePath } = (e as CustomEvent).detail ?? {};
      if (filePath) cachedEditorStatesRef.current.delete(filePath);
    };
    window.addEventListener('notesage:invalidate-editor-state', handler);
    return () => window.removeEventListener('notesage:invalidate-editor-state', handler);
  }, [cachedEditorStatesRef]);

  // --- External change review (clean tabs) ---
  // Select the raw record and derive the array in a memo to avoid new-reference infinite loops
  const externalChangesRecord = useExternalChangeStore((s) => s.changes);
  const externalChangesAll = useMemo(() => Object.values(externalChangesRecord), [externalChangesRecord]);
  const activeExternalChange = activeTab ? externalChangesRecord[activeTab.filePath] : undefined;
  const [changeListOpen, setChangeListOpen] = useState(false);
  const lastExternalDecoratedFile = useRef<string | null>(null);

  // When a new external change arrives for the active tab, immediately show
  // inline diffs (red/green decorations) and a toast with Accept / Review.
  // On auto-dismiss the change defers to the status bar tracker.
  //
  // Uses rAF to ensure the editor content is loaded first — when switching tabs,
  // this effect may fire BEFORE the tab-switch effect loads the correct content.
  // Without rAF, mapExternalChangeToPM would diff the previous tab's content
  // against the new file, producing a giant incorrect diff.
  useEffect(() => {
    if (!editor || !activeTab || !activeExternalChange) return;
    if (activeExternalChange.status !== "pending") return;

    const filePath = activeTab.filePath;
    const tabId = activeTab.id;

    const rafId = requestAnimationFrame(() => {
      // Re-check: the change may have been resolved during the rAF delay
      const currentChange = useExternalChangeStore.getState().getChange(filePath);
      if (!currentChange || currentChange.status !== "pending") return;

      // Compute PM-level diff (this is the single source of truth for display)
      const pmHunks = mapExternalChangeToPM(editor, currentChange.newContent);

      if (pmHunks.length === 0) {
        // Content renders identically at PM level — silently accept the new markdown
        useExternalChangeStore.getState().resolveChange(filePath);
        updateTabContent(tabId, currentChange.newContent, false);
        return;
      }

      // Load decorations and sync store hunks to match PM-level hunks
      showInlineDiff(editor, pmHunks);
      lastExternalDecoratedFile.current = filePath;
      useExternalChangeStore.getState().setHunks(filePath, pmHunks.map(h => ({
        id: h.id,
        charFrom: h.from,
        charTo: h.to,
        deleteText: h.deleteText,
        insertText: h.insertText,
      })));

      // Set to deferred — decorations visible, no banner, tracked in status bar.
      // This prevents the effect from re-firing and is the default resting state.
      useExternalChangeStore.getState().setStatus(filePath, "deferred");

      // Sticky action toast: Accept reloads from disk, Reject keeps in-memory
      // version, Dismiss leaves decorations visible for per-hunk review.
      // Uses the shared helper in src/lib/notifications.ts.
      toastExternalChange({
        filePath,
        onAccept: () => {
          const change = useExternalChangeStore.getState().getChange(filePath);
          if (!change) return;
          // Nullify ref and resolve BEFORE dispatching the accept transaction.
          // acceptAllDiffHunks dispatches synchronously, which fires the sync
          // effect's onTransaction listener. Without this guard, the sync effect
          // would also resolve + save, causing a double-save race condition.
          lastExternalDecoratedFile.current = null;
          useExternalChangeStore.getState().resolveChange(filePath);
          acceptAllDiffHunks(editor);
          const markdown = getMarkdownFromEditor(editor);
          updateTabContent(tabId, markdown, true);
          saveFile(filePath, markdown, tabId).catch((err) =>
            console.error("Failed to save after accepting:", err)
          );
        },
        onReject: () => {
          const change = useExternalChangeStore.getState().getChange(filePath);
          if (!change) return;
          lastExternalDecoratedFile.current = null;
          useExternalChangeStore.getState().resolveChange(filePath);
          rejectAllDiffHunks(editor);
          // Persist the in-memory version back to disk so the watcher doesn't
          // re-detect the same mismatch in a loop.
          const markdown = getMarkdownFromEditor(editor);
          saveFile(filePath, markdown, tabId).catch((err) =>
            console.error("Failed to save after rejecting:", err)
          );
        },
        // onDismiss: no-op. Decorations remain visible so the user can
        // review and accept/reject individual hunks via the inline controls.
      });
    });

    return () => cancelAnimationFrame(rafId);
  }, [editor, activeTab?.filePath, activeExternalChange?.timestamp]);

  // Load/unload external change decorations when switching tabs or editor changes
  useEffect(() => {
    if (!editor || !activeTab) return;

    const change = useExternalChangeStore.getState().getChange(activeTab.filePath);

    // Clear decorations from the previous file
    if (lastExternalDecoratedFile.current && lastExternalDecoratedFile.current !== activeTab.filePath) {
      clearInlineDiff(editor);
      lastExternalDecoratedFile.current = null;
    }

    // Load decorations for the incoming tab if it has a pending change
    if (change && change.status !== "pending") {
      // Use rAF to ensure editor content is loaded first (tab-switch sets content synchronously)
      requestAnimationFrame(() => {
        const currentChange = useExternalChangeStore.getState().getChange(activeTab.filePath);
        if (!currentChange) return;
        const hunks = mapExternalChangeToPM(editor, currentChange.newContent);
        if (hunks.length > 0) {
          showInlineDiff(editor, hunks);
          lastExternalDecoratedFile.current = activeTab.filePath;
        }
      });
    }
  }, [editor, activeTab?.id]);

  // Handle accept all for external change review
  const handleExternalAcceptAll = useCallback(async () => {
    if (!editor || !activeTab) return;
    // Nullify ref and resolve BEFORE dispatching — prevents sync effect double-save
    lastExternalDecoratedFile.current = null;
    useExternalChangeStore.getState().resolveChange(activeTab.filePath);
    acceptAllDiffHunks(editor);
    const markdown = getMarkdownFromEditor(editor);
    updateTabContent(activeTab.id, markdown, true);
    try {
      await saveFile(activeTab.filePath, markdown, activeTab.id);
    } catch (error) {
      console.error("Failed to save after accepting external changes:", error);
    }
  }, [editor, activeTab, updateTabContent, saveFile]);

  // Handle reject all for external change review
  const handleExternalRejectAll = useCallback(() => {
    if (!editor || !activeTab) return;
    // Nullify ref and resolve BEFORE dispatching — prevents sync effect double-save
    lastExternalDecoratedFile.current = null;
    useExternalChangeStore.getState().resolveChange(activeTab.filePath);
    rejectAllDiffHunks(editor);
    // Save the old content to disk to overwrite the external change.
    // Without this, the file watcher would re-detect the mismatch in a loop.
    const markdown = getMarkdownFromEditor(editor);
    saveFile(activeTab.filePath, markdown, activeTab.id).catch((err) =>
      console.error("Failed to save after rejecting external changes:", err)
    );
  }, [editor, activeTab, saveFile]);

  // Handle per-hunk accept/reject from the ChangeListPopover.
  // Only works for the focused file (PM plugin dispatch).
  const handleExternalAcceptHunk = useCallback((hunkId: string) => {
    if (!editor || !activeTab) return;
    acceptDiffHunk(editor, hunkId);
  }, [editor, activeTab]);

  const handleExternalRejectHunk = useCallback((hunkId: string) => {
    if (!editor || !activeTab) return;
    rejectDiffHunk(editor, hunkId);
  }, [editor, activeTab]);

  // Sync: keep the external-change-store's hunks in sync with the InlineDiff
  // plugin state. When individual hunks are accepted/rejected via inline controls,
  // only the plugin state updates — this effect mirrors those changes to the store
  // so the ChangeListPopover stays accurate.
  //
  // When ALL hunks are resolved, resolves the change entry and saves.
  //
  // Guards against race conditions:
  // 1. Only fires if we previously loaded decorations for this specific file
  //    (prevents premature resolution before decorations exist)
  // 2. Only fires if the change status is not "pending"
  //    (prevents resolution during the window before the toast effect runs)
  useEffect(() => {
    if (!editor || !activeTab) return;
    const onTransaction = () => {
      const filePath = activeTab.filePath;
      // Guard: only process if we actually loaded decorations for this file
      if (lastExternalDecoratedFile.current !== filePath) return;
      const change = useExternalChangeStore.getState().getChange(filePath);
      if (!change || change.status === "pending") return;

      const pluginHunks = getInlineDiffHunks(editor);

      if (pluginHunks.length === 0) {
        // All hunks resolved — clean up and save
        lastExternalDecoratedFile.current = null;
        useExternalChangeStore.getState().resolveChange(filePath);
        const markdown = getMarkdownFromEditor(editor);
        updateTabContent(activeTab.id, markdown, true);
        saveFile(filePath, markdown, activeTab.id).catch((err) =>
          console.error("Failed to save after resolving all hunks:", err)
        );
      } else if (pluginHunks.length !== change.hunks.length) {
        // Some hunks resolved — update store to keep popover in sync
        useExternalChangeStore.getState().setHunks(filePath, pluginHunks.map(h => ({
          id: h.id,
          charFrom: h.from,
          charTo: h.to,
          deleteText: h.deleteText,
          insertText: h.insertText,
        })));
      }
    };
    editor.on('transaction', onTransaction);
    return () => { editor.off('transaction', onTransaction); };
  }, [editor, activeTab?.filePath, activeTab?.id, updateTabContent, saveFile]);

  return {
    externalChangesAll,
    activeExternalChange,
    changeListOpen,
    setChangeListOpen,
    lastExternalDecoratedFile,
    handleExternalAcceptAll,
    handleExternalRejectAll,
    handleExternalAcceptHunk,
    handleExternalRejectHunk,
  };
}
