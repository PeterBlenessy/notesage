import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

interface ReleaseEntry {
  version: string;
  date: string;
  previousVersion: string;
  sections: {
    features?: string[];
    fixes?: string[];
    improvements?: string[];
  };
}

interface Changelog {
  releases: ReleaseEntry[];
}

const HISTORY_DIR = join(import.meta.dirname, '..', 'docs', 'history');
const OUTPUT_DIR = join(import.meta.dirname, '..', 'public');
const OUTPUT_FILE = join(OUTPUT_DIR, 'changelog.json');

function parseVersion(filename: string): string | null {
  // Accepts stable (`0.43.0`) and pre-release (`0.44.0-alpha.0`) suffixes.
  const match = filename.match(/release-v([\d.]+(?:-[\w.]+)?)\.md$/);
  return match ? match[1] : null;
}

function parseReleaseFile(filepath: string): ReleaseEntry | null {
  const content = readFileSync(filepath, 'utf-8');
  const filename = basename(filepath);
  const version = parseVersion(filename);
  if (!version) return null;

  // Extract date — supports both "**Date:** 2026-02-25 **Previous" and "**Date:** 2026-02-25\n**Previous"
  const dateMatch = content.match(/\*\*Date:\*\*\s*([\d-]+)/);
  const date = dateMatch ? dateMatch[1] : '';

  // Extract previous version
  const prevMatch = content.match(/\*\*Previous version:\*\*\s*([\d.]+)/);
  const previousVersion = prevMatch ? prevMatch[1] : '';

  // Parse sections
  const sections: ReleaseEntry['sections'] = {};

  const sectionPattern = /###\s+(Features|Fixes|Improvements)\s*\n([\s\S]*?)(?=###|\n## |$)/g;
  let match: RegExpExecArray | null;

  while ((match = sectionPattern.exec(content)) !== null) {
    const sectionName = match[1].toLowerCase() as keyof typeof sections;
    const sectionContent = match[2];

    // Parse list items — supports nested items by only capturing top-level
    const items: string[] = [];
    for (const line of sectionContent.split('\n')) {
      const itemMatch = line.match(/^- (.+)/);
      if (itemMatch) {
        items.push(itemMatch[1].trim());
      }
    }

    if (items.length > 0) {
      sections[sectionName] = items;
    }
  }

  // Skip releases with no sections
  if (!sections.features && !sections.fixes && !sections.improvements) {
    return null;
  }

  return { version, date, previousVersion, sections };
}

/**
 * SemVer comparator (DESCENDING — newest first).
 *
 * Returns positive when b is newer, negative when a is newer, 0 when equal.
 * Compatible with `Array.sort((a, b) => compareVersions(a, b))` to get
 * newest-first order.
 *
 * Handles prerelease suffixes correctly:
 *   - "0.44.0" is NEWER than "0.44.0-alpha.3" (stable > prerelease of same triple)
 *   - "0.44.0-alpha.3" is NEWER than "0.44.0-alpha.0" (higher prerelease ordinal)
 *   - "0.44.0-beta.0" is NEWER than "0.44.0-alpha.0" (lexical compare on first part)
 *
 * Why this is here: the previous implementation did `a.split('.').map(Number)`
 * which produced NaN for the "0-alpha" segment of "0.44.0-alpha.3", and
 * NaN-NaN=NaN as a sort comparator is undefined behaviour — V8 happened to
 * leave alphas in their input order, which surfaced as "newest alpha last"
 * in the in-app changelog.
 */
function compareVersions(a: string, b: string): number {
  const [aTriple, aPre] = splitSemver(a);
  const [bTriple, bPre] = splitSemver(b);

  // Compare X.Y.Z triple first.
  for (let i = 0; i < 3; i++) {
    if (aTriple[i] !== bTriple[i]) return bTriple[i] - aTriple[i];
  }

  // Triples equal. Stable beats prerelease.
  if (!aPre && !bPre) return 0;
  if (!aPre) return -1; // a is stable, b is prerelease → a is newer
  if (!bPre) return 1;  // b is stable, a is prerelease → b is newer

  // Both are prereleases. Compare identifiers lexically with numeric awareness
  // ("alpha.10" > "alpha.2", not "alpha.10" < "alpha.2").
  const aParts = aPre.split('.');
  const bParts = bPre.split('.');
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const ap = aParts[i] ?? '';
    const bp = bParts[i] ?? '';
    if (ap === bp) continue;
    const aN = Number(ap);
    const bN = Number(bp);
    const aIsNum = ap !== '' && !Number.isNaN(aN);
    const bIsNum = bp !== '' && !Number.isNaN(bN);
    if (aIsNum && bIsNum) return bN - aN;
    return ap < bp ? 1 : -1;
  }
  return 0;
}

function splitSemver(v: string): [[number, number, number], string | null] {
  const dashIdx = v.indexOf('-');
  const triple = dashIdx === -1 ? v : v.slice(0, dashIdx);
  const pre = dashIdx === -1 ? null : v.slice(dashIdx + 1);
  const parts = triple.split('.').map((p) => Number(p) || 0);
  return [[parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0], pre];
}

function main() {
  const files = readdirSync(HISTORY_DIR).filter(
    (f) => f.match(/^\d+-release-v[\d.]+(?:-[\w.]+)?\.md$/),
  );

  const releases: ReleaseEntry[] = [];

  for (const file of files) {
    const entry = parseReleaseFile(join(HISTORY_DIR, file));
    if (entry) {
      releases.push(entry);
    }
  }

  // Sort newest first
  releases.sort((a, b) => compareVersions(a.version, b.version));

  const changelog: Changelog = { releases };

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(changelog, null, 2) + '\n');
  console.log(`Generated changelog.json with ${releases.length} releases`);
}

main();
