import { User, Sparkles, ExternalLink, ChevronDown, X, AlertTriangle, Brain, GitBranch, RotateCcw, CircleStop } from 'lucide-react';
import { useState, memo } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { MarkdownContent } from '@/components/MarkdownContent';
import { ProviderLogo } from '@/components/ProviderLogo';
import { BranchSwitcher } from './BranchSwitcher';
import { ReconnectCard } from './ReconnectCard';
import { useChatStore } from '@/stores/chat-store';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ChatMessage as ChatMessageType } from '@/lib/ai/types';
import { ActionIconButton } from './message/ActionIconButton';
import { ActivityLog } from './message/ActivityLog';
import { ToolCallLog } from './message/ToolCallLog';
import { UserContent } from './message/UserContent';
import { UserActionButtons } from './message/UserActionButtons';
import { SegmentRenderer } from './message/SegmentRenderer';
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

function hasSegments(message: ChatMessageType): boolean {
  return !!(message.segments && message.segments.length > 0);
}

interface ChatMessageProps {
  message: ChatMessageType;
  /**
   * Whether this message is the tail of an actively streaming run
   * (`isLoading && isLast`, computed by the parent list). Drives the streaming
   * cursor / thinking auto-expand and hides mutation affordances while the
   * stream writes into this message. Passed as a prop — rather than
   * subscribed via `useForegroundLoading()` — so a loading flip only
   * re-renders the one message whose prop changed (render-perf finding #3).
   */
  isActivelyStreaming?: boolean;
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

export const ChatMessage = memo(function ChatMessage({ message, isActivelyStreaming = false, branchCount, onBranch, onResend, onEdit, onRetry }: ChatMessageProps) {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const [copied, setCopied] = useState(false);
  const deleteMessage = useChatStore((s) => s.deleteMessage);

  // Auto-expand thinking while streaming, collapse after completion. User toggle overrides.
  const [thinkingManualToggle, setThinkingManualToggle] = useState<boolean | null>(null);
  const thinkingExpanded = thinkingManualToggle ?? (isActivelyStreaming && !!message.thinking);
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
                <span>{t("chat.retry")}</span>
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
            <span className="italic">{t("chat.interrupted")}</span>
          </div>
        )}

        {/* Provider badge */}
        {!isUser && message.connectionProvider && !isActivelyStreaming && message.content && (
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

        {/* Delete button — circular, positioned like macOS notification dismiss.
            Hidden while the stream is actively writing into THIS message; earlier
            messages keep their affordances during a run (render-perf finding #3). */}
        {!isActivelyStreaming && message.timestamp && (
          <ActionIconButton
            label="Delete message"
            onClick={() => deleteMessage(message.timestamp!)}
            className={`absolute -top-2 ${isUser ? '-left-2' : '-right-2'} h-5 w-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all bg-card border border-border hover:bg-foreground/10 hover:text-foreground`}
          >
            <X className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.5} />
          </ActionIconButton>
        )}

        {/* Action buttons — bottom row */}
        {!isActivelyStreaming && message.content && (
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
