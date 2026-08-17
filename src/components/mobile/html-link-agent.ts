/**
 * Link agent injected into HTML reports served over the `htmlpreview://`
 * scheme (mobile Reader). Sibling to the find agent, and injected for the same
 * reason: the report renders in a sandboxed cross-origin iframe
 * (`allow-scripts` without `allow-same-origin`), so a click listener in the
 * app never sees an anchor click inside it. Interception has to happen INSIDE
 * the document.
 *
 *   frame → parent  { ns: "notesage-link", type: "open", href, menu: boolean }
 *
 * The agent only ever REPORTS an href. It never navigates, and the parent
 * never trusts what it gets: a report's own scripts share this frame, so the
 * href is attacker-controllable in the worst case. Every path it can reach on
 * the parent side is one the user could reach by other means — resolve inside
 * the granted library, or hand to the system browser — and `resolveRelativeLink`
 * refuses anything climbing out of the library root.
 *
 * Long-press reports the same href with `menu: true` so the parent can offer
 * "Open here" / "Open in browser". 500 ms matches the platform's own
 * press-and-hold feel; a 10 px move cancels it, so scrolling a long report
 * never trips the menu.
 */
const HTML_LINK_AGENT = `
<script>
(function () {
  "use strict";
  var LONG_PRESS_MS = 500;
  var MOVE_CANCEL_PX = 10;
  var timer = null;
  var startX = 0;
  var startY = 0;
  var pressedHref = "";
  var firedMenu = false;

  function anchorFor(node) {
    while (node && node !== document) {
      if (node.tagName && node.tagName.toUpperCase() === "A") return node;
      node = node.parentNode;
    }
    return null;
  }

  function send(href, menu) {
    try {
      window.parent.postMessage(
        { ns: "notesage-link", type: "open", href: String(href), menu: !!menu },
        "*"
      );
    } catch (e) {}
  }

  function cancelPress() {
    if (timer) { clearTimeout(timer); timer = null; }
    pressedHref = "";
  }

  document.addEventListener(
    "click",
    function (e) {
      var a = anchorFor(e.target);
      if (!a) return;
      var href = a.getAttribute("href");
      if (!href) return;

      // In-page anchors belong to the document — let it scroll itself.
      if (href.charAt(0) === "#") return;

      // A long-press already reported this one; swallow the click the touch
      // sequence emits afterwards so the target does not also open.
      if (firedMenu) { firedMenu = false; e.preventDefault(); return; }

      e.preventDefault();
      send(href, false);
    },
    true
  );

  document.addEventListener(
    "touchstart",
    function (e) {
      var t = e.touches && e.touches[0];
      if (!t) return;
      var a = anchorFor(e.target);
      if (!a) return;
      var href = a.getAttribute("href");
      if (!href || href.charAt(0) === "#") return;

      startX = t.clientX;
      startY = t.clientY;
      pressedHref = href;
      firedMenu = false;
      timer = setTimeout(function () {
        timer = null;
        if (!pressedHref) return;
        firedMenu = true;
        send(pressedHref, true);
      }, LONG_PRESS_MS);
    },
    true
  );

  document.addEventListener(
    "touchmove",
    function (e) {
      if (!timer) return;
      var t = e.touches && e.touches[0];
      if (!t) return;
      if (
        Math.abs(t.clientX - startX) > MOVE_CANCEL_PX ||
        Math.abs(t.clientY - startY) > MOVE_CANCEL_PX
      ) {
        cancelPress();
      }
    },
    true
  );

  document.addEventListener("touchend", cancelPress, true);
  document.addEventListener("touchcancel", cancelPress, true);
})();
</script>
`;

/**
 * Append the link agent to a report, closing any dangling `<script>` first —
 * same guard as the find agent, for the same reason: HTML script parsing
 * consumes everything up to the next literal `</script>`, so an unclosed tag
 * in the report would swallow the agent whole and links would silently stop
 * working for that one file.
 */
export function withLinkAgent(raw: string): string {
  const opens = (raw.match(/<script\b/gi) ?? []).length;
  const closes = (raw.match(/<\/script/gi) ?? []).length;
  const guard = opens > closes ? "</script>".repeat(opens - closes) : "";
  return raw + guard + HTML_LINK_AGENT;
}
