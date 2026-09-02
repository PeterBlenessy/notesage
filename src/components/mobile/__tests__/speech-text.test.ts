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
