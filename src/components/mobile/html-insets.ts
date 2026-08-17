/**
 * Give an HTML report the same screen-edge clearance every other document type
 * gets, by injecting padding INTO the document.
 *
 * Notes, text and the editor are full-screen scrollers (`inset-0`) with
 * `CONTENT_INSETS` padding: they own the whole screen, the padding keeps
 * content clear of the islands, and content scrolls *under* them. That is what
 * makes the app feel full-height.
 *
 * An HTML report renders in a sandboxed iframe, and the parent cannot reach
 * into another document's scroll area to pad it. So the container used to be
 * inset from the top instead — which shortened the viewport, removed the
 * scroll-under effect, and left no bottom clearance at all, so the end of a
 * report sat under the search island (#722).
 *
 * Appending a style block is the same trick the find and link agents already
 * use, and it lets the container go back to `inset-0`.
 *
 * ---------------------------------------------------------------------------
 * Why the values are passed in as pixels
 * ---------------------------------------------------------------------------
 *
 * `env(safe-area-inset-*)` does not resolve inside a sandboxed iframe — the
 * frame is not the top-level viewport, so it reads as 0 and the notch would
 * eat the first line. The parent CAN resolve it, so the caller measures there
 * and passes literal pixels.
 */

/** Chrome allowance above and below, matching `CONTENT_INSETS` in Chrome.tsx. */
const TOP_CHROME_REM = 3.75;
const BOTTOM_CHROME_REM = 4.25;

/**
 * Measure the device's safe-area insets plus the island allowance, in pixels,
 * from the parent document where `env()` actually resolves.
 *
 * Uses a probe element rather than hard-coding: the insets differ per device
 * and change on rotation, and a wrong guess is a notch through the first line.
 */
export function measureReaderInsets(): { top: number; bottom: number } {
  if (typeof document === "undefined") return { top: 0, bottom: 0 };

  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;" +
    `padding-top:calc(${TOP_CHROME_REM}rem + env(safe-area-inset-top));` +
    `padding-bottom:calc(${BOTTOM_CHROME_REM}rem + env(safe-area-inset-bottom));`;
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const top = Number.parseFloat(style.paddingTop) || 0;
  const bottom = Number.parseFloat(style.paddingBottom) || 0;
  probe.remove();

  return { top, bottom };
}

/**
 * Append the padding rule to a report.
 *
 * `!important` because a generated report may set its own body padding, and
 * losing this one puts content under the notch. Appended last so it wins on
 * order too.
 *
 * `min-height` keeps a SHORT document from leaving the scroller too small to
 * reach — without it, a one-paragraph report has nothing below the fold and
 * the bottom padding collapses to nothing useful.
 */
export function withReaderInsets(raw: string, insets: { top: number; bottom: number }): string {
  return `${raw}
<style>
  html { -webkit-text-size-adjust: 100%; }
  body {
    padding-top: ${Math.round(insets.top)}px !important;
    padding-bottom: ${Math.round(insets.bottom)}px !important;
    box-sizing: border-box !important;
    min-height: 100vh !important;
  }
</style>
`;
}
