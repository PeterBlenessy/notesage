import { GitBranch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * DiffReviewPill — persistent affordance while a git branch diff review is
 * active. Floats over the editor's top-right corner (the pill Toolbar owns
 * top-centre) so the user always knows a review is running and can accept
 * the current file's remaining hunks or end the review without hunting for
 * the sidebar context menu that started it.
 *
 * Neutral greyscale only — the diff decorations in the document carry the
 * chromatic meaning; this is chrome.
 */

export interface DiffReviewPillProps {
  /** The branch being compared against (the "incoming" side). */
  compareBranch: string | null;
  /** Accept all unresolved hunks in the active file (from useDiffReview). */
  onAcceptAll: () => void;
  /** End the review session entirely (diff-review-store.endReview). */
  onEnd: () => void;
}

export function DiffReviewPill({
  compareBranch,
  onAcceptAll,
  onEnd,
}: DiffReviewPillProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div
        data-diff-review-pill
        role="status"
        aria-label={`Reviewing branch ${compareBranch ?? ""}`}
        className={[
          "absolute top-3 right-4 z-10 pointer-events-auto",
          "flex h-7 items-center gap-1.5 rounded-full border border-border",
          "bg-popover/95 backdrop-blur px-2.5 shadow-sm",
          "text-xs text-muted-foreground",
        ].join(" ")}
      >
        <GitBranch
          className="h-3 w-3 shrink-0"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="max-w-[160px] truncate">
          Reviewing{" "}
          <span className="font-medium text-foreground">
            {compareBranch ?? "branch"}
          </span>
        </span>
        <Separator orientation="vertical" className="h-3.5" />
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-5 px-1.5"
          onClick={onAcceptAll}
        >
          Accept all
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="End branch review"
              onClick={onEnd}
            >
              <X strokeWidth={1.5} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">End branch review</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export default DiffReviewPill;
