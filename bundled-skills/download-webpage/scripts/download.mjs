#!/usr/bin/env node
// download.mjs — Fetch a web page and save as clean markdown with images
// Usage: node download.mjs <url> <output_dir> [--force]
//
// Outputs JSON to stdout: { title, url, file, wordCount, images, status }
// status: "created", "exists", or "overwritten"
// Errors go to stderr with non-zero exit code.

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * Detect content type from response headers and map to extension.
 */
function extFromContentType(contentType) {
  if (!contentType) return null;
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
  };
  for (const [mime, ext] of Object.entries(map)) {
    if (contentType.includes(mime)) return ext;
  }
  return null;
}

/**
 * Download an image URL and save it locally.
 * Returns the local relative path, or null on failure.
 */
async function downloadImage(imgUrl, outputDir, slug, index, pageUrl) {
  try {

    const imgRes = await fetch(imgUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: pageUrl,
        Accept: "image/*,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });

    if (!imgRes.ok) {
      console.error(`Warning: HTTP ${imgRes.status} for image: ${imgUrl}`);
      return null;
    }

    const ext = extFromContentType(imgRes.headers.get("content-type")) || ".jpg";
    const imgFilename = `${slug}-${index}${ext}`;
    const localPath = `images/${imgFilename}`;

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    // Skip tiny images (tracking pixels, spacers)
    if (buffer.length < 200) return null;

    writeFileSync(join(outputDir, localPath), buffer);
    return localPath;
  } catch (err) {
    console.error(`Warning: failed to download image: ${imgUrl} — ${err.message}`);
    return null;
  }
}

const url = process.argv[2];
const outputDir = process.argv[3];
const force = process.argv.includes("--force");
const tagsIdx = process.argv.indexOf("--tags");
const tags = tagsIdx !== -1 && process.argv[tagsIdx + 1]
  ? process.argv[tagsIdx + 1].split(",").map(t => t.trim()).filter(Boolean)
  : [];

if (!url || !outputDir) {
  console.error("Usage: download.mjs <url> <output_dir> [--force]");
  process.exit(1);
}

// Validate URL
let parsedUrl;
try {
  parsedUrl = new URL(url);
} catch {
  console.error(`Invalid URL: ${url}`);
  process.exit(1);
}

// Fetch the page
let html;
try {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}: ${url}`);
    process.exit(1);
  }

  html = await res.text();
} catch (err) {
  console.error(`Failed to fetch ${url}: ${err.message}`);
  process.exit(1);
}

// Parse with Readability
const dom = new JSDOM(html, { url });

// Readability mutates the DOM, so clone it first
const docClone = dom.window.document.cloneNode(true);
const reader = new Readability(docClone);
const article = reader.parse();

if (!article || !article.content) {
  console.error(`No extractable content from ${url}`);
  process.exit(1);
}

// --- Extract metadata from original DOM ---
const doc = dom.window.document;

function extractAuthor() {
  // 1. Readability byline
  if (article.byline) return article.byline;
  // 2. <meta> tags
  const metaAuthor = doc.querySelector('meta[name="author"]')?.getAttribute("content")
    || doc.querySelector('meta[property="article:author"]')?.getAttribute("content");
  if (metaAuthor) return metaAuthor;
  // 3. JSON-LD
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item.author) {
          if (typeof item.author === "string") return item.author;
          if (item.author.name) return item.author.name;
          if (Array.isArray(item.author) && item.author[0]?.name) return item.author[0].name;
        }
      }
    } catch {}
  }
  return "";
}

function extractDatePublished() {
  // 1. <meta> tags
  const metaDate = doc.querySelector('meta[property="article:published_time"]')?.getAttribute("content")
    || doc.querySelector('meta[name="date"]')?.getAttribute("content")
    || doc.querySelector('meta[property="og:article:published_time"]')?.getAttribute("content");
  if (metaDate) {
    try { return new Date(metaDate).toISOString().split("T")[0]; } catch {}
  }
  // 2. <time> elements with datetime
  const timeEl = doc.querySelector("time[datetime]");
  if (timeEl) {
    try { return new Date(timeEl.getAttribute("datetime")).toISOString().split("T")[0]; } catch {}
  }
  // 3. JSON-LD
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item.datePublished) {
          try { return new Date(item.datePublished).toISOString().split("T")[0]; } catch {}
        }
      }
    } catch {}
  }
  return "";
}

// Build slug for filenames
const slug = (article.title || parsedUrl.hostname)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 80);

// Ensure output directory exists
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

const filename = `${slug}.md`;
const filePath = join(outputDir, filename);

// Check if file already exists
if (existsSync(filePath) && !force) {
  console.log(
    JSON.stringify({
      title: article.title || "",
      url,
      file: filePath,
      wordCount: 0,
      images: 0,
      status: "exists",
    })
  );
  process.exit(0);
}

// Convert article HTML to markdown
const articleDom = new JSDOM(article.content, { url });

// Fix lazy-loaded images: replace placeholder src with data-src or data-srcset
for (const img of articleDom.window.document.querySelectorAll("img")) {
  const src = img.getAttribute("src") || "";
  const dataSrc = img.getAttribute("data-src") || "";
  const dataSrcset = img.getAttribute("data-srcset") || "";
  // If src is a placeholder (data URI or tiny), use data-src instead
  if ((src.startsWith("data:") || !src) && dataSrc) {
    img.setAttribute("src", dataSrc);
  } else if ((src.startsWith("data:") || !src) && dataSrcset) {
    // Take the first URL from srcset
    const firstUrl = dataSrcset.split(",")[0].trim().split(/\s+/)[0];
    if (firstUrl) img.setAttribute("src", firstUrl);
  }
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});

// GFM support: tables, strikethrough, task lists
turndown.use(gfm);

// <picture> → just use the <img> fallback inside it
turndown.addRule("picture", {
  filter: "picture",
  replacement: (content, node) => {
    const img = node.querySelector("img");
    if (img) {
      const src = img.getAttribute("src") || "";
      const alt = img.getAttribute("alt") || "";
      return `![${alt}](${src})`;
    }
    return content;
  },
});

// <a> wrapping ONLY an image (no meaningful text) → just output the image
// Substack pattern: <a href="..."><div><picture><img></picture></div></a>
// Do NOT match <a> tags that have text content alongside images (e.g. regular links)
turndown.addRule("linked-image", {
  filter: (node) => {
    if (node.nodeName !== "A") return false;
    const img = node.querySelector("img");
    if (!img) return false;
    // Only match if the link has no meaningful text (just whitespace around the image)
    const text = node.textContent.replace(/\s+/g, "").trim();
    return text.length === 0;
  },
  replacement: (_content, node) => {
    const img = node.querySelector("img");
    const src = img.getAttribute("src") || "";
    const alt = img.getAttribute("alt") || "";
    return `\n\n![${alt}](${src})\n\n`;
  },
});

// Keep code blocks clean
turndown.addRule("pre-code", {
  filter: (node) =>
    node.nodeName === "PRE" && node.querySelector("code"),
  replacement: (_content, node) => {
    const code = node.querySelector("code");
    const lang = (code.className.match(/language-(\S+)/) || [])[1] || "";
    return `\n\n\`\`\`${lang}\n${code.textContent.trim()}\n\`\`\`\n\n`;
  },
});

// Handle <figure> with <figcaption>
turndown.addRule("figure", {
  filter: "figure",
  replacement: (content) => `\n\n${content.trim()}\n\n`,
});

turndown.addRule("figcaption", {
  filter: "figcaption",
  replacement: (content) => `\n*${content.trim()}*\n`,
});

// Preserve <mark> as bold
turndown.addRule("mark", {
  filter: "mark",
  replacement: (content) => `**${content}**`,
});

// Handle <aside>
turndown.addRule("aside", {
  filter: "aside",
  replacement: (content) => {
    const lines = content.trim().split("\n").map((l) => `> ${l}`);
    return `\n\n${lines.join("\n")}\n\n`;
  },
});

// Handle <details>/<summary>
turndown.addRule("details", {
  filter: "details",
  replacement: (content, node) => {
    const summary = node.querySelector("summary");
    const title = summary ? summary.textContent.trim() : "Details";
    const body = content.replace(title, "").trim();
    return `\n\n**${title}**\n\n${body}\n\n`;
  },
});

// Remove empty links that produce no content
turndown.addRule("empty-links", {
  filter: (node) =>
    node.nodeName === "A" && !node.textContent.trim() && !node.querySelector("img"),
  replacement: () => "",
});

let converted = turndown.turndown(articleDom.window.document.body.innerHTML).trim();

// Post-process: clean up any remaining broken linked-image patterns
// Pattern: \[\n![alt](url)\n\]\n(url) → ![alt](url)
converted = converted.replace(
  /\\\[\s*!\[([^\]]*)\]\(([^)]+)\)\s*\\?\]\s*\([^)]*\)/g,
  "![$1]($2)"
);

// Add article title as h1 (Readability extracts it separately from the content)
const titleLine = article.title ? `# ${article.title}\n\n` : "";
let markdown = `${titleLine}${converted}`;

// --- Download images found in the markdown ---
// Scan for remote image URLs in markdown: ![alt](url) and bare URLs from broken syntax
const imgRegex = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g;
let imageCount = 0;
const seen = new Set();
const imagePromises = [];

// Create images directory once before parallel downloads
mkdirSync(join(outputDir, "images"), { recursive: true });

let match;
while ((match = imgRegex.exec(markdown)) !== null) {
  const imgUrl = match[1];
  if (seen.has(imgUrl) || imgUrl.startsWith("data:")) continue;
  seen.add(imgUrl);

  imageCount++;
  const index = imageCount;
  imagePromises.push(
    downloadImage(imgUrl, outputDir, slug, index, url)
      .then(localPath => localPath ? [imgUrl, localPath] : null)
  );
}

const results = await Promise.all(imagePromises);
const replacements = results.filter(Boolean);

// Apply all replacements in a single pass
const replacementMap = new Map(replacements);
markdown = markdown.replace(imgRegex, (full, imgUrl) => {
  const local = replacementMap.get(imgUrl);
  return local ? full.replace(imgUrl, local) : full;
});

// Update image count to reflect successful downloads only
const downloadedImages = replacements.length;

// Build frontmatter
const wordCount = markdown.split(/\s+/).length;
const author = extractAuthor();
const datePublished = extractDatePublished();
const dateSaved = new Date().toISOString().split("T")[0];

const frontmatter = [
  "---",
  `title: "${article.title?.replace(/"/g, '\\"') || ""}"`,
  `url: "${url}"`,
  `source_url: "${url}"`,
  `saved: "${dateSaved}"`,
  `date_saved: "${dateSaved}"`,
  `date_published: "${datePublished}"`,
  article.siteName ? `source: "${article.siteName}"` : null,
  `author: "${author.replace(/"/g, '\\"')}"`,
  `tags: [${tags.map(t => `"${t}"`).join(", ")}]`,
  `word_count: ${wordCount}`,
  "---",
]
  .filter(Boolean)
  .join("\n");

const content = `${frontmatter}\n\n${markdown}\n`;

writeFileSync(filePath, content, "utf-8");

// Output result as JSON
console.log(
  JSON.stringify({
    title: article.title || "",
    url,
    file: filePath,
    wordCount,
    images: downloadedImages,
    status: force ? "overwritten" : "created",
  })
);
