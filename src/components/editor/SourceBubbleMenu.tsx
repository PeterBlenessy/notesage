import { useEffect, useState, useRef, useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import { Sparkles, Loader2, ListChevronsDownUp, ListChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAIStore } from "@/stores/ai-store";
import { useAIOperations } from "@/hooks/useAIOperations";

interface SourceBubbleMenuProps {
  cmView: EditorView | null;
}

export function SourceBubbleMenu({ cmView }: SourceBubbleMenuProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<{ from: number; to: number; text: string } | null>(null);
  const { provider } = useAIStore();
  const { generateText } = useAIOperations();

  // Track selection changes via polling (CodeMirror doesn't expose a React-friendly selection event)
  useEffect(() => {
    if (!cmView) {
      setVisible(false);
      return;
    }

    let rafId: number;
    let lastFrom = -1;
    let lastTo = -1;

    const checkSelection = () => {
      if (!cmView.hasFocus || loadingAction) {
        rafId = requestAnimationFrame(checkSelection);
        return;
      }

      const sel = cmView.state.selection.main;

      // Only update when selection actually changes
      if (sel.from === lastFrom && sel.to === lastTo) {
        rafId = requestAnimationFrame(checkSelection);
        return;
      }

      lastFrom = sel.from;
      lastTo = sel.to;

      if (sel.empty) {
        setVisible(false);
        selectionRef.current = null;
        rafId = requestAnimationFrame(checkSelection);
        return;
      }

      const text = cmView.state.sliceDoc(sel.from, sel.to);
      if (!text.trim()) {
        setVisible(false);
        selectionRef.current = null;
        rafId = requestAnimationFrame(checkSelection);
        return;
      }

      selectionRef.current = { from: sel.from, to: sel.to, text };

      // Position above the selection start using viewport coords (fixed positioning)
      const coords = cmView.coordsAtPos(sel.from);
      if (coords) {
        const menuHeight = 36;
        const menuWidth = 260;
        const pad = 8;

        let top = coords.top - menuHeight - 8;
        let left = coords.left;

        // Clamp to viewport
        if (top < pad) top = coords.bottom + 8;
        if (left + menuWidth > window.innerWidth - pad) left = window.innerWidth - pad - menuWidth;
        if (left < pad) left = pad;

        setPosition({ top, left });
        setVisible(true);
      }

      rafId = requestAnimationFrame(checkSelection);
    };

    rafId = requestAnimationFrame(checkSelection);
    return () => cancelAnimationFrame(rafId);
  }, [cmView, loadingAction]);

  const handleAction = useCallback(
    async (action: "improve" | "summarize" | "expand") => {
      if (!cmView || !selectionRef.current) return;

      if (!provider) {
        toast.error("Please configure an AI provider in Settings first.");
        return;
      }

      const { from, to, text } = selectionRef.current;
      setLoadingAction(action);

      try {
        let prompt = "";
        switch (action) {
          case "improve":
            prompt = `Improve the following text while keeping the same meaning and tone:\n\n${text}\n\nProvide only the improved text without any explanation.`;
            break;
          case "summarize":
            prompt = `Summarize the following text concisely:\n\n${text}\n\nProvide only the summary without any explanation.`;
            break;
          case "expand":
            prompt = `Expand on the following text with more detail:\n\n${text}\n\nProvide only the expanded text without any explanation.`;
            break;
        }

        const result = await generateText(prompt);
        const trimmed = result.trim();

        // Replace the selected text in CodeMirror
        cmView.dispatch({
          changes: { from, to, insert: trimmed },
          selection: { anchor: from, head: from + trimmed.length },
        });

        setVisible(false);
      } catch (error) {
        console.error("AI action failed:", error);
        toast.error(
          `AI ${action} failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      } finally {
        setLoadingAction(null);
      }
    },
    [cmView, provider, generateText],
  );

  if (!visible && !loadingAction) return null;

  const isLoading = !!loadingAction;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 flex items-center rounded-lg border border-border bg-popover p-1 shadow-lg backdrop-blur-sm transition-opacity duration-150 animate-in fade-in-0 zoom-in-95"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <Button
        variant="ghost"
        size="xs"
        onClick={() => handleAction("improve")}
        disabled={isLoading}
        title="Improve with AI"
      >
        {loadingAction === "improve" ? (
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
        onClick={() => handleAction("summarize")}
        disabled={isLoading}
        title="Summarize with AI"
      >
        {loadingAction === "summarize" ? (
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
        onClick={() => handleAction("expand")}
        disabled={isLoading}
        title="Expand with AI"
      >
        {loadingAction === "expand" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <ListChevronsUpDown className="h-3 w-3" strokeWidth={1.5} />
        )}
        Expand
      </Button>
    </div>
  );
}
