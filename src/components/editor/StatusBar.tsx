import {
  useState,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { cn } from "@/lib/utils";
import { useSidebarStatusSlotStore } from "@/stores/sidebar-status-slot-store";
import type { ViewMode } from "@/lib/file-utils";
import type { Comment } from "@/stores/comment-store";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";
import { StatusTray, type StatusTrayGroup } from "./StatusTray";
import { getFormatLocale } from "@/lib/i18n";
import { useFormatLocale } from "@/lib/useLocale";

/**
 * Format a number with localized thousand separators.
 *
 * Built per call rather than once at module load: the old module-level
 * formatter captured `navigator.languages` before the user could express a
 * language preference, so word counts kept the OS grouping forever (#705).
 * Memoized by locale so the common case is still a single construction.
 */
const fmtCache = new Map<string, Intl.NumberFormat>();
function fmtNum(n: number): string {
  const locale = getFormatLocale();
  const key = locale ?? "";
  let fmt = fmtCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { useGrouping: true });
    fmtCache.set(key, fmt);
  }
  return fmt.format(n);
}

/**
 * Trailing debounce for the word-count recompute. `editor.getText()` + the
 * regex split walk the whole document — running that on every transaction
 * meant a full-doc scan per keystroke. 250 ms trailing keeps the count
 * feeling live (it lands right after typing pauses) while bounding the
 * recompute to at most ~4x/sec.
 */
const WORD_COUNT_DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// StatusBar — the Quiet Composer status strip.
//
// Quiet Composer is the only shell (Classic Layout removed in #325), so this
// is the single status surface: a minimal clickable strip
// (`<dots> <words> · saved Xs ago · ⌘. focus`) that opens the `StatusTray`
// popover. The legacy "full" rich-strip variant and its inline indicators were
// removed in #415 — the live status items now live as StatusTray groups.
// ---------------------------------------------------------------------------


interface StatusBarProps {
  editor: Editor | null;
  comments?: Comment[];
  onSelectComment?: (comment: Comment) => void;
  onDelegateComment?: (comment: Comment) => void;
  onDelegateAll?: () => void;
  canDelegate?: boolean;
  onShortcutsOpen?: () => void;
  onOpenActions?: () => void;
  viewMode?: ViewMode;
  /**
   * Source-mode toggle callback. When provided the StatusTray hosts a
   * WYSIWYG ↔ Source switcher that calls this. Mirrors the inline Toolbar's
   * `onToggleViewMode` so the keyboard-shortcut behaviour stays untouched.
   */
  onToggleViewMode?: () => void;
  /**
   * Optional secondary notifier fired when the strip opens the StatusTray.
   * Retained for existing tests / out-of-tree callers that listen for it;
   * the tray's own open state is owned here.
   */
  onOpenTray?: () => void;
}

export function StatusBar({
  editor,
  comments,
  onSelectComment,
  onDelegateComment,
  onDelegateAll,
  canDelegate,
  onShortcutsOpen,
  onOpenActions,
  viewMode,
  onToggleViewMode,
  onOpenTray,
}: StatusBarProps) {
  // Subscribe to language changes — the date/number helpers used below read
  // the i18n module directly, so without this their output would keep the
  // previous locale until an unrelated re-render.
  useFormatLocale();


  // Re-read word count when the editor transacts so it tracks typing.
  // Debounced (trailing): the recompute below runs `editor.getText()` over the
  // whole document, so ticking on every transaction cost a full-doc scan per
  // keystroke. The tick now fires WORD_COUNT_DEBOUNCE_MS after the last
  // transaction — prompt once typing stops, silent while keys are streaming.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onTransaction = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setTick((t) => t + 1);
      }, WORD_COUNT_DEBOUNCE_MS);
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
      if (timer) clearTimeout(timer); // never fire after unmount
    };
  }, [editor]);

  const text = editor ? editor.getText() : "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  // StatusTray is owned here — the strip clicks to open; Radix handles
  // outside-click / Escape to close. `onOpenTray` stays as an optional
  // secondary notifier so existing tests and any out-of-tree callers that
  // were already listening keep working.
  const [trayOpen, setTrayOpen] = useState(false);
  // Remembers which group a click requested — set by dot activations so
  // the tray can deep-link into the right section. Cleared when the tray
  // closes so a subsequent "blank" strip click doesn't re-target.
  const [initialGroup, setInitialGroup] = useState<StatusTrayGroup | undefined>(
    undefined,
  );
  const anchorRef = useRef<HTMLDivElement | null>(null);

  // Virtual anchor — feeds `PopoverAnchor.virtualRef`. Its `getBoundingClientRect()`
  // returns a zero-size rect at the last click location so the popover opens
  // near the pointer (via `side="top" align="start"`) rather than pinned to
  // the far-left of the whole status strip. For keyboard activation we fall
  // back to the strip's own bounding rect so the popover still has something
  // meaningful to anchor against.
  const virtualRectRef = useRef<DOMRect | null>(null);
  const virtualAnchorRef = useRef<{ getBoundingClientRect(): DOMRect }>({
    getBoundingClientRect() {
      if (virtualRectRef.current) return virtualRectRef.current;
      const el = anchorRef.current;
      if (el) return el.getBoundingClientRect();
      // Fallback zero-rect (shouldn't normally hit this path — the strip is
      // always mounted when the tray can open).
      return new DOMRect(0, 0, 0, 0);
    },
  });

  /** Stash a zero-size DOMRect at (x, y) so the popover anchors to the click. */
  const setAnchorAt = (x: number, y: number) => {
    virtualRectRef.current = new DOMRect(x, y, 0, 0);
  };

  /** Fall back to anchoring against the strip's own rect (keyboard activation). */
  const clearAnchor = () => {
    virtualRectRef.current = null;
  };

  const handleActivate = (e?: ReactMouseEvent<HTMLDivElement>) => {
    if (e && typeof e.clientX === "number" && typeof e.clientY === "number") {
      setAnchorAt(e.clientX, e.clientY);
    } else {
      clearAnchor();
    }
    setInitialGroup(undefined);
    setTrayOpen(true);
    onOpenTray?.();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      // Keyboard activation has no pointer — anchor against the strip rect.
      clearAnchor();
      setInitialGroup(undefined);
      setTrayOpen(true);
      onOpenTray?.();
    }
  };

  // Reset the group hint whenever the tray closes so the next strip-level
  // click (without a dot) doesn't accidentally re-scroll to the previous
  // dot's group.
  const handleOpenChange = (next: boolean) => {
    setTrayOpen(next);
    if (!next) setInitialGroup(undefined);
  };

  const content = (
    <TooltipProvider delayDuration={300}>
      <div
        ref={anchorRef}
        data-quiet-status
        role="button"
        tabIndex={0}
        aria-label="Open status tray"
        onClick={(e) => handleActivate(e)}
        onKeyDown={handleKeyDown}
        className={cn(
          // `overflow-hidden` is the guard, not decoration: this strip is portaled
          // into the sidebar footer beside the Settings gear, and the sidebar is
          // user-resizable down to 200px. `min-w-0` lets the flex slot shrink, but
          // without a clip the strip's content simply paints outside its box and
          // over its neighbour. The gear must stay reachable at every width.
          "h-8 flex items-center gap-2.5 px-2 text-xs text-muted-foreground min-w-0 overflow-hidden",
          "cursor-pointer select-none",
          "hover:text-foreground transition-colors",
          "transition-opacity duration-[340ms] ease-in-out",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
          "motion-reduce:transition-none",
        )}
      >
        {/* The Local AI status dot was REMOVED here (Peter, 2026-08-27).
            Orange-then-green while the bundled server starts told the user
            nothing they could act on, and in a narrow sidebar the strip could
            reach across the Settings gear that shares the footer row.

            Local AI status is not lost — the StatusTray's Session group shows
            it with the same `localAiDotClass` helper, one click away. What DID
            lose its only ambient surface is background-activity progress
            (indexing, model downloads), which rode the same dot as a ring;
            flagged rather than silently dropped. */}

        {/* Word count is only meaningful when a document is open — when
            the editor is null (landing state, no tab) we render the
            bare chrome (dots + focus hint) without a stale "0 words"
            label. Live-test 2026-04-26 bug #3. */}
        {editor ? (
          <span className="tabular-nums truncate">
            {fmtNum(words)} {words === 1 ? "word" : "words"}
          </span>
        ) : null}

        {/* "saved Xs ago" was removed here (2026-07-01) when the strip moved
            into the narrow sidebar footer — it's redundant with auto-save and
            the extra width didn't fit alongside the Settings button. Auto-save
            still runs; the dirty state shows via the TitleBar dot when enabled. */}

        <span className="ml-auto flex items-center gap-3 shrink-0">
          <span>
            <kbd className="font-sans">{"⌘"}.</kbd> focus
          </span>
        </span>
      </div>
      <StatusTray
        open={trayOpen}
        onOpenChange={handleOpenChange}
        anchor={virtualAnchorRef}
        comments={comments}
        onSelectComment={onSelectComment}
        onDelegateComment={onDelegateComment}
        onDelegateAll={onDelegateAll}
        canDelegate={canDelegate}
        onShortcutsOpen={onShortcutsOpen}
        onOpenActions={onOpenActions}
        initialExpandedGroup={initialGroup}
        editor={editor}
        viewMode={viewMode}
        onToggleViewMode={onToggleViewMode}
      />
    </TooltipProvider>
  );

  return content;
}

/**
 * App wrapper that teleports the {@link StatusBar} strip into the QuietSidebar
 * footer slot (next to the Settings button), so the editor column runs
 * edge-to-edge. Renders **nothing** when the sidebar — and thus the slot — is
 * hidden (`⌘⇧L`): the status footer only ever appears in the sidebar, never
 * inline in the editor. `StatusBar` itself stays a plain inline component so it
 * remains testable in isolation.
 */
export function SidebarStatusBar(props: StatusBarProps) {
  const slotEl = useSidebarStatusSlotStore((s) => s.el);
  return slotEl ? createPortal(<StatusBar {...props} />, slotEl) : null;
}
