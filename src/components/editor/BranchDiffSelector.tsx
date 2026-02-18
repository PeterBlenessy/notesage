import { useState } from "react";
import { GitBranch, GitCompareArrows, Loader2 } from "lucide-react";
import { useGitStore } from "@/stores/git-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { tauriApi } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface BranchDiffSelectorProps {
  projectPath: string;
}

export function BranchDiffSelector({ projectPath }: BranchDiffSelectorProps) {
  const repo = useGitStore((s) => s.repos[projectPath]);
  const currentBranch = repo?.currentBranch ?? "";
  const { reviewActive, compareBranch, isLoading, startReview, endReview } =
    useDiffReviewStore();
  const [branches, setBranches] = useState<string[]>([]);
  const [worktreeBranches, setWorktreeBranches] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  if (!currentBranch) return null;

  const handleOpenChange = async (open: boolean) => {
    setIsOpen(open);
    if (open) {
      try {
        const [branchList, worktreeList] = await Promise.all([
          tauriApi.gitBranchList(projectPath),
          tauriApi.gitWorktreeList(projectPath),
        ]);
        setBranches(branchList.filter((b) => b !== currentBranch));
        setWorktreeBranches(
          worktreeList
            .filter((wt) => !wt.is_main && wt.branch && wt.branch !== currentBranch)
            .map((wt) => wt.branch)
        );
      } catch (error) {
        toast.error(`Failed to list branches: ${error}`);
      }
    }
  };

  const handleSelectBranch = async (branch: string) => {
    setIsOpen(false);
    try {
      await startReview(projectPath, currentBranch, branch);
      const store = useDiffReviewStore.getState();
      if (store.error) {
        toast.error(`Failed to load diff: ${store.error}`);
      } else {
        const fileCount = store.changedFiles.length;
        const hunkCount = store.changedFiles.reduce((sum, f) => sum + f.hunks.length, 0);
        if (fileCount === 0) {
          toast.info(`No changes found between "${currentBranch}" and "${branch}"`);
          endReview();
        } else {
          toast.success(
            `Reviewing ${hunkCount} ${hunkCount === 1 ? "change" : "changes"} across ${fileCount} ${fileCount === 1 ? "file" : "files"}`
          );
        }
      }
    } catch (error) {
      toast.error(`Failed to start review: ${error}`);
    }
  };

  // While a review is active, show a compact status + end button
  if (reviewActive && compareBranch) {
    return (
      <Button
        variant="ghost"
        size="xs"
        className="text-xs gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={endReview}
        title="End branch diff review"
      >
        <GitCompareArrows className="h-3 w-3" strokeWidth={1.5} />
        <span className="truncate max-w-[120px]">{compareBranch}</span>
        <span className="text-[10px] px-1 py-0.5 rounded bg-muted">
          End
        </span>
      </Button>
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          disabled={isLoading}
          title="Review changes from another branch"
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
          ) : (
            <GitCompareArrows className="h-3 w-3" strokeWidth={1.5} />
          )}
          <span>Review Branch</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          Compare against <span className="font-medium">{currentBranch}</span>
        </div>
        <DropdownMenuSeparator />

        {/* Worktree branches shown first (these are the agent branches) */}
        {worktreeBranches.length > 0 && (
          <>
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
              Worktrees
            </div>
            {worktreeBranches.map((branch) => (
              <DropdownMenuItem
                key={`wt-${branch}`}
                onClick={() => handleSelectBranch(branch)}
                className="text-xs"
              >
                <GitBranch
                  className={cn("mr-2 h-3 w-3 shrink-0")}
                  strokeWidth={1.5}
                />
                <span className="truncate">{branch}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}

        {/* Other branches */}
        {branches.filter((b) => !worktreeBranches.includes(b)).length > 0 ? (
          branches
            .filter((b) => !worktreeBranches.includes(b))
            .map((branch) => (
              <DropdownMenuItem
                key={branch}
                onClick={() => handleSelectBranch(branch)}
                className="text-xs"
              >
                <GitBranch className="mr-2 h-3 w-3 shrink-0 opacity-50" strokeWidth={1.5} />
                <span className="truncate">{branch}</span>
              </DropdownMenuItem>
            ))
        ) : (
          !worktreeBranches.length && (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              No other branches found
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
