#!/usr/bin/env node
/**
 * Generate a ~500 KB book-like markdown fixture for performance testing.
 *
 * Designed to mirror the profile of large real-world docs we know stress
 * the editor: heavy prose interleaved with many medium-sized tables,
 * blockquotes, multi-level headings, footnote-style references, and
 * YAML frontmatter. Produces a ~6,500-line document weighing ~500 KB.
 *
 * Output: tests/fixtures/perf/perf-book-500kb.md
 *
 * Usage:
 *   node scripts/generate-perf-book.mjs [--size 500] [--out path]
 *
 * Re-running with the same seed produces byte-identical output, so the
 * fixture stays stable across regenerations (useful for diffs).
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const sizeKB = parseInt(args[args.indexOf('--size') + 1] ?? '500', 10);
const defaultOut = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../tests/fixtures/perf/perf-book-500kb.md',
);
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : defaultOut;

// Deterministic LCG so the fixture stays stable across regenerations.
let seed = 0x53766b62;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
function int(min, max) { return min + Math.floor(rand() * (max - min + 1)); }

const WORDS = [
  'the','of','and','to','a','in','that','it','is','was','for','with','on','as','by','at','from','an','this','which',
  'capital','market','company','investor','growth','strategy','dividend','equity','ownership','stake','holding','board',
  'governance','sustainability','allocation','portfolio','quarterly','annual','report','analysis','framework','model',
  'thesis','asymmetric','compounding','margin','safety','quality','franchise','moat','runway','vertical','horizontal',
  'integration','disruption','platform','network','effect','flywheel','optionality','convexity','tail','risk','reward',
  'probability','base','rate','heuristic','first','principle','reasoning','induction','deduction','abduction','signal',
  'noise','filter','pattern','outlier','median','mean','variance','distribution','heavy','left','right','skew','kurtosis',
  'cycle','expansion','contraction','recession','recovery','cohort','vintage','generation','demographic','secular',
  'cyclical','rotation','momentum','reversion','arbitrage','liquidity','solvency','leverage','duration','convexity',
];

const COMPANIES = ['Investor AB','Industrivärden','Lundbergs','Latour','Kinnevik','EQT','Wallenberg Holdings','Lifeco','Svolder','Bure'];
const PEOPLE = ['Peter','Anna','Marcus','Sofia','Erik','Karin','Johan','Maria','Lars','Eva'];

function word() { return pick(WORDS); }
function sentence(min = 8, max = 18) {
  const n = int(min, max);
  const ws = Array.from({ length: n }, word);
  ws[0] = ws[0][0].toUpperCase() + ws[0].slice(1);
  return ws.join(' ') + pick(['.','.','.','?','.','!','.']);
}
function paragraph(sentences = 5) {
  return Array.from({ length: int(sentences - 1, sentences + 2) }, () => sentence()).join(' ');
}

function frontmatter() {
  return [
    '---',
    'title: "The Compounding Decade — Owners, Capital, and Stewardship"',
    'subtitle: "A perf-test fixture mirroring a 500 KB book-style document"',
    'author: "Perf Fixture Generator"',
    'lang: "en-GB"',
    'date: "2026"',
    'documentclass: "book"',
    'fontsize: "11pt"',
    'geometry: "margin=2.5cm"',
    'toc: "True"',
    'tags: [perf, fixture, book, large-doc]',
    '---',
    '',
  ].join('\n');
}

function table(rows = int(8, 18), cols = int(4, 7)) {
  const header = '| ' + Array.from({ length: cols }, (_, i) => `Column ${String.fromCharCode(65 + i)}`).join(' | ') + ' |';
  const sep = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
  const body = Array.from({ length: rows }, () => {
    const cells = Array.from({ length: cols }, (_, i) => {
      if (i === 0) return pick(COMPANIES);
      if (i === 1) return `${int(100, 9999)}.${int(0, 99).toString().padStart(2, '0')}`;
      if (i === 2) return `${(rand() * 30 - 5).toFixed(2)}%`;
      if (i === 3) return pick(PEOPLE);
      return `${int(1, 99)}.${int(0, 9)}`;
    });
    return '| ' + cells.join(' | ') + ' |';
  });
  return [header, sep, ...body].join('\n');
}

function blockquote(text) {
  return text.split('\n').map((l) => `> ${l}`).join('\n');
}

function callout(kind) {
  return [
    `> [!${kind}]`,
    `> ${sentence(12, 22)}`,
    `> ${sentence(8, 14)}`,
  ].join('\n');
}

function bulletList(items = int(4, 8)) {
  return Array.from({ length: items }, () => `- **${pick(COMPANIES)}**: ${sentence(10, 18)}`).join('\n');
}

function orderedList(items = int(4, 7)) {
  return Array.from({ length: items }, (_, i) => `${i + 1}. ${sentence(10, 18)}`).join('\n');
}

function codeBlock() {
  const lang = pick(['typescript','python','rust','sql','bash']);
  const lines = Array.from({ length: int(5, 12) }, () => {
    if (lang === 'sql') return `SELECT ${word()}_id, AVG(${word()}_value) FROM ${word()}_table WHERE year = ${int(2010, 2025)};`;
    if (lang === 'bash') return `${word()} --${word()}=${word()} | grep -v ${word()} > /tmp/${word()}.log`;
    return `const ${word()}_${int(1, 99)} = compute_${word()}(${int(1, 999)}, "${word()}");`;
  });
  return ['```' + lang, ...lines, '```'].join('\n');
}

/**
 * One chapter — mirrors the shape of a real prose-dominated book chapter:
 * H1 chapter title, ~4 H2 sections each with ~2-3 H3 subsections, 2-3 prose
 * paragraphs per subsection, occasional bullet list / blockquote / callout.
 *
 * Tables are intentionally rare and small — real books carry few GFM tables
 * even when content "looks tabular." A handful of 4-6 row × 3-4 col tables
 * exercise the table-render path without exploding the node count (each
 * table cell is a ProseMirror node and ~10 cells per table × 6 tables ≈ 60
 * cells per chapter feels right for prose books; the previous 160-tables
 * variant pushed hydrate from 2 s to 50 s by adding ~2,000 nested cells).
 */
function chapter(num) {
  const out = [];
  out.push(`# Chapter ${num} — ${sentence(3, 6).slice(0, -1)}`);
  out.push('');
  out.push(blockquote(`*"${sentence(15, 25)}"*\n\n— ${pick(PEOPLE)} ${pick(['Andersson','Bergman','Carlsson','Dahlberg','Eriksson'])}, ${int(1950, 2020)}`));
  out.push('');

  const sections = int(3, 5);
  for (let s = 1; s <= sections; s++) {
    out.push(`## ${num}.${s} ${sentence(3, 7).slice(0, -1)}`);
    out.push('');
    out.push(paragraph(6));
    out.push('');
    out.push(paragraph(5));
    out.push('');

    const subsections = int(2, 4);
    for (let ss = 1; ss <= subsections; ss++) {
      out.push(`### ${num}.${s}.${ss} ${sentence(3, 6).slice(0, -1)}`);
      out.push('');
      out.push(paragraph(5));
      out.push('');
      out.push(paragraph(4));
      out.push('');

      // Sparse mix-in — bullet list, blockquote, callout, or list — NOT a table.
      const r = rand();
      if (r < 0.30) {
        out.push(bulletList(int(3, 6)));
        out.push('');
      } else if (r < 0.50) {
        out.push(orderedList(int(3, 5)));
        out.push('');
      } else if (r < 0.65) {
        out.push(blockquote(paragraph(2)));
        out.push('');
      } else if (r < 0.75) {
        out.push(callout(pick(['note','tip','warning','important'])));
        out.push('');
      }
      // Otherwise: just more prose.
    }

    // Roughly one small table per H2 section — keeps the doc broadly
    // representative without dominating the node count.
    if (rand() < 0.7) {
      out.push(table(int(3, 6), int(3, 5)));
      out.push('');
    }

    // Mid-chapter scene-break HR — real books use --- as a beat marker
    // between sections, not just at chapter ends. Cheap node (atomic
    // horizontal_rule), included for shape fidelity rather than perf cost.
    if (s < sections && rand() < 0.6) {
      out.push('---');
      out.push('');
    }
  }
  out.push('---');
  out.push('');
  return out.join('\n');
}

const target = sizeKB * 1024;
let out = frontmatter();
let chapterNum = 1;
while (Buffer.byteLength(out, 'utf8') < target) {
  out += chapter(chapterNum) + '\n';
  chapterNum++;
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out, 'utf8');
const bytes = Buffer.byteLength(out, 'utf8');
console.log(`Wrote ${outPath}`);
console.log(`  size: ${(bytes / 1024).toFixed(1)} KB (${bytes} bytes), ${out.split('\n').length} lines, ${chapterNum - 1} chapters`);
const tableCount = (out.match(/^\| --- \|/gm) || []).length;
console.log(`  tables: ${tableCount}`);
