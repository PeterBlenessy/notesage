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
// Simple YAML parser (for chart blocks — no external dependency)
// ---------------------------------------------------------------------------

function parseYamlValue(str) {
  str = str.trim();
  if (str.startsWith("[") && str.endsWith("]")) {
    return str.slice(1, -1).split(",").map((s) => {
      s = s.trim();
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
      const num = Number(s);
      return isNaN(num) ? s : num;
    });
  }
  if (str === "true") return true;
  if (str === "false") return false;
  const num = Number(str);
  if (!isNaN(num) && str !== "") return num;
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) return str.slice(1, -1);
  return str;
}

function parseSimpleYaml(text) {
  const result = {};
  const lines = text.split("\n");
  let currentKey = null;
  let currentArray = null;
  let currentObj = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // Array item start: "  - key: value"
    if (/^\s+-\s/.test(line) && currentKey) {
      if (!currentArray) {
        currentArray = [];
        result[currentKey] = currentArray;
      }
      currentObj = {};
      currentArray.push(currentObj);
      const kvMatch = line.match(/^\s+-\s+(\w+):\s*(.+)/);
      if (kvMatch) currentObj[kvMatch[1]] = parseYamlValue(kvMatch[2]);
      continue;
    }

    // Indented key: value (continuation of array item or nested object)
    if (/^\s+\w/.test(line) && !/^\s+-/.test(line)) {
      const kvMatch = line.match(/^\s+(\w+):\s*(.+)/);
      if (kvMatch) {
        if (currentObj) {
          currentObj[kvMatch[1]] = parseYamlValue(kvMatch[2]);
        } else if (currentKey) {
          if (typeof result[currentKey] !== "object" || Array.isArray(result[currentKey])) result[currentKey] = {};
          result[currentKey][kvMatch[1]] = parseYamlValue(kvMatch[2]);
        }
      }
      continue;
    }

    // Top-level key: value
    const topMatch = line.match(/^(\w+):\s*(.*)/);
    if (topMatch) {
      const key = topMatch[1];
      const value = topMatch[2].trim();
      currentArray = null;
      currentObj = null;
      if (value) {
        result[key] = parseYamlValue(value);
        currentKey = null;
      } else {
        currentKey = key;
      }
    }
  }
  return result;
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

    // HTML comment directives: <!-- background: path --> or <!-- youtube: url -->
    const bgMatch = trimmed.match(/^<!--\s*background:\s*(.+?)(?:\s+overlay=([\d.]+))?\s*-->$/);
    if (bgMatch) {
      const bgPath = bgMatch[1].trim();
      const overlay = bgMatch[2] ? parseFloat(bgMatch[2]) : null;
      ensureSlide()._background = { path: bgPath, overlay };
      i++;
      continue;
    }

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

    // Fenced div blocks (:::type ... :::) — columns, callout, highlight
    const fencedMatch = trimmed.match(/^:::(\w+)/);
    if (fencedMatch) {
      const blockType = fencedMatch[1].toLowerCase();
      const blockLines = [];
      i++;
      while (i < lines.length && lines[i].trimEnd() !== ":::") {
        blockLines.push(lines[i]);
        i++;
      }
      i++; // skip closing :::
      if (blockType === "columns") {
        const parts = blockLines.join("\n").split(/^---column---$/m);
        ensureSlide().content.push({
          type: "columns",
          data: { left: parts[0]?.trim() || "", right: parts[1]?.trim() || "" },
        });
      } else if (blockType === "callout") {
        ensureSlide().content.push({
          type: "accentCallout",
          data: { text: blockLines.join("\n").trim() },
        });
      } else if (blockType === "highlight") {
        ensureSlide().content.push({
          type: "highlight",
          data: { text: blockLines.join("\n").trim() },
        });
      }
      continue;
    }

    // Code block (including ```chart for chart YAML)
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
      if (lang === "chart") {
        const chartData = parseSimpleYaml(codeLines.join("\n"));
        if (chartData.type && chartData.series) {
          ensureSlide().content.push({ type: "chart", data: chartData });
        } else {
          ensureSlide().content.push({ type: "code", data: { lang, text: codeLines.join("\n") } });
        }
      } else {
        ensureSlide().content.push({ type: "code", data: { lang, text: codeLines.join("\n") } });
      }
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

    // Image — ![alt](path) or ![alt](path "keyword")
    const imgMatch = trimmed.match(/^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)/);
    if (imgMatch) {
      ensureSlide().content.push({
        type: "image",
        data: { alt: imgMatch[1], path: imgMatch[2], sizing: imgMatch[3] || null },
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
  const hasColumns = slide.content.some((c) => c.type === "columns");

  if (hasColumns) return "columns";
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
    chartColors: ["666666", "999999", "BBBBBB", "DDDDDD", "444444", "777777"],
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
    chartColors: ["2D2D2D", "555555", "888888", "AAAAAA", "333333", "666666"],
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
    chartColors: ["404040", "666666", "888888", "AAAAAA", "333333", "555555"],
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

// ---------------------------------------------------------------------------
// Slide master definitions (#6)
// ---------------------------------------------------------------------------

function defineSlideMasters(pptx, theme) {
  const MARGIN_LEFT = 0.8;
  const CONTENT_WIDTH = 13.33 - MARGIN_LEFT - 0.8;
  const slideNumberDef = theme.slideNumbers
    ? { x: 12.2, y: 6.9, w: 0.8, h: 0.4, fontSize: 10, fontFace: theme.fonts.body, color: theme.colors.dk2 }
    : undefined;

  // Content slide objects (accent bar for business style)
  const contentObjects = [];
  if (theme.accentBar) {
    contentObjects.push({
      rect: { x: MARGIN_LEFT, y: 1.3, w: CONTENT_WIDTH, h: theme.accentBar.height, fill: { color: theme.accentBar.color } },
    });
  }

  pptx.defineSlideMaster({ title: "TITLE_SLIDE", background: { color: theme.titleSlide.bgColor } });
  pptx.defineSlideMaster({ title: "SECTION_HEADER", background: { color: theme.titleSlide.bgColor } });
  pptx.defineSlideMaster({ title: "CONTENT", background: { color: theme.background.color }, objects: contentObjects, slideNumber: slideNumberDef });
  pptx.defineSlideMaster({ title: "TWO_CONTENT", background: { color: theme.background.color }, objects: [...contentObjects], slideNumber: slideNumberDef });
  pptx.defineSlideMaster({ title: "PICTURE", background: { color: theme.background.color }, objects: [...contentObjects], slideNumber: slideNumberDef });
  pptx.defineSlideMaster({ title: "BLANK", background: { color: theme.background.color } });
}

const MASTER_MAP = { title: "TITLE_SLIDE", content: "CONTENT", picture: "PICTURE", blank: "BLANK", columns: "TWO_CONTENT" };

// ---------------------------------------------------------------------------
// Content height estimation (#12)
// ---------------------------------------------------------------------------

function estimateContentHeight(item) {
  switch (item.type) {
    case "bullets":
    case "numbered":
      return item.data.items.length * 0.4;
    case "text":
      return 0.55;
    case "table":
      return item.data.rows.length * 0.4;
    case "code":
      return Math.min(item.data.text.split("\n").length * 0.3 + 0.4, 4.0);
    case "image":
      return 3.7;
    case "chart":
      return 4.7;
    case "callout":
      return 0.9;
    case "accentCallout":
      return 1.2;
    case "highlight":
      return 1.6;
    case "columns":
      return 3.0;
    default:
      return 0.5;
  }
}

// ---------------------------------------------------------------------------
// Chart rendering (#8)
// ---------------------------------------------------------------------------

function renderChart(slide, chartItem, theme, pptx, x, y, w, h) {
  const chartType = chartItem.type?.toLowerCase();
  const chartColors = theme.chartColors || ["666666", "999999", "BBBBBB", "DDDDDD", "444444", "777777"];

  const chartTypeMap = {
    bar: pptx.charts.BAR,
    line: pptx.charts.LINE,
    pie: pptx.charts.PIE,
    doughnut: pptx.charts.DOUGHNUT,
    area: pptx.charts.AREA,
    scatter: pptx.charts.SCATTER,
    radar: pptx.charts.RADAR,
    bubble: pptx.charts.BUBBLE,
  };

  const pptxChartType = chartTypeMap[chartType];
  if (!pptxChartType) return false;

  // Scatter/bubble use { x, y [, size] } value format
  const isXY = chartType === "scatter" || chartType === "bubble";
  const chartData = (chartItem.series || []).map((s) => {
    if (isXY && Array.isArray(s.values) && typeof s.values[0] === "object") {
      return {
        name: s.name || "",
        values: s.values.map((v) => (typeof v === "object" ? [v.x, v.y] : v)),
        sizes: chartType === "bubble" ? s.values.map((v) => (typeof v === "object" ? v.size || 1 : 1)) : undefined,
      };
    }
    return {
      name: s.name || "",
      labels: chartItem.labels || s.labels || [],
      values: s.values || [],
    };
  });

  const chartOpts = {
    x, y, w, h,
    showTitle: !!chartItem.title,
    title: chartItem.title || "",
    titleFontSize: 14,
    titleColor: theme.colors.dk1,
    chartColors,
    showLegend: chartData.length > 1,
    legendPos: "b",
    legendFontSize: 10,
  };

  const opts = chartItem.options || {};
  if (chartType === "bar") {
    chartOpts.barDir = opts.barDir || "col";
    chartOpts.barGrouping = opts.barGrouping || "clustered";
  }
  if (chartType === "line") {
    chartOpts.lineSmooth = opts.lineSmooth !== undefined ? opts.lineSmooth : false;
    chartOpts.lineDataSymbol = opts.lineDataSymbol || "circle";
  }
  if (chartType === "pie" || chartType === "doughnut") {
    chartOpts.showPercent = true;
    chartOpts.showLegend = true;
  }
  if (chartType === "doughnut") {
    chartOpts.holeSize = opts.holeSize || 50;
  }
  if (chartType === "radar") {
    chartOpts.radarStyle = opts.radarStyle || "standard";
  }
  if (chartType === "scatter") {
    chartOpts.lineDataSymbol = opts.lineDataSymbol || "circle";
    chartOpts.lineSize = 0; // no connecting lines by default
  }

  slide.addChart(pptxChartType, chartData, chartOpts);
  return true;
}

// ---------------------------------------------------------------------------
// Slide generation — PptxGenJS
// ---------------------------------------------------------------------------

async function generatePptx(slides, theme, inputDir, outputPath, metadata = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inches

  // Apply presentation metadata (#2)
  pptx.title = metadata.title || stripMarkdownFormatting(slides[0]?.title || "");
  if (metadata.author) pptx.author = metadata.author;
  if (metadata.company) pptx.company = metadata.company;
  if (metadata.subject) pptx.subject = metadata.subject;

  // Define slide masters (#6)
  defineSlideMasters(pptx, theme);

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
    const isFirstSlide = si === 0;
    const isTitleOnly = slideData.layout === "title" || (isFirstSlide && slideData.content.length === 0);
    const masterName = MASTER_MAP[slideData.layout] || "CONTENT";
    const slide = pptx.addSlide({ masterName: isTitleOnly ? "TITLE_SLIDE" : masterName });

    // Background image (#13)
    if (slideData._background) {
      let bgPath = slideData._background.path;
      if (!bgPath.startsWith("/") && !bgPath.startsWith("http")) bgPath = resolve(inputDir, bgPath);
      if (existsSync(bgPath)) {
        slide.background = { path: bgPath };
        if (slideData._background.overlay) {
          slide.addShape(pptx.ShapeType.rect, {
            x: 0, y: 0, w: SLIDE_W, h: 7.5,
            fill: { color: "000000", transparency: (1 - slideData._background.overlay) * 100 },
          });
        }
      } else {
        console.warn(`Warning: Background image not found: ${bgPath}`);
      }
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

    // Content with overflow detection (#12)
    let curY = slideData.subtitle ? CONTENT_Y_WITH_SUB : CONTENT_Y_BASE;
    let curSlide = slide;

    function createContinuationSlide() {
      const contSlide = pptx.addSlide({ masterName: MASTER_MAP[slideData.layout] || "CONTENT" });
      if (slideData.title) {
        const contTitleOpts = {
          x: MARGIN_LEFT, y: TITLE_Y, w: CONTENT_WIDTH, h: TITLE_H,
          fontSize: 36, fontFace: theme.fonts.heading, color: theme.colors.dk1,
          bold: true, align: "left", valign: "bottom",
        };
        if (theme.titleShadow) contTitleOpts.shadow = theme.titleShadow;
        contSlide.addText(stripMarkdownFormatting(slideData.title) + " (cont.)", contTitleOpts);
      }
      curY = CONTENT_Y_BASE;
      curSlide = contSlide;
      return contSlide;
    }

    for (const item of slideData.content) {
      // Overflow check: create continuation slide if content won't fit (#12)
      const estH = estimateContentHeight(item);
      if (curY + estH > MAX_CONTENT_BOTTOM && curY > CONTENT_Y_BASE + 0.5) {
        createContinuationSlide();
      }

      switch (item.type) {
        case "bullets":
        case "numbered": {
          const allItems = item.data.items;
          let startIdx = 0;
          while (startIdx < allItems.length) {
            const remaining = MAX_CONTENT_BOTTOM - curY;
            const maxItems = Math.max(1, Math.floor(remaining / 0.4));
            const batch = allItems.slice(startIdx, startIdx + maxItems);
            const textRows = batch.map((it) => ({
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
            curSlide.addText(textRows, {
              x: MARGIN_LEFT, y: curY, w: CONTENT_WIDTH, h: listH, valign: "top",
            });
            curY += listH + 0.1;
            startIdx += batch.length;
            if (startIdx < allItems.length) createContinuationSlide();
          }
          break;
        }

        case "text": {
          curSlide.addText(stripMarkdownFormatting(item.data.text), {
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
          const numCols = item.data.rows[0]?.length || 1;
          const rows = item.data.rows.map((row, ri) => {
            const isHeader = ri === 0;
            const cells = [];
            for (let ci = 0; ci < row.length; ci++) {
              const cell = row[ci];
              // Colspan: empty cells after || merge with previous (#15)
              if (cell === "" && ci > 0 && cells.length > 0) {
                const prev = cells[cells.length - 1];
                prev.options.colspan = (prev.options.colspan || 1) + 1;
                continue;
              }
              // Per-side borders (#15)
              const border = isHeader
                ? [
                    { type: "solid", pt: 0, color: "FFFFFF" },         // top
                    { type: "solid", pt: 0.25, color: "CCCCCC" },      // right
                    { type: "solid", pt: 1.5, color: theme.colors.accent1 }, // bottom (heavy)
                    { type: "solid", pt: 0.25, color: "CCCCCC" },      // left
                  ]
                : [
                    { type: "solid", pt: 0.25, color: "DDDDDD" },      // top (light)
                    { type: "solid", pt: 0.25, color: "DDDDDD" },      // right (light)
                    { type: "solid", pt: 0.25, color: "DDDDDD" },      // bottom (light)
                    { type: "solid", pt: 0.25, color: "DDDDDD" },      // left (light)
                  ];
              // Alternating rows using theme colors with transparency (#15)
              let fill;
              if (isHeader) fill = { color: theme.colors.accent1 };
              else if (ri % 2 === 0) fill = { color: theme.colors.lt2 };
              const cellOpts = {
                fontSize: 14,
                fontFace: theme.fonts.body,
                color: isHeader ? theme.colors.lt1 : theme.colors.dk1,
                bold: isHeader,
                fill,
                border,
                valign: "middle",
                margin: [4, 6, 4, 6],
              };
              const linkMatch = cell.match(/\[([^\]]+)\]\(([^)]+)\)/);
              if (linkMatch) {
                const slideRef = linkMatch[2].match(/^#slide-(\d+)$/);
                if (slideRef) cellOpts.hyperlink = { slide: slideRef[1] };
                else cellOpts.hyperlink = { url: linkMatch[2] };
              }
              cells.push({ text: stripMarkdownFormatting(cell), options: cellOpts });
            }
            return cells;
          });
          const tableH = rows.length * 0.4;
          curSlide.addTable(rows, {
            x: MARGIN_LEFT,
            y: curY,
            w: CONTENT_WIDTH,
            colW: Array(numCols).fill(CONTENT_WIDTH / numCols),
            autoPage: true,
            autoPageRepeatHeader: true,
            autoPageHeaderRows: 1,
          });
          curY += Math.min(tableH, MAX_CONTENT_BOTTOM - curY) + 0.2;
          break;
        }

        case "code": {
          const codeH = Math.min(item.data.text.split("\n").length * 0.3 + 0.4, 4.0);
          curSlide.addText(item.data.text, {
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
          if (!imgPath.startsWith("/") && !imgPath.startsWith("http")) {
            imgPath = resolve(inputDir, imgPath);
          }
          if (imgPath.startsWith("http")) {
            curSlide.addText(`[Image: ${item.data.alt || imgPath}]`, {
              x: MARGIN_LEFT, y: curY, w: CONTENT_WIDTH, h: 0.5,
              fontSize: 14, fontFace: theme.fonts.body, color: "999999", italic: true,
            });
            curY += 0.6;
          } else if (existsSync(imgPath)) {
            const imgH = 3.5;
            const imgW = CONTENT_WIDTH * 0.8;
            const keyword = item.data.sizing;
            const imgOpts = {
              path: imgPath,
              x: MARGIN_LEFT,
              y: curY,
              w: imgW,
              h: imgH,
            };
            // Alt text for accessibility (#14)
            if (item.data.alt) imgOpts.altText = item.data.alt;
            // Sizing keywords (#14)
            if (keyword === "cover") {
              imgOpts.sizing = { type: "cover", w: imgW, h: imgH };
            } else if (keyword === "round") {
              imgOpts.sizing = { type: "cover", w: imgH, h: imgH };
              imgOpts.w = imgH; // square for circular crop
              imgOpts.x = MARGIN_LEFT + (imgW - imgH) / 2; // center
              imgOpts.rounding = true;
            } else {
              imgOpts.sizing = { type: "contain", w: imgW, h: imgH };
            }
            // Subtle shadow for business/report styles (#14)
            if (theme.titleShadow) {
              imgOpts.shadow = { type: "outer", blur: 3, offset: 1, opacity: 0.2, angle: 45, color: "000000" };
            }
            curSlide.addImage(imgOpts);
            curY += imgH + 0.2;
          }
          break;
        }

        case "callout": {
          const label = item.data.calloutType.charAt(0).toUpperCase() + item.data.calloutType.slice(1);
          curSlide.addText(
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

        case "chart": {
          const chartH = 4.5;
          renderChart(curSlide, item.data, theme, pptx, MARGIN_LEFT, curY, CONTENT_WIDTH, chartH);
          curY += chartH + 0.2;
          break;
        }

        case "accentCallout": {
          const calloutH = 1.0;
          curSlide.addShape(pptx.ShapeType.roundRect, {
            x: MARGIN_LEFT + 0.2,
            y: curY,
            w: CONTENT_WIDTH - 0.4,
            h: calloutH,
            fill: { color: theme.colors.lt2 },
            line: { color: theme.colors.accent1, width: 1.5 },
            rectRadius: 0.1,
            shadow: { type: "outer", blur: 2, offset: 1, opacity: 0.15, angle: 45, color: "000000" },
          });
          curSlide.addText(parseInlineFormatting(item.data.text), {
            x: MARGIN_LEFT + 0.5,
            y: curY + 0.1,
            w: CONTENT_WIDTH - 1.0,
            h: calloutH - 0.2,
            fontSize: 18,
            fontFace: theme.fonts.body,
            color: theme.colors.dk1,
            valign: "middle",
          });
          curY += calloutH + 0.2;
          break;
        }

        case "highlight": {
          const highlightH = 1.4;
          curSlide.addShape(pptx.ShapeType.roundRect, {
            x: MARGIN_LEFT + 1.0,
            y: curY,
            w: CONTENT_WIDTH - 2.0,
            h: highlightH,
            fill: { color: theme.colors.accent1 },
            rectRadius: 0.1,
            shadow: { type: "outer", blur: 3, offset: 1, opacity: 0.2, angle: 45, color: "000000" },
          });
          curSlide.addText(stripMarkdownFormatting(item.data.text), {
            x: MARGIN_LEFT + 1.3,
            y: curY + 0.1,
            w: CONTENT_WIDTH - 2.6,
            h: highlightH - 0.2,
            fontSize: 28,
            fontFace: theme.fonts.heading,
            color: theme.colors.lt1,
            bold: true,
            align: "center",
            valign: "middle",
          });
          curY += highlightH + 0.2;
          break;
        }

        case "columns": {
          const colW = 5.5;
          const leftX = MARGIN_LEFT;
          const rightX = 7.0;

          function parseColumnLines(text) {
            return text.split("\n").filter((l) => l.trim()).map((l) => {
              const bm = l.match(/^(\s*)[*-]\s+(.+)/);
              if (bm) {
                return {
                  text: stripMarkdownFormatting(bm[2].trim()),
                  options: { fontSize: 18, fontFace: theme.fonts.body, color: theme.colors.dk1, bullet: { code: "2022" }, indentLevel: Math.floor(bm[1].length / 2), paraSpaceAfter: 4 },
                };
              }
              const nm = l.match(/^(\s*)\d+\.\s+(.+)/);
              if (nm) {
                return {
                  text: stripMarkdownFormatting(nm[2].trim()),
                  options: { fontSize: 18, fontFace: theme.fonts.body, color: theme.colors.dk1, bullet: { type: "number" }, indentLevel: Math.floor(nm[1].length / 3), paraSpaceAfter: 4 },
                };
              }
              return { text: stripMarkdownFormatting(l.trim()), options: { fontSize: 18, fontFace: theme.fonts.body, color: theme.colors.dk1, paraSpaceAfter: 6 } };
            });
          }

          const leftRows = parseColumnLines(item.data.left);
          const rightRows = parseColumnLines(item.data.right);
          const colH = Math.min(Math.max(leftRows.length, rightRows.length) * 0.4 + 0.2, MAX_CONTENT_BOTTOM - curY);

          if (leftRows.length > 0) {
            curSlide.addText(leftRows, { x: leftX, y: curY, w: colW, h: colH, valign: "top" });
          }
          if (rightRows.length > 0) {
            curSlide.addText(rightRows, { x: rightX, y: curY, w: colW, h: colH, valign: "top" });
          }
          curY += colH + 0.2;
          break;
        }
      }
    }

    // Speaker notes
    if (slideData.notes) {
      slide.addNotes(slideData.notes);
    }

    // Footer with title (slide numbers now handled by master definitions)
    if (theme.footer === "title" && slideData.title && !isTitleOnly) {
      curSlide.addText(stripMarkdownFormatting(slides[0]?.title || ""), {
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

  // Warn about escaped callout brackets (they still work, but signal source markdown issues)
  const escapedCallouts = markdown.match(/^>\s*\\\[!(\w+)\\\]/gm);
  if (escapedCallouts) {
    console.warn(`Warning: Found ${escapedCallouts.length} escaped callout tag(s) (e.g., \\[!notes\\]) — treating as callouts. Consider removing backslashes for cleaner markdown.`);
  }

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
export { parseMarkdown, parseInlineFormatting, stripMarkdownFormatting, inferLayout, parseSimpleYaml, parseYamlValue, estimateContentHeight, STYLES, MASTER_MAP };

if (__isMain) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
