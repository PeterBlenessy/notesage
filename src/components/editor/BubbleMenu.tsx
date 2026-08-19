import { BubbleMenu as TiptapBubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import {
  Sparkles,
  Loader2,
  ChevronDown,
  MessageSquare,
  ListChevronsDownUp,
  ListChevronsUpDown,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useAIStore } from "@/stores/ai-store";
import { useRoutingStore } from "@/stores/routing-store";
import { useAIOperations } from "@/hooks/useAIOperations";
import { setSuggestion, hasActiveSuggestion, CommentMarkPluginKey } from "@/components/editor/extensions";
import { track } from "@/lib/telemetry";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

interface BubbleMenuProps {
  editor: Editor;
}

export function BubbleMenu({ editor }: BubbleMenuProps) {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const [loadingAction, setLoadingAction] = useState<'improve' | 'summarize' | 'expand' | 'custom' | null>(null);
  const [hasSuggestion, setHasSuggestion] = useState(false);
  const { provider: legacyProvider, customPrompts } = useAIStore();
  const interactiveConnection = useRoutingStore((s) => s.getConnectionForUseCase('interactive'));
  const hasAIProvider = !!interactiveConnection || !!legacyProvider;
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

  const openConnectionSettings = () => {
    window.dispatchEvent(new CustomEvent("notesage:open-settings", { detail: { tab: "ai" } }));
  };

  const settingsAction = { label: "Check settings", onClick: openConnectionSettings };

  const handleAIAction = async (action: 'improve' | 'summarize' | 'expand') => {
    if (!hasAIProvider) {
      toast.error('Please configure an AI provider in Settings first.', { action: settingsAction });
      return;
    }

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, '\n');

    if (!selectedText.trim()) {
      return;
    }

    track("ai_action_used", { action });

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
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const isConfigError = /api.?key|unauthorized|401|403|forbidden|provider|connection|not configured/i.test(msg);
      toast.error(`AI ${action} failed: ${msg}`, isConfigError ? { action: settingsAction } : undefined);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCustomPrompt = async (template: string) => {
    if (!hasAIProvider) {
      toast.error('Please configure an AI provider in Settings first.', { action: settingsAction });
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
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const isConfigError = /api.?key|unauthorized|401|403|forbidden|provider|connection|not configured/i.test(msg);
      toast.error(`Custom prompt failed: ${msg}`, isConfigError ? { action: settingsAction } : undefined);
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <TiptapBubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state }) => {
        // Only show for text selections, not node selections (e.g. horizontal rule)
        if (state.selection instanceof NodeSelection) return false;
        // Must have a non-empty selection with actual text
        const { from, to } = state.selection;
        if (from === to) return false;
        // Don't show inside code blocks
        if (e.isActive("codeBlock")) return false;
        return true;
      }}
      className="z-50 flex items-center rounded-lg border border-border bg-popover p-1 shadow-lg backdrop-blur-sm overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150"
    >
      {!hasSuggestion && (
        <>
          {hasAIProvider && (
            <>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => handleAIAction('improve')}
                disabled={loadingAction !== null}
                title={t("editor.improveWithAi")}
              >
                {loadingAction === 'improve' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" strokeWidth={1.5} />
                )}
                Improve
              </Button>

              <Separator orientation="vertical" className="h-4 mx-0.5" />

              <Button
                variant="ghost"
                size="xs"
                onClick={() => handleAIAction('summarize')}
                disabled={loadingAction !== null}
                title={t("editor.summarizeWithAi")}
              >
                {loadingAction === 'summarize' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ListChevronsDownUp className="h-3 w-3" strokeWidth={1.5} />
                )}
                Summarize
              </Button>

              <Separator orientation="vertical" className="h-4 mx-0.5" />

              <Button
                variant="ghost"
                size="xs"
                onClick={() => handleAIAction('expand')}
                disabled={loadingAction !== null}
                title={t("editor.expandWithAi")}
              >
                {loadingAction === 'expand' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ListChevronsUpDown className="h-3 w-3" strokeWidth={1.5} />
                )}
                Expand
              </Button>

              {customPrompts.length > 0 && (
                <>
                  <Separator orientation="vertical" className="h-4 mx-0.5" />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={loadingAction !== null}
                        title={t("editor.customPrompts")}
                        className="text-muted-foreground"
                      >
                        {loadingAction === 'custom' ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            More
                            <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
                          </>
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
                          className="cursor-pointer text-sm"
                        >
                          <span className="mr-2">{prompt.icon}</span>
                          {prompt.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}

              <Separator orientation="vertical" className="h-4 mx-0.5" />
            </>
          )}

          <Button
            variant="ghost"
            size="xs"
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
            title={t("editor.addComment") + " (⌘⌥C)"}
          >
            <MessageSquare className="h-3 w-3" strokeWidth={1.5} />
            Comment
          </Button>
        </>
      )}

      {hasSuggestion && (
        <div className="flex items-center gap-2 px-2 py-1">
          <Sparkles className="h-3 w-3 text-primary" strokeWidth={1.5} />
          <span className="text-xs font-medium text-foreground">
            AI suggestion
          </span>
          <div className="flex items-center gap-1.5 ml-1 text-muted-foreground">
            <kbd className="px-1 py-0.5 text-[10px] font-mono rounded bg-muted border border-border">
              ⌘↵
            </kbd>
            <span className="text-[10px]">accept</span>
            <kbd className="px-1 py-0.5 text-[10px] font-mono rounded bg-muted border border-border ml-1">
              ⌘⌫
            </kbd>
            <span className="text-[10px]">reject</span>
          </div>
        </div>
      )}
    </TiptapBubbleMenu>
  );
}
