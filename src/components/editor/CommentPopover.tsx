import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquarePlus, Pencil, Trash2, X, Check, BotMessageSquare, CheckCircle2, MessageSquare, MoreHorizontal, MessageSquareShare } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { CommentThread, formatRelativeTime } from '@/components/editor/CommentThread';
import { DelegationPanel } from '@/components/editor/DelegationPanel';

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Reset mode when popover opens
  useEffect(() => {
    if (open) {
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
        if (!newOpen && deleteDialogOpen) return;
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
                  {navigator.userAgent.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter to submit
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
                <CommentThread
                  comment={comment}
                  linkedConversation={linkedConversation}
                  partialReply={partialReply}
                  partialReplyVersion={partialReplyVersion}
                  activities={activities}
                  onApply={onApply}
                  suggestionActive={suggestionActive}
                  onCancelDelegation={onCancelDelegation}
                />
              </div>
              <DelegationPanel
                comment={comment}
                linkedConversation={linkedConversation}
                partialReply={partialReply}
                canDelegate={canDelegate}
                activities={activities}
                onReply={onReply}
                onDelegateReply={onDelegateReply}
                onCancelDelegation={onCancelDelegation}
                onClose={() => onOpenChange(false)}
              />
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
