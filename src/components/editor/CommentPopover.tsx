import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, MessageSquarePlus, Pencil, Trash2, X, Check, BotMessageSquare, CheckCircle2, Loader2, ChevronDown, Square, Info, AlertCircle, SendHorizontal, FileOutput, User, MessageSquareShare, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { useCommentStore, getPartialReply, type Comment, type DelegationActivity } from '@/stores/comment-store';
import { useChatStore } from '@/stores/chat-store';
import { MarkdownContent } from '@/components/MarkdownContent';

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** Collapsible activity log rendered inline within each agent message. */
function InlineActivityLog({ activities }: { activities: DelegationActivity[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasRunning = activities.some((a) => a.status === 'running');

  return (
    <div className="mt-1.5 pt-1 border-t border-border/50">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
          strokeWidth={1.5}
        />
        <span>
          {hasRunning
            ? `Working (${activities.length} ${activities.length === 1 ? 'step' : 'steps'})`
            : `${activities.length} ${activities.length === 1 ? 'step' : 'steps'} completed`}
        </span>
      </button>
      {expanded && (
        <div className="mt-0.5 flex flex-col gap-0.5">
          {activities.map((a, i) => (
            <div key={`${a.timestamp}-${i}`} className={`flex items-start gap-1.5 pl-1 py-0.5 text-xs ${a.status === 'error' ? 'text-destructive/70' : 'text-muted-foreground/70'}`}>
              <span className="mt-px shrink-0">
                {a.status === 'running' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : a.status === 'error' ? (
                  <AlertCircle className="h-3 w-3" />
                ) : a.status === 'info' ? (
                  <Info className="h-3 w-3" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
              </span>
              <span className="leading-tight min-w-0">
                <span className="font-medium">{a.label}</span>
                {a.detail && (
                  <span className="opacity-70"> — {a.detail.length > 60 ? a.detail.slice(0, 60) + '\u2026' : a.detail}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CommentPopoverProps {
  /** The comment to display (null = create mode) */
  comment: Comment | null;
  /** Whether the popover is open */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when creating a new comment */
  onCreate?: (body: string) => void;
  /** Called when editing an existing comment */
  onEdit?: (commentId: string, body: string) => void;
  /** Called when deleting a comment */
  onDelete?: (commentId: string) => void;
  /** Called when creating a new comment AND chatting with agent inline (popover stays open) */
  onChat?: (body: string) => void;
  /** Called when creating a new comment AND delegating to agent (popover closes) */
  onDelegate?: (body: string) => void;
  /** Called to delegate an existing comment to agent (popover closes) */
  onDelegateExisting?: () => void;
  /** Called to start an inline chat on an existing comment (popover stays open) */
  onChatExisting?: () => void;
  /** Called to cancel an active delegation */
  onCancelDelegation?: () => void;
  /** Called to resolve a comment */
  onResolve?: (commentId: string) => void;
  /** Called to move the conversation to the chat panel */
  onMoveToChat?: () => void;
  /** Called when user sends a follow-up reply (chat mode — inline) */
  onReply?: (text: string) => void;
  /** Called when user sends a reply and delegates to agent (background) */
  onDelegateReply?: (text: string) => void;
  /** Called when user clicks Apply on an agent reply */
  onApply?: (reply: { body: string }) => void;
  /** Disables Apply when another suggestion is active */
  suggestionActive?: boolean;
  /** Whether an agent is available for delegation */
  canDelegate?: boolean;
  /** Runtime activity log for active delegation */
  activities?: DelegationActivity[];
  /** Viewport position to anchor the popover to */
  anchorPosition: { top: number; left: number } | null;
}

export function CommentPopover({
  comment,
  open,
  onOpenChange,
  onCreate,
  onEdit,
  onDelete,
  onChat,
  onDelegate,
  onDelegateExisting,
  onChatExisting,
  onCancelDelegation,
  onResolve,
  onMoveToChat,
  onReply,
  onDelegateReply,
  onApply,
  suggestionActive = false,
  canDelegate = false,
  activities = [],
  anchorPosition,
}: CommentPopoverProps) {
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const [body, setBody] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [threadExpanded, setThreadExpanded] = useState(false);
  const [replyText, setReplyText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);
  const streamingEndRef = useRef<HTMLSpanElement>(null);

  // Subscribe to partial reply version counter — triggers re-render when chunks arrive
  const partialReplyVersion = useCommentStore((s) => s.partialReplyVersion);
  const partialReply = comment ? getPartialReply(comment.documentId, comment.id) : undefined;
  // Subscribe to delegation mode for dismiss guard
  const delegationMode = useCommentStore((s) => comment ? s.delegationModeByComment[comment.id] : undefined);

  // Read linked conversation from chat store (if comment was moved to chat)
  const linkedConversation = useChatStore((s) => {
    if (!comment?.linkedConversationId) return null;
    return s.conversations.find((c) => c.id === comment.linkedConversationId) ?? null;
  });

  // Auto-scroll to follow streaming text
  useEffect(() => {
    if (partialReply && streamingEndRef.current) {
      streamingEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [partialReplyVersion, partialReply]);

  // Reset mode when popover opens
  useEffect(() => {
    if (open) {
      setReplyText('');
      setThreadExpanded(false);
      if (comment) {
        setMode('view');
        setBody(comment.body);
      } else {
        setMode('create');
        setBody('');
      }
    }
  }, [open, comment]);

  // Focus textarea when entering create/edit mode
  useEffect(() => {
    if (mode === 'create' || mode === 'edit') {
      // Use a short timeout to ensure the popover content is fully mounted
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [mode]);

  const handleSubmit = useCallback(() => {
    const trimmed = body.trim();
    if (!trimmed) return;

    if (mode === 'create') {
      onCreate?.(trimmed);
    } else if (mode === 'edit' && comment) {
      onEdit?.(comment.id, trimmed);
    }
    onOpenChange(false);
  }, [body, mode, comment, onCreate, onEdit, onOpenChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      if (mode === 'edit') {
        setMode('view');
        setBody(comment?.body ?? '');
      } else {
        onOpenChange(false);
      }
    }
  };

  const handleDelete = () => {
    if (comment) {
      onDelete?.(comment.id);
      setDeleteDialogOpen(false);
      onOpenChange(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={(newOpen) => {
        // Don't close when the delete confirmation dialog is open
        if (!newOpen && deleteDialogOpen) return;
        // Don't dismiss during active chat streaming (outside clicks, Escape)
        if (!newOpen && delegationMode === 'chat' && comment?.status === 'delegated') return;
        onOpenChange(newOpen);
      }}>
        <PopoverAnchor asChild>
          <span
            style={{
              position: 'fixed',
              top: anchorPosition?.top ?? 0,
              left: anchorPosition?.left ?? 0,
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={8}
          className="w-[480px] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {(mode === 'create' || mode === 'edit') && (
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <MessageSquarePlus
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {mode === 'create' ? 'Add comment' : 'Edit comment'}
                </span>
              </div>
              <Textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write a comment..."
                rows={3}
                className="resize-none min-h-0 text-sm"
              />
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">
                  {navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to submit
                </span>
                <div className="flex gap-1.5">
                  {mode === 'edit' && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => { setMode('view'); setBody(comment?.body ?? ''); }}
                    >
                      Cancel
                    </Button>
                  )}
                  {mode === 'create' && canDelegate && onChat && (
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => {
                              const trimmed = body.trim();
                              if (trimmed) {
                                onChat(trimmed);
                              }
                            }}
                            disabled={!body.trim()}
                          >
                            <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
                            Chat
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Add comment and chat with AI agent</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {mode === 'create' && canDelegate && onDelegate && (
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => {
                              const trimmed = body.trim();
                              if (trimmed) {
                                onDelegate(trimmed);
                                onOpenChange(false);
                              }
                            }}
                            disabled={!body.trim()}
                          >
                            <BotMessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
                            Delegate
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Add comment and delegate to AI agent</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <Button
                    variant="default"
                    size="xs"
                    onClick={handleSubmit}
                    disabled={!body.trim()}
                  >
                    <Check className="h-3 w-3" strokeWidth={1.5} />
                    {mode === 'create' ? 'Add' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {mode === 'view' && comment && (
            <div className="flex flex-col">
              {/* Header — always visible */}
              <div className="p-3 pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground">
                      {comment.author || 'You'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                  </div>
                  <TooltipProvider delayDuration={300}>
                    <div className="flex items-center gap-1">
                      {/* Chat + Delegate: only when no conversation yet (no replies) */}
                      {canDelegate && onChatExisting && (!comment.status || comment.status === 'open') && !comment.replies?.length && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={onChatExisting}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">Chat with AI agent</TooltipContent>
                        </Tooltip>
                      )}
                      {canDelegate && onDelegateExisting && (!comment.status || comment.status === 'open') && !comment.replies?.length && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => { onDelegateExisting(); onOpenChange(false); }}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <BotMessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">Delegate to AI agent</TooltipContent>
                        </Tooltip>
                      )}
                      {onMoveToChat && comment.status === 'done' && !comment.linkedConversationId && comment.replies && comment.replies.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => { onMoveToChat(); onOpenChange(false); }}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <MessageSquareShare className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">Move to Chat</TooltipContent>
                        </Tooltip>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          {onResolve && comment.status !== 'resolved' && (
                            <DropdownMenuItem onClick={() => { onResolve(comment.id); onOpenChange(false); }}>
                              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                              Resolve
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => { setMode('edit'); setBody(comment.body); }}>
                            <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteDialogOpen(true)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => onOpenChange(false)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Close</TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </div>
              </div>
              {/* Scrollable content — comment body + replies */}
              <div className="px-3 pb-2 space-y-2 max-h-80 overflow-y-auto thin-scrollbar">
                <p className="text-sm whitespace-pre-wrap text-foreground">
                  {comment.body}
                </p>
                {comment.updatedAt > comment.createdAt && !comment.replies?.length && !linkedConversation && (
                  <span className="text-xs text-muted-foreground">
                    edited {formatRelativeTime(comment.updatedAt)}
                  </span>
                )}
                {/* Replies — from linked conversation or comment.replies */}
                {(() => {
                  // Compute effective replies: linked conversation messages (skip first = original comment) or comment.replies
                  type EffectiveReply = { id: string; body: string; author: string; timestamp: number; msgActivities?: DelegationActivity[] };
                  const effectiveReplies: EffectiveReply[] =
                    linkedConversation
                      ? linkedConversation.messages.slice(1).map((msg) => ({
                          id: String(msg.timestamp),
                          body: msg.content,
                          author: msg.role === 'user' ? 'You' : (msg.connectionLabel || 'AI'),
                          timestamp: msg.timestamp ?? 0,
                          // Map AgentActivity → DelegationActivity shape
                          msgActivities: msg.activities?.map((a) => ({
                            label: a.label,
                            detail: a.detail,
                            status: a.status as DelegationActivity['status'],
                            timestamp: a.timestamp,
                          })),
                        }))
                      : (comment.replies ?? []).map((reply) => ({
                            ...reply,
                            // Persisted activities are historical — force any stale 'running' to 'done'
                            msgActivities: reply.activities?.map((a) =>
                              a.status === 'running' ? { ...a, status: 'done' as const } : a
                            ),
                          }));

                  return effectiveReplies.map((reply) => {
                  const isLong = reply.body.split('\n').length > 3 || reply.body.length > 200;
                  const isClamped = isLong && !threadExpanded;
                  const isUserReply = reply.author === 'You';
                  const replyActivities = reply.msgActivities;
                  return (
                    <div key={reply.id} className="border-t border-border pt-2 mt-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        {isUserReply ? (
                          <User className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                        ) : (
                          <BotMessageSquare className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                        )}
                        <span className="text-xs font-medium text-foreground">{reply.author}</span>
                        <span className="text-xs text-muted-foreground">{formatRelativeTime(reply.timestamp)}</span>
                      </div>
                      <div className={isClamped ? 'relative' : undefined}>
                        <div className={isClamped ? 'line-clamp-3' : undefined}>
                          <MarkdownContent content={reply.body} className="text-sm" />
                        </div>
                        {isClamped && (
                          <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-popover to-transparent" />
                        )}
                      </div>
                      {/* Per-message activity log */}
                      {replyActivities && replyActivities.length > 0 && (
                        <InlineActivityLog activities={replyActivities} />
                      )}
                      <div className="flex items-center justify-between mt-0.5">
                        {isLong && !threadExpanded ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setThreadExpanded(true);
                            }}
                            className="text-xs text-muted-foreground hover:text-foreground active:opacity-75 transition-colors rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            Show more
                          </button>
                        ) : <span />}
                        {!isUserReply && (comment.status === 'done' || linkedConversation) && onApply && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => onApply(reply)}
                            disabled={suggestionActive}
                            title={suggestionActive ? 'Another suggestion is active' : 'Apply to document'}
                            className="text-muted-foreground hover:text-foreground h-5 px-1.5 text-xs gap-0.5"
                          >
                            <FileOutput className="h-3.5 w-3.5" strokeWidth={1.5} />
                            Apply
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                  });
                })()}
                {/* Streaming reply — shown while agent is generating */}
                {comment.status === 'delegated' && partialReply && (
                  <div className="border-t border-border pt-2 mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <BotMessageSquare className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                        <span className="text-xs font-medium text-foreground">AI Agent</span>
                        <span className="text-xs text-muted-foreground">streaming...</span>
                      </div>
                      {onCancelDelegation && (
                        <button
                          type="button"
                          onClick={onCancelDelegation}
                          title="Stop"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground active:opacity-75 transition-colors px-1.5 py-0.5 rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <Square className="h-3 w-3" strokeWidth={1.5} />
                          Stop
                        </button>
                      )}
                    </div>
                    <MarkdownContent content={partialReply} className="text-sm" />
                    <span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse bg-muted-foreground" />
                    <span ref={streamingEndRef} />
                    {/* Activity log during streaming */}
                    {activities.length > 0 && (
                      <InlineActivityLog activities={activities} />
                    )}
                  </div>
                )}
              </div>
              {/* Reply input — shown when agent has responded or conversation is linked to chat */}
              {((comment.status === 'done' && canDelegate) || linkedConversation) && onReply && (
                <div className="px-3 pb-2 pt-0 shrink-0 border-t border-border">
                  <div className="flex items-center gap-1.5 mt-2">
                    <Input
                      ref={replyInputRef}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && replyText.trim()) {
                          e.preventDefault();
                          onReply(replyText.trim());
                          setReplyText('');
                        }
                        if (e.key === 'Escape') {
                          setReplyText('');
                        }
                      }}
                      placeholder="Reply to agent..."
                      className="flex-1 h-7 text-xs"
                    />
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                              if (replyText.trim()) {
                                onReply(replyText.trim());
                                setReplyText('');
                              }
                            }}
                            disabled={!replyText.trim()}
                            className="text-muted-foreground hover:text-foreground shrink-0"
                          >
                            <SendHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Send reply (chat)</TooltipContent>
                      </Tooltip>
                      {onDelegateReply && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => {
                                if (replyText.trim()) {
                                  onDelegateReply(replyText.trim());
                                  setReplyText('');
                                  onOpenChange(false);
                                }
                              }}
                              disabled={!replyText.trim()}
                              className="text-muted-foreground hover:text-foreground shrink-0"
                            >
                              <BotMessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">Delegate reply (background)</TooltipContent>
                        </Tooltip>
                      )}
                    </TooltipProvider>
                  </div>
                </div>
              )}
              {/* Delegation status bar — activity log + stop button, shown while delegated without partial reply */}
              {comment.status === 'delegated' && !partialReply && onCancelDelegation && (
                <div className="px-3 pb-3 pt-0 shrink-0">
                  <div className="border-t border-border pt-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                        <span>AI is working on this...</span>
                      </div>
                      <button
                        type="button"
                        onClick={onCancelDelegation}
                        title="Cancel delegation"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground active:opacity-75 transition-colors px-1.5 py-0.5 rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <Square className="h-3 w-3" strokeWidth={1.5} />
                        Stop
                      </button>
                    </div>
                    {activities.length > 0 && (
                      <InlineActivityLog activities={activities} />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The comment will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
