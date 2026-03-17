import { useState, useEffect } from "react";
import type { Editor } from "@tiptap/core";
import { ArrowUpCircle, CheckSquare, Command, Cpu, Download, GitBranch, Loader2, ScrollText, X } from "lucide-react";
import { useActionStore } from "@/stores/action-store";

/** Inline completion icon — italic T with horizontal sparkle trail ✦··· representing text being completed. */
function InlineCompletionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className={className}>
      {/* Italic T */}
      <line x1="2" y1="3" x2="8.5" y2="3" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6.5" y1="3" x2="3.5" y2="13" strokeWidth="1.5" strokeLinecap="round" />
      {/* Sparkles — 4-pointed stars, increasing size, spread across icon */}
      <path d="M9 9 L9.7 11.8 L12 13 L9.7 14.2 L9 17 L8.3 14.2 L6 13 L8.3 11.8 Z" fill="currentColor" stroke="none" />
      <path d="M13.5 2 L14.55 6.2 L18 8 L14.55 9.8 L13.5 14 L12.45 9.8 L9 8 L12.45 6.2 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
import { useLocalAIStore } from "@/stores/local-ai-store";
import { useConnectionsStore } from "@/stores/connections-store";
import { useRecordingStore } from "@/stores/recording-store";
import { Progress } from "@/components/ui/progress";
import type { ViewMode } from "@/lib/file-utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";



import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useSettingsStore } from "@/stores/settings-store";
import { useSkillStore } from "@/stores/skill-store";
import { CommentListPopover } from "./CommentListPopover";
import { ChangeListPopover } from "./ChangeListPopover";
import type { Comment } from "@/stores/comment-store";
import type { ExternalChangeEntry } from "@/stores/external-change-store";

/** Format number with localized thousand separators (uses host locale). */
const fmt = new Intl.NumberFormat(navigator.languages as string[], { useGrouping: true });
function fmtNum(n: number): string {
  return fmt.format(n);
}

function CopilotMaxCharsSlider() {
  const maxChars = useSettingsStore((s) => s.copilotMaxCompletionChars);
  const setMaxChars = useSettingsStore((s) => s.setCopilotMaxCompletionChars);
  return (
    <div className="space-y-1.5 pt-1 border-t border-border">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Max display length</label>
        <span className="text-[10px] text-muted-foreground tabular-nums">{maxChars} chars</span>
      </div>
      <Slider
        min={40}
        max={200}
        step={10}
        value={[maxChars]}
        onValueChange={([v]) => setMaxChars(v)}
        className="w-full"
      />
    </div>
  );
}

function FimContextSlider() {
  const contextChars = useSettingsStore((s) => s.fimContextChars);
  const setContextChars = useSettingsStore((s) => s.setFimContextChars);
  return (
    <div className="space-y-1.5 pt-1 border-t border-border">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Context sent</label>
        <span className="text-[10px] text-muted-foreground tabular-nums">{contextChars} chars</span>
      </div>
      <Slider
        min={200}
        max={2000}
        step={100}
        value={[contextChars]}
        onValueChange={([v]) => setContextChars(v)}
        className="w-full"
      />
    </div>
  );
}

function ActionsIndicator({ onOpenActions }: { onOpenActions?: () => void }) {
  const openCount = useActionStore((s) => s.getOpenCount());

  if (openCount === 0 || !onOpenActions) return null;

  return (
    <>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenActions}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <CheckSquare className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <span>{openCount} {openCount === 1 ? 'action' : 'actions'}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Open actions dashboard ({'\u2318'}5)
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span className="w-px h-2.5 bg-border" />
    </>
  );
}

function IndexProgressIndicator() {
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    let unlisten1: (() => void) | undefined;
    let unlisten2: (() => void) | undefined;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ current: number; total: number }>("index-progress", (event) => {
        setProgress(event.payload);
      }).then((fn) => { unlisten1 = fn; });

      listen("index-ready", () => {
        setProgress(null);
      }).then((fn) => { unlisten2 = fn; });
    });

    return () => { unlisten1?.(); unlisten2?.(); };
  }, []);

  if (!progress) return null;

  return (
    <>
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        <span>Indexing {progress.current}/{progress.total}</span>
      </span>
      <span className="w-px h-2.5 bg-border" />
    </>
  );
}

function AgentInstructionsIndicator() {
  const agentInstructions = useSkillStore((s) => s.agentInstructions);
  const count = agentInstructions.length;

  if (count === 0) return null;

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            title="Agent instructions"
          >
            <ScrollText className="h-3 w-3" strokeWidth={1.5} />
            <span>{count}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-3" sideOffset={6}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ScrollText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="text-xs font-medium">Agent Instructions</span>
            </div>
            <p className="text-[10px] text-muted-foreground/60 leading-tight">
              {count} {count === 1 ? 'file' : 'files'} loaded into AI context
            </p>
            <div className="space-y-1">
              {agentInstructions
                .slice()
                .sort((a, b) => b.priority - a.priority)
                .map((inst) => {
                  const filename = inst.source.split('/').pop() || inst.source;
                  return (
                    <div
                      key={`${inst.source_type}-${inst.priority}`}
                      className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                    >
                      <span className="tabular-nums text-muted-foreground/40 w-3 text-right shrink-0">
                        {inst.priority}
                      </span>
                      <span className="truncate">{filename}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <span className="w-px h-2.5 bg-border" />
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function ModelDownloadIndicator() {
  const activeDownloads = useRecordingStore((s) => s.activeDownloads);
  const models = useRecordingStore((s) => s.availableModels);
  const cancelDownload = useRecordingStore((s) => s.cancelDownload);
  const entries = Object.entries(activeDownloads);

  if (entries.length === 0) return null;

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" strokeWidth={1.5} />
            <span>{entries.length === 1 ? "Downloading" : `${entries.length} downloads`}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3" sideOffset={6}>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="text-xs font-medium">Model Downloads</span>
            </div>
            <div className="space-y-2">
              {entries.map(([name, state]) => {
                const model = models.find((m) => m.name === name);
                return (
                  <div key={name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-medium truncate">{name === 'large-v3' ? 'Large v3' : name.charAt(0).toUpperCase() + name.slice(1)}</span>
                        {model && (
                          <span className="text-[10px] text-muted-foreground/60">{formatSize(model.size_bytes)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {Math.round(state.progress)}%
                        </span>
                        <button
                          onClick={() => cancelDownload(name)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Cancel download"
                        >
                          <X className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                    <Progress value={state.progress} className="h-1" />
                  </div>
                );
              })}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <span className="w-px h-2.5 bg-border" />
    </>
  );
}

function LocalAIIndicator() {
  const serverStatus = useLocalAIStore((s) => s.serverStatus);
  const activeModelId = useLocalAIStore((s) => s.activeModelId);
  const models = useLocalAIStore((s) => s.models);
  const connections = useConnectionsStore((s) => s.connections);

  const hasConnection = connections.some(
    (c) => c.provider === 'local_ai' && c.authMethod === 'local_bundled'
  );

  if (!hasConnection) return null;

  const activeModel = models.find((m) => m.id === activeModelId);

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
            <Cpu className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                serverStatus === 'running'
                  ? 'bg-green-500'
                  : serverStatus === 'starting'
                  ? 'bg-amber-500 animate-pulse'
                  : serverStatus === 'error'
                  ? 'bg-red-500'
                  : 'bg-muted-foreground/30'
              }`}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-48 p-3" sideOffset={6}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Cpu className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="text-xs font-medium">Local AI</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  serverStatus === 'running'
                    ? 'bg-green-500'
                    : serverStatus === 'starting'
                    ? 'bg-amber-500 animate-pulse'
                    : serverStatus === 'error'
                    ? 'bg-red-500'
                    : 'bg-muted-foreground/30'
                }`}
              />
              <span>
                {serverStatus === 'running' && activeModel
                  ? `Running (${activeModel.name})`
                  : serverStatus === 'starting'
                  ? 'Starting...'
                  : serverStatus === 'error'
                  ? 'Error — check Settings'
                  : 'Stopped'}
              </span>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <span className="w-px h-2.5 bg-border" />
    </>
  );
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
  viewMode?: ViewMode;
  updateAvailable?: boolean;
  updateVersion?: string | null;
  onUpdateClick?: () => void;
  onShortcutsOpen?: () => void;
  onOpenActions?: () => void;
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
  viewMode,
  updateAvailable = false,
  updateVersion = null,
  onUpdateClick,
  onOpenActions,
  onShortcutsOpen,
}: StatusBarProps) {
  if (!editor) {
    return (
      <div className="h-6 border-t border-border px-3 flex items-center text-[11px] shrink-0 overflow-x-auto overflow-y-hidden whitespace-nowrap bg-background text-muted-foreground">
        <div className="flex items-center gap-2 min-w-0">
          <IndexProgressIndicator />
          <ModelDownloadIndicator />
          <LocalAIIndicator />
          <ActionsIndicator onOpenActions={onOpenActions} />
        </div>
        <span className="flex-1" />
        <div className="flex items-center gap-3">
          {onShortcutsOpen && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onShortcutsOpen}
                    className="inline-flex items-center hover:text-foreground transition-colors"
                  >
                    <Command className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Keyboard shortcuts (⌘7)
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    );
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
        {updateAvailable && onUpdateClick && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onUpdateClick}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <ArrowUpCircle className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                  <span>Update</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Update available: v{updateVersion}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <ModelDownloadIndicator />
        <LocalAIIndicator />
        <ActionsIndicator onOpenActions={onOpenActions} />
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
        <AgentInstructionsIndicator />
        {copilotActive && (() => {
          const disabled = useSettingsStore.getState().inlineCompletionsDisabled;
          const toggle = () => useSettingsStore.getState().setInlineCompletionsDisabled(!disabled);
          return (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
                      disabled ? "opacity-40" : ""
                    }`}
                    title="Inline completions"
                  >
                    <InlineCompletionIcon className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-3" sideOffset={6}>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <InlineCompletionIcon className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-xs font-medium">Inline Completions</span>
                      <span
                        className={`ml-auto h-1.5 w-1.5 rounded-full shrink-0 ${
                          disabled ? "bg-muted-foreground/40" : "bg-foreground/70"
                        }`}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground/60 leading-tight">
                      Inline completions suggest text as you type. Press Tab to accept, Escape to dismiss.
                    </p>
                    <div className="flex items-center justify-between">
                      <label htmlFor="copilot-toggle" className="text-xs text-muted-foreground">
                        Enabled
                      </label>
                      <Switch
                        id="copilot-toggle"
                        checked={!disabled}
                        onCheckedChange={toggle}
                        className="scale-75 origin-center"
                      />
                    </div>
                    <CopilotMaxCharsSlider />
                    <FimContextSlider />
                  </div>
                </PopoverContent>
              </Popover>
              <span className="w-px h-2.5 bg-border" />
            </>
          );
        })()}
        {viewMode && (
          <>
            <span className="uppercase tracking-wider font-medium">
              {viewMode === "source" ? "Raw" : "Rich text"}
            </span>
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
        {onShortcutsOpen && (
          <>
            <span className="w-px h-2.5 bg-border" />
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onShortcutsOpen}
                    className="inline-flex items-center hover:text-foreground transition-colors"
                  >
                    <Command className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Keyboard shortcuts (⌘7)
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </>
        )}
      </div>
    </div>
  );
}
