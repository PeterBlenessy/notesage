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
  /** Under-the-hood detail for the iOS app, split out with the rest. */
  iosUnderTheHood?: string[];
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
// The iOS feed. No in-app consumer yet — it is the source for TestFlight /
// App Store release notes, which are written by hand today.
const IOS_OUTPUT_FILE = join(OUTPUT_DIR, 'changelog-ios.json');

function parseVersion(filename: string): string | null {
  // Accepts stable (`0.43.0`) and pre-release (`0.44.0-alpha.0`) suffixes.
  const match = filename.match(/release-v([\d.]+(?:-[\w.]+)?)\.md$/);
  return match ? match[1] : null;
}

/**
 * Turn a bullet into something readable as a RELEASE NOTE.
 *
 * The iOS feed inherits auto-cut bullets, which are commit subjects:
 * `feat(mobile): long-press menu, capture fixes (#684)`. That is fine for a
 * developer scanning what landed, and useless as text to paste into
 * TestFlight. Strip the conventional-commit scope and the PR reference, and
 * capitalise — the result is not prose, but it is a note rather than a commit.
 */
export function humanizeBullet(bullet: string): string {
  const withoutScope = bullet.replace(
    /^\**(?:feat|fix|perf|refactor|style|docs|chore|build|ci|test)\s*\([^)]*\):\s*/i,
    '',
  );
  const withoutPr = withoutScope.replace(/\s*\(#\d+\)\s*$/, '').trim();
  return withoutPr.charAt(0).toUpperCase() + withoutPr.slice(1);
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

  return parseBullets(match[1]);
}

/**
 * Bullets from a markdown block, JOINING wrapped continuation lines.
 *
 * Curated notes wrap at ~80 columns, so a bullet routinely spans several
 * lines. Reading only the line that starts with `- ` truncated every one of
 * them mid-sentence — silently, and in the user-facing sections, which is
 * where it mattered most. Found when the generated iOS notes read
 * "…instead of appearing to do" (Peter, 2026-08-15).
 *
 * A continuation is any non-empty line that does not itself begin a bullet
 * and is not a heading. Nested list items (`  - …`) stay excluded, matching
 * the previous top-level-only behaviour.
 */
function parseBullets(block: string): string[] {
  const items: string[] = [];
  for (const line of block.split('\n')) {
    const start = line.match(/^- (.+)/);
    if (start) {
      items.push(start[1].trim());
      continue;
    }
    const trimmed = line.trim();
    if (items.length === 0 || trimmed === '' || trimmed.startsWith('#')) continue;
    if (/^[-*]\s/.test(trimmed)) continue;
    items[items.length - 1] += ` ${trimmed}`;
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

    const items = parseBullets(sectionContent);

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
  const desktopUth = uth.filter((b) => !isMobileScoped(b));
  const mobileUth = uth.filter((b) => isMobileScoped(b));
  const underTheHood = desktopUth.length > 0 ? desktopUth : undefined;
  const iosUnderTheHood = mobileUth.length > 0 ? mobileUth : undefined;

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

  return { version, date, previousVersion, sections, underTheHood, iosUnderTheHood };
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

/**
 * Render the iOS feed as a markdown document.
 *
 * The iOS app has no in-app changelog — its notes are typed into TestFlight
 * and App Store Connect by hand. This is the source for that text, so it is
 * written to `docs/app-store/` beside the rest of the store copy rather than
 * to `public/`, which is for things the app itself fetches.
 */
function writeIosReleaseNotes(
  releases: Array<{ version: string; date: string; sections: { features?: string[] } }>,
): void {
  const lines = [
    '# iOS release notes',
    '',
    '**Generated** by `scripts/generate-changelog.ts` from the iOS half of the',
    'release history — do not edit by hand, the next run overwrites it.',
    '',
    'Paste the relevant section into TestFlight "What to Test" or App Store',
    '"What\'s New". Bullets come from merged PR titles with the commit scope',
    'stripped; tighten the wording before shipping a public release.',
    '',
  ];

  for (const release of releases) {
    lines.push(`## ${release.version} — ${release.date}`, '');
    for (const bullet of release.sections.features ?? []) {
      lines.push(`- ${humanizeBullet(bullet)}`);
    }
    lines.push('');
  }

  const dir = join(import.meta.dirname, '..', 'docs', 'app-store');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ios-release-notes.md'), lines.join('\n'));
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

  // TWO feeds, one per PRODUCT. Not because the readers are different people
  // — usually they are the SAME person — but because the context is: when
  // you are reading the changelog of the app in front of you, changes to the
  // other one are noise. "Folder pinning fixed on iPhone" does not belong in
  // a Mac release, and vice versa (Peter, 2026-08-15). Version numbers stay
  // shared, which is correct: one commit, one release, described twice for
  // the two places it lands.
  //
  // An entry with nothing for a platform is OMITTED from that platform's
  // feed rather than listed empty: a release that only touched iOS genuinely
  // changed nothing for desktop users, and saying so honestly beats an entry
  // with no bullets under it.
  const desktopReleases = releases
    .map(({ iosUnderTheHood: _ios, ...entry }) => ({
      ...entry,
      sections: { ...entry.sections, ios: undefined },
    }))
    .filter(
      (r) =>
        r.sections.features || r.sections.fixes || r.sections.improvements || r.underTheHood,
    );

  const iosReleases = releases
    .filter((r) => r.sections.ios || r.iosUnderTheHood)
    .map((r) => ({
      version: r.version,
      date: r.date,
      previousVersion: r.previousVersion,
      // The iOS feed's "features" ARE the iOS bullets — a reader of this feed
      // has no desktop sections to compare them against.
      sections: { features: r.sections.ios },
      underTheHood: r.iosUnderTheHood,
    }));

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify({ releases: desktopReleases }, null, 2) + '\n');
  writeFileSync(IOS_OUTPUT_FILE, JSON.stringify({ releases: iosReleases }, null, 2) + '\n');
  writeIosReleaseNotes(iosReleases);

  console.log(
    `Generated changelog.json (${desktopReleases.length} desktop) + ` +
      `changelog-ios.json (${iosReleases.length} iOS) + ios-release-notes.md`,
  );
}

// Run only when executed directly (via `tsx scripts/generate-changelog.ts`),
// not when imported by unit tests for the pure parse helpers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
