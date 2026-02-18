import { Copy, Check, User, Sparkles, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useChatStore } from '@/stores/chat-store';
import type { ChatMessage as ChatMessageType } from '@/lib/ai/types';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const { isLoading } = useChatStore();

  const isUser = message.role === 'user';
  const isStreaming = !isUser && isLoading && message.content.length === 0;
  const hasCitations = !isUser && message.citations && message.citations.length > 0;

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
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''} mb-4`}>
      {/* Avatar */}
      <div
        className="h-6 w-6 rounded-full shrink-0 flex items-center justify-center mt-0.5"
        style={{
          backgroundColor: 'var(--color-muted)',
        }}
      >
        {isUser ? (
          <User className="h-3 w-3" style={{ color: 'var(--color-muted-foreground)' }} />
        ) : (
          <Sparkles className="h-3 w-3" style={{ color: 'var(--color-muted-foreground)' }} />
        )}
      </div>

      {/* Message bubble */}
      <div
        className={`group relative max-w-[82%] rounded-xl px-3.5 py-2.5 ${
          isUser
            ? 'rounded-tr-sm'
            : 'rounded-tl-sm'
        }`}
        style={{
          backgroundColor: isUser ? 'var(--color-secondary)' : 'var(--color-muted)',
          color: 'var(--color-foreground)',
          border: isUser ? '1px solid var(--color-border)' : undefined,
        }}
      >
        {isUser ? (
          <p className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed">{message.content}</p>
        ) : isStreaming ? (
          <div className="flex items-center gap-1.5 py-1">
            <div className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-muted-foreground)' }} />
            <div className="h-1.5 w-1.5 rounded-full animate-pulse [animation-delay:150ms]" style={{ backgroundColor: 'var(--color-muted-foreground)' }} />
            <div className="h-1.5 w-1.5 rounded-full animate-pulse [animation-delay:300ms]" style={{ backgroundColor: 'var(--color-muted-foreground)' }} />
          </div>
        ) : (
          <div className="chat-markdown text-[13px] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
            {isLoading && (
              <span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse" style={{ backgroundColor: 'var(--color-muted-foreground)' }} />
            )}
          </div>
        )}

        {/* Citations / Sources */}
        {hasCitations && (
          <div className="mt-2.5 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-[10px] font-medium uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted-foreground)' }}>
              Sources
            </p>
            <ol className="list-none m-0 p-0 flex flex-col gap-1">
              {message.citations!.map((citation, i) => (
                <li key={`${citation.url}-${i}`} className="flex items-start gap-1.5">
                  <span className="text-[10px] font-medium shrink-0 mt-px" style={{ color: 'var(--color-muted-foreground)' }}>
                    {i + 1}.
                  </span>
                  <button
                    onClick={() => handleOpenUrl(citation.url)}
                    className="text-[11px] leading-snug text-left transition-colors hover:underline truncate"
                    style={{ color: 'var(--color-foreground)' }}
                    title={citation.url}
                  >
                    <span className="flex items-center gap-1">
                      <span className="truncate">{citation.title || citation.url}</span>
                      <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-50" />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Copy button */}
        {!isUser && message.content && (
          <button
            className="absolute -bottom-3 right-2 h-6 w-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-border)' }}
            onClick={handleCopy}
            title="Copy message"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" style={{ color: 'var(--color-muted-foreground)' }} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
