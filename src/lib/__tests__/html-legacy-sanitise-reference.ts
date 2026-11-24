/**
 * TEST-ONLY reference: the HTML viewer's sanitising pipeline exactly as it
 * was before large `data:` URIs were lifted out of it (HtmlViewer.tsx at
 * v0.62.0). The new pipeline is checked against this mechanically, input by
 * input, so "nothing more survives than before" is asserted rather than
 * argued. Do not import this from application code.
 */
import DOMPurify from "dompurify";
import { stripExternalResources } from "@/lib/html-viewer-sanitise";
import type { PreparedHtmlBody } from "@/lib/html-viewer-sanitise";

/** The string the old viewer handed to `dangerouslySetInnerHTML`. */
export function legacySanitisedBody(content: string, blockExternal: boolean): string {
  const parsed = new DOMParser().parseFromString(content, "text/html");
  const fragment = parsed.body.innerHTML || content;
  const processedFragment = blockExternal ? stripExternalResources(fragment) : fragment;
  return DOMPurify.sanitize(processedFragment, {
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "iframe", "object", "embed"],
  });
}

/**
 * The new pipeline's output as one string, with every stand-in textually
 * replaced by the value it stands for. Only a test may do this: the
 * application restores on the DOM, never in a string.
 */
export function expandForComparison(prepared: PreparedHtmlBody): string {
  let out = prepared.html;
  for (const [standIn, original] of prepared.lifted.originals) {
    out = out.split(standIn).join(original);
  }
  return out;
}

/** A syntactically valid base64 payload of exactly `chars` characters. */
export function base64Payload(chars: number, seed: number): string {
  const unit = `iVBORw0KGgo${seed.toString(36)}AAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ+/`;
  let out = "";
  while (out.length < chars) out += unit;
  out = out.slice(0, chars);
  // Keep the length a multiple of four, as real base64 is.
  return out.slice(0, out.length - (out.length % 4));
}

export interface SyntheticCapture {
  html: string;
  /** The `src` of each inlined image, in document order. */
  images: string[];
}

/**
 * A saved article the way the share extension writes one: a styled head, a
 * masthead, paragraphs, and images inlined as base64 `data:` URIs.
 */
export function buildCapture(totalChars: number, imageCount: number, marker = "capture"): SyntheticCapture {
  const perImage = Math.floor(totalChars / imageCount);
  const images: string[] = [];
  const parts: string[] = [
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>",
    marker,
    "</title><style>body{font-family:serif}img{max-width:100%}</style></head><body><article>",
    `<h1>${marker} headline</h1><p class="byline">By A. Writer · example.com</p>`,
  ];
  for (let i = 0; i < imageCount; i++) {
    const type = i % 2 === 0 ? "png" : "jpeg";
    const src = `data:image/${type};base64,${base64Payload(perImage, i)}`;
    images.push(src);
    parts.push(
      `<p>${marker} paragraph ${i} with a <a href="https://example.com/${i}">link</a> and <em>emphasis</em>.</p>`,
      `<figure><img src="${src}" alt="figure ${i}"><figcaption>Figure ${i}</figcaption></figure>`,
    );
    for (let p = 0; p < 20; p++) {
      parts.push(`<p>Body text ${i}.${p} — lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>`);
    }
  }
  parts.push("</article></body></html>");
  return { html: parts.join(""), images };
}
