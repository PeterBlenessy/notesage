import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { GitBranch, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  acceptAllDiffHunks,
  rejectAllDiffHunks,
  getInlineDiffHunks,
  hasActiveInlineDiff,
} from "@/components/editor/extensions";

interface DiffReviewBannerProps {
  editor: Editor;
  branchName: string;
  /** Called after Accept All is applied */
  onAcceptAll?: () => void;
  /** Called after Reject All is applied */
  onRejectAll?: () => void;
}

export function DiffReviewBanner({
  editor,
  branchName,
  onAcceptAll,
  onRejectAll,
}: DiffReviewBannerProps) {
  const [hunkCount, setHunkCount] = useState(0);
  const [visible, setVisible] = useState(false);

  // Track hunk count from the editor's inline diff state
  useEffect(() => {
    const updateCount = () => {
      const active = hasActiveInlineDiff(editor);
      const hunks = getInlineDiffHunks(editor);
      setHunkCount(hunks.length);
      setVisible(active && hunks.length > 0);
    };

    // Initial check
    updateCount();

    // Listen for editor state changes (transactions)
    editor.on("transaction", updateCount);
    return () => {
      editor.off("transaction", updateCount);
    };
  }, [editor]);

  const handleAcceptAll = () => {
    acceptAllDiffHunks(editor);
    onAcceptAll?.();
  };

  const handleRejectAll = () => {
    rejectAllDiffHunks(editor);
    onRejectAll?.();
  };

  return (
    <div
      className="overflow-hidden transition-all duration-200 ease-in-out"
      style={{
        maxHeight: visible ? "48px" : "0px",
        opacity: visible ? 1 : 0,
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{
          backgroundColor: "var(--color-muted)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-foreground)" }}>
          <GitBranch className="h-4 w-4" style={{ color: "var(--color-muted-foreground)" }} strokeWidth={1.5} />
          <span>
            Reviewing changes from{" "}
            <span className="font-medium">&ldquo;{branchName}&rdquo;</span>
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: "var(--color-background)",
              color: "var(--color-muted-foreground)",
            }}
          >
            {hunkCount} {hunkCount === 1 ? "change" : "changes"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="xs" onClick={handleRejectAll}>
            <X className="h-3 w-3" strokeWidth={2} />
            Reject All
          </Button>
          <Button variant="default" size="xs" onClick={handleAcceptAll}>
            <Check className="h-3 w-3" strokeWidth={2} />
            Accept All
          </Button>
        </div>
      </div>
    </div>
  );
}
