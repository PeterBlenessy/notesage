import type { Editor } from "@tiptap/core";
import { GitBranch } from "lucide-react";
import { CommentListPopover } from "./CommentListPopover";
import type { Comment } from "@/stores/comment-store";

/** Format number with localized thousand separators (uses host locale). */
const fmt = new Intl.NumberFormat(navigator.languages as string[], { useGrouping: true });
function fmtNum(n: number): string {
  return fmt.format(n);
}

interface StatusBarProps {
  editor: Editor | null;
  maxWidth?: number;
  renderedWidth?: number | null;
  comments?: Comment[];
  branchName?: string;
  isGitRepo?: boolean;
  reviewActive?: boolean;
  compareBranch?: string | null;
  pageInfo?: { current: number; total: number } | null;
  commentListOpen?: boolean;
  onCommentListOpenChange?: (open: boolean) => void;
  onSelectComment?: (comment: Comment) => void;
}

export function StatusBar({
  editor,
  maxWidth,
  renderedWidth,
  comments = [],
  branchName = "",
  isGitRepo = false,
  reviewActive = false,
  compareBranch = null,
  pageInfo = null,
  commentListOpen = false,
  onCommentListOpenChange,
  onSelectComment,
}: StatusBarProps) {
  if (!editor) {
    return null;
  }

  const text = editor.getText();
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  // Average reading speed: 200 words per minute
  const readingTimeMinutes = Math.ceil(words / 200);

  // Calculate scale percentage for paper-size modes
  const scalePercent = maxWidth && renderedWidth
    ? Math.round((renderedWidth / maxWidth) * 100)
    : null;

  return (
    <div
      className="h-6 border-t border-border px-3 flex items-center text-[11px] shrink-0 overflow-x-auto overflow-y-hidden whitespace-nowrap bg-background text-muted-foreground"
    >
      {/* Left zone: workspace context */}
      <div className="flex items-center gap-2 min-w-0">
        {isGitRepo && branchName && !reviewActive && (
          <span className="inline-flex items-center gap-1 min-w-0">
            <GitBranch className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <span className="truncate max-w-[120px]">{branchName}</span>
          </span>
        )}
        {reviewActive && compareBranch && (
          <span className="inline-flex items-center gap-1 min-w-0">
            <GitBranch className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <span className="truncate">Reviewing {compareBranch}</span>
          </span>
        )}
      </div>

      {/* Spacer */}
      <span className="flex-1" />

      {/* Right zone: document context */}
      <div className="flex items-center gap-3">
        {comments.length > 0 && onCommentListOpenChange && onSelectComment && (
          <>
            <CommentListPopover
              open={commentListOpen}
              onOpenChange={onCommentListOpenChange}
              comments={comments}
              onSelectComment={onSelectComment}
            />
            <span className="w-px h-2.5 bg-border" />
          </>
        )}
        <span>{fmtNum(words)} {words === 1 ? "word" : "words"}</span>
        <span className="w-px h-2.5 bg-border" />
        <span>{fmtNum(readingTimeMinutes)} min read</span>
        {pageInfo && (
          <>
            <span className="w-px h-2.5 bg-border" />
            <span>page {fmtNum(pageInfo.current)}/{fmtNum(pageInfo.total)}</span>
          </>
        )}
        {scalePercent !== null && scalePercent < 100 && (
          <>
            <span className="w-px h-2.5 bg-border" />
            <span>{scalePercent}%</span>
          </>
        )}
      </div>
    </div>
  );
}
