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
import { useLocalAIStore } from "@/stores/local-ai-store";
import { useConnectionsStore } from "@/stores/connections-store";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { ViewMode } from "@/lib/file-utils";
import type { Comment } from "@/stores/comment-store";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StatusTray, type StatusTrayGroup } from "./StatusTray";
import { localAiDotClass, localAiStatusLabel } from "./local-ai-dot";
import { useBackgroundActivity } from "./status/use-background-activity";

/** Format number with localized thousand separators (uses host locale). */
const fmt = new Intl.NumberFormat(navigator.languages as string[], { useGrouping: true });
function fmtNum(n: number): string {
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

/**
 * Semantic ambient dot in the strip's `data-status-dots` slot.
 *
 * Two consumers today:
 *   - Local AI status (left dot). Colour + label come from the shared
 *     `local-ai-dot` helper, so this dot and the StatusTray `SessionGroup`
 *     dot are guaranteed to match (issue #415).
 *   - Recording / dictation (right of it). Independent concept — rendered
 *     red while audio capture is live.
 *
 * The dot sits inside the strip which already handles click-to-open-tray, so
 * the dot's `onClick` must `stopPropagation` — otherwise the parent would ALSO
 * fire and the group-deep-link intent would be lost. Keyboard users still
 * reach these dots through normal tab order; Enter activates the button.
 *
 * The tooltip uses the app's shadcn `Tooltip` (not a native `title`) so it
 * matches every other tooltip in the app (issue #415).
 */
/** Circumference of the progress ring (r=6 in the 16×16 viewBox). */
const RING_CIRCUMFERENCE = 2 * Math.PI * 6;

function StatusDot({
  colorClass,
  label,
  onActivate,
  progress,
  spin,
  reducedMotion,
}: {
  colorClass: string;
  label: string;
  /**
   * Called with the pointer coordinates when activated by a mouse click
   * (so the popover can anchor to the pointer), or `undefined` when
   * activated by keyboard (Enter / Space) — the caller should then fall
   * back to anchoring against the strip rect.
   */
  onActivate: (coords?: { x: number; y: number }) => void;
  /**
   * Optional 0–1 progress fraction. When set, a thin arc fills around the
   * dot — turning it into a DUAL indicator (fill = status, ring = background
   * activity such as indexing or a model download). #415. The ring overflows
   * the 6px button so the click hitbox and the dot's colour class stay put.
   */
  progress?: number;
  /** When true, render the ring as an indeterminate spinner (indexing) rather
   *  than a determinate fill (downloads). The burst of short index passes has
   *  no meaningful single %, so a spinner avoids backward arc jumps. */
  spin?: boolean;
  reducedMotion?: boolean;
}) {
  const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    // Prevent the enclosing strip from ALSO opening the tray without a
    // group hint. We call onActivate ourselves so the click both opens
    // the tray AND targets the correct group.
    e.stopPropagation();
    onActivate({ x: e.clientX, y: e.clientY });
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    // Same reasoning as handleClick — avoid bubbling Enter / Space up
    // to the strip's keydown handler, which would fire handleActivate
    // with no group hint.
    if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
      e.preventDefault();
      onActivate();
    }
  };

  const fraction = progress === undefined ? null : Math.max(0, Math.min(1, progress));

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-progress={fraction === null ? undefined : Math.round(fraction * 100)}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          className={cn(
            "relative h-1.5 w-1.5 rounded-full shrink-0",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
          )}
        >
          {/* Dot fill — fills the button. The status colour AND the
              (reduced-motion-gated) pulse live on this inner span, NOT the
              button: CSS opacity multiplies through descendants, so with the
              pulse on the button the progress ring (a child) blinked and hid
              along with the dot. Keeping the ring as a SIBLING of this span,
              both inside the un-animated button, decouples them. The button
              has NO `grid`/flex — an absolutely-positioned ring inside a grid
              container gets mis-centred by `place-items`. */}
          <span
            className={cn(
              "block h-full w-full rounded-full transition-colors duration-200 hover:opacity-80",
              colorClass,
            )}
          />
          {fraction !== null && (
            // Ring — a 14px square centred on the 6px dot so it sits
            // concentrically AROUND it. Centre via left/top-1/2 + translate on a
            // NON-animated wrapper: a spinning child owns its own `transform`, so
            // the centring transform must live on a separate element or the spin
            // overrides it. pointer-events-none keeps clicks on the dot.
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2"
            >
              {spin ? (
                // Indeterminate spinner (indexing). A faint full ring under a
                // single-quadrant arc that rotates — no backward jumps, no
                // flashing off between the many short index passes.
                <>
                  <span className="absolute inset-0 rounded-full border-[1.5px] border-border" />
                  <span
                    className={cn(
                      "absolute inset-0 rounded-full border-[1.5px] border-transparent border-t-foreground",
                      !reducedMotion && "animate-spin",
                    )}
                  />
                </>
              ) : (
                // Determinate fill (downloads) — a real 0–100% arc.
                <svg viewBox="0 0 16 16" className="h-full w-full">
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-border"
                  />
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    transform="rotate(-90 8 8)"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
                    className={cn(
                      "text-foreground transition-[stroke-dashoffset] duration-300 ease-out",
                      reducedMotion && "transition-none",
                    )}
                  />
                </svg>
              )}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Compute the live Local AI state the strip's status dot reflects. The dot
 * mirrors the StatusTray `SessionGroup` exactly (same `local-ai-dot` helper)
 * and appears whenever a `local_bundled` connection exists, regardless of
 * routing.
 *
 * (Recording is no longer surfaced here — the AgentOrb owns the recording
 * indicator now, #415.)
 */
function useStatusDotsState(): {
  hasLocalAi: boolean;
  serverStatus: string;
} {
  const serverStatus = useLocalAIStore((s) => s.serverStatus);
  const connections = useConnectionsStore((s) => s.connections);

  const hasLocalAi = connections.some(
    (c) => c.provider === "local_ai" && c.authMethod === "local_bundled",
  );

  return { hasLocalAi, serverStatus };
}

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
  const reducedMotion = useReducedMotion();

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

  const openTrayForGroup = (
    group: StatusTrayGroup,
    coords?: { x: number; y: number },
  ) => {
    if (coords) {
      setAnchorAt(coords.x, coords.y);
    } else {
      clearAnchor();
    }
    setInitialGroup(group);
    setTrayOpen(true);
    onOpenTray?.();
  };

  /** Open the tray with no group hint (used by the pure-activity dot). */
  const openTrayAt = (coords?: { x: number; y: number }) => {
    if (coords) {
      setAnchorAt(coords.x, coords.y);
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

  const { hasLocalAi, serverStatus } = useStatusDotsState();
  const bg = useBackgroundActivity();

  // The single status dot is a DUAL indicator: its fill shows Local AI server
  // status (or a neutral fill when no local AI connection exists), and a
  // progress ring around it shows background activity (indexing / model
  // downloads). It renders whenever there's a local AI connection OR background
  // work in flight — so indexing stays visible even without local AI. (#415)
  const showStatusDot = hasLocalAi || bg.active;
  const statusDotColor = hasLocalAi
    ? localAiDotClass(serverStatus, reducedMotion)
    : "bg-muted-foreground/30";
  const statusDotLabel = (() => {
    const parts: string[] = [];
    if (hasLocalAi) parts.push(`Local AI ${localAiStatusLabel(serverStatus).toLowerCase()}`);
    if (bg.active && bg.label) parts.push(bg.label);
    if (parts.length === 0) parts.push("Background activity");
    const base = parts.join(" · ");
    return hasLocalAi ? `${base} — opens Session group` : `${base} — opens status tray`;
  })();

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
          "h-8 flex items-center gap-2.5 px-2 text-xs text-muted-foreground min-w-0",
          "cursor-pointer select-none",
          "hover:text-foreground transition-colors",
          "transition-opacity duration-[340ms] ease-in-out",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
          "motion-reduce:transition-none",
        )}
      >
        {/* Dual-indicator status dot — fill mirrors the StatusTray
            `SessionGroup` Local AI dot exactly (shared `local-ai-dot`
            helper); the progress ring shows background activity (indexing /
            model downloads). stopPropagation in StatusDot keeps the strip's
            own click from firing twice. Recording is no longer shown here —
            the AgentOrb owns that indicator. */}
        <div data-status-dots className="flex items-center gap-1">
          {showStatusDot && (
            <StatusDot
              colorClass={statusDotColor}
              label={statusDotLabel}
              progress={bg.active ? bg.fraction ?? 0 : undefined}
              spin={bg.indeterminate}
              reducedMotion={reducedMotion}
              onActivate={(coords) =>
                hasLocalAi ? openTrayForGroup("session", coords) : openTrayAt(coords)
              }
            />
          )}
        </div>

        {/* Word count is only meaningful when a document is open — when
            the editor is null (landing state, no tab) we render the
            bare chrome (dots + focus hint) without a stale "0 words"
            label. Live-test 2026-04-26 bug #3. */}
        {editor ? (
          <span className="tabular-nums">
            {fmtNum(words)} {words === 1 ? "word" : "words"}
          </span>
        ) : null}

        {/* "saved Xs ago" was removed here (2026-07-01) when the strip moved
            into the narrow sidebar footer — it's redundant with auto-save and
            the extra width didn't fit alongside the Settings button. Auto-save
            still runs; the dirty state shows via the TitleBar dot when enabled. */}

        <span className="ml-auto flex items-center gap-3">
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
