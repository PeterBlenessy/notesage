#!/usr/bin/env node
// save.mjs — Save and organize research files with metadata
// Usage: node save.mjs <content_or_path> <output_dir> [--title "..."] [--tags "tag1,tag2"] [--url "..."] [--author "..."] [--force]
//
// If content_or_path is a file path (exists on disk): reads content from that file
// If content_or_path is "-": reads from stdin
// Otherwise: treats it as inline content text
//
// Outputs JSON to stdout: { file, title, tags, status }
// status: "created", "exists", or "overwritten"

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, basename, extname } from "path";

// --- Argument parsing ---

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error("Usage: save.mjs <content_or_path> <output_dir> [--title \"...\"] [--tags \"tag1,tag2\"] [--url \"...\"] [--author \"...\"] [--force]");
  process.exit(1);
}

const contentOrPath = args[0];
const outputDir = args[1];

function getFlag(name) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

const flagTitle = getFlag("--title");
const flagTags = getFlag("--tags");
const flagUrl = getFlag("--url");
const flagAuthor = getFlag("--author");
const force = args.includes("--force");

const cliTags = flagTags
  ? flagTags.split(",").map(t => t.trim()).filter(Boolean)
  : [];

// --- Read content ---

let rawContent = "";

if (contentOrPath === "-") {
  // Read from stdin
  try {
    rawContent = readFileSync(0, "utf-8");
  } catch (err) {
    console.error(`Failed to read from stdin: ${err.message}`);
    process.exit(1);
  }
} else if (existsSync(contentOrPath)) {
  // Read from file
  try {
    rawContent = readFileSync(contentOrPath, "utf-8");
  } catch (err) {
    console.error(`Failed to read file ${contentOrPath}: ${err.message}`);
    process.exit(1);
  }
} else {
  // Treat as inline content
  rawContent = contentOrPath;
}

if (!rawContent.trim()) {
  console.error("Error: no content provided (empty input)");
  process.exit(1);
}

// --- Parse existing frontmatter ---

let existingFrontmatter = {};
let bodyContent = rawContent;

const fmMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
if (fmMatch) {
  const fmBlock = fmMatch[1];
  bodyContent = fmMatch[2];

  // Simple YAML key-value parser (handles strings, arrays, numbers)
  for (const line of fmBlock.split("\n")) {
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value = kvMatch[2].trim();

      // Array: [item1, item2]
      const arrMatch = value.match(/^\[([^\]]*)\]$/);
      if (arrMatch) {
        value = arrMatch[1]
          .split(",")
          .map(s => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else {
        // Strip surrounding quotes
        value = value.replace(/^["']|["']$/g, "");
      }

      existingFrontmatter[key] = value;
    }
  }
}

// --- Merge metadata (CLI takes precedence) ---

const title = flagTitle || existingFrontmatter.title || "";
const sourceUrl = flagUrl || existingFrontmatter.source_url || existingFrontmatter.url || "";
const author = flagAuthor || existingFrontmatter.author || "";
const datePublished = existingFrontmatter.date_published || "";

// Merge tags: CLI tags + existing tags, deduplicated
const existingTags = Array.isArray(existingFrontmatter.tags)
  ? existingFrontmatter.tags
  : typeof existingFrontmatter.tags === "string" && existingFrontmatter.tags
    ? existingFrontmatter.tags.split(",").map(t => t.trim()).filter(Boolean)
    : [];

const allTags = [...new Set([...cliTags, ...existingTags])];

// --- Generate filename ---

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled-research";
}

const slug = title ? slugify(title) : "untitled-research";
const filename = `${slug}.md`;

// --- Ensure output directory exists ---

if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

const filePath = join(outputDir, filename);

// --- Check for duplicates ---

// Strategy 1: Check by source_url in existing files' frontmatter
if (sourceUrl) {
  try {
    const existingFiles = readdirSync(outputDir).filter(f => f.endsWith(".md"));
    for (const f of existingFiles) {
      const fp = join(outputDir, f);
      try {
        const content = readFileSync(fp, "utf-8");
        const urlMatch = content.match(/^---[\s\S]*?source_url:\s*["']?([^\s"'\n]+)["']?[\s\S]*?---/);
        if (urlMatch && urlMatch[1] === sourceUrl && fp !== filePath) {
          // Duplicate found by URL — treat as existing (use the existing file's path)
          if (!force) {
            console.log(JSON.stringify({
              file: fp,
              title: title || slug,
              tags: allTags,
              status: "exists",
            }));
            process.exit(0);
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }
  } catch {
    // Output dir doesn't exist yet or can't be read — will be created below
  }
}

// Strategy 2: Check by filename
const fileExistedBefore = existsSync(filePath);
if (fileExistedBefore && !force) {
  console.log(JSON.stringify({
    file: filePath,
    title: title || slug,
    tags: allTags,
    status: "exists",
  }));
  process.exit(0);
}

// --- Build frontmatter ---

const dateSaved = new Date().toISOString().split("T")[0];
const wordCount = bodyContent.split(/\s+/).filter(Boolean).length;

const fmLines = [
  "---",
  `title: "${(title || slug).replace(/"/g, '\\"')}"`,
];

if (sourceUrl) {
  fmLines.push(`source_url: "${sourceUrl}"`);
}

if (author) {
  fmLines.push(`author: "${author.replace(/"/g, '\\"')}"`);
}

fmLines.push(`date_saved: "${dateSaved}"`);

if (datePublished) {
  fmLines.push(`date_published: "${datePublished}"`);
}

if (allTags.length > 0) {
  fmLines.push(`tags: [${allTags.map(t => `"${t}"`).join(", ")}]`);
} else {
  fmLines.push("tags: []");
}

fmLines.push(`word_count: ${wordCount}`);
fmLines.push("---");

// --- Write file ---

const finalContent = `${fmLines.join("\n")}\n\n${bodyContent.trim()}\n`;

writeFileSync(filePath, finalContent, "utf-8");

// --- Output result ---

console.log(JSON.stringify({
  file: filePath,
  title: title || slug,
  tags: allTags,
  status: force && fileExistedBefore ? "overwritten" : "created",
}));
