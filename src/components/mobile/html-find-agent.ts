/**
 * Find-in-document agent injected into HTML reports served over the
 * `htmlpreview://` scheme (mobile Reader). The report renders in a sandboxed
 * cross-origin iframe (`allow-scripts` without `allow-same-origin`), so the
 * app CANNOT reach its DOM — search must run INSIDE the document. This script
 * is appended to the registered HTML and speaks a tiny postMessage protocol:
 *
 *   parent → frame  { ns: "notesage-find", type: "query", q: string }
 *   parent → frame  { ns: "notesage-find", type: "nav", dir: 1 | -1 }
 *   frame  → parent { ns: "notesage-find", type: "state", total, current }
 *
 * The parent treats replies as untrusted (a report's own scripts share the
 * frame) — worst case a hostile report lies about its own match count, which
 * only misleads its own search UI.
 */
const HTML_FIND_AGENT = `
<script>
(function () {
  "use strict";
  var marks = [];
  var current = 0;
  var lastQuery = "";
  var BASE = "background:rgba(255,213,79,.6);color:inherit;border-radius:2px;";
  var ACTIVE = "background:rgba(255,152,0,.9);color:#000;border-radius:2px;";

  function reply() {
    try {
      window.parent.postMessage(
        { ns: "notesage-find", type: "state", total: marks.length, current: current },
        "*"
      );
    } catch (e) {}
  }

  function clearMarks() {
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      var parent = m.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(m.textContent || ""), m);
      parent.normalize();
    }
    marks = [];
    current = 0;
  }

  // Whether layout information exists (real browsers yes, jsdom no) — the
  // visibility filter only makes sense where hidden things HAVE no layout.
  var hasLayout = document.documentElement.getBoundingClientRect().width > 0;

  function isHidden(el) {
    // display:none anywhere in the chain (offsetParent null) — the common
    // case for tabbed reports: matches behind another tab are unreachable
    // by scrolling, so navigation must skip them entirely.
    if (!hasLayout) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return true;
    return false;
  }

  var MAX_MATCHES = 300;

  function highlight(query) {
    clearMarks();
    if (!query) { reply(); return; }
    var needle = query.toLowerCase();
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA" || tag === "MARK")
          return NodeFilter.FILTER_REJECT;
        if (isHidden(p)) return NodeFilter.FILTER_REJECT;
        return node.nodeValue && node.nodeValue.toLowerCase().indexOf(needle) !== -1
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var n = 0; n < nodes.length && marks.length < MAX_MATCHES; n++) {
      var node = nodes[n];
      var text = node.nodeValue || "";
      var lower = text.toLowerCase();
      var frag = document.createDocumentFragment();
      var pos = 0;
      var idx = lower.indexOf(needle);
      while (idx !== -1) {
        frag.appendChild(document.createTextNode(text.slice(pos, idx)));
        var mark = document.createElement("mark");
        mark.setAttribute("data-nsfind", "");
        mark.setAttribute("style", BASE);
        mark.textContent = text.slice(idx, idx + needle.length);
        frag.appendChild(mark);
        marks.push(mark);
        pos = idx + needle.length;
        idx = lower.indexOf(needle, pos);
      }
      frag.appendChild(document.createTextNode(text.slice(pos)));
      node.parentNode && node.parentNode.replaceChild(frag, node);
    }
    if (marks.length > 0) activate(0, true);
    reply();
  }

  function activate(idx, scroll) {
    if (marks.length === 0) return;
    marks[current] && marks[current].setAttribute("style", BASE);
    current = ((idx % marks.length) + marks.length) % marks.length;
    var m = marks[current];
    m.setAttribute("style", ACTIVE);
    if (scroll) {
      // Land the match in the upper third: centering left it behind the
      // app's bottom search island (and the keyboard while typing).
      m.scrollIntoView({ block: "start" });
      window.scrollBy(0, -Math.round(window.innerHeight * 0.3));
    }
  }

  // Reports with tabs/accordions reveal content AFTER the search ran — a
  // match on another tab is invisible to the initial walk. Any click may be
  // such a reveal: re-run the active query once things settle.
  document.addEventListener(
    "click",
    function () {
      if (!lastQuery) return;
      setTimeout(function () {
        if (lastQuery) highlight(lastQuery);
      }, 350);
    },
    true
  );

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.ns !== "notesage-find") return;
    if (d.type === "query") {
      lastQuery = String(d.q || "");
      highlight(lastQuery);
    } else if (d.type === "nav") {
      activate(current + (d.dir === -1 ? -1 : 1), true);
      reply();
    }
  });
})();
</script>
`;

/**
 * Append the find agent to a report, closing any dangling `<script>` first.
 * HTML script parsing consumes everything up to the next literal
 * `</script>` — an unclosed script tag in the report would otherwise swallow
 * the agent whole (no sandbox impact, but search would silently die for that
 * file).
 */
export function withFindAgent(raw: string): string {
  const opens = (raw.match(/<script\b/gi) ?? []).length;
  const closes = (raw.match(/<\/script/gi) ?? []).length;
  const guard = opens > closes ? "</script>".repeat(opens - closes) : "";
  return raw + guard + HTML_FIND_AGENT;
}
