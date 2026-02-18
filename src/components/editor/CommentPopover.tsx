import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquarePlus, Pencil, Trash2, X, Check } from 'lucide-react';
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
import type { Comment } from '@/stores/comment-store';

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
  anchorPosition,
}: CommentPopoverProps) {
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const [body, setBody] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
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
    if ((mode === 'create' || mode === 'edit') && textareaRef.current) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
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
          className="w-72 p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {(mode === 'create' || mode === 'edit') && (
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <MessageSquarePlus
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: 'var(--color-muted-foreground)' }}
                  strokeWidth={1.5}
                />
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted-foreground)' }}>
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
                className="w-full resize-none rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-foreground/30"
                style={{
                  backgroundColor: 'var(--color-background)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-foreground)',
                }}
              />
              <div className="flex justify-between items-center">
                <span className="text-[10px]" style={{ color: 'var(--color-muted-foreground)' }}>
                  {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to submit
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
                  <Button
                    variant="default"
                    size="xs"
                    onClick={handleSubmit}
                    disabled={!body.trim()}
                  >
                    <Check className="h-3 w-3" strokeWidth={2} />
                    {mode === 'create' ? 'Add' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {mode === 'view' && comment && (
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-foreground)' }}>
                    {comment.author || 'You'}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--color-muted-foreground)' }}>
                    {formatRelativeTime(comment.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => { setMode('edit'); setBody(comment.body); }}
                    className="h-6 w-6 rounded-md flex items-center justify-center transition-colors"
                    style={{ color: 'var(--color-muted-foreground)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                    title="Edit"
                  >
                    <Pencil className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => setDeleteDialogOpen(true)}
                    className="h-6 w-6 rounded-md flex items-center justify-center transition-colors"
                    style={{ color: 'var(--color-destructive)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => onOpenChange(false)}
                    className="h-6 w-6 rounded-md flex items-center justify-center transition-colors"
                    style={{ color: 'var(--color-muted-foreground)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                    title="Close"
                  >
                    <X className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--color-foreground)' }}>
                {comment.body}
              </p>
              {comment.updatedAt > comment.createdAt && (
                <span className="text-[10px]" style={{ color: 'var(--color-muted-foreground)' }}>
                  edited {formatRelativeTime(comment.updatedAt)}
                </span>
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
