/**
 * Lift large inlined raster images out of a parsed HTML document before it is
 * sanitised, and put them back afterwards.
 *
 * A saved web page carries its images as base64 `data:` URIs, so a capture is
 * mostly attribute values that are megabytes long. Sanitising it means
 * serialising, re-parsing, and regex-testing those megabytes several times,
 * all to reach the same verdict a 60-character value would get: DOMPurify
 * decides a `data:` URI on the attribute name, the element name and the
 * `data:` prefix, never on the payload.
 *
 * So each such value is swapped, on the parsed DOM, for a short stand-in with
 * the same scheme and MIME type, and swapped back, again on the DOM, once the
 * sanitiser has had its say.
 *
 * SECURITY — what makes this exactly as strict as sanitising the original:
 *
 * 1. Only a value that is, in full, `data:image/<raster>;base64,<base64>` is
 *    lifted: lowercase scheme, a MIME type from the raster list below, and a
 *    payload of base64-alphabet characters only. No quote, `<`, `>`, `&`,
 *    `-`, `]`, whitespace or `%` can be in it, so the payload cannot change
 *    how the value serialises, re-parses, or matches any of the sanitiser's
 *    value probes. `data:text/html`, `data:image/svg+xml`, anything
 *    percent-encoded or oddly cased is NOT lifted and is judged at full
 *    length as before.
 * 2. Only the URL attributes in LIFT_ATTRS are considered. `style`, `srcset`,
 *    `id`, `name`, `value` and the rest are never touched.
 * 3. The stand-in keeps the `data:image/<mime>;base64,` prefix and replaces
 *    the payload with other base64-alphabet characters, so every decision
 *    made about it is the decision that would have been made about the
 *    original.
 * 4. Restoration uses `setAttribute` on an element that survived sanitising,
 *    on one of the same attributes, and only when the attribute's WHOLE value
 *    is a stand-in issued by this lift. Nothing is spliced into a string, so
 *    a stand-in that turns up in text, in `style`, or as part of a longer
 *    value is left exactly as it is. The value written is one this module
 *    validated under rule 1.
 * 5. Stand-ins carry 128 random bits per lift, so a document cannot name one.
 *    If it somehow did, the worst it gets is one of its own validated images
 *    in a place where the sanitiser already accepted an image `data:` URI.
 */

/** Attributes whose whole value may be lifted. All are URL attributes. */
const LIFT_ATTRS = ["src", "href", "xlink:href", "poster"] as const;

/** Raster types only. Never `svg+xml`, which is a document, not a bitmap. */
const PREFIX = /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/;

/** First character outside the base64 alphabet (padding handled separately). */
const NON_BASE64 = /[^A-Za-z0-9+/]/g;

/** Values shorter than this are cheap enough to leave where they are. */
export const LIFT_MIN_CHARS = 2048;

const TOKEN_MARK = "NSLIFT";

/** Upper bound on a stand-in's length; longer values are never looked up. */
const MAX_STAND_IN_CHARS = 128;

export interface LiftedDataUris {
  /** Stand-in value → the original attribute value it replaced. */
  readonly originals: ReadonlyMap<string, string>;
  /** Total characters lifted out of the document. */
  readonly chars: number;
}

export const NOTHING_LIFTED: LiftedDataUris = { originals: new Map(), chars: 0 };

/**
 * The MIME subtype of `value` when it is a liftable raster `data:` URI in
 * full, else null. Exported for tests.
 */
export function liftableImageType(value: string): string | null {
  const prefix = PREFIX.exec(value.length > 64 ? value.slice(0, 64) : value);
  if (!prefix) return null;
  const start = prefix[0].length;
  if (value.length === start) return null;
  // One forward scan, no backtracking: find the first non-alphabet character
  // and require that everything from there on is at most two `=` of padding.
  NON_BASE64.lastIndex = start;
  const bad = NON_BASE64.exec(value);
  NON_BASE64.lastIndex = 0;
  if (bad) {
    if (bad.index === start) return null;
    if (value.length - bad.index > 2) return null;
    for (let i = bad.index; i < value.length; i++) {
      if (value.charCodeAt(i) !== 61 /* = */) return null;
    }
  }
  return prefix[1];
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function forEachElement(root: ParentNode, visit: (el: Element) => void): void {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    const el = node as Element;
    visit(el);
    // A <template>'s children live in a separate fragment the walker skips.
    if (el.localName === "template") {
      const content = (el as HTMLTemplateElement).content;
      if (content) forEachElement(content, visit);
    }
    node = walker.nextNode();
  }
}

/**
 * Replace every large raster `data:` URI under `root` with a short stand-in.
 * Mutates `root`; pass the result to `restoreDataUris` after sanitising.
 *
 * `<template>` content is not entered: the sanitiser judges it at full
 * length, as before, and nothing a capture produces puts its images there.
 *
 * `token` exists so tests can build a deliberately forged stand-in. Callers
 * must not pass it.
 */
export function liftDataUris(
  root: ParentNode,
  minChars: number = LIFT_MIN_CHARS,
  token: string = randomToken(),
): LiftedDataUris {
  const originals = new Map<string, string>();
  let chars = 0;
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    const el = node as Element;
    for (const name of LIFT_ATTRS) {
      const value = el.getAttribute(name);
      if (value === null || value.length < minChars) continue;
      const type = liftableImageType(value);
      if (type === null) continue;
      const standIn = `data:image/${type};base64,${TOKEN_MARK}${token}Z${originals.size.toString(16)}`;
      originals.set(standIn, value);
      chars += value.length;
      el.setAttribute(name, standIn);
    }
    node = walker.nextNode();
  }
  return { originals, chars };
}

/**
 * Put lifted values back on the sanitised tree under `root`. Returns how many
 * attributes were restored; a lifted value whose element or attribute the
 * sanitiser removed is simply never written anywhere.
 */
export function restoreDataUris(
  root: ParentNode,
  lifted: LiftedDataUris,
  onRestore?: (el: Element, attr: string) => void,
): number {
  if (lifted.originals.size === 0) return 0;
  let restored = 0;
  forEachElement(root, (el) => {
    for (const name of LIFT_ATTRS) {
      const value = el.getAttribute(name);
      if (value === null || value.length > MAX_STAND_IN_CHARS) continue;
      const original = lifted.originals.get(value);
      if (original === undefined) continue;
      el.setAttribute(name, original);
      restored++;
      onRestore?.(el, name);
    }
  });
  return restored;
}
