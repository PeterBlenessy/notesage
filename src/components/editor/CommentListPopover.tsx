import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MessageSquare } from "lucide-react";
import type { Comment } from "@/stores/comment-store";

interface CommentListPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comments: Comment[];
  onSelectComment: (comment: Comment) => void;
}

function relativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "\u2026";
}

export function CommentListPopover({
  open,
  onOpenChange,
  comments,
  onSelectComment,
}: CommentListPopoverProps) {
  const sorted = [...comments].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <MessageSquare className="h-3 w-3" strokeWidth={1.5} />
          <span>{comments.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-72 p-0 max-h-80 overflow-y-auto"
      >
        <div className="px-3 py-2 border-b border-border">
          <span className="text-xs font-medium text-foreground">
            Comments ({comments.length})
          </span>
        </div>
        {sorted.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            No comments
          </div>
        ) : (
          <div className="py-1">
            {sorted.map((comment) => (
              <button
                key={comment.id}
                type="button"
                onClick={() => {
                  onSelectComment(comment);
                  onOpenChange(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2 mb-0.5">
                  <span className="text-[11px] text-muted-foreground/70 italic truncate flex-1 min-w-0">
                    "{truncate(comment.anchorText, 40)}"
                  </span>
                  <span className="text-[10px] text-muted-foreground/50 shrink-0">
                    {relativeTime(comment.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-foreground/80 leading-snug">
                  {truncate(comment.body, 60)}
                </p>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
