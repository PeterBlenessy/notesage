import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useEditorStore } from "@/stores/editor-store";
import { buildLineMap, getPositionRangeForLines } from "@/lib/pm-line-map";
import { getMarkdownFromEditor } from "@/lib/markdown";
import {
  showInlineDiff,
  clearInlineDiff,
  type InlineDiffHunk,
} from "@/components/editor/extensions";
import type { DiffHunk } from "@/lib/tauri";

/**
 * Convert git DiffHunks to InlineDiffHunks using the line-to-PM position mapping.
 *
 * Each git DiffHunk has old_start/old_lines (the range in the base/current file)
 * and delete_text/insert_text. We map old_start..old_start+old_lines to PM positions.
 *
 * For pure insertions (old_lines=0), we use the position just before new_start
 * to anchor the widget.
 */
function mapHunksToPM(
  hunks: DiffHunk[],
  lineMap: Map<number, { pmFrom: number; pmTo: number }>,
  docSize: number,
): InlineDiffHunk[] {
  const result: InlineDiffHunk[] = [];

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i];

    if (hunk.old_lines > 0) {
      // Deletion or replacement: map the old line range to PM positions
      const endLine = hunk.old_start + hunk.old_lines - 1;
      const range = getPositionRangeForLines(lineMap, hunk.old_start, endLine);
      if (!range) continue;

      result.push({
        id: `hunk-${i}`,
        from: range.pmFrom,
        to: range.pmTo,
        deleteText: hunk.delete_text,
        insertText: hunk.insert_text,
      });
    } else {
      // Pure insertion: anchor at the position of the line before or after
      // old_start is where the insertion happens (line number in base file)
      const anchorLine = hunk.old_start > 0 ? hunk.old_start : 1;
      const mapping = lineMap.get(anchorLine);
      // If the anchor line isn't in the map, try nearby lines
      const pos = mapping ? mapping.pmTo : (anchorLine > 1 ? docSize - 1 : 1);

      result.push({
        id: `hunk-${i}`,
        from: pos,
        to: pos,
        deleteText: "",
        insertText: hunk.insert_text,
      });
    }
  }

  return result;
}

/**
 * Hook that orchestrates the full diff review flow:
 * 1. User picks a branch → startReview loads diffs
 * 2. When a changed file is active, decorations are shown
 * 3. Accept/reject updates store and saves file
 * 4. endReview clears everything
 */
export function useDiffReview(editor: Editor | null) {
  const { reviewActive, compareBranch, changedFiles, endReview, resolveHunk } =
    useDiffReviewStore();
  const { saveFile } = useFileOperations();
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Track which file we last applied decorations for, to avoid re-applying
  const lastDecoratedFile = useRef<string | null>(null);

  // Get the relative path of the active file within the repo
  // The diff store uses relative paths from git (e.g., "src/foo.md")
  // while tabs use absolute paths
  const getRelativePath = useCallback(
    (absolutePath: string): string | null => {
      // Find a matching changed file by checking if the absolute path ends with the relative path
      for (const fd of changedFiles) {
        if (absolutePath.endsWith(fd.filePath) || absolutePath.endsWith(`/${fd.filePath}`)) {
          return fd.filePath;
        }
      }
      return null;
    },
    [changedFiles]
  );

  // Apply inline diff decorations when a changed file becomes active
  useEffect(() => {
    if (!editor || !reviewActive || !activeTab) {
      if (editor && lastDecoratedFile.current) {
        clearInlineDiff(editor);
        lastDecoratedFile.current = null;
      }
      return;
    }

    const relPath = getRelativePath(activeTab.filePath);
    if (!relPath) {
      // Active file has no diffs — clear any existing decorations
      if (lastDecoratedFile.current) {
        clearInlineDiff(editor);
        lastDecoratedFile.current = null;
      }
      return;
    }

    // Don't re-apply if we already decorated this file
    if (lastDecoratedFile.current === relPath) return;

    const fileDiff = useDiffReviewStore.getState().getFileDiff(relPath);
    if (!fileDiff || fileDiff.hunks.length === 0) {
      clearInlineDiff(editor);
      lastDecoratedFile.current = relPath;
      return;
    }

    // Only show unresolved hunks
    const unresolvedHunks = fileDiff.hunks.filter((_, idx) => fileDiff.resolved[idx] === null);
    if (unresolvedHunks.length === 0) {
      clearInlineDiff(editor);
      lastDecoratedFile.current = relPath;
      return;
    }

    // Build line map and convert hunks
    const lineMap = buildLineMap(editor);
    const docSize = editor.state.doc.content.size;
    const mappedHunks = mapHunksToPM(
      unresolvedHunks,
      lineMap,
      docSize,
    );

    if (mappedHunks.length > 0) {
      showInlineDiff(editor, mappedHunks);
    }

    lastDecoratedFile.current = relPath;
  }, [editor, reviewActive, activeTab?.filePath, activeTab?.id, getRelativePath]);

  // Clear decorations when review ends
  useEffect(() => {
    if (!reviewActive && editor && lastDecoratedFile.current) {
      clearInlineDiff(editor);
      lastDecoratedFile.current = null;
    }
  }, [reviewActive, editor]);

  // Handle accept all: save the modified content and mark hunks resolved
  const handleAcceptAll = useCallback(async () => {
    if (!editor || !activeTab) return;

    const relPath = getRelativePath(activeTab.filePath);
    if (!relPath) return;

    const fileDiff = useDiffReviewStore.getState().getFileDiff(relPath);
    if (!fileDiff) return;

    // Mark all hunks as accepted in the store
    fileDiff.hunks.forEach((_, idx) => {
      if (fileDiff.resolved[idx] === null) {
        resolveHunk(relPath, idx, "accept");
      }
    });

    // Save the modified content
    const markdown = getMarkdownFromEditor(editor);
    const { updateTabContent } = useEditorStore.getState();
    updateTabContent(activeTab.id, markdown, true);

    try {
      await saveFile(activeTab.filePath, markdown, activeTab.id);
    } catch (error) {
      console.error("Failed to save after accepting all:", error);
    }

    lastDecoratedFile.current = null;
  }, [editor, activeTab, getRelativePath, resolveHunk, saveFile]);

  // Handle reject all: clear decorations, mark hunks resolved
  const handleRejectAll = useCallback(() => {
    if (!editor || !activeTab) return;

    const relPath = getRelativePath(activeTab.filePath);
    if (!relPath) return;

    const fileDiff = useDiffReviewStore.getState().getFileDiff(relPath);
    if (!fileDiff) return;

    // Mark all hunks as rejected
    fileDiff.hunks.forEach((_, idx) => {
      if (fileDiff.resolved[idx] === null) {
        resolveHunk(relPath, idx, "reject");
      }
    });

    lastDecoratedFile.current = null;
  }, [editor, activeTab, getRelativePath, resolveHunk]);

  // Handle single hunk accept: save the modified content after the inline-diff extension applies it
  const handleHunkAccepted = useCallback(
    async (hunkId: string) => {
      if (!editor || !activeTab) return;

      const relPath = getRelativePath(activeTab.filePath);
      if (!relPath) return;

      // Find the hunk index from the id (format: "hunk-N")
      const idx = parseInt(hunkId.replace("hunk-", ""), 10);
      if (!isNaN(idx)) {
        resolveHunk(relPath, idx, "accept");
      }

      // Save the modified content
      const markdown = getMarkdownFromEditor(editor);
      const { updateTabContent } = useEditorStore.getState();
      updateTabContent(activeTab.id, markdown, true);

      try {
        await saveFile(activeTab.filePath, markdown, activeTab.id);
      } catch (error) {
        console.error("Failed to save after accepting hunk:", error);
      }
    },
    [editor, activeTab, getRelativePath, resolveHunk, saveFile]
  );

  // Handle single hunk reject
  const handleHunkRejected = useCallback(
    (hunkId: string) => {
      if (!activeTab) return;

      const relPath = getRelativePath(activeTab.filePath);
      if (!relPath) return;

      const idx = parseInt(hunkId.replace("hunk-", ""), 10);
      if (!isNaN(idx)) {
        resolveHunk(relPath, idx, "reject");
      }
    },
    [activeTab, getRelativePath, resolveHunk]
  );

  return {
    reviewActive,
    compareBranch,
    endReview,
    handleAcceptAll,
    handleRejectAll,
    handleHunkAccepted,
    handleHunkRejected,
  };
}
