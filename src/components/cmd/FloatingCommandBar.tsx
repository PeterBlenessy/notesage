import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import AttachmentChips, {
  type AttachmentChip,
} from "@/components/cmd/AttachmentChips";

/**
 * FloatingCommandBar — the unified composer shell for the Quiet Composer
 * UI refresh (PRD `2026-04-21-ui-refresh`, Phase 1, task #9).
 *
 * This file is intentionally just the bar's outer chrome. It hosts:
 *   - Compact state: a centred placeholder pill near the bottom of the
 *     viewport that hints at the ⌘K shortcut.
 *   - Expanded state: the same pill grows in height to ~480 px and reveals
 *     an autofocused input plus an empty scroll region for the future
 *     conversation stream.
 *
 * Subsequent tasks fill in the contents:
 *   - #10 CommandBarContext      → context row (provider, projects, mode)
 *   - #11 AttachmentChips        → chips above the input
 *   - #12 CommandBarStream       → real chat stream replaces the placeholder
 *   - #13 prefix morph           → /, @, #, !, ?, > mode switching
 *   - #28 pinned panel layout    → wires up the `isPinned` branch
 *
 * Behaviour summary:
 *   - Click the compact pill (or open via ⌘K — handled by a future task) to
 *     expand. The input autofocuses.
 *   - Esc collapses back to compact and blurs the input.
 *   - On focus, the bar lifts 14 px with a 200 ms ease transition. When
 *     `prefers-reduced-motion: reduce` is set, the lift and the height
 *     transition are skipped — the bar just snaps.
 *   - When `isPinned` is true the bar renders inline (no portal). Caller
 *     positions it; this component does not paint pinned-mode chrome yet.
 */

export interface FloatingCommandBarProps {
  /**
   * When true, the bar renders inline as a normal block element instead of
   * being portal-mounted to `document.body`. Forward-declared for the
   * pinned-side-panel work in #28; the actual pinned-mode layout (vertical
   * context stack, drag handle, etc.) arrives there.
   *
   * @default false
   */
  isPinned?: boolean;
}

const COMPACT_PLACEHOLDER = "Press ⌘K to ask";
const STREAM_PLACEHOLDER = "Conversation will render here";

function FloatingCommandBar({ isPinned = false }: FloatingCommandBarProps) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reducedMotion = useReducedMotion();

  // Attachment chips above the input (#11). Starts empty — populated by the
  // reference / task / research mode pickers in #15, #17, #18.
  const [chips, setChips] = useState<AttachmentChip[]>([]);
  const removeChip = useCallback((id: string) => {
    setChips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Autofocus the input whenever we transition into the expanded state.
  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  const expand = useCallback(() => {
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    setExpanded(false);
    // Blur is a courtesy — the input itself unmounts when expanded === false,
    // but if we ever animate the input out we still want the focus released.
    inputRef.current?.blur();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        collapse();
      }
    },
    [collapse],
  );

  // ---------------------------------------------------------------------
  // Visual chrome
  //
  // The bar is the same DOM in both compact and expanded states — only the
  // size, contents, and lift offset differ. Tailwind `h-*` + `transition-all`
  // gives a smooth height/opacity morph; reduced-motion strips both the
  // transition utility and the lift transform.
  // ---------------------------------------------------------------------

  // Position differs between portal mode (fixed bottom-centre overlay) and
  // pinned mode (caller takes over). In pinned mode we render a relative
  // block so the caller's layout decides where it lands.
  const positionClasses = isPinned
    ? "relative w-full"
    : "fixed bottom-10 left-1/2 -translate-x-1/2";

  // Width grows when expanded so the stream has more breathing room.
  const widthClasses = expanded ? "w-[640px] max-w-[90vw]" : "w-[480px] max-w-[90vw]";

  // Height collapses to ~48 px in the compact pill state; grows to ~480 px
  // when expanded so there's room for the (currently empty) stream zone.
  const heightClasses = expanded ? "h-[480px]" : "h-12";

  // Roundness softens slightly when expanded, matching the design spec.
  const radiusClasses = expanded ? "rounded-2xl" : "rounded-xl";

  // 14 px lift on focus / when expanded. Skipped in reduced-motion mode.
  const liftClasses = !reducedMotion && expanded ? "-translate-y-[14px]" : "";

  // Fixed-position overlay needs a vertical translate that combines with
  // the horizontal -translate-x-1/2. We layer them via Tailwind's transform
  // composition: `-translate-x-1/2` already sets transform; the lift then
  // composes via the additional `-translate-y-[14px]` utility.

  const transitionClasses = reducedMotion
    ? ""
    : "transition-all duration-200 ease-out";

  const bar = (
    <div
      data-cmd-bar
      data-expanded={expanded ? "true" : "false"}
      className={cn(
        positionClasses,
        widthClasses,
        heightClasses,
        radiusClasses,
        liftClasses,
        transitionClasses,
        "z-40 flex flex-col overflow-hidden",
        "border border-border bg-popover/95 backdrop-blur-md shadow-lg",
      )}
    >
      {expanded ? (
        <ExpandedContent
          inputRef={inputRef}
          onKeyDown={handleKeyDown}
          chips={chips}
          onRemoveChip={removeChip}
        />
      ) : (
        <CompactContent onActivate={expand} />
      )}
    </div>
  );

  if (isPinned) {
    return bar;
  }

  // SSR / non-browser fallback: skip the portal entirely.
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(bar, document.body);
}

// ---------------------------------------------------------------------------
// Sub-components — kept private to this module per the "one component per
// file" rule. These are pure visual fragments, not standalone components.
// ---------------------------------------------------------------------------

interface CompactContentProps {
  onActivate: () => void;
}

function CompactContent({ onActivate }: CompactContentProps) {
  return (
    <button
      type="button"
      onClick={onActivate}
      className={cn(
        "flex h-full w-full items-center justify-between px-4",
        "text-left text-sm text-muted-foreground",
        "hover:text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
    >
      <span>{COMPACT_PLACEHOLDER}</span>
      <kbd className="hidden text-xs text-muted-foreground/70 sm:inline-flex">⌘K</kbd>
    </button>
  );
}

interface ExpandedContentProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  chips: AttachmentChip[];
  onRemoveChip: (id: string) => void;
}

function ExpandedContent({
  inputRef,
  onKeyDown,
  chips,
  onRemoveChip,
}: ExpandedContentProps) {
  return (
    <div className="flex h-full flex-col">
      {/*
        Future home of:
          - Context row (#10) — pinned to the top of the expanded bar
          - Chat stream (#12) — fills the scroll region below
       */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        <p className="text-xs text-muted-foreground">{STREAM_PLACEHOLDER}</p>
      </div>

      {/* #11 — Attachment chips strip. Renders nothing while `chips` is empty. */}
      <AttachmentChips chips={chips} onRemove={onRemoveChip} />

      <div className="border-t border-border px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          role="textbox"
          onKeyDown={onKeyDown}
          placeholder="Ask, search, or type / for skills…"
          className={cn(
            "w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground",
            "outline-none",
          )}
        />
      </div>
    </div>
  );
}

export default FloatingCommandBar;
