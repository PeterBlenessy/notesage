import { useState } from 'react';
import { ArrowUp } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');

  const handleSubmit = () => {
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage('');
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
      className="flex items-end gap-2 rounded-xl border px-3 py-2 transition-colors"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-background)',
      }}
    >
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything..."
        disabled={disabled}
        rows={1}
        className="flex-1 bg-transparent text-[13px] resize-none outline-none placeholder:text-muted-foreground/50 max-h-[120px] py-0.5 leading-relaxed"
        style={{ color: 'var(--color-foreground)' }}
      />
      <button
        onClick={handleSubmit}
        disabled={!canSend}
        className="h-6 w-6 rounded-md flex items-center justify-center shrink-0 transition-colors disabled:opacity-30"
        style={{
          backgroundColor: canSend ? 'var(--color-foreground)' : 'var(--color-muted)',
          color: canSend ? 'var(--color-background)' : 'var(--color-muted-foreground)',
        }}
        title="Send (Cmd+Enter)"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
