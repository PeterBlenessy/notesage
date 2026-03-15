import { useState, useRef } from 'react';
import { BotMessageSquare, Loader2, SendHorizontal, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { InlineActivityLog } from '@/components/editor/CommentThread';
import type { Comment, DelegationActivity } from '@/stores/comment-store';
import type { Conversation } from '@/stores/chat-store';

export interface DelegationPanelProps {
  /** The comment this panel belongs to */
  comment: Comment;
  /** Linked chat conversation (if comment was moved to chat) */
  linkedConversation: Conversation | null;
  /** Partial streaming reply text (used to determine delegation status bar visibility) */
  partialReply: string | undefined;
  /** Whether an agent is available for delegation */
  canDelegate: boolean;
  /** Runtime activity log for active delegation */
  activities: DelegationActivity[];
  /** Called when user sends a follow-up reply (chat mode) */
  onReply?: (text: string) => void;
  /** Called when user sends a reply and delegates to agent (background) */
  onDelegateReply?: (text: string) => void;
  /** Called to cancel an active delegation */
  onCancelDelegation?: () => void;
  /** Called to close the parent popover */
  onClose: () => void;
}

export function DelegationPanel({
  comment,
  linkedConversation,
  partialReply,
  canDelegate,
  activities,
  onReply,
  onDelegateReply,
  onCancelDelegation,
  onClose,
}: DelegationPanelProps) {
  const [replyText, setReplyText] = useState('');
  const replyInputRef = useRef<HTMLInputElement>(null);

  const showReplyInput = ((comment.status === 'done' && canDelegate) || linkedConversation) && onReply;
  const showDelegationStatus = comment.status === 'delegated' && !partialReply && onCancelDelegation;

  if (!showReplyInput && !showDelegationStatus) return null;

  return (
    <>
      {/* Reply input — shown when agent has responded or conversation is linked to chat */}
      {showReplyInput && (
        <div className="px-3 pb-2 pt-0 shrink-0 border-t border-border">
          <div className="flex items-center gap-1.5 mt-2">
            <Input
              ref={replyInputRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && replyText.trim()) {
                  e.preventDefault();
                  onReply!(replyText.trim());
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
                        onReply!(replyText.trim());
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
                          onClose();
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
      {showDelegationStatus && (
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
    </>
  );
}
