/**
 * aria-announcer — short-lived live-region helper used by sidebar rows (#80).
 *
 * Creates a visually-hidden `aria-live="assertive"` node on `document.body`
 * containing the provided message, then removes it after `ttlMs`. Matches the
 * pattern used by `useFocusMode.ts`; centralised here so every sidebar section
 * produces the exact same screen-reader output for rename, context-menu, and
 * peek-open events.
 *
 * Assertive rather than polite because a rename interrupts whatever the user
 * was previously doing — that's the intent of F2.
 */
export function announce(message: string, ttlMs = 2000): void {
  if (typeof document === "undefined") return;

  const node = document.createElement("div");
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "assertive");
  node.setAttribute("data-sidebar-announcer", "");
  // Visually-hidden inline styles — independent of Tailwind so jsdom tests
  // can locate the node without loading globals.css.
  node.style.position = "absolute";
  node.style.width = "1px";
  node.style.height = "1px";
  node.style.padding = "0";
  node.style.margin = "-1px";
  node.style.overflow = "hidden";
  node.style.clip = "rect(0, 0, 0, 0)";
  node.style.whiteSpace = "nowrap";
  node.style.border = "0";
  node.textContent = message;
  document.body.appendChild(node);

  window.setTimeout(() => {
    node.parentNode?.removeChild(node);
  }, ttlMs);
}
