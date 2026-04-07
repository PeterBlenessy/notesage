import { describe, it, expect } from "vitest";
import { parseMarkdown, parseInlineFormatting, stripMarkdownFormatting, parseSimpleYaml, parseYamlValue, inferLayout, estimateContentHeight, parseHtmlTable, STYLES, MASTER_MAP } from "./generate.mjs";

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
// Escaped brackets in callouts
// ---------------------------------------------------------------------------

describe("parseMarkdown — escaped bracket callouts", () => {
  it("parses > \\[!notes\\] as speaker notes", () => {
    const md = "# Slide\n\n> \\[!notes\\]\n> These are speaker notes";
    const { slides } = parseMarkdown(md);
    expect(slides[0].notes).toBe("These are speaker notes");
  });

  it("parses > [!notes] (unescaped) as speaker notes", () => {
    const md = "# Slide\n\n> [!notes]\n> These are speaker notes";
    const { slides } = parseMarkdown(md);
    expect(slides[0].notes).toBe("These are speaker notes");
  });

  it("parses > \\[!tip\\] as callout", () => {
    const md = "# Slide\n\n> \\[!tip\\]\n> A useful tip";
    const { slides } = parseMarkdown(md);
    const callout = slides[0].content.find((c) => c.type === "callout");
    expect(callout).toBeDefined();
    expect(callout.data.calloutType).toBe("tip");
    expect(callout.data.text).toBe("A useful tip");
  });

  it("parses > \\[!warning\\] as callout", () => {
    const md = "# Slide\n\n> \\[!warning\\]\n> Be careful";
    const { slides } = parseMarkdown(md);
    const callout = slides[0].content.find((c) => c.type === "callout");
    expect(callout).toBeDefined();
    expect(callout.data.calloutType).toBe("warning");
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

// ===========================================================================
// TIER 2 TESTS
// ===========================================================================

// ---------------------------------------------------------------------------
// #7 — Chart YAML parser
// ---------------------------------------------------------------------------

describe("parseSimpleYaml", () => {
  it("parses top-level key-value pairs", () => {
    const result = parseSimpleYaml("type: bar\ntitle: Revenue");
    expect(result.type).toBe("bar");
    expect(result.title).toBe("Revenue");
  });

  it("parses inline arrays", () => {
    const result = parseSimpleYaml("labels: [Q1, Q2, Q3, Q4]");
    expect(result.labels).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });

  it("parses numeric arrays", () => {
    const result = parseSimpleYaml("values: [12, 15, 18, 22]");
    expect(result.values).toEqual([12, 15, 18, 22]);
  });

  it("parses nested array of objects (series)", () => {
    const yaml = `series:
  - name: Revenue
    values: [12, 15]
  - name: Expenses
    values: [8, 10]`;
    const result = parseSimpleYaml(yaml);
    expect(result.series).toHaveLength(2);
    expect(result.series[0].name).toBe("Revenue");
    expect(result.series[0].values).toEqual([12, 15]);
    expect(result.series[1].name).toBe("Expenses");
  });

  it("parses nested plain objects (options)", () => {
    const yaml = `options:
  barDir: bar
  lineSmooth: true
  holeSize: 50`;
    const result = parseSimpleYaml(yaml);
    expect(result.options.barDir).toBe("bar");
    expect(result.options.lineSmooth).toBe(true);
    expect(result.options.holeSize).toBe(50);
  });

  it("handles booleans and numbers", () => {
    const result = parseSimpleYaml("enabled: true\ncount: 42\nlabel: hello");
    expect(result.enabled).toBe(true);
    expect(result.count).toBe(42);
    expect(result.label).toBe("hello");
  });

  it("skips comments and blank lines", () => {
    const result = parseSimpleYaml("# comment\ntype: pie\n\ntitle: Chart");
    expect(result.type).toBe("pie");
    expect(result.title).toBe("Chart");
  });
});

describe("parseYamlValue", () => {
  it("parses quoted strings", () => {
    expect(parseYamlValue('"hello world"')).toBe("hello world");
    expect(parseYamlValue("'hello world'")).toBe("hello world");
  });

  it("parses numbers", () => {
    expect(parseYamlValue("42")).toBe(42);
    expect(parseYamlValue("3.14")).toBe(3.14);
  });

  it("parses booleans", () => {
    expect(parseYamlValue("true")).toBe(true);
    expect(parseYamlValue("false")).toBe(false);
  });
});

describe("parseMarkdown — chart blocks", () => {
  it("parses ```chart block into chart content type", () => {
    const md = "# Slide\n\n```chart\ntype: bar\ntitle: Revenue\nlabels: [Q1, Q2]\nseries:\n  - name: Rev\n    values: [10, 20]\n```";
    const { slides } = parseMarkdown(md);
    const chart = slides[0].content.find((c) => c.type === "chart");
    expect(chart).toBeDefined();
    expect(chart.data.type).toBe("bar");
    expect(chart.data.title).toBe("Revenue");
    expect(chart.data.series[0].values).toEqual([10, 20]);
  });

  it("falls back to code block on invalid chart YAML", () => {
    const md = "# Slide\n\n```chart\ninvalid content without type or series\n```";
    const { slides } = parseMarkdown(md);
    const code = slides[0].content.find((c) => c.type === "code");
    expect(code).toBeDefined();
  });

  it("recognizes all chart types", () => {
    for (const type of ["bar", "line", "pie", "doughnut", "area"]) {
      const md = `# S\n\n\`\`\`chart\ntype: ${type}\nseries:\n  - name: A\n    values: [1, 2]\n\`\`\``;
      const { slides } = parseMarkdown(md);
      expect(slides[0].content[0].type).toBe("chart");
      expect(slides[0].content[0].data.type).toBe(type);
    }
  });
});

// ---------------------------------------------------------------------------
// #10 — Callout and accent shapes
// ---------------------------------------------------------------------------

describe("parseMarkdown — fenced div blocks", () => {
  it("parses :::callout block", () => {
    const md = "# Slide\n\n:::callout\nThis is important\n:::";
    const { slides } = parseMarkdown(md);
    const callout = slides[0].content.find((c) => c.type === "accentCallout");
    expect(callout).toBeDefined();
    expect(callout.data.text).toBe("This is important");
  });

  it("parses :::highlight block", () => {
    const md = "# Slide\n\n:::highlight\n$12.5M Revenue\n:::";
    const { slides } = parseMarkdown(md);
    const highlight = slides[0].content.find((c) => c.type === "highlight");
    expect(highlight).toBeDefined();
    expect(highlight.data.text).toBe("$12.5M Revenue");
  });

  it("handles multiline callout content", () => {
    const md = "# Slide\n\n:::callout\nLine 1\nLine 2\n:::";
    const { slides } = parseMarkdown(md);
    expect(slides[0].content[0].data.text).toBe("Line 1\nLine 2");
  });
});

// ---------------------------------------------------------------------------
// #9 — Two-column layout
// ---------------------------------------------------------------------------

describe("parseMarkdown — columns", () => {
  it("parses :::columns with ---column--- separator", () => {
    const md = "# Slide\n\n:::columns\n- Left item 1\n- Left item 2\n---column---\n- Right item 1\n:::";
    const { slides } = parseMarkdown(md);
    const cols = slides[0].content.find((c) => c.type === "columns");
    expect(cols).toBeDefined();
    expect(cols.data.left).toContain("Left item 1");
    expect(cols.data.right).toContain("Right item 1");
  });

  it("infers columns layout", () => {
    const md = "# Slide\n\n:::columns\nLeft\n---column---\nRight\n:::";
    const { slides } = parseMarkdown(md);
    expect(slides[0].layout).toBe("columns");
  });
});

describe("inferLayout", () => {
  it("returns columns when columns content present", () => {
    expect(inferLayout({ title: "T", content: [{ type: "columns" }] })).toBe("columns");
  });

  it("returns title for title-only slide", () => {
    expect(inferLayout({ title: "T", content: [] })).toBe("title");
  });
});

// ---------------------------------------------------------------------------
// #6 — Slide masters
// ---------------------------------------------------------------------------

describe("MASTER_MAP", () => {
  it("maps title to TITLE_SLIDE", () => {
    expect(MASTER_MAP.title).toBe("TITLE_SLIDE");
  });

  it("maps content to CONTENT", () => {
    expect(MASTER_MAP.content).toBe("CONTENT");
  });

  it("maps columns to TWO_CONTENT", () => {
    expect(MASTER_MAP.columns).toBe("TWO_CONTENT");
  });

  it("maps picture to PICTURE", () => {
    expect(MASTER_MAP.picture).toBe("PICTURE");
  });

  it("maps blank to BLANK", () => {
    expect(MASTER_MAP.blank).toBe("BLANK");
  });
});

// ---------------------------------------------------------------------------
// #11 — Chart color palettes (structural)
// ---------------------------------------------------------------------------

describe("STYLES — chartColors", () => {
  it("all styles have chartColors", () => {
    for (const style of ["simple", "business", "report"]) {
      expect(STYLES[style].chartColors).toBeDefined();
      expect(STYLES[style].chartColors).toHaveLength(6);
    }
  });
});

// ===========================================================================
// TIER 3 TESTS
// ===========================================================================

// ---------------------------------------------------------------------------
// #12 — Content overflow and slide splitting
// ---------------------------------------------------------------------------

describe("estimateContentHeight", () => {
  it("estimates bullet height based on item count", () => {
    const h = estimateContentHeight({ type: "bullets", data: { items: [1, 2, 3, 4, 5] } });
    expect(h).toBe(2.0); // 5 * 0.4
  });

  it("estimates text height", () => {
    expect(estimateContentHeight({ type: "text", data: { text: "hello" } })).toBe(0.55);
  });

  it("estimates table height from row count", () => {
    const h = estimateContentHeight({ type: "table", data: { rows: [["a"], ["b"], ["c"]] } });
    expect(h).toBeCloseTo(1.2); // 3 * 0.4
  });

  it("estimates code height from line count", () => {
    const h = estimateContentHeight({ type: "code", data: { text: "a\nb\nc" } });
    expect(h).toBeCloseTo(1.3); // 3 * 0.3 + 0.4
  });

  it("estimates chart as fixed 4.7", () => {
    expect(estimateContentHeight({ type: "chart", data: {} })).toBe(4.7);
  });

  it("estimates image as 3.7", () => {
    expect(estimateContentHeight({ type: "image", data: {} })).toBe(3.7);
  });
});

// ---------------------------------------------------------------------------
// #13 — Background image support
// ---------------------------------------------------------------------------

describe("parseMarkdown — background images", () => {
  it("parses <!-- background: path --> comment", () => {
    const md = "<!-- background: ./bg.jpg -->\n# Slide Title";
    const { slides } = parseMarkdown(md);
    expect(slides[0]._background).toBeDefined();
    expect(slides[0]._background.path).toBe("./bg.jpg");
    expect(slides[0]._background.overlay).toBeNull();
  });

  it("parses background with overlay", () => {
    const md = "<!-- background: ./bg.jpg overlay=0.4 -->\n# Slide Title";
    const { slides } = parseMarkdown(md);
    expect(slides[0]._background.overlay).toBe(0.4);
  });

  it("does not confuse regular comments", () => {
    const md = "<!-- just a comment -->\n# Slide Title";
    const { slides } = parseMarkdown(md);
    expect(slides[0]._background).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #14 — Image enhancements
// ---------------------------------------------------------------------------

describe("parseMarkdown — image sizing keywords", () => {
  it("parses image with cover keyword", () => {
    const md = '# Slide\n\n![photo](img.jpg "cover")';
    const { slides } = parseMarkdown(md);
    const img = slides[0].content.find((c) => c.type === "image");
    expect(img.data.sizing).toBe("cover");
  });

  it("parses image with round keyword", () => {
    const md = '# Slide\n\n![avatar](me.png "round")';
    const { slides } = parseMarkdown(md);
    const img = slides[0].content.find((c) => c.type === "image");
    expect(img.data.sizing).toBe("round");
  });

  it("parses image without keyword", () => {
    const md = "# Slide\n\n![photo](img.jpg)";
    const { slides } = parseMarkdown(md);
    const img = slides[0].content.find((c) => c.type === "image");
    expect(img.data.sizing).toBeNull();
  });

  it("preserves alt text", () => {
    const md = '# Slide\n\n![A scenic view](photo.jpg "cover")';
    const { slides } = parseMarkdown(md);
    expect(slides[0].content[0].data.alt).toBe("A scenic view");
  });
});

// ---------------------------------------------------------------------------
// #15 — Table enhancements (colspan)
// ---------------------------------------------------------------------------

describe("parseMarkdown — table colspan", () => {
  it("preserves empty cells for colspan detection", () => {
    const md = "| A | B | C |\n|---|---|---|\n| Wide || Narrow |";
    const { slides } = parseMarkdown(md);
    const table = slides[0].content.find((c) => c.type === "table");
    // Empty cell preserved for colspan detection in rendering
    expect(table.data.rows[1]).toEqual(["Wide", "", "Narrow"]);
  });
});

// ---------------------------------------------------------------------------
// #16 — Scatter/radar/bubble chart types
// ---------------------------------------------------------------------------

describe("parseMarkdown — scatter/radar/bubble charts", () => {
  it("parses scatter chart", () => {
    const md = "# S\n\n```chart\ntype: scatter\nseries:\n  - name: Data\n    values: [1, 2, 3]\n```";
    const { slides } = parseMarkdown(md);
    expect(slides[0].content[0].data.type).toBe("scatter");
  });

  it("parses radar chart", () => {
    const md = "# S\n\n```chart\ntype: radar\nlabels: [A, B, C]\nseries:\n  - name: S1\n    values: [1, 2, 3]\n```";
    const { slides } = parseMarkdown(md);
    expect(slides[0].content[0].data.type).toBe("radar");
  });

  it("parses bubble chart", () => {
    const md = "# S\n\n```chart\ntype: bubble\nseries:\n  - name: B\n    values: [10, 20, 30]\n```";
    const { slides } = parseMarkdown(md);
    expect(slides[0].content[0].data.type).toBe("bubble");
  });
});

// ===========================================================================
// TIER 4 TESTS
// ===========================================================================

// ---------------------------------------------------------------------------
// #17 — YouTube embedding
// ---------------------------------------------------------------------------

describe("parseMarkdown — YouTube embedding", () => {
  it("parses <!-- youtube: URL --> with standard URL", () => {
    const md = "# Slide\n\n<!-- youtube: https://www.youtube.com/watch?v=dQw4w9WgXcQ -->";
    const { slides } = parseMarkdown(md);
    const yt = slides[0].content.find((c) => c.type === "youtube");
    expect(yt).toBeDefined();
    expect(yt.data.videoId).toBe("dQw4w9WgXcQ");
    expect(yt.data.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("parses youtu.be short URL", () => {
    const md = "# Slide\n\n<!-- youtube: https://youtu.be/dQw4w9WgXcQ -->";
    const { slides } = parseMarkdown(md);
    const yt = slides[0].content.find((c) => c.type === "youtube");
    expect(yt).toBeDefined();
    expect(yt.data.videoId).toBe("dQw4w9WgXcQ");
  });

  it("ignores invalid YouTube URL", () => {
    const md = "# Slide\n\n<!-- youtube: https://example.com/not-youtube -->";
    const { slides } = parseMarkdown(md);
    const yt = slides[0].content.find((c) => c.type === "youtube");
    expect(yt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #18 — HTML table import
// ---------------------------------------------------------------------------

describe("parseHtmlTable", () => {
  it("parses basic HTML table", () => {
    const html = "<table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table>";
    const rows = parseHtmlTable(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["Name", "Value"]);
    expect(rows[1]).toEqual(["A", "1"]);
  });

  it("strips inner HTML tags", () => {
    const html = "<table><tr><td><strong>Bold</strong> text</td></tr></table>";
    const rows = parseHtmlTable(html);
    expect(rows[0][0]).toBe("Bold text");
  });

  it("returns empty array for non-table HTML", () => {
    expect(parseHtmlTable("<div>not a table</div>")).toEqual([]);
  });
});

describe("parseMarkdown — HTML tables", () => {
  it("parses <table> block as htmlTable content", () => {
    const md = "# Slide\n\n<table><tr><th>A</th></tr><tr><td>1</td></tr></table>";
    const { slides } = parseMarkdown(md);
    const ht = slides[0].content.find((c) => c.type === "htmlTable");
    expect(ht).toBeDefined();
    expect(ht.data.rows).toHaveLength(2);
  });
});
