#!/usr/bin/env node
// apply.mjs — Merge model-generated OKF fields (type / title / description) into
// a document's YAML frontmatter and print the full merged content to stdout.
//
// IMPORTANT: this script does NOT write to disk. It computes the merged document
// and returns it; the caller writes it via the approval-gated `write_file` tool.
//
// Usage: node apply.mjs <file_path> <fields_json>
//   <fields_json> is the model's structured-output object as a JSON string, e.g.
//   '{"type":"note","title":"Q3 Planning","description":"Notes from Q3 planning."}'
//
// Merge policy: ADDITIVE ONLY. A field is written only if it is absent (or empty)
// in the existing frontmatter. Existing values are never overwritten.
//
// Outputs JSON to stdout: { file, applied, skipped, content }
//   applied  — fields that were missing and got filled
//   skipped  — fields the model returned that were already present (untouched)
//   content  — the complete merged document to hand to write_file

import { readFileSync, existsSync } from "fs";
import { isAbsolute, resolve } from "path";

const ENRICH_FIELDS = ["type", "title", "description"];

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: apply.mjs <file_path> <fields_json>');
  process.exit(1);
}

const filePath = isAbsolute(args[0]) ? args[0] : resolve(args[0]);
const fieldsJson = args[1];

if (!existsSync(filePath)) {
  console.error(`File does not exist: ${filePath}`);
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(filePath, "utf-8");
} catch (err) {
  console.error(`Failed to read file ${filePath}: ${err.message}`);
  process.exit(1);
}

let fields;
try {
  fields = JSON.parse(fieldsJson);
} catch (err) {
  console.error(`Invalid fields_json (not valid JSON): ${err.message}`);
  process.exit(1);
}
if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
  console.error("fields_json must be a JSON object");
  process.exit(1);
}

// --- Split frontmatter from body ---

let frontmatterBlock = null;
let body = raw;

const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
if (fmMatch) {
  frontmatterBlock = fmMatch[1];
  body = fmMatch[2];
}

// --- Determine which enrichment fields are already present (non-empty) ---

const presentKeys = new Set();
if (frontmatterBlock !== null) {
  for (const line of frontmatterBlock.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const value = kv[2].trim().replace(/^["']|["']$/g, "");
    if (value.length > 0) presentKeys.add(kv[1]);
  }
}

// --- Compute additions (additive only, valid enrichment fields only) ---

const applied = [];
const skipped = [];
const additions = [];

for (const field of ENRICH_FIELDS) {
  if (!(field in fields)) continue;
  const value = fields[field];
  if (typeof value !== "string" || value.trim().length === 0) continue;

  if (presentKeys.has(field)) {
    skipped.push(field);
    continue;
  }
  applied.push(field);
  additions.push([field, value.trim()]);
}

// --- Build merged content ---

function yamlScalar(value) {
  // Quote the value and escape embedded double quotes / backslashes so the
  // result is always a valid double-quoted YAML scalar (handles colons,
  // leading symbols, and multi-word values uniformly).
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

const additionLines = additions.map(
  ([key, value]) => `${key}: ${yamlScalar(value)}`
);

let content;
if (frontmatterBlock !== null) {
  // Append new keys to the existing frontmatter block (preserving everything).
  const existing = frontmatterBlock.replace(/\r?\n$/, "");
  const mergedBlock =
    additionLines.length > 0
      ? `${existing}\n${additionLines.join("\n")}`
      : existing;
  content = `---\n${mergedBlock}\n---\n\n${body.replace(/^\r?\n+/, "").trimEnd()}\n`;
} else {
  // No frontmatter yet — create a block from the additions.
  const block =
    additionLines.length > 0 ? `${additionLines.join("\n")}\n` : "";
  content = `---\n${block}---\n\n${body.replace(/^\r?\n+/, "").trimEnd()}\n`;
}

console.log(
  JSON.stringify({
    file: filePath,
    applied,
    skipped,
    content,
  })
);
