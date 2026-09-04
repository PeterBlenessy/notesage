/**
 * The read-aloud highlight, as one self-contained function (#833, #891).
 *
 * Marks the paragraph being read and, when the voice reports word
 * boundaries, the word — in whatever DOM holds the article. Two hosts:
 *
 *  - a saved page, where it is INJECTED as a string (`html-speech-agent.ts`
 *    serialises this function with `toString()`), because the page is a
 *    bridge-less native web view or a sandboxed iframe;
 *  - the app's own reader for markdown and plain text, where it is called
 *    directly on the article element.
 *
 * Hence the shape: no imports, no references to anything outside the
 * function, plain DOM only — it must survive being turned into a string.
 *
 * The utterances are located by a whitespace-normalised search through the
 * root's text nodes, in order (they come from the source by regex; the DOM's
 * text differs only in whitespace). Drawn with the CSS Custom Highlight API
 * where it exists (no DOM change — the reader's DOM belongs to React) and by
 * wrapping `<mark>`s otherwise (never in the app: `allowWrap: false`).
 */
export interface SpeechHighlightOptions {
  /** Add the mark styles to the document (a page); the app has them in its
   *  stylesheet. */
  injectStyle?: boolean;
  /** Bring the paragraph into view; the host knows its scroller. */
  reveal?: (range: Range) => void;
  /** Permit the `<mark>`-wrapping fallback where the Highlight API is
   *  missing. Off for DOM owned by a framework. */
  allowWrap?: boolean;
}

export interface SpeechHighlight {
  setParagraphs(items: string[]): void;
  position(index: number, location?: number, length?: number): void;
  clear(): void;
}

export function installSpeechHighlight(root: Node, options: SpeechHighlightOptions): SpeechHighlight {
  var doc = root.ownerDocument || (root as Document);
  var win = doc.defaultView as (Window & typeof globalThis) | null;
  var SKIP: Record<string, number> = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, HEAD: 1 };
  var paragraphs: string[] = [];
  var located: Array<[number, number] | null> = [];
  var nodes: Text[] = [];
  var starts: number[] = [];
  var norm = "";
  var map: number[] = [];
  var built = false;
  var current = -1;
  var wraps: HTMLElement[] = [];
  interface HighlightLike { add(r: Range): void; clear(): void }
  interface HighlightRegistry { set(n: string, h: HighlightLike): void; get(n: string): HighlightLike | undefined; delete(n: string): void }
  var cssNs = win && (win as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  var HighlightCtor = win && (win as unknown as { Highlight?: new () => HighlightLike }).Highlight;
  var useHighlights = !!(cssNs && cssNs.highlights && typeof HighlightCtor === "function");
  var allowWrap = options.allowWrap !== false;
  // One Highlight object per name, its ranges swapped in place: WebKit does
  // not always repaint the old ranges when the registry entry is REPLACED,
  // and the previous paragraph's last word stayed lit (seen on the
  // simulator, 2026-09-04). Mutating the object it already tracks does.
  function highlightNamed(name: string): HighlightLike {
    var registry = (cssNs as { highlights: HighlightRegistry }).highlights;
    var h = registry.get(name);
    if (!h) {
      h = new (HighlightCtor as new () => HighlightLike)();
      registry.set(name, h);
    }
    return h;
  }

  function style() {
    if (!options.injectStyle || doc.getElementById("ns-speech-style")) return;
    var s = doc.createElement("style");
    s.id = "ns-speech-style";
    s.textContent =
      "::highlight(ns-speech-para){background:rgba(255,213,79,.28)}" +
      "::highlight(ns-speech-word){background:rgba(255,152,0,.9);color:#000}" +
      "mark.ns-speech-para{background:rgba(255,213,79,.28);color:inherit}" +
      "mark.ns-speech-word{background:rgba(255,152,0,.9);color:#000}";
    doc.documentElement.appendChild(s);
  }

  function build() {
    nodes = []; starts = []; norm = ""; map = [];
    var raw = 0;
    var walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
      acceptNode: function (n: Node) {
        for (var e = n.parentNode; e && e.nodeType === 1; e = e.parentNode) {
          if (SKIP[e.nodeName.toUpperCase()]) return 2; /* FILTER_REJECT */
        }
        return 1; /* FILTER_ACCEPT */
      },
    });
    var lastSpace = true;
    for (var n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      var text = n.data;
      nodes.push(n); starts.push(raw);
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        if (/\s/.test(ch)) {
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

  function point(rawIndex: number) {
    var lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= rawIndex) lo = mid; else hi = mid - 1;
    }
    var node = nodes[lo];
    return { node: node, offset: Math.min(rawIndex - starts[lo], node.data.length) };
  }

  function rangeFor(normStart: number, normEnd: number): Range | null {
    if (normStart >= map.length) return null;
    var s = point(map[normStart]);
    var e = point(map[Math.max(normStart, Math.min(normEnd, map.length) - 1)]);
    var r = doc.createRange();
    try {
      r.setStart(s.node, s.offset);
      r.setEnd(e.node, e.offset + 1);
    } catch (err) { return null; }
    return r;
  }

  function clearMarks() {
    if (useHighlights) {
      highlightNamed("ns-speech-para").clear();
      highlightNamed("ns-speech-word").clear();
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

  function wrap(range: Range, cls: string) {
    var walker = doc.createTreeWalker(range.commonAncestorContainer, 4);
    var touched: Text[] = [];
    for (var n = walker.currentNode; n; n = walker.nextNode() as Node) {
      if (n.nodeType !== 3) continue;
      if (range.intersectsNode(n)) touched.push(n as Text);
    }
    for (var i = 0; i < touched.length; i++) {
      var node = touched[i];
      var from = node === range.startContainer ? range.startOffset : 0;
      var to = node === range.endContainer ? range.endOffset : node.data.length;
      if (to <= from) continue;
      var tail = node.splitText(from);
      tail.splitText(to - from);
      var m = doc.createElement("mark");
      m.className = cls;
      (tail.parentNode as Node).insertBefore(m, tail);
      m.appendChild(tail);
      wraps.push(m);
    }
  }

  function paint(name: string, range: Range | null) {
    if (!range) return;
    if (useHighlights) {
      var h = highlightNamed(name);
      h.clear();
      h.add(range);
      return;
    }
    if (allowWrap) wrap(range, name);
  }

  function reveal(range: Range) {
    if (options.reveal) { options.reveal(range); return; }
    if (!win || typeof range.getBoundingClientRect !== "function") return;
    var rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;
    var vh = win.innerHeight;
    if (rect.top >= vh * 0.15 && rect.bottom <= vh * 0.85) return;
    win.scrollTo({ top: win.scrollY + rect.top - vh * 0.3, behavior: "smooth" });
  }

  function position(index: number, location?: number, length?: number) {
    style();
    clearMarks();
    // The fallback's unwrap + normalize changed the text nodes, so the map
    // is rebuilt — once per position, whatever arrives.
    if (!built || !useHighlights) { build(); locate(); }
    var span = located[index];
    if (!span) { current = index; return; }
    var para = rangeFor(span[0], span[1]);
    // Paragraph first, then the word INSIDE it, so the word mark nests in
    // the paragraph mark and paints over it.
    paint("ns-speech-para", para);
    if (typeof location === "number" && typeof length === "number" && length > 0) {
      if (!useHighlights) {
        // The paragraph wrap moved text nodes, and a live range does not
        // follow a node that is moved — so the map is rebuilt for the word.
        build(); locate(); span = located[index];
        if (!span) { current = index; return; }
      }
      var ws = span[0] + location, we = Math.min(span[0] + location + length, span[1]);
      paint("ns-speech-word", rangeFor(ws, we));
    }
    if (index !== current && para) reveal(para);
    current = index;
  }

  return {
    setParagraphs: function (items: string[]) {
      paragraphs = items.filter(function (p) { return typeof p === "string"; });
      built = false; current = -1; clearMarks();
    },
    position: position,
    clear: function () { clearMarks(); current = -1; built = false; },
  };
}
