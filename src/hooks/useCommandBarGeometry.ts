import type { CSSProperties } from 'react';

// ---------------------------------------------------------------------------
// Pinned-mode width clamping constants — shared between PinnedResizeHandle and
// the main geometry computation so the resize handle, store setter, and CSS
// variable fallback all agree on the same range.
// ---------------------------------------------------------------------------
export const PINNED_WIDTH_MIN = 280;
export const PINNED_WIDTH_MAX = 800;
export const PINNED_WIDTH_DEFAULT = 400;
export const PINNED_WIDTH_KEYBOARD_STEP = 20;

// ---------------------------------------------------------------------------
// Floating-mode (expanded) width clamping constants — mirror of the pinned
// constants above for the centred-overlay shape. Dragging the right edge by
// 50 px grows the bar by 100 px (both edges move, centred bar).
// ---------------------------------------------------------------------------
export const EXPANDED_WIDTH_MIN = 480;
export const EXPANDED_WIDTH_MAX = 1400;
export const EXPANDED_WIDTH_DEFAULT = 640;
export const EXPANDED_WIDTH_KEYBOARD_STEP = 20;

// ---------------------------------------------------------------------------
// Floating-mode (expanded) height clamping constants. 240 keeps the input row
// and action buttons visible; 800 avoids the bar dominating smaller displays.
// ---------------------------------------------------------------------------
export const EXPANDED_HEIGHT_MIN = 240;
export const EXPANDED_HEIGHT_MAX = 800;
export const EXPANDED_HEIGHT_DEFAULT = 480;
export const EXPANDED_HEIGHT_KEYBOARD_STEP = 20;

interface UseCommandBarGeometryInput {
  isPinned: boolean;
  expanded: boolean;
  effectiveExpanded: boolean;
  reducedMotion: boolean;
  quietChromeTransparent: boolean;
}

interface UseCommandBarGeometryResult {
  positionClasses: string;
  widthClasses: string;
  heightClasses: string;
  radiusClasses: string;
  liftClasses: string;
  transitionClasses: string;
  backgroundClasses: string;
  inlineStyle: CSSProperties;
}

/**
 * Derives the CSS classes and inline style for the FloatingCommandBar outer
 * wrapper from its three independent display axes: pinned vs floating,
 * expanded vs compact, and reduced-motion preference. Keeping this
 * computation in one place ensures the resize handle, store setter, and CSS
 * variable fallback all agree on the same range without duplicating the
 * logic across the main component and sub-components.
 */
export function useCommandBarGeometry({
  isPinned,
  expanded,
  effectiveExpanded,
  reducedMotion,
  quietChromeTransparent,
}: UseCommandBarGeometryInput): UseCommandBarGeometryResult {
  const positionClasses = isPinned
    ? 'fixed top-0 right-0 h-screen'
    : 'fixed bottom-10 left-[calc(50%+var(--quiet-sidebar-width,0px)/2)] -translate-x-1/2';

  const widthClasses = isPinned
    ? 'max-w-[90vw]'
    : effectiveExpanded
      ? 'max-w-[90vw]'
      : 'w-[480px] max-w-[90vw]';

  const heightClasses = isPinned
    ? ''
    : effectiveExpanded
      ? ''
      : 'h-12';

  const radiusClasses = isPinned
    ? 'rounded-l-2xl rounded-r-none'
    : effectiveExpanded
      ? 'rounded-2xl'
      : 'rounded-xl';

  const liftClasses =
    !reducedMotion && expanded && !isPinned ? '-translate-y-[14px]' : '';

  const transitionClasses = reducedMotion ? '' : 'transition-all duration-200 ease-out';

  const backgroundClasses =
    !effectiveExpanded && !isPinned && quietChromeTransparent
      ? 'bg-popover/70 backdrop-blur-[14px]'
      : 'bg-popover backdrop-blur-md';

  const inlineStyle: CSSProperties = isPinned
    ? { width: `var(--cmd-bar-pinned-width, ${PINNED_WIDTH_DEFAULT}px)` }
    : effectiveExpanded
      ? {
          width: `var(--cmd-bar-expanded-width, ${EXPANDED_WIDTH_DEFAULT}px)`,
          height: `var(--cmd-bar-expanded-height, ${EXPANDED_HEIGHT_DEFAULT}px)`,
        }
      : {};

  return {
    positionClasses,
    widthClasses,
    heightClasses,
    radiusClasses,
    liftClasses,
    transitionClasses,
    backgroundClasses,
    inlineStyle,
  };
}
