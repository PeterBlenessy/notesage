import { describe, expect, it } from "vitest";
import {
  documentToSpeechText,
  htmlToSpeechText,
  markdownToSpeechText,
} from "../speech-text";

describe("htmlToSpeechText", () => {
  it("keeps prose and drops the markup around it", () => {
    const out = htmlToSpeechText("<p>First para.</p><p>Second <em>para</em>.</p>");
    expect(out).toBe("First para.\n\nSecond para.");
  });

  it("never emits an inlined base64 image", () => {
    // The real shape of a capture: the hero is a data URI hundreds of KB long.
    // Left in, the synthesiser reads it out character by character.
    const data = "A".repeat(5000);
    const html = `<p>Before.</p><img class="hero" src="data:image/jpeg;base64,${data}"><p>After.</p>`;
    const out = htmlToSpeechText(html);
    expect(out).toBe("Before.\n\nAfter.");
    expect(out).not.toContain("base64");
    expect(out).not.toContain("AAAA");
  });

  it("drops an UNCLOSED script's body, not just its opening tag", () => {
    // A truncated capture or a malformed page leaves <script> with no closer.
    // The balanced-pair regex then matches nothing and the self-closing one
    // strips only "<script>", leaving the whole body — base64 and all — as
    // plain text for the synthesiser to read out. (Review finding, Critical.)
    const data = "A".repeat(300);
    const html = `<p>Before.</p><script>var x = "data:image/png;base64,${data}";`;
    const out = htmlToSpeechText(html);
    expect(out).toBe("Before.");
    expect(out).not.toContain("base64");
    expect(out).not.toContain("var x");
  });

  it("drops an unclosed style's body too", () => {
    expect(htmlToSpeechText("<p>A.</p><style>body{background:url(x)}")).toBe("A.");
  });

  it("strips a data: URI even if it reaches the output by some other route", () => {
    // Defence in depth: the contract is "no base64 reaches the voice", and it
    // must not rest on the tag regexes being exhaustive.
    const out = htmlToSpeechText(`<p>data:image/jpeg;base64,${"Q".repeat(400)} tail</p>`);
    expect(out).not.toContain("base64");
    expect(out).not.toContain("QQQQ");
    expect(out).toContain("tail");
  });

  it("drops script and style CONTENT, not just their tags", () => {
    const html = "<style>body{color:red}</style><script>alert(1)</script><p>Words.</p>";
    expect(htmlToSpeechText(html)).toBe("Words.");
  });

  it("drops an svg wholesale rather than reading its path data", () => {
    const html = '<p>A.</p><svg viewBox="0 0 9 9"><path d="M0 0L9 9Z"/></svg><p>B.</p>';
    expect(htmlToSpeechText(html)).toBe("A.\n\nB.");
  });

  it("decodes entities so punctuation is spoken, not spelled", () => {
    expect(htmlToSpeechText("<p>Tom&rsquo;s &amp; Jerry&hellip;</p>")).toBe("Tom’s & Jerry…");
    expect(htmlToSpeechText("<p>&#8212;&#x2014;</p>")).toBe("——");
  });

  it("leaves an unknown entity alone rather than mangling it", () => {
    expect(htmlToSpeechText("<p>&notanentity;</p>")).toBe("&notanentity;");
  });

  it("treats block boundaries and <br> as paragraph breaks", () => {
    expect(htmlToSpeechText("<div>A</div><h2>B</h2>C<br>D")).toBe("A\n\nB\n\nC\n\nD");
  });

  it("collapses whitespace inside a paragraph", () => {
    expect(htmlToSpeechText("<p>one\n   two\t three</p>")).toBe("one two three");
  });
});

describe("markdownToSpeechText", () => {
  it("strips frontmatter, headings and emphasis", () => {
    const md = "---\ntitle: T\nsource_url: http://x\n---\n\n# Heading\n\nSome **bold** text.";
    expect(markdownToSpeechText(md)).toBe("Heading\n\nSome bold text.");
  });

  it("reads a link's text but not its URL", () => {
    expect(markdownToSpeechText("See [the docs](https://example.com/a/b).")).toBe("See the docs.");
  });

  it("drops an image entirely, including a data URI src", () => {
    const md = `Before.\n\n![alt](data:image/png;base64,${"Z".repeat(3000)})\n\nAfter.`;
    const out = markdownToSpeechText(md);
    expect(out).toBe("Before.\n\nAfter.");
    expect(out).not.toContain("base64");
  });

  it("drops an image whose alt text contains nested brackets", () => {
    // `[^\]]*` cannot cross the `]` in "[nested]", so the old pattern failed
    // to match at all and the entire image — base64 included — passed
    // through untouched. (Review finding, Critical.)
    const md = `Before.\n\n![a [nested] alt](data:image/png;base64,${"Z".repeat(300)})\n\nAfter.`;
    const out = markdownToSpeechText(md);
    expect(out).toBe("Before.\n\nAfter.");
    expect(out).not.toContain("base64");
  });

  it("keeps link text when the label contains nested brackets", () => {
    expect(markdownToSpeechText("See [the [good] docs](https://example.com).")).toBe(
      "See the [good] docs.",
    );
  });

  it("does not read a bare URL out character by character", () => {
    expect(markdownToSpeechText("Go to https://example.com/x?y=1 now.")).toBe("Go to now.");
  });

  it("strips list and quote markers but keeps the item text", () => {
    expect(markdownToSpeechText("- one\n\n- two\n\n> quoted")).toBe("one\n\ntwo\n\nquoted");
  });

  it("drops fenced code rather than spelling out syntax", () => {
    expect(markdownToSpeechText("Intro.\n\n```js\nconst a = 1;\n```\n\nOutro.")).toBe(
      "Intro.\n\nOutro.",
    );
  });
});

describe("documentToSpeechText", () => {
  it("routes by kind", () => {
    expect(documentToSpeechText("<p>x</p>", "html")).toBe("x");
    expect(documentToSpeechText("# x", "markdown")).toBe("x");
    expect(documentToSpeechText("plain\n\ntext", "text")).toBe("plain\n\ntext");
  });

  it("returns empty for a document with nothing readable in it", () => {
    // The caller keeps Listen hidden on "" rather than offering a player that
    // would say nothing.
    expect(documentToSpeechText("<style>a{}</style>", "html")).toBe("");
    expect(documentToSpeechText("---\ntitle: T\n---\n", "markdown")).toBe("");
    expect(documentToSpeechText("   \n\n  ", "text")).toBe("");
  });

  it("splits the same way for a note and its HTML capture", () => {
    // Paragraph index IS the resume position, so the two extractors must not
    // disagree about where a paragraph ends.
    expect(documentToSpeechText("One.\n\nTwo.", "markdown")).toBe(
      documentToSpeechText("<p>One.</p><p>Two.</p>", "html"),
    );
  });
});
