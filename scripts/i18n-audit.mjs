#!/usr/bin/env node
/**
 * Find user-visible English strings that never reach the translation table.
 *
 * Deliberately conservative: it flags only things a user can read — JSX text
 * nodes and the props that render as text — and it ignores anything already
 * wrapped in t(). False negatives are fine; the point is a floor, not a census.
 *
 * Two consumers:
 *   - CLI:  `node scripts/i18n-audit.mjs src/components/settings --detail`
 *   - test: `src/lib/__tests__/i18n-coverage.test.ts` imports `scan()` and
 *           ratchets the count down. See that file for why a ceiling rather
 *           than a hard zero.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const TEXT_PROPS = [
  "label",
  "title",
  "placeholder",
  "aria-label",
  "description",
  "tooltip",
  "alt",
  "heading",
  "emptyText",
  "confirmLabel",
];

function walk(dir, out = []) {
  // Accept a single file as well as a directory — auditing one file while
  // translating it is the common case, and ENOTDIR is a useless error there.
  if (statSync(dir).isFile()) return [dir];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (/(__tests__|node_modules|\.git)/.test(entry)) continue;
      walk(full, out);
    } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Two or more words of prose, or one capitalised word of 4+ chars.
const PROSE =
  /^[A-Z][A-Za-z]{2,}(?:[ ,'’\-—:.!?][A-Za-z0-9][A-Za-z0-9 ,'’\-—:.!?%()]*)?$/;
const SKIP = /^(true|false|null|undefined|px|rem|auto|none|div|span|button)$/i;

function looksTranslatable(s) {
  const t = s.trim();
  if (t.length < 4 || t.length > 120) return false;
  if (SKIP.test(t)) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  if (/^[a-z-]+$/.test(t)) return false; // css class / kebab id
  if (/^\w+\.\w+/.test(t)) return false; // file.ext, obj.prop
  if (/^(https?:|\/|#|@)/.test(t)) return false; // urls, paths, selectors
  if (!/\s/.test(t) && !/^[A-Z][a-z]{3,}$/.test(t)) return false;
  return PROSE.test(t) || /\s[a-z]/.test(t);
}

/** @returns {{file: string, line: number, kind: string, text: string}[]} */
export function scan(root = "src") {
  const findings = [];

  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");

    src.split("\n").forEach((line, i) => {
      // Skip lines that already translate, plus imports and pure code.
      if (/\bt\(/.test(line)) return;
      if (/^\s*(import|export type|\/\/|\*)/.test(line)) return;

      // 1. JSX text nodes: >Some words<
      // The `(?<![=-])` rejects the arrow in `() => Promise<void>`, which
      // otherwise reads as a JSX text node containing "Promise".
      for (const m of line.matchAll(/(?<![=-])>\s*([A-Z][^<>{}\n]{3,100}?)\s*</g)) {
        if (looksTranslatable(m[1])) {
          findings.push({ file, line: i + 1, kind: "jsx-text", text: m[1].trim() });
        }
      }

      // 2. Text-bearing props with a literal string
      for (const prop of TEXT_PROPS) {
        const re = new RegExp(`\\b${prop}=["']([^"']{4,100})["']`, "g");
        for (const m of line.matchAll(re)) {
          if (looksTranslatable(m[1])) {
            findings.push({ file, line: i + 1, kind: prop, text: m[1].trim() });
          }
        }
      }

      // 3. toasts — user-facing by definition
      for (const m of line.matchAll(/toast\.\w+\(\s*["']([^"']{4,120})["']/g)) {
        findings.push({ file, line: i + 1, kind: "toast", text: m[1].trim() });
      }
    });
  }

  return findings;
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "src";
  const findings = scan(root);

  const byFile = new Map();
  for (const f of findings) {
    const key = relative(process.cwd(), f.file);
    byFile.set(key, (byFile.get(key) || []).concat(f));
  }

  const ranked = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(
    `${findings.length} untranslated user-visible strings across ${byFile.size} files\n`,
  );

  const detail = process.argv.includes("--detail");
  for (const [file, items] of ranked) {
    console.log(`${String(items.length).padStart(4)}  ${file}`);
    if (detail) {
      for (const it of items.slice(0, 40)) {
        console.log(`        ${String(it.line).padStart(4)} [${it.kind}] ${it.text}`);
      }
      if (items.length > 40) console.log(`        … ${items.length - 40} more`);
    }
  }
}
