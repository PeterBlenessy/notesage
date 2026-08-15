import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { pathToFileURL } from 'url';

interface ReleaseEntry {
  version: string;
  date: string;
  previousVersion: string;
  sections: {
    features?: string[];
    fixes?: string[];
    improvements?: string[];
    /**
     * Changes to the iOS app, kept OUT of the desktop sections.
     *
     * The two apps share a repo and a version line but ship to different
     * people through different stores — a desktop alpha announcing "folder
     * pinning fixed on iPhone" reads as noise to someone who just updated
     * their Mac (Peter, 2026-08-15). Routed by conventional-commit scope, so
     * it works for hand-written notes and auto-cut ones alike.
     */
    ios?: string[];
  };
  // Verbatim merged-PR dump from the history file's "## Under the hood"
  // section. Populated ONLY for prerelease (alpha) entries so the alpha
  // changelog feed shows what landed in each auto-cut. Only attached when the
  // version carries a `-` segment, so curated releases keep their prose.
  underTheHood?: string[];
}

interface Changelog {
  releases: ReleaseEntry[];
}

const HISTORY_DIR = join(import.meta.dirname, '..', 'docs', 'history');
const OUTPUT_DIR = join(import.meta.dirname, '..', 'public');
// `changelog.json` is THE feed — one release stream, so every entry is in it,
// historical `-alpha.N` releases included. Until 2026-08-15 a second
// `changelog-alpha.json` carried the prerelease line; the single-binary change
// (PRD `2026-08-15-single-binary-feature-flags.md`) removed the channel the
// split existed to serve.
const OUTPUT_FILE = join(OUTPUT_DIR, 'changelog.json');

function parseVersion(filename: string): string | null {
  // Accepts stable (`0.43.0`) and pre-release (`0.44.0-alpha.0`) suffixes.
  const match = filename.match(/release-v([\d.]+(?:-[\w.]+)?)\.md$/);
  return match ? match[1] : null;
}

/**
 * Is this bullet about the iOS app rather than the desktop one?
 *
 * Matched on the conventional-commit scope (`feat(mobile): …`, `fix(ios): …`),
 * which is what both hand-written and auto-cut notes carry. Deliberately
 * narrow: a desktop change that merely mentions the word "mobile" in prose
 * must not be misfiled, so only a leading scope counts.
 */
function isMobileScoped(bullet: string): boolean {
  return /^\**(?:feat|fix|perf|refactor|style|docs|chore|build|ci|test)\s*\((?:mobile|ios)[^)]*\)/i.test(
    bullet.trim(),
  );
}

/**
 * Extract the bullet list from the "## Under the hood" section.
 *
 * The section also carries a descriptive lead paragraph ("Auto-generated dump
 * of merged Tier-A/B PRs…") which is intentionally dropped — only `- ` list
 * items (the merged-PR lines) are returned.
 */
export function parseUnderTheHood(content: string): string[] {
  const match = content.match(/##\s+Under the hood\s*\n([\s\S]*?)(?=\n## |$)/);
  if (!match) return [];

  const items: string[] = [];
  for (const line of match[1].split('\n')) {
    const itemMatch = line.match(/^- (.+)/);
    if (itemMatch) {
      items.push(itemMatch[1].trim());
    }
  }
  return items;
}

export function parseReleaseFile(filepath: string): ReleaseEntry | null {
  const content = readFileSync(filepath, 'utf-8');
  const filename = basename(filepath);
  const version = parseVersion(filename);
  if (!version) return null;

  // Extract date — supports both "**Date:** 2026-02-25 **Previous" and "**Date:** 2026-02-25\n**Previous"
  const dateMatch = content.match(/\*\*Date:\*\*\s*([\d-]+)/);
  const date = dateMatch ? dateMatch[1] : '';

  // Extract previous version — include any `-alpha.N` prerelease suffix (the
  // old `[\d.]+` stopped at the `-`, so every alpha reported `0.46.0`).
  const prevMatch = content.match(/\*\*Previous version:\*\*\s*([\d.]+(?:-[\w.]+)?)/);
  const previousVersion = prevMatch ? prevMatch[1] : '';

  // Parse sections
  const sections: ReleaseEntry['sections'] = {};

  const sectionPattern = /###\s+(Features|Fixes|Improvements|iOS)\s*\n([\s\S]*?)(?=###|\n## |$)/g;
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

    if (items.length === 0) continue;

    // Route by platform. A bullet scoped to the mobile app belongs in the iOS
    // bucket wherever it was written — auto-cut alphas classify by commit type
    // alone and would otherwise file `feat(mobile): …` under desktop Features.
    if (sectionName === 'ios') {
      sections.ios = [...(sections.ios ?? []), ...items];
      continue;
    }
    const desktop = items.filter((item) => !isMobileScoped(item));
    const mobile = items.filter((item) => isMobileScoped(item));
    if (desktop.length > 0) sections[sectionName] = desktop;
    if (mobile.length > 0) sections.ios = [...(sections.ios ?? []), ...mobile];
  }

  // Prerelease (alpha) entries surface the verbatim merged-PR dump so the
  // alpha changelog shows what made the cut. Stable entries never do — the
  // `/release` flow rewrites that detail into curated prose.
  const isPrerelease = version.includes('-');
  const uth = isPrerelease ? parseUnderTheHood(content) : [];
  const underTheHood = uth.length > 0 ? uth : undefined;

  // Skip releases with nothing to show. For alphas, an "Under the hood" dump
  // counts as content even when the curated sections are empty — otherwise
  // auto-cut alphas (which have no curated sections yet) would vanish from the
  // feed entirely.
  // `sections.ios` counts as content too — a release whose changes were ALL
  // mobile would otherwise be dropped from the feed entirely, which is how
  // the platform split could silently lose a whole entry.
  if (
    !sections.features &&
    !sections.fixes &&
    !sections.improvements &&
    !sections.ios &&
    !underTheHood
  ) {
    return null;
  }

  return { version, date, previousVersion, sections, underTheHood };
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


// Patterns that are forbidden in user-facing bullets (Features / Improvements / Fixes).
// Each entry is [regex, human-readable label].
// The linter is warn-only: exit code stays 0 so the linter guides the writer
// without blocking releases. See `.claude/skills/release/SKILL.md` §"User-facing
// copy vs Under the hood" for the rationale and before/after examples.
const FORBIDDEN_BULLET_PATTERNS: [RegExp, string][] = [
  [/\d+\.\d+\.\d+/, 'version triple (e.g. 11.14.0)'],
  [/Dependabot/i, 'Dependabot reference'],
  [/transitive/i, '"transitive" distribution mechanic'],
  [/Cargo\.lock/i, 'Cargo.lock reference'],
  [/\bcrate\b/i, '"crate" internal term'],
];

/**
 * Warn-only linter for user-facing release bullets.
 *
 * Scans Features / Improvements / Fixes bullets in all parsed releases and
 * prints a console.warn for each bullet that matches a forbidden pattern.
 * Always returns void — callers must NOT exit(1) based on this output.
 */
function lintUserFacingBullets(releases: ReleaseEntry[]): void {
  let warningCount = 0;

  for (const release of releases) {
    const sectionEntries = Object.entries(release.sections) as [
      keyof ReleaseEntry['sections'],
      string[] | undefined,
    ][];

    for (const [sectionName, bullets] of sectionEntries) {
      if (!bullets) continue;

      for (const bullet of bullets) {
        for (const [pattern, label] of FORBIDDEN_BULLET_PATTERNS) {
          if (pattern.test(bullet)) {
            console.warn(
              `[changelog-linter] v${release.version} › ${sectionName} › forbidden pattern (${label}): "${bullet}"`,
            );
            warningCount++;
            break; // one warning per bullet is enough
          }
        }
      }
    }
  }

  if (warningCount > 0) {
    console.warn(
      `[changelog-linter] ${warningCount} user-facing bullet(s) contain forbidden patterns.`,
    );
    console.warn(
      `[changelog-linter] Move developer-facing detail to ## Under the hood.`,
    );
    console.warn(
      `[changelog-linter] See .claude/skills/release/SKILL.md §"User-facing copy vs Under the hood" for examples.`,
    );
  }
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

  // Warn-only linter: flag user-facing bullets that contain forbidden patterns.
  lintUserFacingBullets(releases);

  // ONE feed. There is one release stream now, so every entry belongs in it —
  // including the historical `-alpha.N` ones, which are simply older releases
  // (PRD `2026-08-15-single-binary-feature-flags.md`). Filtering them out
  // would blank the in-app changelog for anyone upgrading FROM an alpha.
  const changelog: Changelog = { releases };

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(changelog, null, 2) + '\n');
  console.log(`Generated changelog.json (${changelog.releases.length} releases)`);
}

// Run only when executed directly (via `tsx scripts/generate-changelog.ts`),
// not when imported by unit tests for the pure parse helpers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
