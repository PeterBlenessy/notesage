import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, Loader2 } from "lucide-react";
import { useGitStore } from "@/stores/git-store";
import { useGitOperations } from "@/hooks/useGitOperations";
import { tauriApi } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { GitStatus } from "@/lib/tauri";

const STATUS_CONFIG: Record<GitStatus, { label: string; color: string; tooltip: string }> = {
  modified: { label: "M", color: "text-muted-foreground/50", tooltip: "Modified" },
  added: { label: "A", color: "text-muted-foreground/50", tooltip: "Added — new file staged for commit" },
  untracked: { label: "U", color: "text-muted-foreground/50", tooltip: "Untracked — not yet tracked by git" },
  deleted: { label: "D", color: "text-muted-foreground/50", tooltip: "Deleted" },
  renamed: { label: "R", color: "text-muted-foreground/50", tooltip: "Renamed" },
  conflicted: { label: "C", color: "text-muted-foreground/50", tooltip: "Conflicted — merge conflict" },
};

interface CommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  preSelectedFiles?: string[];
}

export function CommitDialog({ open, onOpenChange, repoPath, preSelectedFiles }: CommitDialogProps) {
  const repo = useGitStore((s) => s.repos[repoPath]);
  const fileStatuses = repo?.fileStatuses ?? [];
  const { stage, unstage, commit, refreshStatus } = useGitOperations(repoPath);

  const [message, setMessage] = useState("");
  const [body, setBody] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState("");
  const [configName, setConfigName] = useState("");
  const [configEmail, setConfigEmail] = useState("");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Deduplicate files — one entry per path, tracking staged state
  const files = useMemo(() => {
    const map = new Map<string, { path: string; status: GitStatus; staged: boolean }>();
    for (const f of fileStatuses) {
      // Prefer unstaged entry for display status, but track if anything is staged
      const existing = map.get(f.path);
      if (!existing) {
        map.set(f.path, { ...f });
      } else if (!f.staged) {
        // Unstaged status takes display priority
        map.set(f.path, { ...f });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
  }, [fileStatuses]);

  // Reset state when dialog opens — only on the open transition, not on every
  // fileStatuses change, to avoid resetting the user's message and selection.
  useEffect(() => {
    if (open) {
      setMessage("");
      setBody("");
      setError("");
      setIsCommitting(false);
      setConfigName("");
      setConfigEmail("");
      setIsSavingConfig(false);
      setConfigLoaded(false);
      // Pre-select: use preSelectedFiles if provided, otherwise staged files
      if (preSelectedFiles && preSelectedFiles.length > 0) {
        setSelectedFiles(new Set(preSelectedFiles));
      } else {
        const staged = new Set<string>();
        for (const f of fileStatuses) {
          if (f.staged) {
            staged.add(f.path);
          }
        }
        setSelectedFiles(staged);
      }
      refreshStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Prefill name/email from global git config when identity is missing
  useEffect(() => {
    if (!error.includes("GIT_CONFIG_MISSING") || configLoaded) return;
    setConfigLoaded(true);

    Promise.all([
      tauriApi.gitGetConfig("user.name"),
      tauriApi.gitGetConfig("user.email"),
    ]).then(([name, email]) => {
      if (name) setConfigName(name);
      if (email) setConfigEmail(email);
    }).catch(() => {
      // Ignore — fields stay empty
    });
  }, [error, configLoaded]);

  const allSelected = files.length > 0 && selectedFiles.size === files.length;

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map((f) => f.path)));
    }
  };

  const canCommit = message.trim().length > 0 && selectedFiles.size > 0 && !isCommitting;

  const handleCommit = async () => {
    if (!canCommit) return;

    setIsCommitting(true);
    setError("");

    try {
      const filesToStage = Array.from(selectedFiles);
      const filesToUnstage = files
        .filter((f) => !selectedFiles.has(f.path))
        .map((f) => f.path);

      // Stage selected, unstage deselected
      if (filesToStage.length > 0) {
        await stage(filesToStage);
      }
      if (filesToUnstage.length > 0) {
        await unstage(filesToUnstage);
      }

      const fullMessage = body.trim()
        ? `${message.trim()}\n\n${body.trim()}`
        : message.trim();

      const hash = await commit(fullMessage);
      onOpenChange(false);
      toast.success(`Committed ${hash}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Commit Changes</DialogTitle>
          <DialogDescription>
            Select files to include and write a commit message.
          </DialogDescription>
        </DialogHeader>

        {files.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No changes to commit</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* File list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  {selectedFiles.size} of {files.length} file{files.length !== 1 ? "s" : ""} selected
                </span>
                <button
                  onClick={toggleAll}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              </div>

              <div className="max-h-[300px] overflow-y-auto rounded-md border border-border">
                {files.map((file) => {
                  const config = STATUS_CONFIG[file.status];
                  const isChecked = selectedFiles.has(file.path);
                  return (
                    <label
                      key={file.path}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 cursor-pointer",
                        "transition-colors duration-150",
                        "hover:bg-accent/50",
                        "border-b border-border last:border-b-0"
                      )}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleFile(file.path)}
                      />
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={cn(
                                "shrink-0 font-mono text-[10px] w-3 text-center",
                                config.color
                              )}
                            >
                              {config.label}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {config.tooltip}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <span className="text-xs truncate flex-1 text-foreground">
                        {file.path.startsWith(repoPath + "/") ? file.path.slice(repoPath.length + 1) : file.path}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Commit message */}
            <div className="space-y-2">
              <Input
                placeholder="Commit message (required)"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && canCommit) {
                    e.preventDefault();
                    handleCommit();
                  }
                }}
                autoFocus
              />
              <Textarea
                placeholder="Extended description (optional)"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="resize-none text-xs"
              />
            </div>

            {error && (
              error.includes("GIT_CONFIG_MISSING") ? (
                <div className="rounded-md border border-border bg-muted/50 p-3 space-y-3">
                  <div className="flex gap-2.5">
                    <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">Git identity not configured</p>
                      <p>Git needs your name and email to create commits.</p>
                    </div>
                  </div>
                  <div className="space-y-2 pl-6.5">
                    <Input
                      placeholder="Your Name"
                      value={configName}
                      onChange={(e) => setConfigName(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      placeholder="you@example.com"
                      type="email"
                      value={configEmail}
                      onChange={(e) => setConfigEmail(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!configName.trim() || !configEmail.trim() || isSavingConfig}
                      onClick={async () => {
                        if (!configName.trim() || !configEmail.trim()) return;
                        setIsSavingConfig(true);
                        try {
                          await tauriApi.gitSetConfig("user.name", configName.trim());
                          await tauriApi.gitSetConfig("user.email", configEmail.trim());
                          setError("");
                          // Auto-retry the commit
                          await handleCommit();
                        } catch (err) {
                          setError(String(err));
                        } finally {
                          setIsSavingConfig(false);
                        }
                      }}
                      className="text-xs"
                    >
                      {isSavingConfig ? (
                        <>
                          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        "Save & Retry"
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2.5 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <Info className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCommitting}
          >
            Cancel
          </Button>
          {files.length > 0 && (
            <Button
              onClick={handleCommit}
              disabled={!canCommit}
            >
              {isCommitting ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Committing...
                </>
              ) : (
                `Commit (${selectedFiles.size})`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
