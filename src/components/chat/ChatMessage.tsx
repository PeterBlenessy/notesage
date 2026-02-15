import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
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

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`group relative max-w-[85%] rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-card border border-border text-card-foreground'
        }`}
      >
        <div className="prose prose-xs dark:prose-invert max-w-none text-sm">
          {isUser ? (
            <p className="m-0 whitespace-pre-wrap text-sm">{message.content}</p>
          ) : isStreaming ? (
            <div className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full bg-current animate-pulse" />
              <div className="h-2 w-2 rounded-full bg-current animate-pulse delay-75" />
              <div className="h-2 w-2 rounded-full bg-current animate-pulse delay-150" />
            </div>
          ) : (
            <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
              {isLoading && (
                <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />
              )}
            </div>
          )}
        </div>
        {!isUser && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-card/80 backdrop-blur-sm"
            onClick={handleCopy}
            title="Copy message"
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
