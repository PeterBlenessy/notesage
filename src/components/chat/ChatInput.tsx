import { useState, useRef, useCallback } from 'react';
import { ArrowUp } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  footer?: React.ReactNode;
}

export function ChatInput({ onSend, disabled, placeholder = 'Ask anything...', footer }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const handleSubmit = () => {
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage('');
      // Reset height after clearing
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = 'auto';
        }
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSend = message.trim() && !disabled;

  return (
    <div
      className="rounded-xl border border-border bg-background transition-colors"
    >
      <div className="flex items-end gap-2 px-3 py-2">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground/50 max-h-[120px] py-0.5 leading-relaxed overflow-y-auto text-foreground"
        />
      </div>
      {footer && (
        <>
          <div className="mx-3 border-t border-border" />
          <div className="flex items-end justify-between px-3 py-1.5 gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              {footer}
            </div>
            <button
              onClick={handleSubmit}
              disabled={!canSend}
              className={`h-6 w-6 rounded-md flex items-center justify-center shrink-0 transition-colors disabled:opacity-30 ${canSend ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
              title="Send (Cmd+Enter)"
            >
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </>
      )}
      {!footer && (
        <div className="flex justify-end px-3 pb-2">
          <button
            onClick={handleSubmit}
            disabled={!canSend}
            className={`h-6 w-6 rounded-md flex items-center justify-center shrink-0 transition-colors disabled:opacity-30 ${canSend ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
            title="Send (Cmd+Enter)"
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}
