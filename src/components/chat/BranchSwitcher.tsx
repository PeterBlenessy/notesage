import { Check, Trash2 } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useChatStore, selectAllMessages, selectActiveLeafId } from '@/stores/chat-store';
import { getThread, getChildren } from '@/lib/chat-tree';
import type { ChatMessage } from '@/lib/ai/types';
import { useFormatLocale } from '@/lib/useLocale';
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

interface BranchSwitcherProps {
  /** The message ID at the branch point */
  messageId: string;
  /** Number of branches (for the trigger label) */
  branchCount: number;
  children: React.ReactNode;
}

interface BranchInfo {
  leafId: string;
  firstMessage: ChatMessage;
  messageCount: number;
  createdAt: number;
  isActive: boolean;
}

function getBranchInfo(
  allMessages: ChatMessage[],
  messageId: string,
  activeLeafId: string | null,
): BranchInfo[] {
  const children = getChildren(allMessages, messageId);
  if (children.length === 0) return [];

  return children.map((child) => {
    // The leaf is the last message in a complete thread starting from root,
    // but we want the leaf in the sub-tree starting from this child.
    // Find the leaf by traversing down from child.
    let leaf = child;
    let current: ChatMessage[] = [child];
    while (current.length > 0) {
      const next: ChatMessage[] = [];
      for (const msg of current) {
        const ch = getChildren(allMessages, msg.id ?? null);
        if (ch.length > 0) {
          next.push(...ch);
        } else {
          leaf = msg;
        }
      }
      current = next;
    }

    const leafThread = getThread(allMessages, leaf.id ?? null);
    // Count only messages after the branch point
    const branchPointIdx = leafThread.findIndex((m) => m.id === messageId);
    const branchMessages = branchPointIdx >= 0 ? leafThread.slice(branchPointIdx + 1) : leafThread;

    return {
      leafId: leaf.id ?? '',
      firstMessage: child,
      messageCount: branchMessages.length,
      createdAt: child.timestamp ?? 0,
      isActive: activeLeafId != null && leafThread.some((m) => m.id === activeLeafId),
    };
  });
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\u2026';
}

export function BranchSwitcher({ messageId, branchCount, children }: BranchSwitcherProps) {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const formatLocale = useFormatLocale();
  const allMessages = useChatStore(selectAllMessages);
  const activeLeafId = useChatStore(selectActiveLeafId);
  const switchBranch = useChatStore((s) => s.switchBranch);
  const deleteBranch = useChatStore((s) => s.deleteBranch);

  const branches = getBranchInfo(allMessages, messageId, activeLeafId);
  const canDelete = branches.length > 1;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-64 p-0"
      >
        <div className="px-3 py-2 border-b border-border">
          <p className="text-xs font-medium text-foreground">
            {branchCount} branches
          </p>
        </div>
        <div className="max-h-60 overflow-y-auto thin-scrollbar">
          {branches.map((branch, index) => {
            const preview = branch.firstMessage.role === 'user'
              ? branch.firstMessage.content
              : branch.firstMessage.content;
            const roleLabel = branch.firstMessage.role === 'user' ? 'You' : 'Assistant';

            return (
              <div
                key={branch.leafId || index}
                className={`flex items-start gap-1 px-3 py-2 transition-colors duration-150 hover:bg-accent/50 ${
                  branch.isActive ? 'bg-accent/30' : ''
                }`}
              >
                <button
                  onClick={() => switchBranch(branch.leafId)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground font-medium">{roleLabel}:</span>
                    {branch.isActive && (
                      <Check className="h-2.5 w-2.5 text-foreground shrink-0" strokeWidth={1.5} />
                    )}
                  </div>
                  <p className="text-xs text-foreground truncate mt-0.5">
                    {truncate(preview, 80)}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {branch.messageCount} message{branch.messageCount !== 1 ? 's' : ''}
                    </span>
                    {branch.createdAt > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(branch.createdAt).toLocaleTimeString(formatLocale, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </button>
                {canDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteBranch(branch.leafId);
                    }}
                    className="shrink-0 mt-1 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title={t("chat.deleteBranch")}
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
