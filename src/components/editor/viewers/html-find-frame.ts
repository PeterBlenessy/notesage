/**
 * In-frame find-in-document for the HtmlViewer's sandboxed iframe paths.
 *
 * The viewer renders document HTML in a `sandbox="allow-scripts"` iframe with
 * NO `allow-same-origin` (opaque origin) — so the host cannot reach into
 * `iframe.contentDocument` to search/highlight (this is what broke find when the
 * viewer was hardened from a same-origin iframe). Instead we inject a small,
 * self-contained search script into the document and drive it over `postMessage`.
 * The frame highlights matches and reports the count + current index back.
 *
 * Security: the injected script only walks the document's own text nodes and
 * wraps matches in <mark>; it accepts a fixed, tiny command vocabulary and never
 * evals. It runs inside the existing sandbox, so it gains no new privileges.
 */

/** Namespace tag on every host↔frame message so unrelated messages are ignored. */
export const HTML_FIND_NS = 'ns-html-find';

/** Host → frame command. */
export interface HtmlFindCommand {
    ns: typeof HTML_FIND_NS;
    action: 'search' | 'next' | 'prev' | 'clear';
    query?: string;
}

/** Frame → host result. */
export interface HtmlFindResult {
    ns: typeof HTML_FIND_NS;
    /** Total match count. */
    count: number;
    /** Active match index (0-based), or -1 when there are no matches. */
    current: number;
}

// The frame-side script, as a string injected into the document. Plain JS (runs
// in the iframe, not through the app's TS build). Kept dependency-free and small.
const FRAME_SCRIPT = `(function () {
  var NS = ${JSON.stringify(HTML_FIND_NS)};
  var MARK = 'nshl-find';
  var ACTIVE = 'nshl-find-active';
  var marks = [];
  var current = -1;

  var style = document.createElement('style');
  style.textContent =
    'mark.' + MARK + '{background:#fde68a;color:inherit;border-radius:2px;}' +
    'mark.' + ACTIVE + '{background:#f59e0b;color:#000;}';
  (document.head || document.documentElement).appendChild(style);

  function post() {
    parent.postMessage({ ns: NS, count: marks.length, current: current }, '*');
  }

  function clear() {
    var existing = document.querySelectorAll('mark.' + MARK);
    for (var i = 0; i < existing.length; i++) {
      var m = existing[i];
      if (m.parentNode) m.parentNode.replaceChild(document.createTextNode(m.textContent || ''), m);
    }
    if (document.body) document.body.normalize();
    marks = [];
    current = -1;
  }

  function paint() {
    for (var i = 0; i < marks.length; i++) marks[i].classList.remove(ACTIVE);
    if (current >= 0 && marks[current]) {
      marks[current].classList.add(ACTIVE);
      if (marks[current].scrollIntoView) {
        marks[current].scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    }
  }

  function search(query) {
    clear();
    if (!query || !document.body) { post(); return; }
    var q = String(query).toLowerCase();
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || node.nodeValue.toLowerCase().indexOf(q) === -1) return NodeFilter.FILTER_REJECT;
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var targets = [];
    var n;
    while ((n = walker.nextNode())) targets.push(n);
    for (var t = 0; t < targets.length; t++) {
      var node = targets[t];
      var text = node.nodeValue;
      var lower = text.toLowerCase();
      var frag = document.createDocumentFragment();
      var pos = 0;
      var idx;
      while ((idx = lower.indexOf(q, pos)) !== -1) {
        if (idx > pos) frag.appendChild(document.createTextNode(text.slice(pos, idx)));
        var mk = document.createElement('mark');
        mk.className = MARK;
        mk.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mk);
        pos = idx + q.length;
      }
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    }
    marks = Array.prototype.slice.call(document.querySelectorAll('mark.' + MARK));
    current = marks.length ? 0 : -1;
    paint();
    post();
  }

  function step(delta) {
    if (!marks.length) { post(); return; }
    current = (current + delta + marks.length) % marks.length;
    paint();
    post();
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.ns !== NS) return;
    if (d.action === 'search') search(d.query);
    else if (d.action === 'next') step(1);
    else if (d.action === 'prev') step(-1);
    else if (d.action === 'clear') clear();
  });
})();`;

/**
 * Inject the find script just before `</body>` (or append it) so it runs inside
 * the rendered document. Idempotent-safe: a fresh blob is built per render, so
 * the script is only ever present once.
 */
export function injectFindScript(html: string): string {
    const tag = `<script>${FRAME_SCRIPT}</script>`;
    const idx = html.toLowerCase().lastIndexOf('</body>');
    if (idx !== -1) {
        return html.slice(0, idx) + tag + html.slice(idx);
    }
    return html + tag;
}
