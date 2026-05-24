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
// `changelog.json` is the stable-channel feed — entries whose version has no
// `-` prerelease segment. `changelog-alpha.json` is the alpha-channel feed —
// every entry including the alpha line. The naming convention follows the
// release-asset/bundled-file/fetch-URL story: unmarked = stable default,
// `-alpha` suffix = the variant. See `useChangelog.ts` for the channel-aware
// URL picker.
const STABLE_OUTPUT_FILE = join(OUTPUT_DIR, 'changelog.json');
const ALPHA_OUTPUT_FILE = join(OUTPUT_DIR, 'changelog-alpha.json');

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


// Patterns that are forbidden in user-facing bullets (Features / Improvements / Fixes).
// Each entry is [regex, human-readable label].
// The bullet-linter is warn-only: exit code stays 0 so the linter guides the writer
// without blocking releases on historical entries. See `.claude/skills/release/SKILL.md`
// §"User-facing copy vs Under the hood" for the rationale and before/after examples.
const FORBIDDEN_BULLET_PATTERNS: [RegExp, string][] = [
  [/\d+\.\d+\.\d+/, 'version triple (e.g. 11.14.0)'],
  [/Dependabot/i, 'Dependabot reference'],
  [/transitive/i, '"transitive" distribution mechanic'],
  [/Cargo\.lock/i, 'Cargo.lock reference'],
  [/\bcrate\b/i, '"crate" internal term'],
];

// Placeholder text the aw-alpha-cut workflow writes when no editorial pass has
// run yet. The aw-release-notes skill MUST replace this with prose before the
// PR is opened — see `.claude/skills/aw-release-notes/SKILL.md`.
const PLACEHOLDER_CHANGES_STRING = '_No user-visible changes._';

// Explicit opt-out phrases that signal an intentional infra-only release.
// When the intro contains one of these AND the Changes section is the
// placeholder, the linter accepts it (releases that genuinely shipped nothing
// user-visible — e.g. CI plumbing alphas).
const INFRA_ONLY_OPTOUT_PATTERNS: RegExp[] = [
  /Infrastructure-only release/i,
  /No user-visible changes vs/i,
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
 * Blocking linter for the LATEST release entry only.
 *
 * Detects the case where the auto-cut placeholder was committed without an
 * editorial rewrite. Returns true if the latest entry is OK to ship, false if
 * it must be reworked. Older entries are grandfathered — they're immutable
 * history at this point and rewriting them is not in scope.
 *
 * Rule:
 *   - If the latest entry's `## Changes` content equals the literal placeholder
 *     `_No user-visible changes._`, then the file body MUST contain one of the
 *     INFRA_ONLY_OPTOUT_PATTERNS to be considered intentional. Otherwise it's
 *     a forgotten rewrite and the linter fails (caller exits 1).
 *
 * The check reads the raw file content because the parser drops releases with
 * empty sections — we need the source to distinguish "intentionally empty" from
 * "accidentally empty".
 */
function lintLatestPlaceholder(historyDir: string): boolean {
  const files = readdirSync(historyDir).filter(
    (f) => f.match(/^\d+-release-v[\d.]+(?:-[\w.]+)?\.md$/),
  );
  if (files.length === 0) return true;

  // Find the latest file by version (same comparator the JSON output uses).
  const sorted = files
    .map((f) => ({ file: f, version: parseVersion(f) }))
    .filter((e): e is { file: string; version: string } => e.version !== null)
    .sort((a, b) => compareVersions(a.version, b.version));
  if (sorted.length === 0) return true;

  const latest = sorted[0];
  const filepath = join(historyDir, latest.file);
  const content = readFileSync(filepath, 'utf-8');

  // Extract the ## Changes section content (between ## Changes and ## Under the hood, or EOF).
  const changesMatch = content.match(/##\s+Changes\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!changesMatch) {
    // No ## Changes section at all — unusual but not the placeholder case; pass through.
    return true;
  }
  const changesBody = changesMatch[1].trim();

  // Placeholder check: is the Changes section just the literal default text?
  if (changesBody !== PLACEHOLDER_CHANGES_STRING) {
    return true; // Real content present, OK.
  }

  // Placeholder is present. Check if the intro opts out explicitly.
  const hasOptOut = INFRA_ONLY_OPTOUT_PATTERNS.some((p) => p.test(content));
  if (hasOptOut) {
    console.log(
      `[changelog-linter] ${latest.file}: placeholder ## Changes accepted (infra-only opt-out present).`,
    );
    return true;
  }

  // Placeholder without opt-out — block.
  console.error(
    `[changelog-linter] BLOCKED: ${latest.file} has placeholder ## Changes section without an opt-out marker.`,
  );
  console.error(
    `[changelog-linter] The aw-release-notes skill must replace "${PLACEHOLDER_CHANGES_STRING}" with editorial prose,`,
  );
  console.error(
    `[changelog-linter] OR the intro paragraph must contain "Infrastructure-only release." / "No user-visible changes vs ..." to opt out.`,
  );
  console.error(
    `[changelog-linter] See .claude/skills/aw-release-notes/SKILL.md for the editorial rules.`,
  );
  return false;
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

  // Blocking linter: refuse to generate the JSON if the LATEST release entry
  // is the unrewritten auto-cut placeholder. This is the gate that catches
  // alpha cuts that skipped the editorial pass (whether the Claude action
  // failed silently or someone reverted the rewrite).
  if (!lintLatestPlaceholder(HISTORY_DIR)) {
    process.exit(1);
  }

  // Alpha feed = every release. Stable feed = entries without a prerelease
  // segment. The `-` test mirrors how `isPrereleaseVersion()` classifies
  // updates in `useAutoUpdate.ts` — same source of truth across the codebase.
  const alphaChangelog: Changelog = { releases };
  const stableChangelog: Changelog = {
    releases: releases.filter((r) => !r.version.includes('-')),
  };

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  writeFileSync(STABLE_OUTPUT_FILE, JSON.stringify(stableChangelog, null, 2) + '\n');
  writeFileSync(ALPHA_OUTPUT_FILE, JSON.stringify(alphaChangelog, null, 2) + '\n');
  console.log(
    `Generated changelog.json (${stableChangelog.releases.length} stable) + changelog-alpha.json (${alphaChangelog.releases.length} total)`,
  );
}

main();
