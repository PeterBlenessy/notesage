import { useState, useRef, useEffect } from 'react';
import { Bot, Check, ChevronDown, Loader2, Info, AlertCircle, Square, FileOutput, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownContent } from '@/components/MarkdownContent';
import type { Comment, DelegationActivity } from '@/stores/comment-store';
import type { Conversation } from '@/stores/chat-store';

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

export { InlineActivityLog };

export interface CommentThreadProps {
  /** The comment whose thread to render */
  comment: Comment;
  /** Linked chat conversation (if comment was moved to chat) */
  linkedConversation: Conversation | null;
  /** Partial streaming reply text */
  partialReply: string | undefined;
  /** Version counter that triggers re-render on streaming chunks */
  partialReplyVersion: number;
  /** Runtime activity log for active delegation */
  activities: DelegationActivity[];
  /** Called when user clicks Apply on an agent reply */
  onApply?: (reply: { body: string }) => void;
  /** Disables Apply when another suggestion is active */
  suggestionActive: boolean;
  /** Called to cancel an active delegation */
  onCancelDelegation?: () => void;
}

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

export { formatRelativeTime };

export function CommentThread({
  comment,
  linkedConversation,
  partialReply,
  partialReplyVersion,
  activities,
  onApply,
  suggestionActive,
  onCancelDelegation,
}: CommentThreadProps) {
  const streamingEndRef = useRef<HTMLSpanElement>(null);

  // Auto-scroll to follow streaming text
  useEffect(() => {
    if (partialReply && streamingEndRef.current) {
      streamingEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [partialReplyVersion, partialReply]);

  // Compute effective replies: linked conversation messages (skip first = original comment) or comment.replies
  type EffectiveReply = { id: string; body: string; author: string; timestamp: number; msgActivities?: DelegationActivity[] };
  const effectiveReplies: EffectiveReply[] =
    linkedConversation
      ? linkedConversation.messages.slice(1).map((msg) => ({
          id: String(msg.timestamp),
          body: msg.content,
          author: msg.role === 'user' ? 'You' : (msg.connectionLabel || 'AI'),
          timestamp: msg.timestamp ?? 0,
          // Map AgentActivity -> DelegationActivity shape
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

  return (
    <>
      {effectiveReplies.map((reply) => {
        const isUserReply = reply.author === 'You';
        const replyActivities = reply.msgActivities;
        return (
          <div key={reply.id} className="border-t border-border pt-2 mt-2">
            <div className="flex items-center gap-1.5 mb-1">
              {isUserReply ? (
                <User className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
              ) : (
                <Bot className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
              )}
              <span className="text-xs font-medium text-foreground">{reply.author}</span>
              <span className="text-xs text-muted-foreground">{formatRelativeTime(reply.timestamp)}</span>
            </div>
            <MarkdownContent content={reply.body} className="text-sm" />
            {/* Per-message activity log */}
            {replyActivities && replyActivities.length > 0 && (
              <InlineActivityLog activities={replyActivities} />
            )}
            <div className="flex items-center justify-end mt-0.5">
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
      })}
      {/* Streaming reply — shown while agent is generating */}
      {comment.status === 'delegated' && partialReply && (
        <div className="border-t border-border pt-2 mt-2">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <Bot className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
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
    </>
  );
}
