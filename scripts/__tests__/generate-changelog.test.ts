// Tests for the alpha "Under the hood" surfacing in the changelog generator.
//
// Goal of the feature: alpha (prerelease) changelog entries carry the verbatim
// merged-PR dump from the history file's "## Under the hood" section so the
// in-app changelog shows what made each auto-cut. Stable entries must NEVER
// carry it — that detail is rewritten into curated prose by `/release`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
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
// Desktop and iOS share a repo and a version line but ship to different people
// through different stores. A desktop alpha announcing "folder pinning fixed
// on iPhone" reads as noise to someone who just updated their Mac, so
// mobile-scoped bullets get their own section (Peter, 2026-08-15).

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
    expect(entry.sections.features).toEqual([
      'feat(editor): callout blocks land in the toolbar (#690)',
    ]);
    expect(entry.sections.fixes).toEqual(['fix(export): PDF footers no longer clip (#691)']);
    expect(entry.sections.ios).toEqual([
      'feat(mobile): long-press menu, Inbox shortcut, row redesign (#684)',
      'fix(ios): stop the scroller stealing swipe gestures (#688)',
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
    expect(entry.sections.ios).toEqual(['feat(mobile): gallery view (#633)']);
  });
});
