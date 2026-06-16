import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, GitBranch } from 'lucide-react';
import { useChatStore, type Conversation } from '@/stores/chat-store';
import { getLeaves } from '@/lib/chat-tree';
import { formatRelativeTime } from '@/components/editor/CommentThread';
import { HistoryRowLeadingIcon } from './SessionStatusBadge';
import { InlineHistoryPermission } from './InlineHistoryPermission';

export interface CommandBarHistoryProps {
  /**
   * Called when the user picks a conversation. Parent updates
   * `chat-store.activeConversationId` and switches the stream back to
   * current-chat mode.
   */
  onPickConversation: (conversationId: string) => void;
  /**
   * Called when the user wants to leave history mode without picking
   * (e.g. Esc). Optional — parent may handle dismiss elsewhere.
   */
  onDismiss?: () => void;
  /**
   * The command bar's selected project paths. When non-empty, only
   * conversations whose `projectPaths` overlap the selection are shown.
   * Empty selection shows everything.
   */
  selectedProjectPaths: string[];
}

const MAX_VISIBLE = 50;

function inScope(conv: Conversation, scope: string[]): boolean {
  if (scope.length === 0) return true;
  if (!conv.projectPaths || conv.projectPaths.length === 0) return false;
  return conv.projectPaths.some((p) => scope.includes(p));
}

function getBranchCount(conv: Conversation): number {
  if (conv.messages.length === 0) return 0;
  return getLeaves(conv.messages).length;
}

/**
 * Find the most recent assistant message that carries provider snapshots.
 * Snapshots survive connection removal — `connectionLabel` and
 * `connectionProvider` are written at generation time.
 */
function getProviderLabel(conv: Conversation): string | null {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const msg = conv.messages[i];
    if (msg.role === 'assistant' && msg.connectionLabel) return msg.connectionLabel;
  }
  return null;
}

export const CommandBarHistory = memo(function CommandBarHistory({
  onPickConversation,
  onDismiss,
  selectedProjectPaths,
}: CommandBarHistoryProps) {
  const conversations = useChatStore((s) => s.conversations);

  const visible = useMemo(() => {
    const filtered = conversations.filter((c) => inScope(c, selectedProjectPaths));
    return filtered
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_VISIBLE);
  }, [conversations, selectedProjectPaths]);

  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Reset highlight when the visible set shrinks/changes.
  useEffect(() => {
    if (highlight >= visible.length) {
      setHighlight(visible.length > 0 ? visible.length - 1 : 0);
    }
  }, [visible.length, highlight]);

  // Scroll the highlighted row into view.
  useEffect(() => {
    const el = rowRefs.current[highlight];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (visible.length === 0) {
      if (e.key === 'Escape' && onDismiss) {
        e.preventDefault();
        onDismiss();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, visible.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setHighlight(0);
        break;
      case 'End':
        e.preventDefault();
        setHighlight(visible.length - 1);
        break;
      case 'Enter': {
        e.preventDefault();
        const conv = visible[highlight];
        if (conv) onPickConversation(conv.id);
        break;
      }
      case 'Escape':
        if (onDismiss) {
          e.preventDefault();
          onDismiss();
        }
        break;
    }
  };

  return (
    <div
      ref={listRef}
      data-testid="cmd-history-list"
      role="listbox"
      aria-label="Conversation history"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex flex-col max-h-[50vh] overflow-y-auto outline-none"
    >
      <div
        data-testid="cmd-history-header"
        className="sticky top-0 z-10 bg-background/95 backdrop-blur px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground border-b border-border"
      >
        History
      </div>

      {visible.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          No past conversations
        </div>
      ) : (
        <div className="divide-y divide-border">
          {visible.map((conv, index) => {
            const branchCount = getBranchCount(conv);
            const provider = getProviderLabel(conv);
            const isHighlighted = index === highlight;
            return (
              // Wrap so the awaiting-permission inline card (task #10) can expand
              // BELOW the clickable row button (interactive controls can't nest
              // inside a <button>). `InlineHistoryPermission` renders null unless
              // this conversation has a pending request, so normal rows are
              // visually unchanged.
              <div key={conv.id}>
              <button
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                type="button"
                role="option"
                aria-selected={isHighlighted}
                onClick={() => onPickConversation(conv.id)}
                onMouseEnter={() => setHighlight(index)}
                className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                  isHighlighted ? 'bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]' : 'hover:bg-accent/50'
                }`}
              >
                <HistoryRowLeadingIcon conversationId={conv.id} />
                <div className="min-w-0 flex-1">
                  <p
                    data-testid="cmd-history-row-title"
                    className="truncate text-sm font-medium"
                  >
                    {conv.title || 'New Chat'}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span
                      data-testid="cmd-history-row-date"
                      className="flex items-center gap-1 text-[10px] text-muted-foreground"
                    >
                      <Clock className="h-2.5 w-2.5" strokeWidth={1.5} />
                      {formatRelativeTime(conv.updatedAt)}
                    </span>
                    {provider && (
                      <span className="text-[10px] text-muted-foreground">
                        {provider}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {conv.messages.length} msg{conv.messages.length === 1 ? '' : 's'}
                    </span>
                    {branchCount > 1 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <GitBranch className="h-2.5 w-2.5" strokeWidth={1.5} />
                        {branchCount} branches
                      </span>
                    )}
                  </div>
                </div>
              </button>
              <InlineHistoryPermission conversationId={conv.id} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default CommandBarHistory;
