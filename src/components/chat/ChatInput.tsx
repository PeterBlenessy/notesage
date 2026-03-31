import { useState, useRef, useCallback, useEffect } from 'react';
import { ArrowUp, Square, Mic, MicOff, X } from 'lucide-react';
import type { EditContext } from './ChatPanel';
import { Button } from '@/components/ui/button';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { SkillCommandMenu, type SkillCommandMenuHandle } from './SkillCommandMenu';
import { AgentCommandMenu, type AgentCommandMenuHandle } from './AgentCommandMenu';
import { ContextPill } from './ContextPill';
import type { SkillEntry, AgentEntry } from '@/stores/skill-store';
import type { ContextItem } from '@/hooks/useChatContext';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  footer?: React.ReactNode;
  contextItems?: ContextItem[];
  onDismissContext?: (id: string) => void;
  editContext?: EditContext | null;
  onCancelEdit?: () => void;
}

export function ChatInput({ onSend, onStop, isLoading, disabled, placeholder = 'Ask anything...', footer, contextItems, onDismissContext, editContext, onCancelEdit }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [agentQuery, setAgentQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<SkillCommandMenuHandle>(null);
  const agentMenuRef = useRef<AgentCommandMenuHandle>(null);
  const { startDictation, stopDictation, isDictating, interimText, finalText } = useSpeechRecognition();

  // Append dictation text to message
  useEffect(() => {
    if (finalText) {
      setMessage((prev) => (prev ? prev + ' ' + finalText : finalText));
    }
  }, [finalText]);

  // Pre-fill input when entering edit mode
  const prevEditContextRef = useRef<EditContext | null | undefined>(undefined);
  useEffect(() => {
    if (editContext && editContext !== prevEditContextRef.current) {
      setMessage(editContext.originalContent);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.selectionStart = el.value.length;
          el.selectionEnd = el.value.length;
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }
      });
    }
    prevEditContextRef.current = editContext;
  }, [editContext]);

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
      setShowAgentMenu(false);
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
      setShowAgentMenu(false);
    } else {
      setShowSkillMenu(false);
    }

    // Show agent menu when input starts with @ and has no spaces or newlines
    if (value.startsWith('@') && !value.includes(' ') && !value.includes('\n')) {
      setShowAgentMenu(true);
      setAgentQuery(value.slice(1));
      setShowSkillMenu(false);
    } else if (!value.startsWith('@')) {
      setShowAgentMenu(false);
    }
  };

  const handleSkillSelect = (skill: SkillEntry) => {
    setMessage(`/${skill.name} `);
    setShowSkillMenu(false);
    textareaRef.current?.focus();
  };

  const handleAgentSelect = (agent: AgentEntry) => {
    setMessage(`@${agent.name} `);
    setShowAgentMenu(false);
    textareaRef.current?.focus();
  };

  const handleCancelEdit = useCallback(() => {
    if (onCancelEdit) {
      onCancelEdit();
      setMessage('');
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) el.style.height = 'auto';
      });
    }
  }, [onCancelEdit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Let skill menu handle keys first
    if (showSkillMenu && menuRef.current?.handleKeyDown(e)) {
      return;
    }
    // Let agent menu handle keys
    if (showAgentMenu && agentMenuRef.current?.handleKeyDown(e)) {
      return;
    }

    // Escape cancels edit mode
    if (e.key === 'Escape' && editContext) {
      e.preventDefault();
      handleCancelEdit();
      return;
    }

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleMicToggle = useCallback(async () => {
    if (isDictating) {
      await stopDictation();
    } else {
      await startDictation();
    }
  }, [isDictating, startDictation, stopDictation]);

  const canSend = message.trim() && !disabled;

  const micButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleMicToggle}
      disabled={disabled}
      className={`h-6 w-6 shrink-0 ${isDictating ? 'text-red-500 animate-pulse' : 'text-muted-foreground hover:text-foreground'}`}
      title={isDictating ? 'Stop dictation' : 'Start dictation'}
    >
      {isDictating ? (
        <MicOff className="h-3.5 w-3.5" strokeWidth={1.5} />
      ) : (
        <Mic className="h-3.5 w-3.5" strokeWidth={1.5} />
      )}
    </Button>
  );

  const sendButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleSubmit}
      disabled={!canSend}
      className={`h-6 w-6 shrink-0 disabled:opacity-30 ${canSend ? 'bg-foreground text-background hover:bg-foreground/90' : 'bg-muted text-muted-foreground'}`}
      title="Send (Cmd+Enter)"
    >
      <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
    </Button>
  );

  const stopButton = isLoading && onStop ? (
    <Button
      variant="ghost"
      size="icon"
      onClick={onStop}
      className="h-6 w-6 shrink-0 bg-muted text-muted-foreground hover:text-foreground"
      title="Stop generating"
    >
      <Square className="h-2.5 w-2.5" strokeWidth={0} fill="currentColor" />
    </Button>
  ) : null;

  return (
    <div className="relative rounded-xl border border-border bg-background transition-colors focus-within:ring-1 focus-within:ring-ring">
      {showSkillMenu && (
        <SkillCommandMenu
          ref={menuRef}
          query={skillQuery}
          onSelect={handleSkillSelect}
          onClose={() => setShowSkillMenu(false)}
        />
      )}
      {showAgentMenu && (
        <AgentCommandMenu
          ref={agentMenuRef}
          query={agentQuery}
          onSelect={handleAgentSelect}
          onClose={() => setShowAgentMenu(false)}
        />
      )}
      {editContext && (
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span className="text-xs text-muted-foreground">Editing message</span>
          <button
            type="button"
            onClick={handleCancelEdit}
            className="h-4 w-4 rounded flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            title="Cancel editing"
          >
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </div>
      )}
      {contextItems && contextItems.length > 0 && onDismissContext && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2 pb-1">
          {contextItems.map((item) => (
            <ContextPill key={item.id} item={item} onDismiss={onDismissContext} />
          ))}
        </div>
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
          placeholder={isDictating && interimText ? interimText : placeholder}
          disabled={disabled}
          rows={1}
          className="chat-input-textarea flex-1 bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground/50 max-h-[120px] py-0.5 leading-relaxed overflow-y-auto text-foreground"
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
              {micButton}
              {stopButton}
              {sendButton}
            </div>
          </div>
        </>
      )}
      {!footer && (
        <div className="flex justify-end px-3 pb-2 gap-1.5">
          {micButton}
          {stopButton}
          {sendButton}
        </div>
      )}
    </div>
  );
}
