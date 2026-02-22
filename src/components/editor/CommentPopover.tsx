import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquarePlus, Pencil, Trash2, X, Check, BotMessageSquare, CheckCircle2, Loader2, ChevronDown, ChevronRight, Square, Info, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import type { Comment, DelegationActivity } from '@/stores/comment-store';

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
  /** Called when creating a new comment AND delegating to agent */
  onDelegate?: (body: string) => void;
  /** Called to delegate an existing comment to agent */
  onDelegateExisting?: () => void;
  /** Called to cancel an active delegation */
  onCancelDelegation?: () => void;
  /** Called to resolve a comment */
  onResolve?: (commentId: string) => void;
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
  onDelegate,
  onDelegateExisting,
  onCancelDelegation,
  onResolve,
  canDelegate = false,
  activities = [],
  anchorPosition,
}: CommentPopoverProps) {
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const [body, setBody] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(true);
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
              <textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write a comment..."
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-background text-foreground px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-foreground/30"
              />
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-muted-foreground">
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
                  {mode === 'create' && canDelegate && onDelegate && (
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
                      title="Add comment and send to AI agent"
                    >
                      <BotMessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
                      Delegate
                    </Button>
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
                    <span className="text-[10px] text-muted-foreground">
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {canDelegate && onDelegateExisting && comment.status !== 'delegated' && comment.status !== 'done' && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => { onDelegateExisting(); }}
                        title="Delegate to AI agent"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <BotMessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </Button>
                    )}
                    {onResolve && comment.status !== 'resolved' && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => { onResolve(comment.id); onOpenChange(false); }}
                        title="Resolve"
                        className="text-muted-foreground"
                      >
                        <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => { setMode('edit'); setBody(comment.body); }}
                      title="Edit"
                      className="text-muted-foreground"
                    >
                      <Pencil className="h-3 w-3" strokeWidth={1.5} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setDeleteDialogOpen(true)}
                      title="Delete"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onOpenChange(false)}
                      title="Close"
                      className="text-muted-foreground"
                    >
                      <X className="h-3 w-3" strokeWidth={1.5} />
                    </Button>
                  </div>
                </div>
              </div>
              {/* Scrollable content — comment body + replies */}
              <div className="px-3 pb-2 space-y-2 max-h-80 overflow-y-auto thin-scrollbar">
                <p className="text-sm whitespace-pre-wrap text-foreground">
                  {comment.body}
                </p>
                {comment.updatedAt > comment.createdAt && !comment.replies?.length && (
                  <span className="text-[10px] text-muted-foreground">
                    edited {formatRelativeTime(comment.updatedAt)}
                  </span>
                )}
                {/* Agent replies — each individually expandable */}
                {comment.replies?.map((reply) => {
                  const isExpanded = expandedReplies.has(reply.id);
                  const isLong = reply.body.split('\n').length > 3 || reply.body.length > 200;
                  return (
                    <div key={reply.id} className="border-t border-border pt-2 mt-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <BotMessageSquare className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                        <span className="text-xs font-medium text-foreground">{reply.author}</span>
                        <span className="text-[10px] text-muted-foreground">{formatRelativeTime(reply.timestamp)}</span>
                      </div>
                      <div className={isLong && !isExpanded ? 'relative' : undefined}>
                        <p className={`text-sm whitespace-pre-wrap text-foreground ${isLong && !isExpanded ? 'line-clamp-3' : ''}`}>
                          {reply.body}
                        </p>
                        {isLong && !isExpanded && (
                          <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-popover to-transparent" />
                        )}
                      </div>
                      {isLong && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedReplies((prev) => {
                              const next = new Set(prev);
                              if (next.has(reply.id)) next.delete(reply.id);
                              else next.add(reply.id);
                              return next;
                            });
                          }}
                          className="text-[10px] text-muted-foreground hover:text-foreground active:opacity-75 transition-colors mt-0.5"
                        >
                          {isExpanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Activity footer — always visible, never scrolls */}
              {(comment.status === 'delegated' || activities.length > 0) && (
                <div className="px-3 pb-3 pt-0 shrink-0">
                  <div className="border-t border-border pt-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setActivityExpanded(!activityExpanded)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground active:opacity-75 transition-colors"
                      >
                        {comment.status === 'delegated' ? (
                          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                        ) : (
                          <BotMessageSquare className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                        )}
                        <span>{comment.status === 'delegated' ? 'AI is working on this...' : 'Agent activity'}</span>
                        {activities.length > 0 && (
                          activityExpanded
                            ? <ChevronDown className="h-3 w-3" />
                            : <ChevronRight className="h-3 w-3" />
                        )}
                      </button>
                      {comment.status === 'delegated' && onCancelDelegation && (
                        <button
                          type="button"
                          onClick={onCancelDelegation}
                          title="Cancel delegation"
                          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground active:opacity-75 transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                        >
                          <Square className="h-2.5 w-2.5" strokeWidth={1.5} />
                          Stop
                        </button>
                      )}
                    </div>
                    {activityExpanded && activities.length > 0 && (
                      <div className="pl-1 space-y-0.5 max-h-32 overflow-y-auto thin-scrollbar">
                        {activities.map((a, i) => (
                          <div key={`${a.timestamp}-${i}`} className={`flex items-start gap-1.5 text-[10px] ${a.status === 'error' ? 'text-destructive/70' : 'text-muted-foreground/70'}`}>
                            {a.status === 'running' ? (
                              <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0 mt-px" />
                            ) : a.status === 'error' ? (
                              <AlertCircle className="h-2.5 w-2.5 shrink-0 mt-px" />
                            ) : a.status === 'info' ? (
                              <Info className="h-2.5 w-2.5 shrink-0 mt-px" />
                            ) : (
                              <Check className="h-2.5 w-2.5 shrink-0 mt-px" />
                            )}
                            <div className="min-w-0">
                              <span className="truncate block">{a.label}</span>
                              {a.detail && (
                                <span className="truncate block text-muted-foreground/50" title={a.detail}>
                                  {a.detail.length > 60 ? a.detail.slice(0, 60) + '\u2026' : a.detail}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
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
