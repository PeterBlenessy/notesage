import { useEffect, useState, type ReactNode } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { tauriApi } from "@/lib/tauri";
import { useGitStore } from "@/stores/git-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

/**
 * BranchComparePopover — branch picker for git branch diff review.
 *
 * Anchored to a repo-backed sidebar row (project / explorer folder) and
 * opened from the row's context menu ("Compare branch…"). Lists the repo's
 * local branches minus the currently checked-out one; selecting a branch
 * starts a diff review via `diff-review-store.startReview(repoPath,
 * currentBranch, selectedBranch)` — the checked-out branch is the BASE
 * (`useDiffReview` maps base line ranges onto the open document), the
 * picked branch is the incoming COMPARE side.
 *
 * Replaces the Classic Layout `BranchDiffSelector` dropdown deleted in
 * PRD 2026-05-22-classic-layout-removal.
 */

export interface BranchComparePopoverProps {
  /** Absolute path of the git repo root (the sidebar row's path). */
  repoPath: string;
  /** Controlled open state — driven by the context menu item. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The anchor element (usually the context-menu-wrapped row). */
  children: ReactNode;
}

export function BranchComparePopover({
  repoPath,
  open,
  onOpenChange,
  children,
}: BranchComparePopoverProps) {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const isLoadingReview = useDiffReviewStore((s) => s.isLoading);

  // Fetch branches + current branch when the picker opens. One IPC pair
  // per user action — never per render.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setLoading(true);
    void (async () => {
      try {
        // Prefer the branch git-store already tracks (populated by repo
        // detection / status refresh); fall back to a fresh fetch.
        const stored = useGitStore.getState().repos[repoPath]?.currentBranch;
        const [list, current] = await Promise.all([
          tauriApi.gitBranchList(repoPath),
          stored ? Promise.resolve(stored) : tauriApi.gitBranchCurrent(repoPath),
        ]);
        if (cancelled) return;
        setBranches(list);
        setCurrentBranch(current);
      } catch (error) {
        if (cancelled) return;
        toast.error(`Failed to list branches: ${error}`);
        onOpenChange(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, repoPath, onOpenChange]);

  const candidates = branches.filter((b) => b !== currentBranch);

  const handleSelect = async (branch: string) => {
    onOpenChange(false);
    await useDiffReviewStore
      .getState()
      .startReview(repoPath, currentBranch, branch);
    const { error } = useDiffReviewStore.getState();
    if (error) {
      toast.error(`Failed to start branch review: ${error}`);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span className="block">{children}</span>
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={4}
        className="p-0 w-64"
        // Same reach-through guards as the Customize popover: React
        // synthetic events bubble through portals, so typing in the
        // CommandInput would otherwise land in the sidebar's
        // type-to-filter, and hover would wake FolderPeek.
        onKeyDown={(e) => e.stopPropagation()}
        onMouseEnter={(e) => e.stopPropagation()}
        onMouseLeave={(e) => e.stopPropagation()}
        onMouseOver={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t("git.compareBranch")} />
          <CommandList className="max-h-[240px]">
            {loading ? (
              <div
                className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"
                role="status"
                aria-label={t("git.loadingBranches")}
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                Loading branches…
              </div>
            ) : (
              <>
                <CommandEmpty>{t("git.noOtherBranches")}</CommandEmpty>
                {candidates.map((branch) => (
                  <CommandItem
                    key={branch}
                    value={branch}
                    disabled={isLoadingReview}
                    onSelect={() => void handleSelect(branch)}
                    className="text-[13px]"
                  >
                    <GitBranch
                      className="h-3.5 w-3.5 text-muted-foreground"
                      strokeWidth={1.5}
                    />
                    <span className="truncate">{branch}</span>
                  </CommandItem>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default BranchComparePopover;
