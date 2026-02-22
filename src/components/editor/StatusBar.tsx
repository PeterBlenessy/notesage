import type { Editor } from "@tiptap/core";
import { GitBranch } from "lucide-react";

function CopilotIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z" />
      <path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z" />
    </svg>
  );
}
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
  onDelegateComment?: (comment: Comment) => void;
  onDelegateAll?: () => void;
  canDelegate?: boolean;
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
  onDelegateComment,
  onDelegateAll,
  canDelegate = false,
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
              onDelegateComment={onDelegateComment}
              onDelegateAll={onDelegateAll}
              canDelegate={canDelegate}
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
                  title="Inline completions"
                >
                  <CopilotIcon className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-3" sideOffset={6}>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CopilotIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-xs font-medium">Inline Completions</span>
                    <span
                      className={`ml-auto h-1.5 w-1.5 rounded-full shrink-0 ${
                        copilotDisabledForTab ? "bg-muted-foreground/40" : "bg-foreground/70"
                      }`}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 leading-tight">
                    GitHub Copilot suggests code and text as you type. Press Tab to accept, Escape to dismiss.
                  </p>
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
