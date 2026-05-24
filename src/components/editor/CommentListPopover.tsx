import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MessageSquare, Bot, Loader2 } from "lucide-react";
import type { Comment } from "@/stores/comment-store";

interface CommentListPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comments: Comment[];
  onSelectComment: (comment: Comment) => void;
  onDelegateComment?: (comment: Comment) => void;
  onDelegateAll?: () => void;
  canDelegate?: boolean;
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

interface CommentListProps {
  comments: Comment[];
  onSelectComment: (comment: Comment) => void;
  onDelegateComment?: (comment: Comment) => void;
  onDelegateAll?: () => void;
  canDelegate?: boolean;
  /**
   * Called after the user picks a comment, the "Delegate all" affordance,
   * or per-row delegate. Lets the parent dismiss its popover. The list
   * itself never owns its open state \u2014 that belongs to the host shell.
   */
  onDismiss?: () => void;
}

/**
 * Visual list of open comments \u2014 header row, optional "Delegate all"
 * button, and one row per comment with anchor snippet, body excerpt,
 * relative timestamp, and per-row delegate. Click a row to fire
 * `onSelectComment(comment)` (and `onDismiss()`).
 *
 * Extracted from `CommentListPopover` so other surfaces (e.g. the
 * `StatusTray`) can mount the same UI inside their own popover
 * without bringing the trigger button along. The standalone
 * `CommentListPopover` continues to render this component inside its
 * own Radix popover \u2014 no behaviour change for existing callers.
 */
export function CommentList({
  comments,
  onSelectComment,
  onDelegateComment,
  onDelegateAll,
  canDelegate = false,
  onDismiss,
}: CommentListProps) {
  // Filter out resolved comments, then sort by creation time
  const visible = comments.filter((c) => c.status !== 'resolved');
  const sorted = [...visible].sort((a, b) => b.createdAt - a.createdAt);
  const delegatable = visible.filter((c) => c.status !== 'delegated' && c.status !== 'done');

  return (
    <>
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">
          Comments ({visible.length})
        </span>
        {canDelegate && onDelegateAll && delegatable.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelegateAll();
              onDismiss?.();
            }}
            title={`Delegate ${delegatable.length} comment${delegatable.length === 1 ? '' : 's'} to AI agent`}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground active:opacity-75 transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
          >
            <Bot className="h-3 w-3" strokeWidth={1.5} />
            Delegate all
          </button>
        )}
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
                onDismiss?.();
              }}
              className="w-full text-left px-3 py-2 hover:bg-muted transition-colors focus-visible:outline-none focus-visible:bg-muted group"
            >
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <span className="text-[11px] text-muted-foreground/70 italic truncate flex-1 min-w-0">
                  &ldquo;{truncate(comment.anchorText, 40)}&rdquo;
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[11px] text-muted-foreground/50">
                    {relativeTime(comment.createdAt)}
                  </span>
                  {comment.status === 'delegated' && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
                  )}
                  {comment.status === 'done' && (
                    <Bot className="h-3 w-3 text-muted-foreground/50" strokeWidth={1.5} />
                  )}
                  {canDelegate && onDelegateComment && comment.status !== 'delegated' && comment.status !== 'done' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelegateComment(comment);
                        onDismiss?.();
                      }}
                      title="Delegate to AI agent"
                      className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground active:opacity-75"
                    >
                      <Bot className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-foreground/80 leading-snug">
                {truncate(comment.body, 60)}
              </p>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function CommentListPopover({
  open,
  onOpenChange,
  comments,
  onSelectComment,
  onDelegateComment,
  onDelegateAll,
  canDelegate = false,
}: CommentListPopoverProps) {
  // Header count mirrors `CommentList`'s "visible" semantics so the
  // trigger badge and the popover heading agree.
  const visible = comments.filter((c) => c.status !== 'resolved');

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-0.5 hover:text-foreground active:opacity-75 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <MessageSquare className="h-3 w-3" strokeWidth={1.5} />
          <span>{visible.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-72 p-0 max-h-80 overflow-y-auto"
      >
        <CommentList
          comments={comments}
          onSelectComment={onSelectComment}
          onDelegateComment={onDelegateComment}
          onDelegateAll={onDelegateAll}
          canDelegate={canDelegate}
          onDismiss={() => onOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
