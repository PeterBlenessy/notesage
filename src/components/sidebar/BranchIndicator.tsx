import { useState } from "react";
import { GitBranch, Check, AlertTriangle } from "lucide-react";
import { useGitStore } from "@/stores/git-store";
import { useGitOperations } from "@/hooks/useGitOperations";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface BranchIndicatorProps {
  projectPath: string;
}

export function BranchIndicator({ projectPath }: BranchIndicatorProps) {
  const repo = useGitStore((s) => s.repos[projectPath]);
  const currentBranch = repo?.currentBranch ?? "";
  const statusError = repo?.statusError ?? false;
  const { switchBranch, listBranches } = useGitOperations(projectPath);
  const [branches, setBranches] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  if (!currentBranch) return null;

  const handleOpenChange = async (open: boolean) => {
    setIsOpen(open);
    if (open) {
      try {
        const list = await listBranches();
        setBranches(list);
      } catch (error) {
        toast.error(`Failed to list branches: ${error}`);
      }
    }
  };

  const handleSwitch = async (branch: string) => {
    if (branch === currentBranch) return;
    try {
      await switchBranch(branch);
    } catch (error) {
      toast.error(`Failed to switch branch: ${error}`);
    }
    setIsOpen(false);
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 w-full text-left",
            "text-xs text-muted-foreground",
            "transition-colors duration-150",
            "hover:text-foreground"
          )}
        >
          <GitBranch className="h-3 w-3 shrink-0" strokeWidth={1.5} />
          <span className="truncate">{currentBranch}</span>
          {statusError && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" strokeWidth={1.5} />
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Git status refresh failed</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {branches.map((branch) => (
          <DropdownMenuItem
            key={branch}
            onClick={() => handleSwitch(branch)}
            className="text-xs"
          >
            <Check
              className={cn(
                "mr-2 h-3 w-3",
                branch === currentBranch ? "opacity-100" : "opacity-0"
              )}
            />
            <span className="truncate">{branch}</span>
          </DropdownMenuItem>
        ))}
        {branches.length === 0 && (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            No branches found
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
