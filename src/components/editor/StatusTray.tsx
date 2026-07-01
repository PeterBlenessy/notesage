import * as React from "react";
import type { Editor } from "@tiptap/react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Comment } from "@/stores/comment-store";
import type { ViewMode } from "@/lib/file-utils";
import { EditorToolsGroup } from "./EditorToolsGroup";
import { CompletionsGroup } from "./CompletionsGroup";
import { CommentsGroup } from "./CommentsGroup";
import { ActionsGroup } from "./ActionsGroup";
import { SessionGroup } from "./SessionGroup";
import { HelpGroup } from "./HelpGroup";

/**
 * Section identifiers for deep-linking into a group on open (task #54 dots).
 * `"actions"` is in the type but has no ref — deep-linking to it silently
 * no-ops (no current call site passes it as `initialExpandedGroup`).
 */
export type StatusTrayGroup =
  | "completions"
  | "comments"
  | "actions"
  | "session"
  | "help";

export interface StatusTrayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Virtual ref accepted — `QuietStatusBar` passes click coordinates. */
  anchor: React.RefObject<
    HTMLElement | { getBoundingClientRect(): DOMRect } | null
  >;
  comments?: Comment[];
  onSelectComment?: (c: Comment) => void;
  onDelegateComment?: (c: Comment) => void;
  onDelegateAll?: () => void;
  canDelegate?: boolean;
  onShortcutsOpen?: () => void;
  onOpenActions?: () => void;
  /** Scroll + focus this group when the tray opens. Ignored on subsequent re-renders. */
  initialExpandedGroup?: StatusTrayGroup;
  /** Pass `null` to hide the EditorToolsGroup row. */
  editor?: Editor | null;
  viewMode?: ViewMode;
  onToggleViewMode?: () => void;
}

export function StatusTray({
  open,
  onOpenChange,
  anchor,
  comments = [],
  onSelectComment,
  onDelegateComment,
  onDelegateAll,
  canDelegate = false,
  onShortcutsOpen,
  onOpenActions,
  initialExpandedGroup,
  editor = null,
  viewMode,
  onToggleViewMode,
}: StatusTrayProps) {
  const handleShortcuts = React.useCallback(() => {
    onOpenChange(false);
    onShortcutsOpen?.();
  }, [onOpenChange, onShortcutsOpen]);

  // Close the tray before opening the dashboard so the two don't overlap.
  const handleOpenActions = React.useMemo(
    () =>
      onOpenActions
        ? () => {
            onOpenChange(false);
            onOpenActions();
          }
        : undefined,
    [onOpenChange, onOpenActions],
  );

  const completionsRef = React.useRef<HTMLDivElement | null>(null);
  const commentsRef = React.useRef<HTMLDivElement | null>(null);
  const sessionRef = React.useRef<HTMLDivElement | null>(null);
  const helpRef = React.useRef<HTMLDivElement | null>(null);

  const resolveGroup = React.useCallback(
    (group?: StatusTrayGroup): HTMLDivElement | null => {
      if (!group) return null;
      if (group === "completions") return completionsRef.current;
      if (group === "comments") return commentsRef.current;
      if (group === "session") return sessionRef.current;
      if (group === "help") return helpRef.current;
      return null;
    },
    [],
  );

  // Prevent Radix's default autofocus (it lands on the first focusable child
  // and triggers its tooltip). When a dot pre-selected a group, steer focus
  // and scroll to that group root instead.
  const handleOpenAutoFocus = React.useCallback(
    (e: Event) => {
      e.preventDefault();
      if (!initialExpandedGroup) return;
      const target = resolveGroup(initialExpandedGroup);
      if (!target) return;
      target.scrollIntoView({ block: "nearest" });
      target.focus({ preventScroll: true });
    },
    [initialExpandedGroup, resolveGroup],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor
        virtualRef={
          anchor as React.RefObject<{ getBoundingClientRect(): DOMRect }>
        }
      />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-[300px] p-0"
        onOpenAutoFocus={handleOpenAutoFocus}
      >
        {/*
          TooltipProvider is required here because PopoverContent portal-
          mounts to document.body — any provider higher in the React tree
          doesn't reach into this portal.
        */}
        <TooltipProvider delayDuration={300}>
          {/* Inset separators (12 px from each edge) between sections. */}
          <div className="[&>*+*]:relative [&>*+*]:before:pointer-events-none [&>*+*]:before:absolute [&>*+*]:before:left-3 [&>*+*]:before:right-3 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-border">
            {(editor || onToggleViewMode) && (
              <div className="p-3">
                <EditorToolsGroup
                  editor={editor}
                  viewMode={viewMode}
                  onToggleViewMode={onToggleViewMode}
                />
              </div>
            )}
            <div ref={completionsRef} tabIndex={-1} className="p-3 focus:outline-none">
              <CompletionsGroup />
            </div>
            <div ref={commentsRef} tabIndex={-1} className="p-3 focus:outline-none">
              <CommentsGroup
                comments={comments}
                onSelectComment={onSelectComment}
                onDelegateComment={onDelegateComment}
                onDelegateAll={onDelegateAll}
                canDelegate={canDelegate}
                onCloseTray={() => onOpenChange(false)}
              />
            </div>
            <div tabIndex={-1} className="p-3 focus:outline-none">
              <ActionsGroup onOpenActions={handleOpenActions} />
            </div>
            <div ref={sessionRef} tabIndex={-1} className="p-3 focus:outline-none">
              <SessionGroup />
            </div>
            <div ref={helpRef} tabIndex={-1} className="p-3 focus:outline-none">
              <HelpGroup onShortcutsOpen={handleShortcuts} />
            </div>
          </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
