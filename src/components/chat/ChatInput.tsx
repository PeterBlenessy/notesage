import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { ArrowUp, Square, Mic, MicOff, X, ImagePlus, Plus } from 'lucide-react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';
import type { EditContext } from './ChatPanel';
import { Button } from '@/components/ui/button';
import { useSettingsStore } from '@/stores/settings-store';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { SkillCommandMenu, type SkillCommandMenuHandle } from './SkillCommandMenu';
import { AgentCommandMenu, type AgentCommandMenuHandle } from './AgentCommandMenu';
import { ContextPill } from './ContextPill';
import { AttachmentStrip } from './AttachmentStrip';
import type { SkillEntry, AgentEntry } from '@/stores/skill-store';
import type { AcpAgentCommand } from '@/lib/ai/acp-agent-state';
import type { ContextItem, ExplicitAttachOffer } from '@/hooks/useChatContext';
import type { ImageAttachment } from '@/lib/ai/types';
import { compressImage } from '@/lib/image-compress';
import { registerSendImageHandler, unregisterSendImageHandler } from '@/lib/ai/vision';
import { tauriApi } from '@/lib/tauri';
import { parseNotesageDrop } from '@/lib/drag-utils';

export interface ChatInputHandle {
  prefill: (text: string) => void;
  /**
   * Trigger the OS image-picker dialog. Exposed so external UI (the footer's
   * "+" consolidated menu) can invoke attach without its own dialog wiring.
   */
  openAttachDialog: () => void;
}

interface ChatInputProps {
  onSend: (message: string, attachments?: ImageAttachment[]) => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  footer?: React.ReactNode;
  contextItems?: ContextItem[];
  onDismissContext?: (id: string) => void;
  /**
   * Task #23 — when the active tab is outside the scoped projects/notes
   * root, it is NOT auto-attached. This offer lets the user opt in
   * manually via a small "Add this file to chat" button rendered next to
   * the context pill row.
   */
  explicitAttachOffer?: ExplicitAttachOffer | null;
  onAttachExplicit?: (path: string, label: string) => void;
  editContext?: EditContext | null;
  onCancelEdit?: () => void;
  supportsVision?: boolean;
  maxTextareaHeight?: number;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({ onSend, onStop, isLoading, disabled, placeholder = 'Ask anything...', footer, contextItems, onDismissContext, explicitAttachOffer, onAttachExplicit, editContext, onCancelEdit, supportsVision, maxTextareaHeight }, ref) {
  const [message, setMessage] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ImageAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const chatHintsShown = useSettingsStore((s) => s.chatHintsShown);
  const setChatHintsShown = useSettingsStore((s) => s.setChatHintsShown);
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [agentQuery, setAgentQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<SkillCommandMenuHandle>(null);
  const agentMenuRef = useRef<AgentCommandMenuHandle>(null);
  // Indirection so useImperativeHandle can forward to a function defined
  // later in the component (handleAttachClick at line ~219).
  const attachHandlerRef = useRef<(() => void) | null>(null);
  const { startDictation, stopDictation, isDictating, interimText, finalText } = useSpeechRecognition();

  useImperativeHandle(ref, () => ({
    prefill: (text: string) => {
      setMessage(text);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.selectionStart = text.length;
          el.selectionEnd = text.length;
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }
      });
    },
    openAttachDialog: () => {
      attachHandlerRef.current?.();
    },
  }), []);

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

  // Clear pending attachments when switching to a non-vision model
  useEffect(() => {
    if (!supportsVision && pendingAttachments.length > 0) {
      setPendingAttachments([]);
      toast.info('Images removed — current model doesn\'t support images');
    }
  }, [supportsVision]); // eslint-disable-line react-hooks/exhaustive-deps

  // Register cross-component event handler so the editor's "Send to AI"
  // context menu can inject image attachments into this component.
  const pendingAttachmentsRef = useRef(pendingAttachments);
  pendingAttachmentsRef.current = pendingAttachments;

  useEffect(() => {
    registerSendImageHandler((attachment) => {
      if (pendingAttachmentsRef.current.length >= 5) {
        toast.error('Maximum 5 images per message');
        return;
      }
      setPendingAttachments((prev) => (prev.length >= 5 ? prev : [...prev, attachment]));
    });
    return () => unregisterSendImageHandler();
  }, []);

  // --- Image attachment handlers ---

  const addAttachment = useCallback(async (source: File | Blob | string, name?: string) => {
    if (!supportsVision) {
      toast.error("Current model doesn't support images");
      return;
    }
    if (pendingAttachments.length >= 5) {
      toast.error('Maximum 5 images per message');
      return;
    }
    try {
      const attachment = await compressImage(source, { name });
      setPendingAttachments(prev => {
        if (prev.length >= 5) return prev;
        return [...prev, attachment];
      });
    } catch {
      toast.error('Failed to process image');
    }
  }, [supportsVision, pendingAttachments.length]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setPendingAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) {
          e.preventDefault();
          addAttachment(file);
        }
      }
    }
  }, [addAttachment]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!supportsVision) return;
    // Accept both native file drops and Notesage sidebar drags (text/plain with JSON payload)
    const hasFiles = e.dataTransfer.types.includes('Files');
    const hasText = e.dataTransfer.types.includes('text/plain');
    if (!hasFiles && !hasText) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = hasFiles ? 'copy' : 'move';
    setIsDragOver(true);
  }, [supportsVision]);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!supportsVision) {
      toast.error("Current model doesn't support images");
      return;
    }

    // Handle Notesage sidebar drags (image files dragged from file tree)
    const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;
    const notesageDrop = parseNotesageDrop(e);
    if (notesageDrop && !notesageDrop.isDirectory && IMAGE_EXT.test(notesageDrop.name)) {
      try {
        const bytes = await tauriApi.readBinaryFile(notesageDrop.path);
        const ext = notesageDrop.name.split('.').pop()?.toLowerCase() ?? '';
        const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
        const blob = new Blob([new Uint8Array(bytes)], { type: mimeMap[ext] ?? 'image/png' });
        await addAttachment(blob, notesageDrop.name);
      } catch {
        toast.error('Failed to add image');
      }
      return;
    }

    // Handle native file drops (from Finder / desktop)
    const files = e.dataTransfer?.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) {
          addAttachment(file);
        }
      }
    }
  }, [supportsVision, addAttachment]);

  // Keep the ref in sync so the exposed `openAttachDialog` handle calls into
  // the current closure (addAttachment captures latest state).
  const handleAttachClick = useCallback(async () => {
    try {
      const selected = await openFileDialog({
        multiple: true,
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        for (const filePath of paths) {
          if (typeof filePath === 'string') {
            const bytes = await tauriApi.readBinaryFile(filePath);
            const u8 = new Uint8Array(bytes);
            const blob = new Blob([u8]);
            const name = filePath.split('/').pop() ?? 'image';
            await addAttachment(blob, name);
          }
        }
      }
    } catch {
      // User cancelled dialog — no action needed
    }
  }, [addAttachment]);
  attachHandlerRef.current = handleAttachClick;

  const handleSubmit = () => {
    if ((message.trim() || pendingAttachments.length > 0) && !disabled) {
      onSend(message.trim(), pendingAttachments.length > 0 ? pendingAttachments : undefined);
      setMessage('');
      setPendingAttachments([]);
      setShowSkillMenu(false);
      setShowAgentMenu(false);
      if (!chatHintsShown) {
        setChatHintsShown(true);
      }
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

  const handleAgentCommandSelect = (cmd: AcpAgentCommand) => {
    setMessage(`/${cmd.name} `);
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

  const canSend = (message.trim() || pendingAttachments.length > 0) && !disabled;

  const micButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleMicToggle}
      disabled={disabled}
      className={`h-6 w-6 shrink-0 ${isDictating ? 'text-red-500 animate-pulse' : 'text-muted-foreground hover:text-foreground'}`}
      title={isDictating ? 'Stop dictation' : 'Start dictation'}
      aria-label={isDictating ? 'Stop dictation' : 'Start dictation'}
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
      className={`h-6 w-6 shrink-0 disabled:opacity-50 ${canSend ? 'bg-foreground text-background hover:bg-foreground/90' : 'bg-muted text-muted-foreground'}`}
      title="Send (Cmd+Enter)"
      aria-label="Send message"
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
      aria-label="Stop generating"
    >
      <Square className="h-2.5 w-2.5" strokeWidth={0} fill="currentColor" />
    </Button>
  ) : null;

  const attachButton = supportsVision ? (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleAttachClick}
      disabled={disabled}
      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground transition-colors duration-150"
      title="Attach image"
      aria-label="Attach image"
    >
      <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.5} />
    </Button>
  ) : null;

  return (
    <>
    <div
      className={`relative rounded-xl border bg-background transition-colors focus-within:ring-1 focus-within:ring-ring ${isDragOver ? 'border-dashed border-foreground/30 bg-muted/50' : 'border-border'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {showSkillMenu && (
        <SkillCommandMenu
          ref={menuRef}
          query={skillQuery}
          onSelect={handleSkillSelect}
          onSelectAgentCommand={handleAgentCommandSelect}
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
            aria-label="Cancel editing"
          >
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </div>
      )}
      {((contextItems && contextItems.length > 0 && onDismissContext) || (explicitAttachOffer && onAttachExplicit)) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2 pb-1">
          {contextItems && onDismissContext && contextItems.map((item) => (
            <ContextPill key={item.id} item={item} onDismiss={onDismissContext} />
          ))}
          {explicitAttachOffer && onAttachExplicit && (
            <button
              type="button"
              onClick={() => onAttachExplicit(explicitAttachOffer.path, explicitAttachOffer.label)}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:text-foreground hover:bg-muted text-xs px-1.5 py-0.5 max-w-[220px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              title={`Add ${explicitAttachOffer.path} to chat (outside selected project scope)`}
              aria-label={`Add ${explicitAttachOffer.label} to chat`}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="truncate">Add {explicitAttachOffer.label} to chat</span>
            </button>
          )}
        </div>
      )}
      <AttachmentStrip attachments={pendingAttachments} onRemove={handleRemoveAttachment} />
      <div className="flex items-end gap-2 px-3 py-2">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => {
            handleChange(e.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={isDictating && interimText ? interimText : placeholder}
          disabled={disabled}
          rows={1}
          style={maxTextareaHeight ? { maxHeight: `${maxTextareaHeight}px` } : undefined}
          className={`chat-input-textarea flex-1 bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground/50 py-0.5 leading-relaxed text-foreground ${maxTextareaHeight ? 'overflow-y-auto' : ''}`}
        />
      </div>
      {footer && (
        <>
          <div className="mx-3 border-t border-border" />
          <div className="flex items-center gap-2 flex-wrap px-3 py-1.5">
            {footer}
            <div className="flex items-center gap-1.5 ml-auto">
              {/* attachButton removed — image attach moved to the "+" menu in ChatFooter */}
              {micButton}
              {stopButton}
              {sendButton}
            </div>
          </div>
        </>
      )}
      {!footer && (
        <div className="flex justify-end px-3 pb-2 gap-1.5">
          {attachButton}
          {micButton}
          {stopButton}
          {sendButton}
        </div>
      )}
    </div>
    {!chatHintsShown && (
      <p className="text-[10px] text-muted-foreground mt-1.5 px-1 transition-opacity">
        Type <kbd className="px-1 py-px rounded bg-muted font-mono text-[10px]">/</kbd> for skills, <kbd className="px-1 py-px rounded bg-muted font-mono text-[10px]">@</kbd> for agents
      </p>
    )}
    </>
  );
});
