import { BubbleMenu as TiptapBubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Loader2,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useAIStore } from "@/stores/ai-store";
import { useAIOperations } from "@/hooks/useAIOperations";
import { setSuggestion, hasActiveSuggestion } from "@/components/editor/extensions";
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

    // Initial check
    updateSuggestionState();

    // Listen to editor updates
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

      // Show suggestion with decorations instead of immediately replacing
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
      // Replace {{selection}} placeholder with actual selected text
      const prompt = template.replace(/\{\{selection\}\}/g, selectedText);
      const result = await generateText(prompt);

      // Show suggestion with decorations instead of immediately replacing
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
      className="flex items-center gap-1 rounded-lg border border-border bg-background/95 backdrop-blur-md p-1.5 shadow-xl ring-1 ring-border/50"
    >
      {provider && !hasSuggestion && (
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAIAction('improve')}
            disabled={loadingAction !== null}
            className="h-8 px-2 text-sm"
            title="Improve with AI"
          >
            {loadingAction === 'improve' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1" />
                Improve
              </>
            )}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAIAction('summarize')}
            disabled={loadingAction !== null}
            className="h-8 px-2 text-sm"
            title="Summarize with AI"
          >
            {loadingAction === 'summarize' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Summarize'
            )}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAIAction('expand')}
            disabled={loadingAction !== null}
            className="h-8 px-2 text-sm"
            title="Expand with AI"
          >
            {loadingAction === 'expand' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Expand'
            )}
          </Button>

          {customPrompts.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loadingAction !== null}
                  className="h-8 px-2 text-sm"
                  title="Custom prompts"
                >
                  {loadingAction === 'custom' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'More'
                  )}
                </Button>
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
                    className="cursor-pointer"
                  >
                    <span className="mr-2">{prompt.icon}</span>
                    {prompt.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      )}

      {hasSuggestion && (
        <>
          <div className="flex items-center gap-2 px-2 text-xs">
            <Sparkles className="h-3 w-3 text-green-600 dark:text-green-400" />
            <span className="font-medium text-foreground">AI suggestion</span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <kbd className="px-1.5 py-0.5 text-xs font-semibold border rounded bg-muted">⌘</kbd>
              <span className="text-[10px]">+</span>
              <kbd className="px-1.5 py-0.5 text-xs font-semibold border rounded bg-muted">↵</kbd>
              <span className="text-[10px] ml-0.5">accept</span>
              <kbd className="px-1.5 py-0.5 text-xs font-semibold border rounded bg-muted ml-2">⌘</kbd>
              <span className="text-[10px]">+</span>
              <kbd className="px-1.5 py-0.5 text-xs font-semibold border rounded bg-muted">⌫</kbd>
              <span className="text-[10px] ml-0.5">reject</span>
            </span>
          </div>
        </>
      )}
    </TiptapBubbleMenu>
  );
}
