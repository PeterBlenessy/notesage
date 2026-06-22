#!/usr/bin/env node
// scan.mjs — Inspect a markdown document and report which of the OKF enrichment
// fields (type / title / description) are missing, plus return the body text the
// model needs to derive them. Does NOT write anything.
//
// Usage: node scan.mjs <file_path>
//        node scan.mjs --list <dir_path>
//
// Single-file mode outputs JSON to stdout:
//   { file, missing, present, status, body }
//   status: "incomplete" (>=1 field missing) | "complete" (all three present)
//
// --list mode enumerates the .md files in a directory (non-recursive) and
// outputs JSON: { dir, files: ["/abs/path/a.md", ...] }

import { readFileSync, readdirSync, statSync } from "fs";
import { join, isAbsolute, resolve } from "path";

const ENRICH_FIELDS = ["type", "title", "description"];

const args = process.argv.slice(2);

if (args.length < 1) {
  console.error(
    "Usage: scan.mjs <file_path>   |   scan.mjs --list <dir_path>"
  );
  process.exit(1);
}

// --- --list mode: enumerate .md files in a directory ---

if (args[0] === "--list") {
  const dir = args[1];
  if (!dir) {
    console.error("Usage: scan.mjs --list <dir_path>");
    process.exit(1);
  }
  const absDir = isAbsolute(dir) ? dir : resolve(dir);
  let entries;
  try {
    entries = readdirSync(absDir);
  } catch (err) {
    console.error(`Failed to read directory ${absDir}: ${err.message}`);
    process.exit(1);
  }
  const files = entries
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .map((name) => join(absDir, name))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    })
    .sort();

  console.log(JSON.stringify({ dir: absDir, files }));
  process.exit(0);
}

// --- Single-file mode ---

const filePath = isAbsolute(args[0]) ? args[0] : resolve(args[0]);

let raw;
try {
  raw = readFileSync(filePath, "utf-8");
} catch (err) {
  console.error(`Failed to read file ${filePath}: ${err.message}`);
  process.exit(1);
}

// --- Split frontmatter from body ---

let frontmatterBlock = "";
let body = raw;

const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
if (fmMatch) {
  frontmatterBlock = fmMatch[1];
  body = fmMatch[2];
}

// --- Detect present fields via a minimal top-level YAML key scan ---
//
// We only need to know whether `type` / `title` / `description` are present and
// non-empty. A full YAML parser is unnecessary and would pull a dependency; a
// top-level `key:` scan is sufficient for frontmatter that the editor writes.

const present = {};
for (const line of frontmatterBlock.split(/\r?\n/)) {
  const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
  if (!kv) continue;
  const key = kv[1];
  if (!ENRICH_FIELDS.includes(key)) continue;
  let value = kv[2].trim().replace(/^["']|["']$/g, "");
  if (value.length > 0) {
    present[key] = value;
  }
}

const missing = ENRICH_FIELDS.filter((f) => !(f in present));
const status = missing.length === 0 ? "complete" : "incomplete";

// Cap the body sent to the model — enough to characterize the document without
// blowing the context budget on a large file.
const BODY_CAP = 4000;
const trimmedBody = body.trim().slice(0, BODY_CAP);

console.log(
  JSON.stringify({
    file: filePath,
    missing,
    present,
    status,
    body: trimmedBody,
  })
);
