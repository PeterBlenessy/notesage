import * as React from "react";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Comment } from "@/stores/comment-store";
import { CommentList } from "./CommentListPopover";

export function CommentsGroup({
  comments,
  onSelectComment,
  onDelegateComment,
  onDelegateAll,
  canDelegate,
  onCloseTray,
}: {
  comments: Comment[];
  onSelectComment?: (c: Comment) => void;
  onDelegateComment?: (c: Comment) => void;
  onDelegateAll?: () => void;
  canDelegate: boolean;
  /** Closes the parent StatusTray so focus returns to the editor after selecting a comment. */
  onCloseTray: () => void;
}) {
  // A comment is "open" unless explicitly resolved — `status === undefined`
  // on freshly created comments, so a strict `=== "open"` would miss them.
  const openCount = comments.filter(
    (c) => c.status !== "resolved" && c.status !== "done",
  ).length;
  const hasOpen = openCount > 0;
  const totalVisible = comments.filter((c) => c.status !== "resolved").length;

  const [listOpen, setListOpen] = React.useState(false);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setListOpen(next);
      if (next) {
        const detail = { comments, onSelectComment, onDelegateComment, onDelegateAll, canDelegate };
        window.dispatchEvent(new CustomEvent("notesage:open-comment-list", { detail }));
      }
    },
    [comments, onSelectComment, onDelegateComment, onDelegateAll, canDelegate],
  );

  return (
    <section className="space-y-2" aria-label="Comments">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="text-xs font-medium">Comments</span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
          {hasOpen ? `${openCount} open` : totalVisible > 0 ? "none open" : "none"}
        </span>
      </div>
      {hasOpen ? (
        <Popover open={listOpen} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors",
                "rounded-sm px-2 py-1 hover:bg-muted/50",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              View open comments
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="left"
            align="start"
            sideOffset={8}
            // z-[60] sits above the parent StatusTray popover (z-50) so we
            // don't get clipped by it. Width + max-height match
            // CommentListPopover's content for visual parity.
            className="w-72 p-0 max-h-80 overflow-y-auto z-[60]"
            onClick={(e) => e.stopPropagation()}
          >
            <CommentList
              comments={comments}
              onSelectComment={(c) => {
                onSelectComment?.(c);
                setListOpen(false);
                onCloseTray();
              }}
              onDelegateComment={onDelegateComment}
              onDelegateAll={onDelegateAll}
              canDelegate={canDelegate}
              onDismiss={() => setListOpen(false)}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <p className="text-[10px] text-muted-foreground/60 leading-tight px-2">
          {totalVisible > 0
            ? "All comments handled."
            : "No comments on this document yet."}
        </p>
      )}
    </section>
  );
}
