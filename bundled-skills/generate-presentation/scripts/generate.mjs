#!/usr/bin/env node

// generate-presentation — PptxGenJS slide deck generator
// Usage: node generate.mjs <input.md> <output.pptx> [--style simple|business|report] [--template file.pptx]

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

// Detect if running as the main script (vs. imported for testing)
const __isMain = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Dependency check
// ---------------------------------------------------------------------------

let PptxGenJS, JSZip;
try {
  PptxGenJS = (await import("pptxgenjs")).default;
} catch {
  if (__isMain) {
    console.error(
      "Error: pptxgenjs not installed. Run `npm install` in this directory:\n  " +
        dirname(new URL(import.meta.url).pathname)
    );
    process.exit(1);
  }
}
try {
  JSZip = (await import("jszip")).default;
} catch {
  if (__isMain) {
    console.error(
      "Error: jszip not installed. Run `npm install` in this directory:\n  " +
        dirname(new URL(import.meta.url).pathname)
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const HELP = `
generate-presentation — Generate a PowerPoint slide deck from markdown

Usage:
  node generate.mjs <input.md> <output.pptx> [options]

Options:
  --style <name>      Built-in style: simple (default), business, report
  --template <file>   Path to a .pptx/.potx template for theme extraction
  --help              Show this help message

Examples:
  node generate.mjs presentation.md slides.pptx
  node generate.mjs presentation.md slides.pptx --style business
  node generate.mjs presentation.md slides.pptx --template brand.pptx
`.trim();

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const positional = [];
  let style = "simple";
  let template = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--style") {
      style = args[++i];
      if (!["simple", "business", "report"].includes(style)) {
        console.error(`Error: Unknown style "${style}". Choose: simple, business, report`);
        process.exit(1);
      }
    } else if (args[i] === "--template") {
      template = resolve(args[++i]);
      if (!existsSync(template)) {
        console.error(`Error: Template file not found: ${template}`);
        process.exit(1);
      }
    } else if (!args[i].startsWith("--")) {
      positional.push(args[i]);
    }
  }

  if (positional.length < 2) {
    console.error("Error: Both <input.md> and <output.pptx> are required.");
    console.error("Run with --help for usage.");
    process.exit(1);
  }

  const inputPath = resolve(positional[0]);
  const outputPath = resolve(positional[1]);

  if (!existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  return { inputPath, outputPath, style, template };
}

// ---------------------------------------------------------------------------
// Markdown parser — converts markdown text into slide data model
// ---------------------------------------------------------------------------

/**
 * Parse markdown into an array of slide objects.
 * Each slide: { title?, subtitle?, content: ContentItem[], notes?, layout }
 * ContentItem: { type: 'bullets'|'numbered'|'text'|'table'|'code'|'image'|'callout', data }
 */
function parseMarkdown(md) {
  const lines = md.split("\n");
  const slides = [];
  let current = null;

  function ensureSlide() {
    if (!current) {
      current = { content: [], notes: null };
      slides.push(current);
    }
    return current;
  }

  function newSlide(title) {
    current = { title: title || undefined, content: [], notes: null };
    slides.push(current);
    return current;
  }

  let i = 0;
  const metadata = {};

  // Parse YAML frontmatter
  if (lines[0] && lines[0].trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") {
      const fmMatch = lines[i].match(/^(\w[\w\s]*?):\s*(.+)/);
      if (fmMatch) metadata[fmMatch[1].trim().toLowerCase()] = fmMatch[2].trim();
      i++;
    }
    i++; // skip closing ---
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Horizontal rule — force new slide
    if (/^---+\s*$/.test(trimmed) && i > 0) {
      current = null; // next content starts a new slide
      i++;
      continue;
    }

    // H1 — new slide with title
    const h1Match = trimmed.match(/^#\s+(.+)/);
    if (h1Match) {
      newSlide(h1Match[1].trim());
      i++;
      continue;
    }

    // H2 — subtitle on current slide
    const h2Match = trimmed.match(/^##\s+(.+)/);
    if (h2Match) {
      ensureSlide().subtitle = h2Match[1].trim();
      i++;
      continue;
    }

    // H3-H6 — bold body text
    const hMatch = trimmed.match(/^#{3,6}\s+(.+)/);
    if (hMatch) {
      ensureSlide().content.push({ type: "text", data: { text: hMatch[1].trim(), bold: true } });
      i++;
      continue;
    }

    // Code block
    const codeMatch = trimmed.match(/^```(\w*)/);
    if (codeMatch) {
      const lang = codeMatch[1] || "";
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimEnd().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      ensureSlide().content.push({ type: "code", data: { lang, text: codeLines.join("\n") } });
      continue;
    }

    // Speaker notes callout: > [!notes] or > \[!notes\] (escaped brackets)
    if (/^>\s*\\?\[!notes\\?\]/i.test(trimmed)) {
      const noteLines = [];
      // Check if the notes text continues on the same line after the tag
      const inlineNotes = trimmed.replace(/^>\s*\\?\[!notes\\?\]\s*/i, "");
      if (inlineNotes) noteLines.push(inlineNotes);
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        noteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      ensureSlide().notes = noteLines.join("\n").trim();
      continue;
    }

    // Other callout: > [!type] or > \[!type\] (escaped brackets)
    const calloutMatch = trimmed.match(/^>\s*\\?\[!(\w+)\\?\]/i);
    if (calloutMatch) {
      const calloutType = calloutMatch[1];
      const calloutLines = [];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        calloutLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      ensureSlide().content.push({
        type: "callout",
        data: { calloutType, text: calloutLines.join("\n").trim() },
      });
      continue;
    }

    // Blockquote (plain)
    if (/^>\s/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      ensureSlide().content.push({
        type: "text",
        data: { text: quoteLines.join("\n").trim(), italic: true },
      });
      continue;
    }

    // Table
    if (/^\|/.test(trimmed)) {
      const tableRows = [];
      while (i < lines.length && /^\|/.test(lines[i].trimEnd())) {
        const row = lines[i]
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
        // Skip separator rows (e.g., |---|---|)
        if (!row.every((c) => /^[-:\s]+$/.test(c))) {
          tableRows.push(row);
        }
        i++;
      }
      if (tableRows.length > 0) {
        ensureSlide().content.push({ type: "table", data: { rows: tableRows } });
      }
      continue;
    }

    // Image
    const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      ensureSlide().content.push({
        type: "image",
        data: { alt: imgMatch[1], path: imgMatch[2] },
      });
      i++;
      continue;
    }

    // Bullet list item
    const bulletMatch = trimmed.match(/^(\s*)[*-]\s+(.+)/);
    if (bulletMatch) {
      const items = [];
      while (i < lines.length) {
        const bm = lines[i].match(/^(\s*)[*-]\s+(.+)/);
        if (!bm) break;
        const level = Math.floor(bm[1].length / 2);
        items.push({ text: bm[2].trim(), level });
        i++;
      }
      ensureSlide().content.push({ type: "bullets", data: { items } });
      continue;
    }

    // Numbered list item
    const numMatch = trimmed.match(/^(\s*)\d+\.\s+(.+)/);
    if (numMatch) {
      const items = [];
      while (i < lines.length) {
        const nm = lines[i].match(/^(\s*)\d+\.\s+(.+)/);
        if (!nm) break;
        const level = Math.floor(nm[1].length / 3);
        items.push({ text: nm[2].trim(), level });
        i++;
      }
      ensureSlide().content.push({ type: "numbered", data: { items } });
      continue;
    }

    // Blank line
    if (trimmed === "") {
      i++;
      continue;
    }

    // Plain paragraph text
    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^[#|>`!\-*\d]/.test(lines[i].trimEnd()) && !/^---/.test(lines[i].trimEnd())) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length > 0) {
      ensureSlide().content.push({ type: "text", data: { text: paraLines.join(" ") } });
    } else {
      i++; // safety: advance to avoid infinite loop
    }
  }

  // Assign layouts
  for (const slide of slides) {
    slide.layout = inferLayout(slide);
  }

  return { slides, metadata };
}

function inferLayout(slide) {
  const hasTitle = !!slide.title;
  const hasContent = slide.content.length > 0;
  const hasImage = slide.content.some((c) => c.type === "image");
  const isFirst = false; // caller can override for first slide

  if (hasTitle && !hasContent) return "title";
  if (hasTitle && hasImage && slide.content.length === 1) return "picture";
  if (hasTitle && hasContent) return "content";
  if (hasImage && !hasTitle) return "blank";
  return "content";
}

// ---------------------------------------------------------------------------
// Built-in styles
// ---------------------------------------------------------------------------

const STYLES = {
  simple: {
    colors: {
      dk1: "333333", dk2: "555555", lt1: "FFFFFF", lt2: "F5F5F5",
      accent1: "666666", accent2: "888888", accent3: "AAAAAA",
      accent4: "CCCCCC", accent5: "DDDDDD", accent6: "EEEEEE",
    },
    fonts: { heading: "Calibri", body: "Calibri" },
    background: { type: "solid", color: "FFFFFF" },
    slideNumbers: false,
    footer: null,
    titleSlide: { bgColor: "FFFFFF", titleColor: "333333" },
  },
  business: {
    colors: {
      dk1: "333333", dk2: "555555", lt1: "F2F2F2", lt2: "FFFFFF",
      accent1: "2D2D2D", accent2: "555555", accent3: "888888",
      accent4: "AAAAAA", accent5: "CCCCCC", accent6: "EEEEEE",
    },
    fonts: { heading: "Calibri", body: "Calibri" },
    background: { type: "solid", color: "F2F2F2" },
    slideNumbers: true,
    footer: null,
    titleSlide: { bgColor: "2D2D2D", titleColor: "FFFFFF" },
    accentBar: { color: "2D2D2D", height: 0.06 },
    titleShadow: { type: "outer", blur: 3, offset: 1, opacity: 0.25, angle: 45, color: "000000" },
  },
  report: {
    colors: {
      dk1: "333333", dk2: "555555", lt1: "FFFFFF", lt2: "F5F5F5",
      accent1: "404040", accent2: "666666", accent3: "888888",
      accent4: "AAAAAA", accent5: "CCCCCC", accent6: "EEEEEE",
    },
    fonts: { heading: "Cambria", body: "Calibri" },
    background: { type: "solid", color: "FFFFFF" },
    slideNumbers: true,
    footer: "title",
    titleSlide: { bgColor: "1A1A1A", titleColor: "FFFFFF" },
    titleShadow: { type: "outer", blur: 3, offset: 1, opacity: 0.25, angle: 45, color: "000000" },
  },
};

// ---------------------------------------------------------------------------
// Template theme extraction
// ---------------------------------------------------------------------------

async function extractTheme(templatePath) {
  const data = readFileSync(templatePath);
  const zip = await JSZip.loadAsync(data);

  const theme = {
    colors: { ...STYLES.simple.colors },
    fonts: { heading: "Calibri", body: "Calibri" },
    background: { type: "solid", color: "FFFFFF" },
    slideNumbers: false,
    footer: null,
    titleSlide: { bgColor: "FFFFFF", titleColor: "333333" },
  };

  // Parse theme XML
  const themeFile = zip.file("ppt/theme/theme1.xml");
  if (themeFile) {
    const xml = await themeFile.async("string");

    // Extract colors from a:clrScheme
    const colorNames = [
      "dk1", "dk2", "lt1", "lt2",
      "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
    ];
    for (const name of colorNames) {
      // Match <a:dk1><a:srgbClr val="XXXXXX"/></a:dk1> or <a:sysClr ... lastClr="XXXXXX"/>
      const srgb = xml.match(new RegExp(`<a:${name}>.*?<a:srgbClr val="([A-Fa-f0-9]{6})"`, "s"));
      const sys = xml.match(new RegExp(`<a:${name}>.*?<a:sysClr[^>]*lastClr="([A-Fa-f0-9]{6})"`, "s"));
      if (srgb) theme.colors[name] = srgb[1];
      else if (sys) theme.colors[name] = sys[1];
    }

    // Extract fonts
    const majorFont = xml.match(/<a:majorFont>.*?<a:latin typeface="([^"]+)"/s);
    const minorFont = xml.match(/<a:minorFont>.*?<a:latin typeface="([^"]+)"/s);
    if (majorFont) theme.fonts.heading = majorFont[1];
    if (minorFont) theme.fonts.body = minorFont[1];
  }

  // Parse slide master for background
  const masterFile = zip.file("ppt/slideMasters/slideMaster1.xml");
  if (masterFile) {
    const xml = await masterFile.async("string");
    const solidFill = xml.match(/<p:bg>.*?<a:solidFill>.*?<a:srgbClr val="([A-Fa-f0-9]{6})"/s);
    if (solidFill) {
      theme.background = { type: "solid", color: solidFill[1] };
    }
  }

  // Derive title slide colors from theme
  theme.titleSlide = {
    bgColor: theme.colors.accent1,
    titleColor: theme.colors.lt1,
  };

  return theme;
}

// ---------------------------------------------------------------------------
// Slide generation — PptxGenJS
// ---------------------------------------------------------------------------

function stripMarkdownFormatting(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/~([^~]+?)~/g, "$1")
    .replace(/\^([^^]+?)\^/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function parseInlineFormatting(text) {
  // Returns an array of PptxGenJS text objects with bold/italic/code/hyperlink/sub/superscript formatting
  const parts = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|_(.+?)_|~~(.+?)~~|~([^~]+?)~|`(.+?)`|\^([^^]+?)\^|\[([^\]]+)\]\(([^)]+)\)|[^*_~`\[^]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const full = match[0];
    if (match[2]) parts.push({ text: match[2], options: { bold: true } });
    else if (match[3]) parts.push({ text: match[3], options: { italic: true } });
    else if (match[4]) parts.push({ text: match[4], options: { bold: true } });
    else if (match[5]) parts.push({ text: match[5], options: { italic: true } });
    else if (match[6]) parts.push({ text: match[6], options: { strike: true } });
    else if (match[7]) parts.push({ text: match[7], options: { subscript: true } });
    else if (match[8]) parts.push({ text: match[8], options: { fontFace: "Courier New", fontSize: 10 } });
    else if (match[9]) parts.push({ text: match[9], options: { superscript: true } });
    else if (match[10]) {
      // Hyperlink: external URL or cross-slide reference (#slide-N)
      const url = match[11];
      const slideRef = url.match(/^#slide-(\d+)$/);
      if (slideRef) {
        parts.push({ text: match[10], options: { hyperlink: { slide: slideRef[1] } } });
      } else {
        parts.push({ text: match[10], options: { hyperlink: { url } } });
      }
    }
    else parts.push({ text: full });
  }
  return parts.length > 0 ? parts : [{ text }];
}

async function generatePptx(slides, theme, inputDir, outputPath, metadata = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inches

  // Apply presentation metadata (#2)
  pptx.title = metadata.title || stripMarkdownFormatting(slides[0]?.title || "");
  if (metadata.author) pptx.author = metadata.author;
  if (metadata.company) pptx.company = metadata.company;
  if (metadata.subject) pptx.subject = metadata.subject;

  const SLIDE_W = 13.33;
  const MARGIN_LEFT = 0.8;
  const MARGIN_RIGHT = 0.8;
  const CONTENT_WIDTH = SLIDE_W - MARGIN_LEFT - MARGIN_RIGHT;
  const TITLE_Y = 0.4;
  const TITLE_H = 0.8;
  const SUBTITLE_Y = 1.25;
  const SUBTITLE_H = 0.5;
  const CONTENT_Y_BASE = 1.9; // default content start (no subtitle)
  const CONTENT_Y_WITH_SUB = 1.9; // same — subtitle fits between title and content
  const MAX_CONTENT_BOTTOM = 6.8;

  for (let si = 0; si < slides.length; si++) {
    const slideData = slides[si];
    const slide = pptx.addSlide();
    const isFirstSlide = si === 0;
    const isTitleOnly = slideData.layout === "title" || (isFirstSlide && slideData.content.length === 0);

    // Background
    if (isTitleOnly) {
      slide.background = { color: theme.titleSlide.bgColor };
    } else {
      slide.background = { color: theme.background.color };
    }

    // Accent bar for business style — thin line below title area
    if (theme.accentBar && !isTitleOnly) {
      slide.addShape(pptx.ShapeType.rect, {
        x: MARGIN_LEFT,
        y: TITLE_Y + TITLE_H + 0.1,
        w: CONTENT_WIDTH,
        h: theme.accentBar.height,
        fill: { color: theme.accentBar.color },
      });
    }

    // Title
    if (slideData.title) {
      const titleColor = isTitleOnly ? theme.titleSlide.titleColor : theme.colors.dk1;
      const titleFontSize = isTitleOnly ? 44 : 36;
      const titleY = isTitleOnly ? 2.5 : TITLE_Y;

      const titleOpts = {
        x: MARGIN_LEFT,
        y: titleY,
        w: CONTENT_WIDTH,
        h: isTitleOnly ? 1.0 : TITLE_H,
        fontSize: titleFontSize,
        fontFace: theme.fonts.heading,
        color: titleColor,
        bold: true,
        align: isTitleOnly ? "center" : "left",
        valign: "bottom",
      };
      // Subtle shadow on content slide titles for business/report styles (#5)
      if (theme.titleShadow && !isTitleOnly) {
        titleOpts.shadow = theme.titleShadow;
      }
      slide.addText(stripMarkdownFormatting(slideData.title), titleOpts);
    }

    // Subtitle
    if (slideData.subtitle) {
      const subtitleY = isTitleOnly ? 3.8 : SUBTITLE_Y;
      slide.addText(stripMarkdownFormatting(slideData.subtitle), {
        x: MARGIN_LEFT,
        y: subtitleY,
        w: CONTENT_WIDTH,
        h: SUBTITLE_H,
        fontSize: isTitleOnly ? 24 : 18,
        fontFace: theme.fonts.body,
        color: isTitleOnly ? theme.titleSlide.titleColor : theme.colors.dk2,
        align: isTitleOnly ? "center" : "left",
      });
    }

    // Date on title slide
    if (isTitleOnly && isFirstSlide) {
      slide.addText(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), {
        x: MARGIN_LEFT,
        y: 4.5,
        w: CONTENT_WIDTH,
        h: 0.5,
        fontSize: 16,
        fontFace: theme.fonts.body,
        color: theme.titleSlide.titleColor,
        align: "center",
      });
    }

    // Content
    let curY = slideData.subtitle ? CONTENT_Y_WITH_SUB : CONTENT_Y_BASE;

    for (const item of slideData.content) {
      switch (item.type) {
        case "bullets":
        case "numbered": {
          // PptxGenJS addText for bullets: flat array of { text: string, options: { bullet, indentLevel, ... } }
          const textRows = item.data.items.map((it, idx) => ({
            text: stripMarkdownFormatting(it.text),
            options: {
              fontSize: 20,
              fontFace: theme.fonts.body,
              color: theme.colors.dk1,
              indentLevel: it.level,
              bullet: item.type === "bullets" ? { code: "2022" } : { type: "number" },
              paraSpaceAfter: 6,
            },
          }));
          const listH = Math.min(textRows.length * 0.45, MAX_CONTENT_BOTTOM - curY);
          slide.addText(textRows, {
            x: MARGIN_LEFT,
            y: curY,
            w: CONTENT_WIDTH,
            h: listH,
            valign: "top",
          });
          curY += listH + 0.1;
          break;
        }

        case "text": {
          slide.addText(stripMarkdownFormatting(item.data.text), {
            x: MARGIN_LEFT,
            y: curY,
            w: CONTENT_WIDTH,
            h: 0.5,
            fontSize: 20,
            fontFace: theme.fonts.body,
            color: theme.colors.dk1,
            bold: item.data.bold || false,
            italic: item.data.italic || false,
            valign: "top",
            paraSpaceAfter: 8,
          });
          curY += 0.55;
          break;
        }

        case "table": {
          const rows = item.data.rows.map((row, ri) =>
            row.map((cell) => {
              const cellOpts = {
                fontSize: 14,
                fontFace: theme.fonts.body,
                color: ri === 0 ? theme.colors.lt1 : theme.colors.dk1,
                bold: ri === 0,
                fill: ri === 0 ? { color: theme.colors.accent1 } : ri % 2 === 0 ? { color: theme.colors.lt2 } : undefined,
                border: { type: "solid", pt: 0.5, color: "CCCCCC" },
                valign: "middle",
                margin: [4, 6, 4, 6],
              };
              // Detect hyperlinks in table cells (#1)
              const linkMatch = cell.match(/\[([^\]]+)\]\(([^)]+)\)/);
              if (linkMatch) {
                const slideRef = linkMatch[2].match(/^#slide-(\d+)$/);
                if (slideRef) cellOpts.hyperlink = { slide: slideRef[1] };
                else cellOpts.hyperlink = { url: linkMatch[2] };
              }
              return { text: stripMarkdownFormatting(cell), options: cellOpts };
            })
          );
          const tableH = Math.min(rows.length * 0.4, 3.5);
          slide.addTable(rows, {
            x: MARGIN_LEFT,
            y: curY,
            w: CONTENT_WIDTH,
            h: tableH,
            colW: Array(rows[0]?.length || 1).fill(CONTENT_WIDTH / (rows[0]?.length || 1)),
            autoPage: false,
          });
          curY += tableH + 0.2;
          break;
        }

        case "code": {
          const codeH = Math.min(item.data.text.split("\n").length * 0.3 + 0.4, 4.0);
          slide.addText(item.data.text, {
            x: MARGIN_LEFT,
            y: curY,
            w: CONTENT_WIDTH,
            h: codeH,
            fontSize: 14,
            fontFace: "Courier New",
            color: "333333",
            fill: { color: "F0F0F0" },
            valign: "top",
            paraSpaceAfter: 4,
            margin: [8, 12, 8, 12],
          });
          curY += codeH + 0.2;
          break;
        }

        case "image": {
          let imgPath = item.data.path;
          // Resolve relative paths from input markdown directory
          if (!imgPath.startsWith("/") && !imgPath.startsWith("http")) {
            imgPath = resolve(inputDir, imgPath);
          }
          if (imgPath.startsWith("http")) {
            // Skip remote images — PptxGenJS can handle URLs but it's unreliable in scripts
            slide.addText(`[Image: ${item.data.alt || imgPath}]`, {
              x: MARGIN_LEFT, y: curY, w: CONTENT_WIDTH, h: 0.5,
              fontSize: 14, fontFace: theme.fonts.body, color: "999999", italic: true,
            });
            curY += 0.6;
          } else if (existsSync(imgPath)) {
            const imgH = 3.5;
            slide.addImage({
              path: imgPath,
              x: MARGIN_LEFT,
              y: curY,
              w: CONTENT_WIDTH * 0.8,
              h: imgH,
              sizing: { type: "contain", w: CONTENT_WIDTH * 0.8, h: imgH },
            });
            curY += imgH + 0.2;
          }
          break;
        }

        case "callout": {
          const label = item.data.calloutType.charAt(0).toUpperCase() + item.data.calloutType.slice(1);
          slide.addText(
            [
              { text: `${label}: `, options: { bold: true, fontSize: 18, fontFace: theme.fonts.body, color: theme.colors.accent1 } },
              { text: stripMarkdownFormatting(item.data.text), options: { fontSize: 18, fontFace: theme.fonts.body, color: theme.colors.dk1 } },
            ],
            {
              x: MARGIN_LEFT + 0.2,
              y: curY,
              w: CONTENT_WIDTH - 0.4,
              h: 0.8,
              fill: { color: theme.colors.lt2 },
              valign: "middle",
              margin: [6, 12, 6, 12],
            }
          );
          curY += 0.9;
          break;
        }
      }
    }

    // Speaker notes
    if (slideData.notes) {
      slide.addNotes(slideData.notes);
    }

    // Slide number via PptxGenJS API (#3) — renders as <p:sldNum> in OOXML
    if (theme.slideNumbers && !isTitleOnly) {
      slide.slideNumber = {
        x: 12.2, y: 6.9, w: 0.8, h: 0.4,
        fontSize: 10, fontFace: theme.fonts.body, color: theme.colors.dk2,
      };
    }

    // Footer with title
    if (theme.footer === "title" && slideData.title && !isTitleOnly) {
      slide.addText(stripMarkdownFormatting(slides[0]?.title || ""), {
        x: MARGIN_LEFT, y: 6.9, w: 6, h: 0.4,
        fontSize: 10, fontFace: theme.fonts.body, color: theme.colors.dk2,
      });
    }
  }

  const outBuffer = await pptx.write({ outputType: "nodebuffer" });
  writeFileSync(outputPath, outBuffer);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { inputPath, outputPath, style, template } = parseArgs(process.argv);
  const inputDir = dirname(inputPath);

  // Read markdown
  const markdown = readFileSync(inputPath, "utf-8");

  // Parse into slide model
  const { slides, metadata } = parseMarkdown(markdown);
  if (slides.length === 0) {
    console.error("Error: No slides parsed from input. Make sure markdown has at least one # heading or content.");
    process.exit(1);
  }

  // Resolve theme
  let theme;
  if (template) {
    console.log(`Extracting theme from template: ${template}`);
    try {
      theme = await extractTheme(template);
      console.log(`Theme extracted: ${theme.fonts.heading}/${theme.fonts.body}, accent: #${theme.colors.accent1}`);
    } catch (err) {
      console.error(`Warning: Failed to extract theme from template: ${err.message}`);
      console.error("Falling back to built-in style.");
      theme = STYLES[style];
    }
  } else {
    theme = STYLES[style];
  }

  // Generate PPTX
  console.log(`Generating ${slides.length} slides with "${template ? "custom template" : style}" style...`);
  await generatePptx(slides, theme, inputDir, outputPath, metadata);
  console.log(`Presentation saved to: ${outputPath}`);
}

// Export for testing
export { parseMarkdown, parseInlineFormatting, stripMarkdownFormatting, inferLayout, STYLES };

if (__isMain) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
