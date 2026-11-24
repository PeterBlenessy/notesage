/**
 * The HTML viewer's default render path: turn an untrusted `.html` file into
 * a sanitised body that can be shown inside the app's own webview.
 *
 * Split from `HtmlViewer.tsx` so the pipeline can be tested, and compared
 * against the one it replaced, without mounting the component.
 */
import DOMPurify from "dompurify";
import {
  liftDataUris,
  restoreDataUris,
  NOTHING_LIFTED,
  type LiftedDataUris,
} from "@/lib/html-data-uri-lift";
import { createHtmlSanitiseCache } from "@/lib/html-sanitise-cache";

/** The viewer's DOMPurify configuration. Do not loosen. */
export const HTML_VIEWER_PURIFY_CONFIG = {
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ["script", "iframe", "object", "embed"],
} as const;

// Strip attributes containing external (http/https) URLs from a raw HTML string.
// Applied before content reaches any render path when blockExternal is ON,
// so the guarantee holds for the sanitised-div, allowScripts iframe, and
// unsafe-preview iframe paths equally.
export function stripExternalResources(html: string): string {
  // Preserve DOCTYPE — DOMParser strips it from outerHTML serialisation.
  const doctypeMatch = html.match(/^(\s*<!DOCTYPE[^>]*>)/i);
  const doctype = doctypeMatch ? doctypeMatch[1] : "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const externalPattern = /^https?:/i;
  const cssUrlExternal = /url\(\s*['"]?https?:[^'")\s]+['"]?\s*\)/gi;

  for (const el of Array.from(doc.querySelectorAll("[src]"))) {
    const val = el.getAttribute("src");
    if (val && externalPattern.test(val)) el.removeAttribute("src");
  }
  for (const el of Array.from(doc.querySelectorAll("[href]"))) {
    const val = el.getAttribute("href");
    if (val && externalPattern.test(val)) el.removeAttribute("href");
  }
  for (const el of Array.from(doc.querySelectorAll("[srcset]"))) {
    const val = el.getAttribute("srcset");
    if (val) {
      const filtered = val
        .split(",")
        .filter((s) => !externalPattern.test(s.trim()))
        .join(",");
      if (filtered.trim()) {
        el.setAttribute("srcset", filtered);
      } else {
        el.removeAttribute("srcset");
      }
    }
  }
  // Strip CSS url(https://…) from inline style attributes.
  for (const el of Array.from(doc.querySelectorAll("[style]"))) {
    const val = el.getAttribute("style");
    if (val) {
      const stripped = val.replace(cssUrlExternal, "url()");
      if (stripped !== val) el.setAttribute("style", stripped);
    }
  }
  // Strip CSS url(https://…) from <style> block text content.
  for (const el of Array.from(doc.querySelectorAll("style"))) {
    if (el.textContent) {
      el.textContent = el.textContent.replace(cssUrlExternal, "url()");
    }
  }
  // Strip external URLs from additional resource-bearing attributes.
  for (const attr of ["poster", "formaction", "ping", "action", "data"]) {
    for (const el of Array.from(doc.querySelectorAll(`[${attr}]`))) {
      const val = el.getAttribute(attr);
      if (val && externalPattern.test(val)) el.removeAttribute(attr);
    }
  }
  return doctype + doc.documentElement.outerHTML;
}

/** A sanitised body, ready to mount with `mountPreparedHtml`. */
export interface PreparedHtmlBody {
  /**
   * DOMPurify's output. Large inlined images appear as short stand-ins and
   * are only made whole on the mounted DOM (see `html-data-uri-lift.ts`), so
   * this string stays small however big the file is.
   */
  readonly html: string;
  readonly lifted: LiftedDataUris;
  /** Length of the string DOMPurify was given. */
  readonly sanitisedChars: number;
}

/**
 * Sanitise the body of an HTML file.
 *
 * The file is parsed once. Large inlined raster images are lifted off that
 * tree, the now-small body goes through exactly the steps it always did
 * (serialise, optional external-resource stripping, DOMPurify with the
 * viewer's configuration), and the images are restored at mount time.
 *
 * The `<head>` is dropped — global selectors in the file's stylesheet would
 * bleed into the surrounding app chrome.
 */
export function prepareHtmlBody(content: string, blockExternal: boolean): PreparedHtmlBody {
  // Use DOMParser to extract body content — handles false </body> tags
  // inside <pre> blocks or HTML comments that would truncate a regex approach.
  const parsed = new DOMParser().parseFromString(content, "text/html");
  let lifted = liftDataUris(parsed.body);
  let fragment = parsed.body.innerHTML;
  if (!fragment) {
    // Nothing in the body: fall back to the raw text, as before. Nothing can
    // have been lifted from an empty body.
    fragment = content;
    lifted = NOTHING_LIFTED;
  }

  // Apply external-resource stripping before DOMPurify so the guarantee
  // is consistent with the iframe render paths (which use the same utility).
  const processedFragment = blockExternal ? stripExternalResources(fragment) : fragment;

  const html = DOMPurify.sanitize(processedFragment, {
    ALLOW_DATA_ATTR: HTML_VIEWER_PURIFY_CONFIG.ALLOW_DATA_ATTR,
    FORBID_TAGS: [...HTML_VIEWER_PURIFY_CONFIG.FORBID_TAGS],
  });
  return { html, lifted, sanitisedChars: processedFragment.length };
}

/**
 * Show a prepared body in `host`: parse the (small) sanitised string in
 * place, exactly as `dangerouslySetInnerHTML` did, then restore the lifted
 * images on the resulting elements.
 *
 * With `imageHints`, a restored `<img>` is also marked `decoding="async"` so
 * a multi-megabyte bitmap is not decoded on the main thread. `loading="lazy"`
 * is deliberately NOT set: captured images carry no dimensions, so a lazy
 * image has no height until it loads, and the document would grow under the
 * reader as they scroll — which is what reading progress is measured against.
 */
export function mountPreparedHtml(
  host: HTMLElement,
  prepared: PreparedHtmlBody,
  imageHints: boolean = false,
): void {
  host.innerHTML = prepared.html;
  restoreDataUris(
    host,
    prepared.lifted,
    imageHints
      ? (el, attr) => {
          if (attr === "src" && el.localName === "img" && !el.hasAttribute("decoding")) {
            el.setAttribute("decoding", "async");
          }
        }
      : undefined,
  );
}

/**
 * Documents at least this long are sanitised after a paint rather than
 * during render, and their result is cached. Shorter ones are handled
 * synchronously, as they always were.
 */
export const HTML_DEFER_MIN_CHARS = 200_000;

/** What a cache entry keeps alive, in characters. */
export function preparedHtmlCost(content: string, prepared: PreparedHtmlBody): number {
  return content.length + prepared.lifted.chars + prepared.html.length;
}

/**
 * Prepared bodies of the last few large documents — about four 3 MB
 * captures. An entry holds the file's text (to prove it is still the same
 * file) and its lifted images.
 */
export const htmlSanitiseCache = createHtmlSanitiseCache<PreparedHtmlBody>({
  maxChars: 24_000_000,
  maxEntries: 8,
});

/** Cache variant: the two settings give different output for one file. */
export function htmlSanitiseVariant(blockExternal: boolean): string {
  return blockExternal ? "block-external" : "default";
}
