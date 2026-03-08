#!/usr/bin/env node
// search.mjs — Search research files by tag, keyword, or content
// Usage: node search.mjs <query> <dir1> [dir2...] [--tag "tagname"] [--limit 20]
//
// Outputs JSON array to stdout: [{ file, title, tags, source_url, snippet, relevance, date_saved }]
// Errors go to stderr with non-zero exit code.

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, extname } from "path";

// --- Argument parsing ---

const args = process.argv.slice(2);

let query = "";
let tagFilter = null;
let limit = 50;
const dirs = [];

let i = 0;
while (i < args.length) {
  if (args[i] === "--tag") {
    tagFilter = args[i + 1] || "";
    i += 2;
  } else if (args[i] === "--limit") {
    limit = parseInt(args[i + 1], 10) || 50;
    i += 2;
  } else if (!query && dirs.length === 0) {
    // First non-flag arg is the query
    query = args[i];
    i++;
  } else {
    // Subsequent non-flag args are directories
    dirs.push(args[i]);
    i++;
  }
}

if (dirs.length === 0) {
  console.error("Usage: search.mjs <query> <dir1> [dir2...] [--tag \"tagname\"] [--limit 20]");
  process.exit(1);
}

const queryLower = query.toLowerCase();
const tagFilterLower = tagFilter ? tagFilter.toLowerCase() : null;

// --- Utility functions ---

/**
 * Recursively find all .md files in a directory.
 */
function findMarkdownFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns { frontmatter: object, body: string } or null if no frontmatter.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const yamlStr = match[1];
  const body = match[2];
  const frontmatter = {};

  for (const line of yamlStr.split("\n")) {
    const kvMatch = line.match(/^(\w[\w_-]*):\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1].trim();
    let value = kvMatch[2].trim();

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Parse YAML array: [tag1, tag2] or [tag1, "tag 2"]
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1);
      value = inner
        .split(",")
        .map(t => {
          t = t.trim();
          if ((t.startsWith('"') && t.endsWith('"')) ||
              (t.startsWith("'") && t.endsWith("'"))) {
            t = t.slice(1, -1);
          }
          return t;
        })
        .filter(Boolean);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * Generate a snippet from body content.
 * If query is provided, show context around the first match.
 * Otherwise, show the first 200 characters.
 */
function generateSnippet(body, queryStr) {
  // Strip leading headings and whitespace
  const cleaned = body.replace(/^#+\s+.*\n*/m, "").trim();

  if (!queryStr || !cleaned) {
    return cleaned.slice(0, 200).replace(/\n+/g, " ").trim();
  }

  const lowerBody = cleaned.toLowerCase();
  const idx = lowerBody.indexOf(queryStr.toLowerCase());

  if (idx === -1) {
    return cleaned.slice(0, 200).replace(/\n+/g, " ").trim();
  }

  // Show context window around the match
  const contextStart = Math.max(0, idx - 80);
  const contextEnd = Math.min(cleaned.length, idx + queryStr.length + 120);
  let snippet = cleaned.slice(contextStart, contextEnd).replace(/\n+/g, " ").trim();

  if (contextStart > 0) snippet = "..." + snippet;
  if (contextEnd < cleaned.length) snippet = snippet + "...";

  return snippet;
}

/**
 * Score a research file against the query and tag filter.
 * Returns relevance score (0 = no match, higher = better).
 */
function scoreFile(frontmatter, body, queryStr, queryLwr, tagLwr) {
  let score = 0;
  let matched = false;

  const title = (frontmatter.title || "").toLowerCase();
  const tags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.map(t => t.toLowerCase())
    : [];
  const sourceUrl = (frontmatter.url || frontmatter.source_url || "").toLowerCase();

  // Tag filter (exact match, required if specified)
  if (tagLwr !== null) {
    if (!tags.includes(tagLwr)) {
      return 0; // Tag filter doesn't match — exclude
    }
    matched = true;
    score = Math.max(score, 0.8);
  }

  // Query matching (if query is provided)
  if (queryLwr) {
    if (title.includes(queryLwr)) {
      score = Math.max(score, 1.0);
      matched = true;
    }
    if (tags.some(t => t.includes(queryLwr))) {
      score = Math.max(score, 0.8);
      matched = true;
    }
    if (sourceUrl.includes(queryLwr)) {
      score = Math.max(score, 0.6);
      matched = true;
    }
    if (body.toLowerCase().includes(queryLwr)) {
      score = Math.max(score, 0.5);
      matched = true;
    }
  }

  // If neither query nor tag filter was provided, match everything
  if (!queryLwr && tagLwr === null) {
    matched = true;
    score = 0.1;
  }

  return matched ? score : 0;
}

// --- Main search ---

const results = [];

for (const dir of dirs) {
  const files = findMarkdownFiles(dir);

  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, "utf-8");
    } catch (err) {
      console.error(`Warning: could not read ${file}: ${err.message}`);
      continue;
    }

    const parsed = parseFrontmatter(content);
    if (!parsed) continue; // Skip files without frontmatter

    const { frontmatter, body } = parsed;
    const score = scoreFile(frontmatter, body, query, queryLower, tagFilterLower);

    if (score === 0) continue;

    const tags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags
      : [];

    results.push({
      file,
      title: frontmatter.title || "",
      tags,
      source_url: frontmatter.url || frontmatter.source_url || "",
      snippet: generateSnippet(body, query),
      relevance: score,
      date_saved: frontmatter.saved || frontmatter.date_saved || "",
    });
  }
}

// Sort by relevance descending, then by date descending
results.sort((a, b) => {
  if (b.relevance !== a.relevance) return b.relevance - a.relevance;
  return (b.date_saved || "").localeCompare(a.date_saved || "");
});

// Apply limit
const limited = results.slice(0, limit);

console.log(JSON.stringify(limited, null, 2));
