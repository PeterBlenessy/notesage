/**
 * Read-aloud highlight agent, injected into a saved page (#833).
 *
 * Marks the paragraph being read and, when the voice reports word
 * boundaries, the word — inside the article's own document, which is the
 * only place the marks can be drawn: natively the report is a bridge-less
 * WKWebView, and in the fallback a sandboxed cross-origin iframe. The agent
 * LISTENS only. Messages arrive as:
 *
 *   iframe:  parent → frame  postMessage { ns: "notesage-speech", ...msg }
 *   native:  a `notesage:speech-agent` CustomEvent with `detail: msg`
 *
 *   { type: "paragraphs", items: string[] }   the utterances, in order
 *   { type: "position", index, location?, length? }
 *   { type: "clear" }
 *
 * The paragraph texts are what the app split for the player, extracted from
 * the raw HTML by regex; this document's text differs from them only in
 * whitespace, so each is located by a whitespace-normalised search through
 * the text nodes, in order. A paragraph that cannot be found is skipped —
 * the reading goes on, only the mark is missing.
 *
 * Drawn with the CSS Custom Highlight API where it exists (no DOM change, so
 * a page's own scripts are undisturbed); otherwise by wrapping the range in
 * a marker element, the way the find agent does.
 */
const HTML_SPEECH_AGENT = `
<script>
(function () {
  "use strict";
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, HEAD: 1 };
  var paragraphs = [];   // the utterances, in order
  var located = [];      // per paragraph: [normStart, normEnd] or null
  var nodes = [];        // text nodes in document order
  var starts = [];       // raw global offset where each node starts
  var norm = "";         // whitespace-normalised text of the whole document
  var map = [];          // norm index → raw global index
  var built = false;
  var current = -1;
  var wraps = [];        // fallback marker elements
  var useHighlights = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";

  function style() {
    if (document.getElementById("ns-speech-style")) return;
    var s = document.createElement("style");
    s.id = "ns-speech-style";
    s.textContent =
      "::highlight(ns-speech-para){background:rgba(255,213,79,.28)}" +
      "::highlight(ns-speech-word){background:rgba(255,152,0,.9);color:#000}" +
      "mark.ns-speech-para{background:rgba(255,213,79,.28);color:inherit}" +
      "mark.ns-speech-word{background:rgba(255,152,0,.9);color:#000}";
    document.documentElement.appendChild(s);
  }

  function build() {
    nodes = []; starts = []; norm = ""; map = [];
    var raw = 0;
    var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        for (var e = n.parentNode; e && e.nodeType === 1; e = e.parentNode) {
          if (SKIP[e.nodeName.toUpperCase()]) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var lastSpace = true;
    for (var n = walker.nextNode(); n; n = walker.nextNode()) {
      var text = n.data;
      nodes.push(n); starts.push(raw);
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        var ws = /\\s/.test(ch);
        if (ws) {
          if (!lastSpace) { norm += " "; map.push(raw + i); lastSpace = true; }
        } else {
          norm += ch; map.push(raw + i); lastSpace = false;
        }
      }
      raw += text.length;
    }
    built = true;
  }

  function locate() {
    located = [];
    var cursor = 0;
    for (var i = 0; i < paragraphs.length; i++) {
      var p = paragraphs[i];
      var at = norm.indexOf(p, cursor);
      if (at < 0 && p.length > 40) at = norm.indexOf(p.slice(0, 40), cursor);
      if (at < 0) { located.push(null); continue; }
      var end = Math.min(at + p.length, norm.length);
      located.push([at, end]);
      cursor = end;
    }
  }

  function point(rawIndex) {
    // Binary search the node that holds raw offset rawIndex.
    var lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= rawIndex) lo = mid; else hi = mid - 1;
    }
    var node = nodes[lo];
    var offset = Math.min(rawIndex - starts[lo], node.data.length);
    return { node: node, offset: offset };
  }

  function rangeFor(normStart, normEnd) {
    if (normStart >= map.length) return null;
    var s = point(map[normStart]);
    var e = point(map[Math.max(normStart, Math.min(normEnd, map.length) - 1)]);
    var r = document.createRange();
    try {
      r.setStart(s.node, s.offset);
      r.setEnd(e.node, e.offset + 1);
    } catch (err) { return null; }
    return r;
  }

  function clearMarks() {
    if (useHighlights) {
      CSS.highlights.delete("ns-speech-para");
      CSS.highlights.delete("ns-speech-word");
      return;
    }
    for (var i = wraps.length - 1; i >= 0; i--) {
      var m = wraps[i], parent = m.parentNode;
      if (!parent) continue;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    }
    wraps = [];
  }

  function wrap(range, cls) {
    // Fallback: wrap every text node the range touches, like the find agent.
    var walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    var touched = [];
    for (var n = walker.currentNode; n; n = walker.nextNode()) {
      if (n.nodeType !== 3) continue;
      if (range.intersectsNode(n)) touched.push(n);
    }
    for (var i = 0; i < touched.length; i++) {
      var node = touched[i];
      var from = node === range.startContainer ? range.startOffset : 0;
      var to = node === range.endContainer ? range.endOffset : node.data.length;
      if (to <= from) continue;
      var tail = node.splitText(from);
      tail.splitText(to - from);
      var m = document.createElement("mark");
      m.className = cls;
      tail.parentNode.insertBefore(m, tail);
      m.appendChild(tail);
      wraps.push(m);
    }
  }

  function paint(name, range) {
    if (!range) return;
    if (useHighlights) { CSS.highlights.set(name, new Highlight(range)); return; }
    wrap(range, name);
  }

  function reveal(range) {
    if (typeof range.getBoundingClientRect !== "function") return;
    var rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;
    var vh = window.innerHeight;
    if (rect.top >= vh * 0.15 && rect.bottom <= vh * 0.85) return;
    window.scrollTo({ top: window.scrollY + rect.top - vh * 0.3, behavior: "smooth" });
  }

  function position(msg) {
    style();
    var i = msg.index;
    clearMarks();
    // The fallback's unwrap + normalize changed the text nodes, so the map
    // is rebuilt — once per position, whatever arrives.
    if (!built || !useHighlights) { build(); locate(); }
    var span = located[i];
    if (!span) { current = i; return; }
    var para = rangeFor(span[0], span[1]);
    // Paragraph first, then the word INSIDE it, so the word mark nests in
    // the paragraph mark and paints over it.
    paint("ns-speech-para", para);
    if (typeof msg.location === "number" && typeof msg.length === "number" && msg.length > 0) {
      if (!useHighlights) {
        // The paragraph wrap moved text nodes, and a live range does not
        // follow a node that is moved — so the map is rebuilt for the word.
        // Two passes over the document, but only on the fallback path (a
        // WebKit without the Highlight API) and only for a word.
        build(); locate(); span = located[i];
        if (!span) { current = i; return; }
      }
      var ws = span[0] + msg.location, we = Math.min(span[0] + msg.location + msg.length, span[1]);
      paint("ns-speech-word", rangeFor(ws, we));
    }
    if (i !== current && para) reveal(para);
    current = i;
  }

  function handle(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "paragraphs" && Array.isArray(msg.items)) {
      paragraphs = msg.items.filter(function (p) { return typeof p === "string"; });
      built = false; current = -1; clearMarks();
      return;
    }
    if (msg.type === "position" && typeof msg.index === "number") { position(msg); return; }
    if (msg.type === "clear") { clearMarks(); current = -1; }
  }

  window.addEventListener("message", function (e) {
    var d = e && e.data;
    if (!d || d.ns !== "notesage-speech") return;
    handle(d);
  });
  window.addEventListener("notesage:speech-agent", function (e) { handle(e.detail); });
})();
</script>
`;

/** Append the read-aloud agent to a saved page (see `withFindAgent` for the
 *  dangling-`<script>` guard). */
export function withSpeechAgent(raw: string): string {
  const opens = (raw.match(/<script\b/gi) ?? []).length;
  const closes = (raw.match(/<\/script/gi) ?? []).length;
  const guard = opens > closes ? "</script>".repeat(opens - closes) : "";
  return raw + guard + HTML_SPEECH_AGENT;
}
