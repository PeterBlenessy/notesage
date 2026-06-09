import { Copy, Check, User, Sparkles, ExternalLink, ChevronDown, Loader2, X, AlertTriangle, Brain, Zap, Wrench, Ban, GitBranch, Pencil, RotateCcw, Ellipsis, CircleStop, Paperclip } from 'lucide-react';
import { useState, useRef, useEffect, memo } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { MarkdownContent } from '@/components/MarkdownContent';
import { ProviderLogo } from '@/components/ProviderLogo';
import { BranchSwitcher } from './BranchSwitcher';
import { ReconnectCard } from './ReconnectCard';
import { useChatStore } from '@/stores/chat-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ChatMessage as ChatMessageType, AgentActivity, ToolCallActivity, ToolCallStatus, Segment } from '@/lib/ai/types';
import { TextSegmentView, ThinkingSegmentView, ToolCallSegmentView, ToolResultSegmentView, ImageSegmentView, ToolCallGroup } from './segments';
import { PlanSegmentView } from './segments/PlanSegmentView';

/**
 * Small wrapper that adds a consistent React Tooltip (300 ms delay,
 * top-aligned, neutral styling) to a message-action icon button.
 * Mirrors the FloatingCommandBar / CommandBarContext / IconButton
 * pattern so every chrome button in the chat surface looks the same.
 */
function ActionIconButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={className}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[220px]">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ActivityIcon({ activity, isActive }: { activity: AgentActivity; isActive: boolean }) {
  if (isActive && activity.status === 'running') {
    return <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" strokeWidth={1.5} />;
  }
  return <Check className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.5} />;
}

function ActivityLog({ activities, isActive }: { activities: AgentActivity[]; isActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  // Attachments are rendered via AttachmentFileStrip on the user bubble —
  // exclude them here so the agent activity log stays tool-call focused.
  const filtered = activities.filter((a) => a.kind !== 'attachment');
  if (filtered.length === 0) return null;
  // Only show running state if the chat is actively loading; otherwise treat all as done
  const hasRunning = isActive && filtered.some((a) => a.status === 'running');

  return (
    <div className="mt-2 pt-1.5 border-t border-border/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
      >
        <ChevronDown
          className={`h-2.5 w-2.5 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
          strokeWidth={1.5}
        />
        <span>
          {hasRunning
            ? `Working (${filtered.length} ${filtered.length === 1 ? 'step' : 'steps'})`
            : `${filtered.length} ${filtered.length === 1 ? 'step' : 'steps'} completed`}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 flex flex-col gap-0.5">
          {filtered.map((activity, i) => (
            <div
              key={`${activity.kind}-${activity.timestamp}-${i}`}
              className="flex items-start gap-1.5 pl-1 py-0.5"
            >
              <span className="mt-px shrink-0">
                <ActivityIcon activity={activity} isActive={isActive} />
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                <span className="font-medium">{activity.label}</span>
                {activity.detail && (
                  <span className="opacity-70"> — {activity.detail}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getToolCallIcon(status: ToolCallStatus, _isActive: boolean) {
  switch (status) {
    case 'pending':
    case 'running':
      return <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" strokeWidth={1.5} />;
    case 'complete':
      return <Check className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.5} />;
    case 'error':
      return <AlertTriangle className="h-2.5 w-2.5 text-destructive" strokeWidth={1.5} />;
    case 'denied':
      return <Ban className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.5} />;
  }
}

function ToolCallItem({ activity, isActive }: { activity: ToolCallActivity; isActive: boolean }) {
  const [resultExpanded, setResultExpanded] = useState(false);
  const icon = getToolCallIcon(activity.status, isActive);

  return (
    <div className="rounded-md bg-muted/30 px-2 py-1.5">
      <div className="flex items-start gap-1.5">
        <span className="mt-px shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-medium">{activity.name}</span>
          {activity.status === 'error' && activity.error && (
            <p className="text-[10px] text-destructive mt-0.5">{activity.error}</p>
          )}
          {activity.status === 'denied' && (
            <p className="text-[10px] text-muted-foreground mt-0.5">Permission denied</p>
          )}
          {activity.status === 'complete' && activity.result && (
            <button
              onClick={() => setResultExpanded(!resultExpanded)}
              className="text-[10px] text-muted-foreground hover:text-foreground mt-0.5 flex items-center gap-0.5 transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
            >
              <ChevronDown
                className={`h-2 w-2 transition-transform duration-150 ${resultExpanded ? '' : '-rotate-90'}`}
                strokeWidth={1.5}
              />
              Result
            </button>
          )}
          {resultExpanded && activity.result && (
            <pre className="mt-1 text-[9px] text-muted-foreground bg-muted/50 rounded px-1.5 py-1 overflow-x-auto max-h-32 overflow-y-auto thin-scrollbar whitespace-pre-wrap break-all">
              {activity.result}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCallLog({ activities, isActive }: { activities: ToolCallActivity[]; isActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasRunning = isActive && activities.some((a) => a.status === 'running' || a.status === 'pending');

  return (
    <div className="mt-2 pt-1.5 border-t border-border/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
      >
        <ChevronDown
          className={`h-2.5 w-2.5 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
          strokeWidth={1.5}
        />
        <Wrench className="h-2.5 w-2.5" strokeWidth={1.5} />
        <span>
          {hasRunning
            ? `Running tools (${activities.length})`
            : `${activities.length} tool ${activities.length === 1 ? 'call' : 'calls'}`}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 flex flex-col gap-1">
          {activities.map((activity) => (
            <ToolCallItem key={activity.id} activity={activity} isActive={isActive} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compact pinned list of file-path attachments logged at send time (task #30).
 * Renders once per user message, above the user-typed text. Uses the basename
 * as the visible label with the full path on hover (native `title`) so the
 * user can audit exactly what filesystem paths were shared with the provider.
 */
function AttachmentFileStrip({ message }: { message: ChatMessageType }) {
  const attachments = (message.activities ?? []).filter((a) => a.kind === 'attachment');
  if (attachments.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1">
      {attachments.map((a, i) => (
        <TooltipProvider key={`${a.timestamp}-${i}`} delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <Paperclip className="h-2.5 w-2.5 shrink-0" strokeWidth={1.5} />
                <span className="truncate max-w-[180px]">{a.label}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[260px]">
              {a.detail ?? a.label}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}

function AttachmentThumbnails({ message }: { message: ChatMessageType }) {
  if (!message.attachments || message.attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {message.attachments.map((att) => (
        <TooltipProvider key={att.id} delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="block rounded-md overflow-hidden border border-border hover:border-foreground/30 transition-colors duration-150 cursor-pointer"
                onClick={() => {
                  // Build the preview window via DOM APIs rather than a
                  // string-interpolated document.write — `mimeType`/`data` are
                  // app-controlled today, but constructing the element avoids
                  // any attribute-context breakout if that ever changes
                  // (security audit LOW).
                  const win = window.open('', '_blank');
                  if (win) {
                    win.document.title = att.name ?? 'Image';
                    const img = win.document.createElement('img');
                    img.src = `data:${att.mimeType};base64,${att.data}`;
                    img.alt = att.name ?? 'Image';
                    img.style.maxWidth = '100%';
                    img.style.height = 'auto';
                    win.document.body.appendChild(img);
                  }
                }}
                aria-label={att.name ?? 'View attached image full size'}
              >
                <img
                  src={`data:${att.mimeType};base64,${att.data}`}
                  alt={att.name ?? 'Attached image'}
                  className="max-w-[120px] max-h-[120px] object-contain"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[260px]">
              {att.name ?? 'Click to view full size'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}

function UserContent({ message }: { message: ChatMessageType }) {
  const [skillExpanded, setSkillExpanded] = useState(false);
  const displayText = message.displayContent ?? message.content;

  if (message.skillName) {
    return (
      <div>
        <AttachmentThumbnails message={message} />
        <AttachmentFileStrip message={message} />
        <button
          onClick={() => setSkillExpanded(!skillExpanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1.5"
        >
          <Zap className="h-3 w-3" strokeWidth={1.5} />
          <ChevronDown
            className={`h-2.5 w-2.5 transition-transform duration-150 ${skillExpanded ? '' : '-rotate-90'}`}
            strokeWidth={1.5}
          />
          <span>Using skill: {message.skillName}</span>
        </button>
        {skillExpanded && (
          <div className="mb-2 max-h-40 overflow-y-auto thin-scrollbar rounded-md bg-muted/40 px-2 py-1.5">
            <MarkdownContent content={message.content} className="text-xs text-muted-foreground" />
          </div>
        )}
        <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{displayText}</p>
      </div>
    );
  }

  return (
    <div>
      <AttachmentThumbnails message={message} />
      <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{displayText}</p>
    </div>
  );
}

/** Action buttons for messages. For user messages, collapses into a ⋯ menu when buttons overflow the bubble. */
function UserActionButtons({ isUser, onEdit, onResend, onBranch, onCopy, copied }: {
  isUser: boolean;
  onEdit?: () => void;
  onResend?: () => void;
  onBranch?: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // For user messages, check if buttons would overflow the bubble
  // +1 for the always-present copy button
  const userButtonCount = [onEdit, onResend, onBranch].filter(Boolean).length + 1;

  useEffect(() => {
    if (!isUser || userButtonCount === 0) return;
    const bubble = bubbleRef.current?.parentElement;
    if (!bubble) return;

    const check = () => {
      const bubbleWidth = bubble.offsetWidth;
      if (bubbleWidth === 0) return; // Not yet laid out
      // Each button is 24px + 4px gap = 28px per button, plus 8px left offset
      const buttonsWidth = userButtonCount * 28 + 8;
      setCollapsed(buttonsWidth > bubbleWidth);
    };
    check();

    const observer = new ResizeObserver(check);
    observer.observe(bubble);
    return () => observer.disconnect();
  }, [isUser, userButtonCount]);

  if (isUser) {

    if (collapsed) {
      return (
        <div ref={bubbleRef} className="absolute -bottom-3 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <DropdownMenu>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="h-6 w-6 rounded-md flex items-center justify-center bg-card border border-border hover:bg-foreground/10 hover:text-foreground transition-colors"
                      aria-label="Message actions"
                    >
                      <Ellipsis className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[220px]">
                  Message actions
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenuContent align="start" side="bottom" className="min-w-[130px] p-0.5">
              {onEdit && (
                <DropdownMenuItem onClick={onEdit} className="text-xs h-7 px-2">
                  <Pencil className="h-3 w-3 mr-1.5" strokeWidth={1.5} />
                  Edit
                </DropdownMenuItem>
              )}
              {onResend && (
                <DropdownMenuItem onClick={onResend} className="text-xs h-7 px-2">
                  <RotateCcw className="h-3 w-3 mr-1.5" strokeWidth={1.5} />
                  Resend
                </DropdownMenuItem>
              )}
              {onBranch && (
                <DropdownMenuItem onClick={onBranch} className="text-xs h-7 px-2">
                  <GitBranch className="h-3 w-3 mr-1.5" strokeWidth={1.5} />
                  Branch
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onCopy} className="text-xs h-7 px-2">
                {copied
                  ? <Check className="h-3 w-3 mr-1.5" strokeWidth={1.5} />
                  : <Copy className="h-3 w-3 mr-1.5" strokeWidth={1.5} />}
                {copied ? 'Copied' : 'Copy'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    }

    const actionBtnCls = "h-6 w-6 rounded-md flex items-center justify-center bg-card border border-border hover:bg-foreground/10 hover:text-foreground transition-colors";
    return (
      <div ref={bubbleRef} className="absolute -bottom-3 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        {onEdit && (
          <ActionIconButton label="Edit message" onClick={onEdit} className={actionBtnCls}>
            <Pencil className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
          </ActionIconButton>
        )}
        {onResend && (
          <ActionIconButton label="Resend message" onClick={onResend} className={actionBtnCls}>
            <RotateCcw className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
          </ActionIconButton>
        )}
        {onBranch && (
          <ActionIconButton label="Branch from here" onClick={onBranch} className={actionBtnCls}>
            <GitBranch className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
          </ActionIconButton>
        )}
        <ActionIconButton label={copied ? 'Copied' : 'Copy message'} onClick={onCopy} className={actionBtnCls}>
          {copied ? (
            <Check className="h-3 w-3 text-foreground" strokeWidth={1.5} />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
          )}
        </ActionIconButton>
      </div>
    );
  }

  // Assistant messages — always inline
  const actionBtnCls = "h-6 w-6 rounded-md flex items-center justify-center bg-card border border-border hover:bg-foreground/10 hover:text-foreground transition-colors";
  return (
    <div className="absolute -bottom-3 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
      {onBranch && (
        <ActionIconButton label="Branch from here" onClick={onBranch} className={actionBtnCls}>
          <GitBranch className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
        </ActionIconButton>
      )}
      <ActionIconButton label={copied ? 'Copied' : 'Copy message'} onClick={onCopy} className={actionBtnCls}>
        {copied ? (
          <Check className="h-3 w-3 text-foreground" strokeWidth={1.5} />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
        )}
      </ActionIconButton>
    </div>
  );
}

function hasSegments(message: ChatMessageType): boolean {
  return !!(message.segments && message.segments.length > 0);
}

/** Extract the verb (first word) from a tool call label for grouping */
function getVerb(seg: Segment): string {
  if (seg.type !== 'tool_call') return '';
  // Label format: "Reading file.ts", "Searching for ...", "Running: cmd", "Fetching host"
  const match = seg.label.match(/^(\S+?)(?::?\s|$)/);
  return match ? match[1] : seg.label;
}

type SegmentGroup =
  | { type: 'single'; index: number }
  | { type: 'verb_group'; label: string; startIndex: number; endIndex: number };

/**
 * Group consecutive tool segments by verb. Each run of tool_call/tool_result
 * with the same verb becomes one collapsible group. Runs with a single tool_call
 * render inline (no wrapper).
 */
function groupSegments(segments: Segment[]): SegmentGroup[] {
  const groups: SegmentGroup[] = [];
  let i = 0;
  while (i < segments.length) {
    const seg = segments[i];
    if (seg.type !== 'tool_call' && seg.type !== 'tool_result') {
      groups.push({ type: 'single', index: i });
      i++;
      continue;
    }

    // Collect consecutive tool segments, splitting by verb
    // Each tool_call starts a potential group entry; tool_results attach to their preceding call
    const toolRunStart = i;
    // Collect the full consecutive tool run first
    while (i < segments.length && (segments[i].type === 'tool_call' || segments[i].type === 'tool_result')) {
      i++;
    }
    const toolRun = segments.slice(toolRunStart, i);

    // Now split this run into verb sub-groups
    const verbRuns: Array<{ verb: string; start: number; end: number }> = [];
    let currentVerb = '';
    let runStart = toolRunStart;

    for (let j = 0; j < toolRun.length; j++) {
      const s = toolRun[j];
      if (s.type === 'tool_call') {
        const verb = getVerb(s);
        if (verb !== currentVerb && currentVerb !== '') {
          // New verb — close current run
          verbRuns.push({ verb: currentVerb, start: runStart, end: toolRunStart + j - 1 });
          runStart = toolRunStart + j;
        }
        currentVerb = verb;
      }
      // tool_result always stays with current verb
    }
    if (currentVerb) {
      verbRuns.push({ verb: currentVerb, start: runStart, end: i - 1 });
    }

    // Convert verb runs into groups
    for (const run of verbRuns) {
      const callCount = segments.slice(run.start, run.end + 1).filter((s) => s.type === 'tool_call').length;
      if (callCount >= 2) {
        groups.push({ type: 'verb_group', label: run.verb, startIndex: run.start, endIndex: run.end });
      } else {
        // Single call — render inline
        for (let j = run.start; j <= run.end; j++) {
          groups.push({ type: 'single', index: j });
        }
      }
    }
  }
  return groups;
}

function SegmentRenderer({ segments, isActivelyStreaming }: { segments: Segment[]; isActivelyStreaming: boolean }) {
  const groups = groupSegments(segments);

  return (
    <div className="flex flex-col">
      {groups.map((group) => {
        if (group.type === 'verb_group') {
          const groupSegs = segments.slice(group.startIndex, group.endIndex + 1);
          return (
            <ToolCallGroup
              key={`group-${group.startIndex}`}
              label={group.label}
              segments={groupSegs}
              isActivelyStreaming={isActivelyStreaming}
            />
          );
        }

        const index = group.index;
        const segment = segments[index];
        const isLastSegment = index === segments.length - 1;
        const isStreamingSegment = isActivelyStreaming && isLastSegment;

        // Compute thinking duration from next segment's timestamp
        let thinkingDuration: number | undefined;
        if (segment.type === 'thinking' && index < segments.length - 1) {
          const nextTimestamp = segments[index + 1].timestamp;
          thinkingDuration = (nextTimestamp - segment.timestamp) / 1000;
        }

        switch (segment.type) {
          case 'text':
            return (
              <TextSegmentView
                key={`text-${index}`}
                segment={segment}
                isStreaming={isStreamingSegment}
              />
            );
          case 'thinking':
            return (
              <ThinkingSegmentView
                key={`thinking-${index}`}
                segment={segment}
                durationSec={thinkingDuration}
                isStreaming={isStreamingSegment}
              />
            );
          case 'tool_call': {
            // When not streaming, force status to done as a safety net
            const effectiveSegment = !isActivelyStreaming && segment.status === 'running'
              ? { ...segment, status: 'done' as const }
              : segment;
            return (
              <ToolCallSegmentView
                key={`tool_call-${index}`}
                segment={effectiveSegment}
              />
            );
          }
          case 'tool_result':
            return (
              <ToolResultSegmentView
                key={`tool_result-${index}`}
                segment={segment}
              />
            );
          case 'image':
            return (
              <ImageSegmentView
                key={`image-${index}`}
                segment={segment}
              />
            );
          case 'plan':
            return (
              <PlanSegmentView
                key={`plan-${index}`}
                segment={segment}
                isStreaming={isStreamingSegment}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

interface ChatMessageProps {
  message: ChatMessageType;
  /** Whether this is the last message in the list (controls streaming cursor) */
  isLast?: boolean;
  /** Number of child branches from this message (shows branch indicator when > 1) */
  branchCount?: number;
  /** Callback to create a branch from this message's timestamp */
  onBranch?: (timestamp: number) => void;
  /** Callback to resend this user message */
  onResend?: (message: ChatMessageType) => void;
  /** Callback to edit this user message */
  onEdit?: (message: ChatMessageType) => void;
  /** Callback to retry a failed assistant message */
  onRetry?: (message: ChatMessageType) => void;
}

export const ChatMessage = memo(function ChatMessage({ message, isLast = false, branchCount, onBranch, onResend, onEdit, onRetry }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isLoading = useChatStore((s) => s.isLoading);
  const deleteMessage = useChatStore((s) => s.deleteMessage);

  // Auto-expand thinking while streaming, collapse after completion. User toggle overrides.
  const [thinkingManualToggle, setThinkingManualToggle] = useState<boolean | null>(null);
  const isActiveStream = isLoading && isLast;
  const thinkingExpanded = thinkingManualToggle ?? (isActiveStream && !!message.thinking);
  const setThinkingExpanded = (v: boolean) => setThinkingManualToggle(v);

  // Bind message/timestamp into stable () => void wrappers for child components
  const handleBranch = onBranch && message.timestamp ? () => onBranch(message.timestamp!) : undefined;
  const handleResend = onResend ? () => onResend(message) : undefined;
  const handleEdit = onEdit ? () => onEdit(message) : undefined;
  const handleRetry = onRetry ? () => onRetry(message) : undefined;

  // Tool messages are not rendered directly — their content is shown via ToolCallLog on the assistant message
  if (message.role === 'tool') return null;

  // System-status messages render as ReconnectCard
  if (message.role === 'system-status' && message.statusType) {
    return (
      <div className="mb-4 px-2">
        <ReconnectCard
          statusType={message.statusType}
          agentName={message.agentName ?? 'the agent'}
          attempt={message.attempt}
          maxAttempts={message.maxAttempts}
          dismissAt={message.dismissAt}
          messageId={message.id ?? ''}
          failedProvider={message.connectionProvider}
          onDismiss={(id) => useChatStore.getState().removeSystemStatus(id)}
        />
      </div>
    );
  }

  const isUser = message.role === 'user';
  const isActivelyStreaming = isLoading && isLast;
  const isStreaming = !isUser && isActivelyStreaming && message.content.length === 0 && !hasSegments(message);
  const hasCitations = !isUser && message.citations && message.citations.length > 0;
  const hasActivities = !isUser && message.activities && message.activities.length > 0;
  const hasToolCallActivities = !isUser && message.toolCallActivities && message.toolCallActivities.length > 0;
  const hasThinking = !isUser && !!message.thinking;
  const isThinkingOnly = hasThinking && !message.content;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenUrl = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      // Fallback: open in webview if opener fails
      window.open(url, '_blank');
    }
  };

  return (
    <div className="mb-4">
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className="h-6 w-6 rounded-full shrink-0 flex items-center justify-center mt-0.5 bg-muted">
        {isUser ? (
          <User className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
        ) : message.isError ? (
          <AlertTriangle className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
        ) : (
          <Sparkles className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
        )}
      </div>

      {/* Message bubble */}
      <div
        className={`group relative max-w-[82%] rounded-xl px-3.5 py-2.5 text-foreground ${
          isUser
            ? 'rounded-tr-sm bg-secondary border border-border'
            : 'rounded-tl-sm bg-muted'
        }`}
      >
        {/* Thinking / reasoning section — only for old messages without segments */}
        {hasThinking && !hasSegments(message) && (
          <div className={message.content ? 'mb-2' : ''}>
            <button
              onClick={() => setThinkingExpanded(!thinkingExpanded)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Brain className="h-3 w-3" strokeWidth={1.5} />
              <ChevronDown
                className={`h-2.5 w-2.5 transition-transform duration-150 ${thinkingExpanded ? '' : '-rotate-90'}`}
                strokeWidth={1.5}
              />
              <span>
                {isActivelyStreaming && isThinkingOnly ? 'Thinking...' : 'Thinking'}
              </span>
            </button>
            {thinkingExpanded && (
              <div className="mt-1 max-h-60 overflow-y-auto thin-scrollbar rounded-md bg-muted/40 px-2 py-1.5 italic">
                <MarkdownContent content={message.thinking!} className="text-xs text-muted-foreground" />
                {isActivelyStreaming && isThinkingOnly && (
                  <span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse motion-reduce:animate-none bg-muted-foreground" />
                )}
              </div>
            )}
          </div>
        )}

        {isUser ? (
          <UserContent message={message} />
        ) : message.isError ? (
          <div>
            <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{message.content}</p>
            {handleRetry && (
              <button
                onClick={handleRetry}
                className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
              >
                <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
                <span>Retry</span>
              </button>
            )}
          </div>
        ) : hasSegments(message) ? (
          <SegmentRenderer segments={message.segments!} isActivelyStreaming={isActivelyStreaming} />
        ) : isStreaming ? (
          <div className="flex items-center gap-1.5 py-1">
            <div className="h-1.5 w-1.5 rounded-full animate-pulse motion-reduce:animate-none bg-muted-foreground" />
            <div className="h-1.5 w-1.5 rounded-full animate-pulse motion-reduce:animate-none [animation-delay:150ms] bg-muted-foreground" />
            <div className="h-1.5 w-1.5 rounded-full animate-pulse motion-reduce:animate-none [animation-delay:300ms] bg-muted-foreground" />
          </div>
        ) : (
          <div>
            <MarkdownContent content={message.content} className="text-sm" />
            {isActivelyStreaming && (
              <span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse motion-reduce:animate-none bg-muted-foreground" />
            )}
          </div>
        )}

        {/* Interrupted indicator */}
        {!isUser && message.interrupted && (
          <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground/60">
            <CircleStop size={10} strokeWidth={1.5} className="shrink-0" />
            <span className="italic">Interrupted</span>
          </div>
        )}

        {/* Provider badge */}
        {!isUser && message.connectionProvider && !(isLoading && isLast) && message.content && (
          <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground/60">
            <ProviderLogo provider={message.connectionProvider} className="w-3 h-3" />
            <span>{message.connectionLabel || message.connectionProvider}</span>
          </div>
        )}

        {/* Agent Activity Log — only for old messages without segments */}
        {hasActivities && !hasSegments(message) && (
          <ActivityLog activities={message.activities!} isActive={isActivelyStreaming} />
        )}

        {/* Tool Call Activity Log — only for old messages without segments */}
        {hasToolCallActivities && !hasSegments(message) && (
          <ToolCallLog activities={message.toolCallActivities!} isActive={isActivelyStreaming} />
        )}

        {/* Citations / Sources */}
        {hasCitations && (
          <div className="mt-2.5 pt-2 border-t border-border">
            <p className="text-xs font-medium uppercase tracking-wider mb-1.5 text-muted-foreground">
              Sources
            </p>
            <ol className="list-none m-0 p-0 flex flex-col gap-1">
              {message.citations!.map((citation, i) => (
                <li key={`${citation.url}-${i}`} className="flex items-start gap-1.5">
                  <span className="text-xs font-medium shrink-0 mt-px text-muted-foreground">
                    {i + 1}.
                  </span>
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleOpenUrl(citation.url)}
                          className="text-xs leading-snug text-left transition-colors duration-150 hover:underline truncate text-foreground"
                          aria-label={`Open ${citation.title || citation.url}`}
                        >
                          <span className="flex items-center gap-1">
                            <span className="truncate">{citation.title || citation.url}</span>
                            <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-50" strokeWidth={1.5} />
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs max-w-[320px] break-all">
                        {citation.url}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Delete button — circular, positioned like macOS notification dismiss */}
        {!isLoading && message.timestamp && (
          <ActionIconButton
            label="Delete message"
            onClick={() => deleteMessage(message.timestamp!)}
            className={`absolute -top-2 ${isUser ? '-left-2' : '-right-2'} h-5 w-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all bg-card border border-border hover:bg-foreground/10 hover:text-foreground`}
          >
            <X className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.5} />
          </ActionIconButton>
        )}

        {/* Action buttons — bottom row */}
        {!isLoading && message.content && (
          <UserActionButtons
            isUser={isUser}
            onEdit={handleEdit}
            onResend={handleResend}
            onBranch={handleBranch}
            onCopy={handleCopy}
            copied={copied}
          />
        )}
      </div>
    </div>

    {/* Branch separator — full-width, clickable to open branch switcher */}
    {branchCount != null && branchCount > 1 && message.id && (
      <BranchSwitcher messageId={message.id} branchCount={branchCount}>
        <button className="flex items-center gap-2.5 w-full py-3 px-1 group/branch cursor-pointer">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground group-hover/branch:text-foreground transition-colors duration-150 shrink-0">
            <GitBranch className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span className="font-medium">{branchCount} branches</span>
          </span>
          <div className="flex-1 border-t border-border group-hover/branch:border-muted-foreground transition-colors duration-150" />
        </button>
      </BranchSwitcher>
    )}
    </div>
  );
});
