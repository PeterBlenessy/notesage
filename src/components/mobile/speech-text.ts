/**
 * Turn a saved document into prose the speech player can read aloud (#833).
 *
 * The native player splits on blank lines into paragraph utterances, so the
 * contract here is: return plain text whose paragraphs are separated by a
 * blank line, and nothing else.
 *
 * Two properties matter more than fidelity:
 *
 *  - **No markup may survive.** A stray `<img src="data:image/jpeg;base64,…">`
 *    is not a cosmetic problem: captures inline their images, so a single X
 *    article carries ~500 KB of base64 that the synthesiser would happily
 *    read out one character at a time.
 *  - **Paragraph boundaries must be stable.** They are the resume position,
 *    so the same document has to split the same way on every open.
 */

/** Block-level tags whose boundaries become paragraph breaks. */
const BLOCK_TAGS =
  "address|article|aside|blockquote|div|dl|dd|dt|fieldset|figcaption|figure|" +
  "footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|" +
  "tfoot|th|thead|tr|ul";

/** Elements whose CONTENT is never prose — dropped whole, not just untagged. */
const DROPPED_ELEMENTS = ["script", "style", "noscript", "svg", "head", "template"];

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      // Reject non-characters rather than emitting U+FFFD mid-sentence.
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Collapse whitespace and drop empty paragraphs.
 *
 * Runs last on every path so the two extractors cannot disagree about what a
 * paragraph boundary is — which would move a resume position between a
 * markdown note and the same note captured as HTML.
 */
/**
 * Last line of defence: strip any surviving `data:` URI.
 *
 * The tag handling above is regex, not a parser, and this file's contract —
 * that a base64 payload never reaches the synthesiser — is too important to
 * rest on one. Two Critical review findings were exactly this leak arriving by
 * routes the tag passes did not cover, so the guarantee is enforced directly
 * rather than inferred from the parsing being correct.
 */
function stripDataUris(text: string): string {
  return text.replace(/data:[a-z0-9.+-]*\/?[a-z0-9.+-]*\s*;?\s*base64\s*,\s*[A-Za-z0-9+/=]*/gi, " ");
}

function normalise(text: string): string {
  return text
    .split("\n\n")
    .map((para) => para.replace(/\s+/g, " ").trim())
    .filter((para) => para.length > 0)
    .join("\n\n");
}

/** Extract readable prose from a saved HTML document. */
export function htmlToSpeechText(html: string): string {
  let text = html;
  for (const tag of DROPPED_ELEMENTS) {
    text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"), " ");
    // An UNCLOSED one — a truncated capture, a malformed page — matched
    // neither the balanced form above nor a self-closing tag, so its entire
    // body survived as plain text and the synthesiser read the script out.
    // Everything after an unterminated <script> IS script, so drop to the end.
    text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, "i"), " ");
    // Self-closing form — drop the tag so its attributes (which can carry a
    // base64 payload) never reach the output.
    text = text.replace(new RegExp(`<${tag}\\b[^>]*/?>`, "gi"), " ");
  }
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  // Block boundaries → paragraph breaks, BEFORE the generic tag strip so the
  // structure survives it.
  text = text.replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n\n");
  text = text.replace(/<br\b[^>]*>/gi, "\n\n");
  // Everything else (inline tags, and any <img> with its data URI) goes.
  text = text.replace(/<[^>]*>/g, "");
  return normalise(stripDataUris(decodeEntities(text)));
}

/** Extract readable prose from a markdown note. */
export function markdownToSpeechText(markdown: string): string {
  let text = markdown;
  // YAML frontmatter — metadata, never prose.
  text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  // Fenced code: read the fact that code is here, not the code itself.
  text = text.replace(/^```[\s\S]*?^```\s*$/gm, "\n\n");
  text = text.replace(/`([^`]*)`/g, "$1");
  // Images before links: `![alt](src)` must not leave its alt text behind as
  // a bare link, and its src can be a data URI.
  //
  // Lazy `[\s\S]*?` up to the first `](`, NOT `[^\]]*`: a nested bracket in
  // the alt text (`![a [nested] alt](data:…)`) made the old pattern fail to
  // match at all, so the whole image — base64 payload included — passed
  // straight through to the synthesiser.
  text = text.replace(/!\[[\s\S]*?\]\([^)]*\)/g, " ");
  text = text.replace(/\[([\s\S]*?)\]\([^)]*\)/g, "$1");
  // Bare autolinks and raw URLs read as noise character by character.
  text = text.replace(/<https?:\/\/[^>]*>/gi, " ");
  text = text.replace(/https?:\/\/\S+/gi, " ");
  // Any HTML embedded in the markdown.
  text = text.replace(/<[^>]*>/g, " ");
  // Leading block markers: headings, quotes, list bullets, ordered markers.
  //
  // `[ \t]` and NOT `\s` in every one of these: `\s` matches newlines, so
  // `^\s{0,3}[-*+]` happily consumes the blank line BEFORE a list item and
  // welds two paragraphs into one utterance. Since a paragraph index is the
  // resume position, that also silently shifts where "resume" lands.
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  text = text.replace(/^[ \t]{0,3}>[ \t]?/gm, "");
  text = text.replace(/^[ \t]{0,3}[-*+][ \t]+/gm, "");
  text = text.replace(/^[ \t]{0,3}\d+[.)][ \t]+/gm, "");
  // Thematic breaks carry no sound.
  text = text.replace(/^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gm, "\n\n");
  // Emphasis markers.
  text = text.replace(/(\*\*|__|\*|_|~~)/g, "");
  return normalise(stripDataUris(decodeEntities(text)));
}

/**
 * Prose for whichever document kind the reader has open.
 *
 * Returns `""` when there is nothing to read — the caller uses that to keep
 * the Listen affordance hidden rather than offering a player that would say
 * nothing.
 */
export function documentToSpeechText(
  source: string,
  kind: "markdown" | "text" | "html",
): string {
  if (kind === "html") return htmlToSpeechText(source);
  if (kind === "markdown") return markdownToSpeechText(source);
  return normalise(source);
}
