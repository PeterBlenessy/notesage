import { Copy, Check, User, Sparkles, ExternalLink, ChevronDown, Loader2, X, AlertTriangle, Brain, Zap, Wrench, Ban, GitBranch } from 'lucide-react';
import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { MarkdownContent } from '@/components/MarkdownContent';
import { ProviderLogo } from '@/components/ProviderLogo';
import { BranchSwitcher } from './BranchSwitcher';
import { useChatStore } from '@/stores/chat-store';
import type { ChatMessage as ChatMessageType, AgentActivity, ToolCallActivity, ToolCallStatus } from '@/lib/ai/types';

function ActivityIcon({ activity, isActive }: { activity: AgentActivity; isActive: boolean }) {
  if (isActive && activity.status === 'running') {
    return <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" strokeWidth={1.5} />;
  }
  return <Check className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.5} />;
}

function ActivityLog({ activities, isActive }: { activities: AgentActivity[]; isActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  // Only show running state if the chat is actively loading; otherwise treat all as done
  const hasRunning = isActive && activities.some((a) => a.status === 'running');

  return (
    <div className="mt-2 pt-1.5 border-t border-border/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown
          className={`h-2.5 w-2.5 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
          strokeWidth={1.5}
        />
        <span>
          {hasRunning
            ? `Working (${activities.length} ${activities.length === 1 ? 'step' : 'steps'})`
            : `${activities.length} ${activities.length === 1 ? 'step' : 'steps'} completed`}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 flex flex-col gap-0.5">
          {activities.map((activity, i) => (
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
              className="text-[10px] text-muted-foreground hover:text-foreground mt-0.5 flex items-center gap-0.5 transition-colors"
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
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
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

function UserContent({ message }: { message: ChatMessageType }) {
  const [skillExpanded, setSkillExpanded] = useState(false);
  const displayText = message.displayContent ?? message.content;

  if (message.skillName) {
    return (
      <div>
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

  return <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{displayText}</p>;
}

interface ChatMessageProps {
  message: ChatMessageType;
  /** Whether this is the last message in the list (controls streaming cursor) */
  isLast?: boolean;
  /** Number of child branches from this message (shows branch indicator when > 1) */
  branchCount?: number;
  /** Callback to create a branch from this message */
  onBranch?: () => void;
}

export function ChatMessage({ message, isLast = false, branchCount, onBranch }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const { isLoading, deleteMessage } = useChatStore();

  // Auto-expand thinking while streaming, collapse after completion. User toggle overrides.
  const [thinkingManualToggle, setThinkingManualToggle] = useState<boolean | null>(null);
  const isActiveStream = isLoading && isLast;
  const thinkingExpanded = thinkingManualToggle ?? (isActiveStream && !!message.thinking);
  const setThinkingExpanded = (v: boolean) => setThinkingManualToggle(v);

  // Tool messages are not rendered directly — their content is shown via ToolCallLog on the assistant message
  if (message.role === 'tool') return null;

  const isUser = message.role === 'user';
  const isActivelyStreaming = isLoading && isLast;
  const isStreaming = !isUser && isActivelyStreaming && message.content.length === 0;
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
        {/* Thinking / reasoning section */}
        {hasThinking && (
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
                  <span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse bg-muted-foreground" />
                )}
              </div>
            )}
          </div>
        )}

        {isUser ? (
          <UserContent message={message} />
        ) : message.isError ? (
          <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{message.content}</p>
        ) : isStreaming ? (
          <div className="flex items-center gap-1.5 py-1">
            <div className="h-1.5 w-1.5 rounded-full animate-pulse bg-muted-foreground" />
            <div className="h-1.5 w-1.5 rounded-full animate-pulse [animation-delay:150ms] bg-muted-foreground" />
            <div className="h-1.5 w-1.5 rounded-full animate-pulse [animation-delay:300ms] bg-muted-foreground" />
          </div>
        ) : (
          <div>
            <MarkdownContent content={message.content} className="text-sm" />
            {isActivelyStreaming && (
              <span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse bg-muted-foreground" />
            )}
          </div>
        )}

        {/* Provider badge */}
        {!isUser && message.connectionProvider && !isLoading && message.content && (
          <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground/60">
            <ProviderLogo provider={message.connectionProvider} className="w-3 h-3" />
            <span>{message.connectionLabel || message.connectionProvider}</span>
          </div>
        )}

        {/* Agent Activity Log */}
        {hasActivities && (
          <ActivityLog activities={message.activities!} isActive={isActivelyStreaming} />
        )}

        {/* Tool Call Activity Log */}
        {hasToolCallActivities && (
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
                  <button
                    onClick={() => handleOpenUrl(citation.url)}
                    className="text-xs leading-snug text-left transition-colors duration-150 hover:underline truncate text-foreground"
                    title={citation.url}
                  >
                    <span className="flex items-center gap-1">
                      <span className="truncate">{citation.title || citation.url}</span>
                      <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-50" strokeWidth={1.5} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Delete button — circular, positioned like macOS notification dismiss */}
        {!isLoading && message.timestamp && (
          <button
            className={`absolute -top-2 ${isUser ? '-left-2' : '-right-2'} h-5 w-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-card border border-border`}
            onClick={() => deleteMessage(message.timestamp!)}
            title="Delete message"
          >
            <X className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={1.5} />
          </button>
        )}

        {/* Action buttons — bottom row */}
        {!isLoading && message.content && (
          <div className={`absolute -bottom-3 ${isUser ? 'left-2' : 'right-2'} flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity`}>
            {onBranch && (
              <button
                className="h-6 w-6 rounded-md flex items-center justify-center bg-card border border-border"
                onClick={onBranch}
                title="Branch from here"
              >
                <GitBranch className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
              </button>
            )}
            {!isUser && (
              <button
                className="h-6 w-6 rounded-md flex items-center justify-center bg-card border border-border"
                onClick={handleCopy}
                title="Copy message"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-foreground" strokeWidth={1.5} />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                )}
              </button>
            )}
          </div>
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
}
