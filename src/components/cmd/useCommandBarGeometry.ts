import { useSettingsStore } from "@/stores/settings-store";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";

/**
 * Pinned-mode width clamping constants — kept at module scope so the resize
 * handle, store setter, and CSS variable fallback all agree on the same
 * range. Mirrors the clamp in `setCmdBarPinnedWidth`.
 */
export const PINNED_WIDTH_MIN = 280;
export const PINNED_WIDTH_MAX = 800;
export const PINNED_WIDTH_DEFAULT = 400;
export const PINNED_WIDTH_KEYBOARD_STEP = 20;

/**
 * Floating-mode (expanded) width clamping constants — mirror of the pinned
 * constants above for the centred-overlay shape. The bar stays horizontally
 * centred so the resize handle delta is doubled when applying — dragging
 * the right edge by 50 px grows the bar by 100 px (both edges move).
 * Live-test 2026-04-26.
 */
export const EXPANDED_WIDTH_MIN = 480;
export const EXPANDED_WIDTH_MAX = 1400;
export const EXPANDED_WIDTH_DEFAULT = 640;
export const EXPANDED_WIDTH_KEYBOARD_STEP = 20;

/**
 * Floating-mode (expanded) height clamping constants. 240 keeps the input
 * row and action buttons visible; 800 avoids the bar dominating smaller
 * displays. Default 480 matches the previous hardcoded value so existing
 * users see zero visual change after upgrade. Issue #37.
 */
export const EXPANDED_HEIGHT_MIN = 240;
export const EXPANDED_HEIGHT_MAX = 800;
export const EXPANDED_HEIGHT_DEFAULT = 480;
export const EXPANDED_HEIGHT_KEYBOARD_STEP = 20;

export interface CommandBarGeometryArgs {
  isPinned: boolean;
  /** Floating-mode expanded flag (drives the focus lift only). */
  expanded: boolean;
  /** `isPinned || expanded` — pinned mode is always "expanded". */
  effectiveExpanded: boolean;
}

export interface CommandBarGeometry {
  /** Full class list for the bar's outer element. */
  barClassName: string;
  /** Inline width/height driven by the resize CSS variables. */
  inlineStyle: React.CSSProperties;
}

/**
 * useCommandBarGeometry — the FloatingCommandBar's visual-chrome state
 * machine (position, width, height, radius, lift, transition, background).
 *
 * The bar is the same DOM in both compact and expanded states — only the
 * size, contents, and lift offset differ. Tailwind `h-*` + `transition-all`
 * gives a smooth height/opacity morph; reduced-motion strips both the
 * transition utility and the lift transform.
 *
 * Position / sizing depend on the current mode:
 *   - pinned       → fixed right-edge full-height side panel; width comes
 *                    from the `--cmd-bar-pinned-width` CSS variable so the
 *                    drag handle can mutate it without React re-renders
 *   - floating + expanded → centered overlay near the bottom, fixed width
 *   - floating + compact  → smaller pill, same horizontal centring
 *
 * In pinned mode the panel is always "expanded" — there's no compact pill
 * and no height collapse. We still funnel through `effectiveExpanded` so
 * a single conditional picks the right content slot.
 * Live-test 2026-04-25 — floating-mode horizontal centre is now the
 * doc-area's centre, NOT the window's. The QuietLayout root publishes
 * `--quiet-sidebar-width` (252 px when pinned, 0 px otherwise); we
 * shift the centre right by half that width so the bar visually
 * belongs to the document. Using a CSS variable keeps the layout
 * logic in one place — toggling the sidebar reflows the bar without
 * any JS. `left: calc(50% + var(--quiet-sidebar-width, 0px) / 2)`
 * lands the bar's translation anchor on the doc-area's centerline.
 */
export function useCommandBarGeometry({
  isPinned,
  expanded,
  effectiveExpanded,
}: CommandBarGeometryArgs): CommandBarGeometry {
  const reducedMotion = useReducedMotion();

  // Live-test 2026-04-26 — when transparent chrome is on, the collapsed
  // pill matches the title bar / status bar by going translucent over
  // the doc area. The bar portals to `document.body` and is NOT a
  // descendant of the QuietLayout root that carries the
  // `data-quiet-chrome-transparent` attribute, so we read the setting
  // directly here instead of relying on a descendant CSS selector.
  const quietChromeTransparent = useSettingsStore(
    (s) => s.quietChromeTransparent,
  );

  const positionClasses = isPinned
    ? "fixed top-0 right-0 h-screen"
    : "fixed bottom-10 left-[calc(50%+var(--quiet-sidebar-width,0px)/2)] -translate-x-1/2";

  const widthClasses = isPinned
    ? // Width is driven by the CSS variable. We set a Tailwind w-* fallback
      // (defaults to PINNED_WIDTH_DEFAULT) for the very first paint before
      // the inline style is applied. `max-w-[90vw]` keeps the panel sane on
      // narrow windows.
      "max-w-[90vw]"
    : effectiveExpanded
      ? // Width is driven by the `--cmd-bar-expanded-width` CSS variable for
        // the same reason as pinned mode — drag-to-resize without React
        // re-renders. The variable falls back to EXPANDED_WIDTH_DEFAULT so
        // first paint is unchanged. Live-test 2026-04-26.
        "max-w-[90vw]"
      : "w-[480px] max-w-[90vw]";

  const heightClasses = isPinned
    ? "" // pinned: full-screen height owned by `positionClasses`
    : effectiveExpanded
      ? "" // expanded: height driven by --cmd-bar-expanded-height CSS variable via inlineStyle
      : "h-12";

  // Pinned panel uses square corners on the right edge (it's flush against
  // the window) and only rounds the left side.
  const radiusClasses = isPinned
    ? "rounded-l-2xl rounded-r-none"
    : effectiveExpanded
      ? "rounded-2xl"
      : "rounded-xl";

  // 14 px lift on focus / when expanded — only for the floating overlay.
  // Pinned mode is permanent docking; lift would feel out of place.
  const liftClasses =
    !reducedMotion && expanded && !isPinned ? "-translate-y-[14px]" : "";

  // Fixed-position overlay needs a vertical translate that combines with
  // the horizontal -translate-x-1/2. We layer them via Tailwind's transform
  // composition: `-translate-x-1/2` already sets transform; the lift then
  // composes via the additional `-translate-y-[14px]` utility.

  const transitionClasses = reducedMotion
    ? ""
    : "transition-all duration-200 ease-out";

  // Inline style — pinned and floating-expanded modes both drive their width
  // via a CSS variable cascaded from <html> (the resize handles write to it
  // on every pointermove without re-rendering React). Collapsed floating
  // mode keeps a Tailwind w-* class instead.
  const inlineStyle: React.CSSProperties = isPinned
    ? { width: `var(--cmd-bar-pinned-width, ${PINNED_WIDTH_DEFAULT}px)` }
    : effectiveExpanded
      ? {
          width: `var(--cmd-bar-expanded-width, ${EXPANDED_WIDTH_DEFAULT}px)`,
          height: `var(--cmd-bar-expanded-height, ${EXPANDED_HEIGHT_DEFAULT}px)`,
        }
      : {};

  const barClassName = cn(
    positionClasses,
    widthClasses,
    heightClasses,
    radiusClasses,
    liftClasses,
    transitionClasses,
    // z-30 in pinned mode — slightly behind floating overlays so dialogs
    // still appear on top. Floating mode keeps z-40 to sit above the
    // editor and friends.
    isPinned ? "z-30" : "z-40",
    "flex flex-col overflow-hidden",
    // Live-test 2026-04-25 #155 — was `bg-popover/95` which let the
    // layout-root bleed through and read as a faint grey. Going to
    // full-opacity `bg-popover` (pure white in default light mode)
    // makes the bar visibly cleaner against the doc area. The
    // shadcn Popover (StatusTray, etc.) already uses full
    // opacity — the bar now matches.
    "border border-border shadow-lg",
    // Aligned with the editor pill toolbar (`Toolbar.tsx`'s
    // `isPill` branch) so the two floating chrome elements read as
    // one family. Opaque `bg-popover` by default; translucent
    // `bg-popover/70 backdrop-blur-[14px]` when the operator has
    // opted into `quietChromeTransparent`. Earlier this branch
    // used `bg-background/40 backdrop-blur-xl` (mirroring TitleBar)
    // but `/40` over a contrasting document (white-bg PDF in dark
    // mode) let too much underlying lightness through, breaking
    // legibility — operator-reported. `/70` over `bg-popover`
    // (slightly lighter than canvas in dark mode per design system
    // elevation cue) reads cleanly against either light or dark
    // documents in either theme.
    //
    // Expanded and pinned modes still stay opaque (full `bg-popover`)
    // so chat stream content reads cleanly on top.
    !effectiveExpanded && !isPinned && quietChromeTransparent
      ? "bg-popover/70 backdrop-blur-[14px]"
      : "bg-popover backdrop-blur-md",
  );

  return { barClassName, inlineStyle };
}
