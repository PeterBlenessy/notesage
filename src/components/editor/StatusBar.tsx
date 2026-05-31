import {
  useState,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Editor } from "@tiptap/core";
import { ArrowUpCircle, CheckSquare, Command, Cpu, Download, GitBranch, Loader2, ScrollText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SavedLabel } from "@/components/SavedLabel";
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
import { useChatStore, selectProjectPaths } from "@/stores/chat-store";
import { useEditorStore } from "@/stores/editor-store";
import { Progress } from "@/components/ui/progress";
import type { ViewMode } from "@/lib/file-utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isUriInScope, type UriScope } from "@/lib/ai/uri-scope";



import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useSettingsStore } from "@/stores/settings-store";
import { useSkillStore } from "@/stores/skill-store";
import { CommentListPopover } from "./CommentListPopover";
import { ChangeListPopover } from "./ChangeListPopover";
import { StatusTray, type StatusTrayGroup } from "./StatusTray";
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

  return (
    <div aria-live="polite" aria-atomic="true" className="contents">
      {progress && (
        <>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
            <span>Indexing {progress.current}/{progress.total}</span>
          </span>
          <span className="w-px h-2.5 bg-border" />
        </>
      )}
    </div>
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

/**
 * Task #17 — surface the reason completions are suppressed when the user is
 * editing a file outside the chat footer's selected project scope. Only
 * renders when all four conditions hold:
 *   - A completion provider is routed (otherwise "off" would be noise)
 *   - Global inline completions aren't explicitly disabled
 *   - The `completionsOnOutOfScope` escape hatch is off (legacy behaviour)
 *   - The active tab path is actually out of scope
 * This keeps the indicator unobtrusive — it appears only in the exact case
 * where the user might wonder why ghost text stopped arriving.
 */
function OutOfScopeCompletionsIndicator({ copilotActive }: { copilotActive: boolean }) {
  const completionsOnOutOfScope = useSettingsStore((s) => s.completionsOnOutOfScope);
  const inlineCompletionsDisabled = useSettingsStore((s) => s.inlineCompletionsDisabled);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const homeDir = useSettingsStore((s) => s.homeDir);
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const openDocuments = useEditorStore((s) => s.openDocuments);
  const activeTab = openDocuments.find((t) => t.id === activeTabId);

  if (!copilotActive || inlineCompletionsDisabled || completionsOnOutOfScope) return null;
  if (!activeTab?.filePath) return null;

  const resolvedNotesRoot =
    notesRootPath && notesRootPath.startsWith("~")
      ? homeDir
        ? notesRootPath.replace("~", homeDir)
        : null
      : notesRootPath || null;
  const scope: UriScope = {
    projectRoots: selectedProjectPaths,
    notesRootPath: resolvedNotesRoot,
  };
  if (isUriInScope(activeTab.filePath, scope)) return null;

  return (
    <>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center text-muted-foreground/70 cursor-default">
              Completions: off (outside project)
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-xs">
            Completions disabled for files outside the selected project scope.
            Toggle in Settings &gt; Advanced.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
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
              data-testid="local-ai-status-dot"
              data-server-status={serverStatus}
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
  /**
   * Visual variant. `"full"` (default) preserves the legacy rich status strip
   * byte-for-byte. `"quiet"` renders the minimal
   * `<words> · saved Xs ago · ⌘K ask · ⌘. focus`
   * strip used by the quiet-composer layout (task #52 of 2026-04-21-ui-refresh).
   * The full variant remains mounted everywhere today — the quiet variant is
   * wired in by `QuietLayout` in a later task.
   */
  variant?: "full" | "quiet";
  /**
   * Callback when the user clicks the quiet status strip — opens the
   * `StatusTray` popover (task #53). Has no effect on the full variant.
   */
  onOpenTray?: () => void;
  /**
   * Source-mode toggle callback. When provided in the `quiet` variant the
   * StatusTray hosts a WYSIWYG ↔ Source switcher that calls this. Mirrors the
   * inline Toolbar's `onToggleViewMode` so the keyboard shortcut behaviour
   * stays untouched. Used only by the StatusTray; pass-through prop in the
   * full variant.
   */
  onToggleViewMode?: () => void;
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
  variant = "full",
  onOpenTray,
  onToggleViewMode,
}: StatusBarProps) {
  // The quiet variant short-circuits before the full-variant render path —
  // it owns its own data reads (word count + lastSavedAt) and never touches
  // the rich indicators (comments, git, external changes, etc.).
  if (variant === "quiet") {
    return (
      <QuietStatusBar
        editor={editor}
        onOpenTray={onOpenTray}
        comments={comments}
        onSelectComment={onSelectComment}
        onDelegateComment={onDelegateComment}
        onDelegateAll={onDelegateAll}
        canDelegate={canDelegate}
        onShortcutsOpen={onShortcutsOpen}
        onOpenActions={onOpenActions}
        viewMode={viewMode}
        onToggleViewMode={onToggleViewMode}
      />
    );
  }

  if (!editor) {
    return (
      <div role="status" aria-live="polite" className="h-6 border-t border-border px-3 flex items-center text-[11px] shrink-0 overflow-x-auto overflow-y-hidden whitespace-nowrap bg-background text-muted-foreground">
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
      role="status"
      aria-live="polite"
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
        <OutOfScopeCompletionsIndicator copilotActive={copilotActive} />
        {copilotActive && (() => {
          const disabled = useSettingsStore.getState().inlineCompletionsDisabled;
          const toggle = () => useSettingsStore.getState().setInlineCompletionsDisabled(!disabled);
          return (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
                      disabled ? "opacity-50" : ""
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

// ---------------------------------------------------------------------------
// Quiet variant (task #52 of 2026-04-21-ui-refresh)
//
// Minimal strip: `<words> · saved Xs ago · ⌘K ask · ⌘. focus`. The whole strip
// is clickable — clicking (or pressing Enter / Space) triggers `onOpenTray`
// which will mount the `StatusTray` popover in task #53. The `data-status-dots`
// slot now hosts task #54 ambient dots. The `data-quiet-status` attribute +
// pre-wired opacity transition let #50 target this element for fade-on-type
// without any further refactor.
// ---------------------------------------------------------------------------

/**
 * Semantic ambient dot in the quiet strip's `data-status-dots` slot.
 *
 * Two consumers today:
 *   - Local AI status (left dot). Tone mirrors `LocalAIIndicator`'s
 *     popover exactly: green=running, amber=starting (pulse), red=error,
 *     muted=stopped. Always rendered when a `local_bundled` connection
 *     exists so the strip surfaces the same state the popover does.
 *     Live-test 2026-04-25 — repeated user request "I want this to look
 *     exactly like the popover."
 *   - Recording / dictation (red, no pulse). Independent concept —
 *     rendered alongside the local AI dot when audio capture is live.
 *
 * The dot sits inside the strip which already handles
 * click-to-open-tray, so the dot's `onClick` must `stopPropagation` —
 * otherwise the parent would ALSO fire and the group-deep-link intent
 * would be lost. Keyboard users still reach these dots through normal
 * tab order; Enter activates the button.
 *
 * Neutral-palette exception: these are semantic status indicators, in
 * the same category as the destructive red allowed for errors. Colors
 * mirror the existing `LocalAIIndicator` / recording-row pattern.
 */
type StatusDotTone = "green" | "amber" | "red" | "muted";

function StatusDot({
  tone,
  ariaLabel,
  onActivate,
}: {
  tone: StatusDotTone;
  ariaLabel: string;
  /**
   * Called with the pointer coordinates when activated by a mouse click
   * (so the popover can anchor to the pointer), or `undefined` when
   * activated by keyboard (Enter / Space) — the caller should then fall
   * back to anchoring against the strip rect.
   */
  onActivate: (coords?: { x: number; y: number }) => void;
}) {
  const color =
    tone === "green"
      ? "bg-green-500"
      : tone === "amber"
        ? "bg-amber-500 animate-pulse"
        : tone === "red"
          ? "bg-red-500"
          : "bg-muted-foreground/30"; // muted — server stopped

  const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    // Prevent the enclosing strip from ALSO opening the tray without a
    // group hint. We call onActivate ourselves so the click both opens
    // the tray AND targets the correct group.
    e.stopPropagation();
    onActivate({ x: e.clientX, y: e.clientY });
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    // Same reasoning as handleClick — avoid bubbling Enter / Space up
    // to the strip's keydown handler, which would fire handleActivate
    // with no group hint.
    if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
      e.preventDefault();
      onActivate();
    }
  };

  return (
    <button
      type="button"
      data-tone={tone}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "h-1.5 w-1.5 rounded-full shrink-0 transition-opacity",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
        "hover:opacity-80",
        color,
      )}
    />
  );
}

/** Human-readable label fragment for a local AI dot tone. */
function localAiToneLabel(tone: StatusDotTone): string {
  switch (tone) {
    case "green":
      return "running";
    case "amber":
      return "starting";
    case "red":
      return "error";
    case "muted":
      return "stopped";
  }
}

/**
 * Compute the dots that should render in the quiet strip.
 *
 * - `localAiTone`: when a `local_bundled` connection exists, the colour
 *   reflects `serverStatus` directly (running → green, starting →
 *   amber+pulse, error → red, stopped → muted). When no local AI
 *   connection exists, returns `null` — the dot is omitted entirely.
 *   This mirrors the `LocalAIIndicator` popover so the strip and tray
 *   never disagree.
 * - `showRecording`: live voice recording or dictation. Independent of
 *   the local AI dot — both can render at once.
 *
 * The previous "inline completions active" orange semantic was removed
 * (live-test 2026-04-25). Inline completions still surface through the
 * StatusTray popover and via the existing `OutOfScopeCompletionsIndicator`
 * when a doc is filtered out of scope.
 */
function useStatusDotsState(): {
  localAiTone: StatusDotTone | null;
  showRecording: boolean;
} {
  const serverStatus = useLocalAIStore((s) => s.serverStatus);
  const connections = useConnectionsStore((s) => s.connections);

  const isRecording = useRecordingStore((s) => s.isRecording);

  // The local-AI dot mirrors `LocalAIIndicator`'s popover exactly. It
  // appears whenever a `local_bundled` connection exists (regardless of
  // routing), and the colour reflects the live `serverStatus`.
  const hasLocalAi = connections.some(
    (c) => c.provider === "local_ai" && c.authMethod === "local_bundled",
  );
  const localAiTone: StatusDotTone | null = !hasLocalAi
    ? null
    : serverStatus === "running"
      ? "green"
      : serverStatus === "starting"
        ? "amber"
        : serverStatus === "error"
          ? "red"
          : "muted";

  const showRecording = isRecording;

  return { localAiTone, showRecording };
}

function QuietStatusBar({
  editor,
  onOpenTray,
  comments,
  onSelectComment,
  onDelegateComment,
  onDelegateAll,
  canDelegate,
  onShortcutsOpen,
  onOpenActions,
  viewMode,
  onToggleViewMode,
}: {
  editor: Editor | null;
  onOpenTray?: () => void;
  comments?: Comment[];
  onSelectComment?: (c: Comment) => void;
  onDelegateComment?: (c: Comment) => void;
  onDelegateAll?: () => void;
  canDelegate?: boolean;
  onShortcutsOpen?: () => void;
  /** Bugs #4 — passed through to StatusTray's ActionsGroup. */
  onOpenActions?: () => void;
  viewMode?: ViewMode;
  onToggleViewMode?: () => void;
}) {
  // Read the active tab so we can render the "saved Xs ago" readout
  // next to the word count (live-test 2026-04-26 — relocated from the
  // TitleBar). The shared `<SavedLabel />` handles its own polling and
  // visibility (suppressed mid-edit, em-dash for never-saved tabs).
  const activeTab = useEditorStore((s) => {
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    return tab ?? null;
  });
  const isDirty = Boolean(activeTab?.isDirty);
  const lastSavedAt = activeTab?.lastSavedAt;

  // Re-read word count when the editor transacts so it tracks typing.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const onTransaction = () => setTick((t) => t + 1);
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  const text = editor ? editor.getText() : "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  // StatusTray is owned here — the strip clicks to open; Radix handles
  // outside-click / Escape to close. `onOpenTray` stays as an optional
  // secondary notifier so existing tests and any out-of-tree callers that
  // were already listening keep working.
  const [trayOpen, setTrayOpen] = useState(false);
  // Remembers which group a click requested — set by dot activations so
  // the tray can deep-link into the right section. Cleared when the tray
  // closes so a subsequent "blank" strip click doesn't re-target.
  const [initialGroup, setInitialGroup] = useState<StatusTrayGroup | undefined>(
    undefined,
  );
  const anchorRef = useRef<HTMLDivElement | null>(null);

  // Virtual anchor — feeds `PopoverAnchor.virtualRef`. Its `getBoundingClientRect()`
  // returns a zero-size rect at the last click location so the popover opens
  // near the pointer (via `side="top" align="start"`) rather than pinned to
  // the far-left of the whole status strip. For keyboard activation we fall
  // back to the strip's own bounding rect so the popover still has something
  // meaningful to anchor against.
  const virtualRectRef = useRef<DOMRect | null>(null);
  const virtualAnchorRef = useRef<{ getBoundingClientRect(): DOMRect }>({
    getBoundingClientRect() {
      if (virtualRectRef.current) return virtualRectRef.current;
      const el = anchorRef.current;
      if (el) return el.getBoundingClientRect();
      // Fallback zero-rect (shouldn't normally hit this path — the strip is
      // always mounted when the tray can open).
      return new DOMRect(0, 0, 0, 0);
    },
  });

  /** Stash a zero-size DOMRect at (x, y) so the popover anchors to the click. */
  const setAnchorAt = (x: number, y: number) => {
    virtualRectRef.current = new DOMRect(x, y, 0, 0);
  };

  /** Fall back to anchoring against the strip's own rect (keyboard activation). */
  const clearAnchor = () => {
    virtualRectRef.current = null;
  };

  const handleActivate = (e?: ReactMouseEvent<HTMLDivElement>) => {
    if (e && typeof e.clientX === "number" && typeof e.clientY === "number") {
      setAnchorAt(e.clientX, e.clientY);
    } else {
      clearAnchor();
    }
    setInitialGroup(undefined);
    setTrayOpen(true);
    onOpenTray?.();
  };

  const openTrayForGroup = (
    group: StatusTrayGroup,
    coords?: { x: number; y: number },
  ) => {
    if (coords) {
      setAnchorAt(coords.x, coords.y);
    } else {
      clearAnchor();
    }
    setInitialGroup(group);
    setTrayOpen(true);
    onOpenTray?.();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      // Keyboard activation has no pointer — anchor against the strip rect.
      clearAnchor();
      setInitialGroup(undefined);
      setTrayOpen(true);
      onOpenTray?.();
    }
  };

  // Reset the group hint whenever the tray closes so the next strip-level
  // click (without a dot) doesn't accidentally re-scroll to the previous
  // dot's group.
  const handleOpenChange = (next: boolean) => {
    setTrayOpen(next);
    if (!next) setInitialGroup(undefined);
  };

  const { localAiTone, showRecording } = useStatusDotsState();

  return (
    <>
      <div
        ref={anchorRef}
        data-quiet-status
        role="button"
        tabIndex={0}
        aria-label="Open status tray"
        onClick={(e) => handleActivate(e)}
        onKeyDown={handleKeyDown}
        className={cn(
          "h-8 flex items-center gap-3 px-3 text-xs text-muted-foreground",
          "cursor-pointer select-none",
          "hover:text-foreground transition-colors",
          "transition-opacity duration-[340ms] ease-in-out",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
          "motion-reduce:transition-none",
        )}
      >
        {/* Ambient dots — local AI status (left) + recording (right of
            it). The local AI dot mirrors `LocalAIIndicator`'s popover
            exactly: green=running, amber=starting (pulse), red=error,
            muted=stopped. It only renders when a `local_bundled`
            connection exists. The recording dot is independent.
            stopPropagation in StatusDot keeps the strip's own click
            from firing twice. */}
        <div data-status-dots className="flex items-center gap-1">
          {localAiTone && (
            <StatusDot
              tone={localAiTone}
              ariaLabel={`Local AI ${localAiToneLabel(localAiTone)} — opens Session group`}
              onActivate={(coords) => openTrayForGroup("session", coords)}
            />
          )}
          {showRecording && (
            <StatusDot
              tone="red"
              ariaLabel="Recording active — opens Session group"
              onActivate={(coords) => openTrayForGroup("session", coords)}
            />
          )}
        </div>

        {/* Word count is only meaningful when a document is open — when
            the editor is null (landing state, no tab) we render the
            bare chrome (dots + focus hint) without a stale "0 words"
            label. Live-test 2026-04-26 bug #3. */}
        {editor ? (
          <span className="tabular-nums">
            {fmtNum(words)} {words === 1 ? "word" : "words"}
          </span>
        ) : null}

        {/* Live-test 2026-04-26 — saved-ago moved here from the
            TitleBar so document-state info (word count + last-save
            recency) lives in one place. The slot is intentionally
            empty (no separator, no label) whenever `<SavedLabel />`
            itself would render nothing: no active tab, the tab is
            dirty (saved-ago would lie mid-edit), or the tab is clean
            but has never been saved this session (no "-" stale
            placeholder). Mounting the bullet behind the SAME gate
            that SavedLabel uses internally guarantees no orphan
            separator in any state. */}
        {activeTab && !isDirty && lastSavedAt !== undefined ? (
          <>
            <span aria-hidden="true">·</span>
            <SavedLabel
              lastSavedAt={lastSavedAt}
              isDirty={isDirty}
              className="text-xs text-muted-foreground tabular-nums"
            />
          </>
        ) : null}

        <span className="ml-auto flex items-center gap-3">
          <span>
            <kbd className="font-sans">{"\u2318"}.</kbd> focus
          </span>
        </span>
      </div>
      <StatusTray
        open={trayOpen}
        onOpenChange={handleOpenChange}
        anchor={virtualAnchorRef}
        comments={comments}
        onSelectComment={onSelectComment}
        onDelegateComment={onDelegateComment}
        onDelegateAll={onDelegateAll}
        canDelegate={canDelegate}
        onShortcutsOpen={onShortcutsOpen}
        onOpenActions={onOpenActions}
        initialExpandedGroup={initialGroup}
        editor={editor}
        viewMode={viewMode}
        onToggleViewMode={onToggleViewMode}
      />
    </>
  );
}

// `QuietSavedLabel` was removed in live-test 2026-04-25. Live-test
// 2026-04-26 \u2014 the shared `SavedLabel` is now mounted directly in the
// QuietStatusBar (next to the word count) so document-state info
// lives in one place. The TitleBar no longer renders it; only the
// dirty dot stays there. The shared `formatSavedLabel` /
// `pickTimerInterval` helpers stay in `@/lib/saved-ago` for
// `SavedLabel.tsx`.
