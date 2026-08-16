// Tests for the alpha "Under the hood" surfacing in the changelog generator.
//
// Goal of the feature: alpha (prerelease) changelog entries carry the verbatim
// merged-PR dump from the history file's "## Under the hood" section so the
// in-app changelog shows what made each auto-cut. Stable entries must NEVER
// carry it — that detail is rewritten into curated prose by `/release`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { parseUnderTheHood, parseReleaseFile } from '../generate-changelog';

const AUTO_CUT_ALPHA = `# Release v0.46.0-alpha.5

**Date:** 2026-05-29
**Previous version:** 0.46.0-alpha.4
**Channel:** Alpha

## Changes

_No user-visible changes._

## Under the hood

Auto-generated dump of merged Tier-A/B PRs. Rewrite as prose grouped by area before stable promotion.

- fix(ci): exclude release PRs from alpha cut to prevent infinite loop (#374)
- feat(quiet-chrome): extend Aggressive preset (#372)
`;

const STABLE_RELEASE = `# Release v0.46.0

**Date:** 2026-05-30
**Previous version:** 0.45.0

## Changes

### Features

- New thing for users

## Under the hood

- fix(ci): some internal plumbing (#999)
`;

describe('parseUnderTheHood', () => {
  it('extracts only the bullet lines, dropping the lead paragraph', () => {
    expect(parseUnderTheHood(AUTO_CUT_ALPHA)).toEqual([
      'fix(ci): exclude release PRs from alpha cut to prevent infinite loop (#374)',
      'feat(quiet-chrome): extend Aggressive preset (#372)',
    ]);
  });

  it('returns an empty array when there is no Under the hood section', () => {
    expect(parseUnderTheHood('# Release\n\n## Changes\n\n- x')).toEqual([]);
  });
});

describe('parseReleaseFile — alpha vs stable Under the hood', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'changelog-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, body: string): string {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  }

  it('attaches underTheHood to an alpha entry even with empty curated sections', () => {
    const entry = parseReleaseFile(write('010-release-v0.46.0-alpha.5.md', AUTO_CUT_ALPHA));
    // Previously this returned null (no curated sections) and the alpha vanished
    // from the feed. It must now survive on the strength of its PR dump.
    expect(entry).not.toBeNull();
    expect(entry!.version).toBe('0.46.0-alpha.5');
    expect(entry!.underTheHood).toEqual([
      'fix(ci): exclude release PRs from alpha cut to prevent infinite loop (#374)',
      'feat(quiet-chrome): extend Aggressive preset (#372)',
    ]);
  });

  it('never attaches underTheHood to a stable entry, even when the section exists', () => {
    const entry = parseReleaseFile(write('011-release-v0.46.0.md', STABLE_RELEASE));
    expect(entry).not.toBeNull();
    expect(entry!.version).toBe('0.46.0');
    expect(entry!.sections.features).toEqual(['New thing for users']);
    expect(entry!.underTheHood).toBeUndefined();
  });

  it('still skips a stable entry that has no curated sections', () => {
    const body = `# Release v0.47.0\n\n**Date:** 2026-06-01\n\n## Changes\n\n_No user-visible changes._\n\n## Under the hood\n\n- internal (#1)\n`;
    const entry = parseReleaseFile(write('012-release-v0.47.0.md', body));
    expect(entry).toBeNull();
  });
});

// ── Platform routing ────────────────────────────────────────────────────────
//
// Desktop and iOS share a repo and a version line, but a changelog is read in
// the context of ONE app. "Folder pinning fixed on iPhone" is noise in a Mac
// release even when the same person uses both, so mobile-scoped bullets are
// routed out here and land in their own feed (Peter, 2026-08-15).

const AUTO_CUT_WITH_MOBILE = `# Release v0.48.0-alpha.35

**Date:** 2026-08-14
**Previous version:** 0.48.0-alpha.34
**Channel:** Alpha

## Changes

### Features
- feat(mobile): long-press menu, Inbox shortcut, row redesign (#684)
- feat(editor): callout blocks land in the toolbar (#690)

### Fixes
- fix(ios): stop the scroller stealing swipe gestures (#688)
- fix(export): PDF footers no longer clip (#691)
`;

const HAND_WRITTEN_IOS = `# Release v0.48.0-alpha.36

**Date:** 2026-08-15
**Previous version:** 0.48.0-alpha.35
**Channel:** Alpha

## Changes

### Features
- Notesage now ships as a single build for everyone.

### iOS
- Pinning a folder now shows it under Pinned.
`;

describe('platform routing', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'changelog-platform-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function parse(content: string) {
    // The version comes from the FILENAME, not the heading — parseReleaseFile
    // returns null for anything that does not match `release-vX.Y.Z.md`.
    const version = content.match(/# Release v([\d.]+(?:-[\w.]+)?)/)![1];
    const file = join(dir, `900-release-v${version}.md`);
    writeFileSync(file, content);
    return parseReleaseFile(file)!;
  }

  it('moves mobile-scoped bullets out of the desktop sections', () => {
    const entry = parse(AUTO_CUT_WITH_MOBILE);
    // Routed by scope, then stripped of it — these reach users as "What's new".
    expect(entry.sections.features).toEqual(['Callout blocks land in the toolbar']);
    expect(entry.sections.fixes).toEqual(['PDF footers no longer clip']);
    expect(entry.sections.ios).toEqual([
      'Long-press menu, Inbox shortcut, row redesign',
      'Stop the scroller stealing swipe gestures',
    ]);
  });

  it('reads an explicit ### iOS section from a hand-written note', () => {
    const entry = parse(HAND_WRITTEN_IOS);
    expect(entry.sections.ios).toEqual(['Pinning a folder now shows it under Pinned.']);
    expect(entry.sections.features).toEqual([
      'Notesage now ships as a single build for everyone.',
    ]);
  });

  it('does not misfile a desktop bullet that merely mentions mobile', () => {
    // Only a LEADING conventional-commit scope counts — prose about mobile
    // in a desktop change must stay where it was written.
    const entry = parse(`# Release v0.48.0-alpha.37

**Date:** 2026-08-16
**Previous version:** 0.48.0-alpha.36
**Channel:** Alpha

## Changes

### Fixes
- Sync no longer stalls when a mobile device writes concurrently (#700)
`);
    expect(entry.sections.fixes).toHaveLength(1);
    expect(entry.sections.ios).toBeUndefined();
  });

  it('drops the desktop section entirely when every bullet was mobile', () => {
    const entry = parse(`# Release v0.48.0-alpha.38

**Date:** 2026-08-17
**Previous version:** 0.48.0-alpha.37
**Channel:** Alpha

## Changes

### Features
- feat(mobile): gallery view (#633)
`);
    expect(entry.sections.features).toBeUndefined();
    expect(entry.sections.ios).toEqual(['Gallery view']);
  });

  // The ordering here is load-bearing and easy to "tidy" into breakage:
  // humanizing strips the very scope `isMobileScoped` routes on, so doing it
  // first sends every iOS bullet to the desktop feed. This test fails loudly
  // if the two steps are ever swapped.
  it('routes on the scope before stripping it', () => {
    const entry = parse(`# Release v0.51.0

**Date:** 2026-08-17
**Previous version:** 0.50.0

## Changes

### Fixes
- fix(ios): reader no longer loses scroll position (#688)
- fix(recording): transcription re-runs with the chosen model (#701)
`);
    expect(entry.sections.ios).toEqual(['Reader no longer loses scroll position']);
    expect(entry.sections.fixes).toEqual(['Transcription re-runs with the chosen model']);
  });

  it('strips an unscoped prefix rather than capitalising it', () => {
    // The scope is optional in real PR titles. Requiring it produced
    // "Feat: queue messages…" in the shipped feed — worse than not trying.
    const entry = parse(`# Release v0.53.0

**Date:** 2026-08-19
**Previous version:** 0.52.0

## Changes

### Features
- feat: queue messages sent during agent work instead of interrupting (#563)
`);
    expect(entry.sections.features).toEqual([
      'Queue messages sent during agent work instead of interrupting',
    ]);
  });

  it('does not sentence-case a leading identifier', () => {
    // "Mcp_oauth" reads as a typo rather than a name.
    const entry = parse(`# Release v0.54.0

**Date:** 2026-08-20
**Previous version:** 0.53.0

## Changes

### Fixes
- fix(security): mcp_oauth redirect SSRF + CI audit gating (#537)
`);
    expect(entry.sections.fixes).toEqual(['mcp_oauth redirect SSRF + CI audit gating']);
  });

  it('strips every trailing PR ref, not just the last', () => {
    // A squashed PR that references another carries two: `… (#375) (#377)`.
    const entry = parse(`# Release v0.55.0

**Date:** 2026-08-21
**Previous version:** 0.54.0

## Changes

### Fixes
- fix(html-viewer): fix 10 bugs from the v0.46.0 code review (#375) (#377)
`);
    expect(entry.sections.fixes).toEqual(['Fix 10 bugs from the v0.46.0 code review']);
  });

  it('leaves curated prose alone', () => {
    // Hand-written notes match neither the scope nor the trailing-PR pattern,
    // so humanizing must be a no-op rather than a re-capitalisation.
    const entry = parse(`# Release v0.52.0

**Date:** 2026-08-18
**Previous version:** 0.51.0

## Changes

### Features
- **One build for everyone.** Notesage no longer ships a separate alpha download.
`);
    expect(entry.sections.features).toEqual([
      '**One build for everyone.** Notesage no longer ships a separate alpha download.',
    ]);
  });
});

// ── Two feeds ───────────────────────────────────────────────────────────────
//
// `main()` writes changelog.json (desktop) and changelog-ios.json. These
// assert the SHAPE the split has to preserve; the routing itself is covered
// above at the parse level.

describe('feed split invariants', () => {
  it('a desktop entry never carries iOS content', () => {
    const desktop = JSON.parse(
      readFileSync(resolve(__dirname, '../../public/changelog.json'), 'utf8'),
    ) as { releases: Array<{ sections: Record<string, unknown>; underTheHood?: string[] }> };

    for (const release of desktop.releases) {
      expect(release.sections.ios).toBeUndefined();
      // Under-the-hood splits too, or iOS commits smuggle themselves back in
      // through the developer detail.
      for (const bullet of release.underTheHood ?? []) {
        expect(bullet).not.toMatch(/^\**(?:feat|fix|perf|refactor|chore)\s*\((?:mobile|ios)/i);
      }
    }
  });

  it('the iOS feed carries only iOS content, and is not empty', () => {
    const ios = JSON.parse(
      readFileSync(resolve(__dirname, '../../public/changelog-ios.json'), 'utf8'),
    ) as { releases: Array<{ sections: { features?: string[] }; underTheHood?: string[] }> };

    expect(ios.releases.length).toBeGreaterThan(0);
    for (const release of ios.releases) {
      const bullets = [...(release.sections.features ?? []), ...(release.underTheHood ?? [])];
      // Every entry must justify its existence — an entry with no bullets
      // would mean a release listed as "iOS changes" with none.
      expect(bullets.length).toBeGreaterThan(0);
    }
  });
});

// ── Wrapped bullets ─────────────────────────────────────────────────────────
//
// Curated notes wrap at ~80 columns. Reading only the line that starts with
// `- ` truncated every wrapped bullet mid-sentence — silently, and in the
// user-facing sections. Caught when the generated iOS notes read "…instead of
// appearing to do" (Peter, 2026-08-15).

describe('wrapped bullets', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'changelog-wrap-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('joins continuation lines into one bullet', () => {
    const file = join(dir, '900-release-v1.0.0.md');
    writeFileSync(
      file,
      `# Release v1.0.0

**Date:** 2026-08-15
**Previous version:** 0.9.0
**Channel:** Stable

## Changes

### Fixes
- Pinning a folder now shows it under Pinned instead of appearing to do
  nothing.
- A short one.
`,
    );
    const entry = parseReleaseFile(file)!;
    expect(entry.sections.fixes).toEqual([
      'Pinning a folder now shows it under Pinned instead of appearing to do nothing.',
      'A short one.',
    ]);
  });

  it('does not swallow a nested list item into the bullet above', () => {
    const file = join(dir, '901-release-v1.1.0.md');
    writeFileSync(
      file,
      `# Release v1.1.0

**Date:** 2026-08-15
**Previous version:** 1.0.0
**Channel:** Stable

## Changes

### Features
- Parent bullet
  - nested detail
`,
    );
    const entry = parseReleaseFile(file)!;
    expect(entry.sections.features).toEqual(['Parent bullet']);
  });
});
