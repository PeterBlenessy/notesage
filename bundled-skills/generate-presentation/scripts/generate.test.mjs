import { describe, it, expect } from "vitest";
import { parseMarkdown, parseInlineFormatting, stripMarkdownFormatting, STYLES } from "./generate.mjs";

// ---------------------------------------------------------------------------
// #1 — Hyperlink support
// ---------------------------------------------------------------------------

describe("parseInlineFormatting — hyperlinks", () => {
  it("emits hyperlink for external URL", () => {
    const result = parseInlineFormatting("[click here](https://example.com)");
    expect(result).toEqual([
      { text: "click here", options: { hyperlink: { url: "https://example.com" } } },
    ]);
  });

  it("emits hyperlink for mailto URL", () => {
    const result = parseInlineFormatting("[email](mailto:a@b.com)");
    expect(result).toEqual([
      { text: "email", options: { hyperlink: { url: "mailto:a@b.com" } } },
    ]);
  });

  it("emits slide hyperlink for #slide-N reference", () => {
    const result = parseInlineFormatting("[see results](#slide-5)");
    expect(result).toEqual([
      { text: "see results", options: { hyperlink: { slide: "5" } } },
    ]);
  });

  it("handles mixed text and link", () => {
    const result = parseInlineFormatting("Visit [Google](https://google.com) today");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ text: "Visit " });
    expect(result[1]).toEqual({ text: "Google", options: { hyperlink: { url: "https://google.com" } } });
    expect(result[2]).toEqual({ text: " today" });
  });
});

describe("parseMarkdown — table cell hyperlinks", () => {
  it("preserves link text in table cells", () => {
    const md = "| Name | Link |\n|---|---|\n| Foo | [click](https://example.com) |";
    const { slides } = parseMarkdown(md);
    const table = slides[0].content.find((c) => c.type === "table");
    expect(table).toBeDefined();
    // The table data stores raw cell text — hyperlink rendering is in generatePptx
    expect(table.data.rows[1][1]).toContain("[click](https://example.com)");
  });
});

// ---------------------------------------------------------------------------
// #2 — Presentation metadata from frontmatter
// ---------------------------------------------------------------------------

describe("parseMarkdown — frontmatter metadata", () => {
  it("parses author, company, title, subject", () => {
    const md = "---\nauthor: Jane Doe\ncompany: Acme Corp\ntitle: My Deck\nsubject: Q4 Review\n---\n# Slide 1";
    const { metadata } = parseMarkdown(md);
    expect(metadata.author).toBe("Jane Doe");
    expect(metadata.company).toBe("Acme Corp");
    expect(metadata.title).toBe("My Deck");
    expect(metadata.subject).toBe("Q4 Review");
  });

  it("returns empty metadata when no frontmatter", () => {
    const md = "# Title\n\nContent";
    const { metadata } = parseMarkdown(md);
    expect(Object.keys(metadata)).toHaveLength(0);
  });

  it("still parses slides correctly with frontmatter", () => {
    const md = "---\nauthor: Test\n---\n# First Slide\n\n- bullet";
    const { slides } = parseMarkdown(md);
    expect(slides).toHaveLength(1);
    expect(slides[0].title).toBe("First Slide");
    expect(slides[0].content).toHaveLength(1);
  });

  it("handles missing fields gracefully", () => {
    const md = "---\nauthor: Only Author\n---\n# Title";
    const { metadata } = parseMarkdown(md);
    expect(metadata.author).toBe("Only Author");
    expect(metadata.company).toBeUndefined();
    expect(metadata.title).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #4 — Subscript and superscript
// ---------------------------------------------------------------------------

describe("parseInlineFormatting — subscript/superscript", () => {
  it("parses subscript ~text~", () => {
    const result = parseInlineFormatting("H~2~O");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ text: "H" });
    expect(result[1]).toEqual({ text: "2", options: { subscript: true } });
    expect(result[2]).toEqual({ text: "O" });
  });

  it("parses superscript ^text^", () => {
    const result = parseInlineFormatting("x^2^");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ text: "x" });
    expect(result[1]).toEqual({ text: "2", options: { superscript: true } });
  });

  it("does not conflict with strikethrough ~~text~~", () => {
    const result = parseInlineFormatting("~~deleted~~");
    expect(result).toEqual([{ text: "deleted", options: { strike: true } }]);
  });

  it("handles nested bold with subscript", () => {
    const result = parseInlineFormatting("**H~2~O**");
    // Bold wraps the whole thing — inner subscript is inside bold match
    // The bold regex captures greedily, so this becomes a bold run
    expect(result[0].options.bold).toBe(true);
  });
});

describe("stripMarkdownFormatting — subscript/superscript", () => {
  it("strips subscript markers", () => {
    expect(stripMarkdownFormatting("H~2~O")).toBe("H2O");
  });

  it("strips superscript markers", () => {
    expect(stripMarkdownFormatting("x^2^")).toBe("x2");
  });

  it("strips strikethrough before subscript", () => {
    expect(stripMarkdownFormatting("~~deleted~~")).toBe("deleted");
  });
});

// ---------------------------------------------------------------------------
// #5 — Title shadows
// ---------------------------------------------------------------------------

describe("STYLES — title shadow", () => {
  it("simple style has no titleShadow", () => {
    expect(STYLES.simple.titleShadow).toBeUndefined();
  });

  it("business style has titleShadow", () => {
    expect(STYLES.business.titleShadow).toBeDefined();
    expect(STYLES.business.titleShadow.type).toBe("outer");
    expect(STYLES.business.titleShadow.blur).toBe(3);
  });

  it("report style has titleShadow", () => {
    expect(STYLES.report.titleShadow).toBeDefined();
    expect(STYLES.report.titleShadow.type).toBe("outer");
  });
});

// ---------------------------------------------------------------------------
// #3 — Slide numbers (structural test — API usage verified via integration)
// ---------------------------------------------------------------------------

describe("STYLES — slideNumbers flag", () => {
  it("simple has slideNumbers false", () => {
    expect(STYLES.simple.slideNumbers).toBe(false);
  });

  it("business has slideNumbers true", () => {
    expect(STYLES.business.slideNumbers).toBe(true);
  });

  it("report has slideNumbers true", () => {
    expect(STYLES.report.slideNumbers).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: existing formatting still works
// ---------------------------------------------------------------------------

describe("parseInlineFormatting — existing formatting", () => {
  it("handles bold", () => {
    const result = parseInlineFormatting("**bold**");
    expect(result).toEqual([{ text: "bold", options: { bold: true } }]);
  });

  it("handles italic", () => {
    const result = parseInlineFormatting("*italic*");
    expect(result).toEqual([{ text: "italic", options: { italic: true } }]);
  });

  it("handles inline code", () => {
    const result = parseInlineFormatting("`code`");
    expect(result).toEqual([{ text: "code", options: { fontFace: "Courier New", fontSize: 10 } }]);
  });

  it("handles plain text", () => {
    const result = parseInlineFormatting("just text");
    expect(result).toEqual([{ text: "just text" }]);
  });
});
