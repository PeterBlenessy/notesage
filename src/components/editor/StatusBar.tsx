import type { Editor } from "@tiptap/core";
import { GitBranch, Github } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { CommentListPopover } from "./CommentListPopover";
import { ChangeListPopover } from "./ChangeListPopover";
import type { Comment } from "@/stores/comment-store";
import type { ExternalChangeEntry } from "@/stores/external-change-store";

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
  externalChanges?: ExternalChangeEntry[];
  activeFilePath?: string | null;
  changeListOpen?: boolean;
  onChangeListOpenChange?: (open: boolean) => void;
  onAcceptAllChanges?: () => void;
  onRejectAllChanges?: () => void;
  onAcceptHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
  onSelectChange?: (change: ExternalChangeEntry, hunkIndex: number) => void;
  copilotActive?: boolean;
  copilotDisabledForTab?: boolean;
  onToggleCopilot?: () => void;
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
  externalChanges = [],
  activeFilePath = null,
  changeListOpen = false,
  onChangeListOpenChange,
  onAcceptAllChanges,
  onRejectAllChanges,
  onAcceptHunk,
  onRejectHunk,
  onSelectChange,
  copilotActive = false,
  copilotDisabledForTab = false,
  onToggleCopilot,
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
        {externalChanges.length > 0 && onChangeListOpenChange && onSelectChange && (
          <>
            <ChangeListPopover
              open={changeListOpen}
              onOpenChange={onChangeListOpenChange}
              changes={externalChanges}
              activeFilePath={activeFilePath}
              onSelectChange={onSelectChange}
              onAcceptAll={onAcceptAllChanges}
              onRejectAll={onRejectAllChanges}
              onAcceptHunk={onAcceptHunk}
              onRejectHunk={onRejectHunk}
            />
            <span className="w-px h-2.5 bg-border" />
          </>
        )}
        {copilotActive && onToggleCopilot && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
                    copilotDisabledForTab ? "opacity-40" : ""
                  }`}
                  title="GitHub Copilot LSP"
                >
                  <Github className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-3" sideOffset={6}>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Github className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                    <span className="text-xs font-medium">GitHub Copilot LSP</span>
                    <span
                      className={`ml-auto h-1.5 w-1.5 rounded-full shrink-0 ${
                        copilotDisabledForTab ? "bg-muted-foreground/40" : "bg-green-500"
                      }`}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="copilot-toggle" className="text-xs text-muted-foreground">
                      Enable for this document
                    </label>
                    <Switch
                      id="copilot-toggle"
                      checked={!copilotDisabledForTab}
                      onCheckedChange={() => onToggleCopilot()}
                      className="scale-75 origin-right"
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 leading-tight">
                    Session only — resets when tab is closed
                  </p>
                </div>
              </PopoverContent>
            </Popover>
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
