import { useState, useRef, useCallback } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { SkillCommandMenu, type SkillCommandMenuHandle } from './SkillCommandMenu';
import type { SkillEntry } from '@/stores/skill-store';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  footer?: React.ReactNode;
}

export function ChatInput({ onSend, onStop, isLoading, disabled, placeholder = 'Ask anything...', footer }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<SkillCommandMenuHandle>(null);

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
      setShowSkillMenu(false);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = 'auto';
        }
      });
    }
  };

  const handleChange = (value: string) => {
    setMessage(value);

    // Show skill menu when input starts with / and has no spaces or newlines
    if (value.startsWith('/') && !value.includes(' ') && !value.includes('\n')) {
      setShowSkillMenu(true);
      setSkillQuery(value.slice(1));
    } else {
      setShowSkillMenu(false);
    }
  };

  const handleSkillSelect = (skill: SkillEntry) => {
    setMessage(`/${skill.name} `);
    setShowSkillMenu(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Let skill menu handle keys first
    if (showSkillMenu && menuRef.current?.handleKeyDown(e)) {
      return;
    }

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSend = message.trim() && !disabled;

  const sendButton = (
    <button
      onClick={handleSubmit}
      disabled={!canSend}
      className={`h-6 w-6 rounded-md flex items-center justify-center shrink-0 transition-colors disabled:opacity-30 ${canSend ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
      title="Send (Cmd+Enter)"
    >
      <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
    </button>
  );

  const stopButton = isLoading && onStop ? (
    <button
      onClick={onStop}
      className="h-6 w-6 rounded-md flex items-center justify-center shrink-0 transition-colors bg-muted text-muted-foreground hover:text-foreground"
      title="Stop generating"
    >
      <Square className="h-2.5 w-2.5" strokeWidth={0} fill="currentColor" />
    </button>
  ) : null;

  return (
    <div className="relative rounded-xl border border-border bg-background transition-colors">
      {showSkillMenu && (
        <SkillCommandMenu
          ref={menuRef}
          query={skillQuery}
          onSelect={handleSkillSelect}
          onClose={() => setShowSkillMenu(false)}
        />
      )}
      <div className="flex items-end gap-2 px-3 py-2">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => {
            handleChange(e.target.value);
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
            <div className="flex items-center gap-1.5">
              {stopButton}
              {sendButton}
            </div>
          </div>
        </>
      )}
      {!footer && (
        <div className="flex justify-end px-3 pb-2 gap-1.5">
          {stopButton}
          {sendButton}
        </div>
      )}
    </div>
  );
}
