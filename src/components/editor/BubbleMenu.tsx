import { BubbleMenu as TiptapBubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/core";
import {
  Sparkles,
  Loader2,
  ChevronDown,
  MessageSquare,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useAIStore } from "@/stores/ai-store";
import { useAIOperations } from "@/hooks/useAIOperations";
import { setSuggestion, hasActiveSuggestion, CommentMarkPluginKey } from "@/components/editor/extensions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

interface BubbleMenuProps {
  editor: Editor;
}

function BubbleButton({
  onClick,
  disabled,
  title,
  loading,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-1.5"
      style={{ color: 'var(--color-foreground)' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : children}
    </button>
  );
}

export function BubbleMenu({ editor }: BubbleMenuProps) {
  const [loadingAction, setLoadingAction] = useState<'improve' | 'summarize' | 'expand' | 'custom' | null>(null);
  const [hasSuggestion, setHasSuggestion] = useState(false);
  const { provider, customPrompts } = useAIStore();
  const { generateText } = useAIOperations();

  // Check for active suggestion on every editor update
  useEffect(() => {
    const updateSuggestionState = () => {
      setHasSuggestion(hasActiveSuggestion(editor));
    };

    updateSuggestionState();

    editor.on('update', updateSuggestionState);
    editor.on('transaction', updateSuggestionState);

    return () => {
      editor.off('update', updateSuggestionState);
      editor.off('transaction', updateSuggestionState);
    };
  }, [editor]);

  const handleAIAction = async (action: 'improve' | 'summarize' | 'expand') => {
    if (!provider) {
      alert('Please configure an AI provider in Settings first.');
      return;
    }

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, '\n');

    if (!selectedText.trim()) {
      return;
    }

    setLoadingAction(action);

    try {
      let prompt = '';
      switch (action) {
        case 'improve':
          prompt = `Improve the following text while keeping the same meaning and tone:\n\n${selectedText}\n\nProvide only the improved text without any explanation.`;
          break;
        case 'summarize':
          prompt = `Summarize the following text concisely:\n\n${selectedText}\n\nProvide only the summary without any explanation.`;
          break;
        case 'expand':
          prompt = `Expand on the following text with more detail:\n\n${selectedText}\n\nProvide only the expanded text without any explanation.`;
          break;
      }

      const result = await generateText(prompt);
      setSuggestion(editor, from, to, selectedText, result.trim());
    } catch (error) {
      console.error('AI action failed:', error);
      alert(`AI ${action} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCustomPrompt = async (template: string) => {
    if (!provider) {
      alert('Please configure an AI provider in Settings first.');
      return;
    }

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, '\n');

    if (!selectedText.trim()) {
      return;
    }

    setLoadingAction('custom');

    try {
      const prompt = template.replace(/\{\{selection\}\}/g, selectedText);
      const result = await generateText(prompt);
      setSuggestion(editor, from, to, selectedText, result.trim());
    } catch (error) {
      console.error('Custom prompt failed:', error);
      alert(`Custom prompt failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <TiptapBubbleMenu
      editor={editor}
      className="flex items-center rounded-lg border shadow-lg backdrop-blur-sm overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-popover)',
        padding: '3px',
      }}
    >
      {!hasSuggestion && (
        <>
          {provider && (
            <>
              <BubbleButton
                onClick={() => handleAIAction('improve')}
                disabled={loadingAction !== null}
                title="Improve with AI"
                loading={loadingAction === 'improve'}
              >
                <Sparkles className="h-3 w-3" />
                Improve
              </BubbleButton>

              <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'var(--color-border)' }} />

              <BubbleButton
                onClick={() => handleAIAction('summarize')}
                disabled={loadingAction !== null}
                title="Summarize with AI"
                loading={loadingAction === 'summarize'}
              >
                Summarize
              </BubbleButton>

              <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'var(--color-border)' }} />

              <BubbleButton
                onClick={() => handleAIAction('expand')}
                disabled={loadingAction !== null}
                title="Expand with AI"
                loading={loadingAction === 'expand'}
              >
                Expand
              </BubbleButton>

              {customPrompts.length > 0 && (
                <>
                  <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'var(--color-border)' }} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        disabled={loadingAction !== null}
                        className="h-7 px-2 rounded-md text-[12px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-1"
                        style={{ color: 'var(--color-muted-foreground)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                        title="Custom prompts"
                      >
                        {loadingAction === 'custom' ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            More
                            <ChevronDown className="h-3 w-3" />
                          </>
                        )}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                        Custom Prompts
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {customPrompts.map((prompt) => (
                        <DropdownMenuItem
                          key={prompt.id}
                          onClick={() => handleCustomPrompt(prompt.template)}
                          className="cursor-pointer text-[13px]"
                        >
                          <span className="mr-2">{prompt.icon}</span>
                          {prompt.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}

              <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'var(--color-border)' }} />
            </>
          )}

          <BubbleButton
            onClick={() => {
              const { from, to } = editor.state.selection;
              if (from === to) return;
              editor.view.dispatch(
                editor.state.tr.setMeta(CommentMarkPluginKey, {
                  requestCreateComment: { from, to },
                })
              );
            }}
            disabled={loadingAction !== null}
            title="Add comment (⌘⇧M)"
            loading={false}
          >
            <MessageSquare className="h-3 w-3" />
            Comment
          </BubbleButton>
        </>
      )}

      {hasSuggestion && (
        <div className="flex items-center gap-2 px-2.5 py-1">
          <Sparkles className="h-3 w-3" style={{ color: 'var(--color-primary)' }} />
          <span className="text-[12px] font-medium" style={{ color: 'var(--color-foreground)' }}>
            AI suggestion
          </span>
          <div className="flex items-center gap-1.5 ml-1" style={{ color: 'var(--color-muted-foreground)' }}>
            <kbd
              className="px-1 py-0.5 text-[10px] font-mono rounded"
              style={{ backgroundColor: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
            >
              ⌘↵
            </kbd>
            <span className="text-[10px]">accept</span>
            <kbd
              className="px-1 py-0.5 text-[10px] font-mono rounded ml-1"
              style={{ backgroundColor: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
            >
              ⌘⌫
            </kbd>
            <span className="text-[10px]">reject</span>
          </div>
        </div>
      )}
    </TiptapBubbleMenu>
  );
}
