// Regression-lock tests for issue #272:
// - `.claude/skills/release/SKILL.md` must contain a dedicated
//   "User-facing copy vs Under the hood" section with forbidden-pattern list
//   and before/after examples.
// - `scripts/generate-changelog.ts` must contain a warn-only linter pass that
//   flags bullets matching the forbidden patterns (exit code remains 0).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const SKILL_PATH = resolve(ROOT, '.claude/skills/release/SKILL.md');
const SCRIPT_PATH = resolve(ROOT, 'scripts/generate-changelog.ts');

function loadSkill(): string {
  return readFileSync(SKILL_PATH, 'utf-8');
}

function loadScript(): string {
  return readFileSync(SCRIPT_PATH, 'utf-8');
}

// Extract a ## section from a markdown document.
// Returns the content from the section header to the next ## heading or EOF.
function extractSection(content: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`##\\s+${escaped}[\\s\\S]*?(?=\\n## |$)`, 'i');
  const match = content.match(pattern);
  return match ? match[0] : '';
}

// ── SKILL.md — dedicated section ─────────────────────────────────────────────

describe('release SKILL.md — User-facing copy section exists', () => {
  it('has a dedicated "User-facing copy vs Under the hood" section', () => {
    const skill = loadSkill();
    expect(skill).toMatch(/##\s+User-facing copy vs Under the hood/i);
  });
});

describe('release SKILL.md — forbidden patterns list', () => {
  it('lists version-number triples as forbidden (e.g. 11.14.0)', () => {
    const skill = loadSkill();
    const section = extractSection(skill, 'User-facing copy vs Under the hood');
    // Section must call out version numbers / triples as a forbidden pattern
    expect(section).toMatch(/\d+\.\d+\.\d+|version triple|version number/i);
    // And must frame it as forbidden / not allowed
    expect(section.toLowerCase()).toMatch(/forbid|not allowed|avoid|banned|don.t include|off.limits/);
  });

  it('lists Dependabot as a forbidden term in user-facing bullets', () => {
    const skill = loadSkill();
    const section = extractSection(skill, 'User-facing copy vs Under the hood');
    expect(section).toMatch(/Dependabot/i);
  });

  it('lists crate / package / library names as forbidden', () => {
    const skill = loadSkill();
    const section = extractSection(skill, 'User-facing copy vs Under the hood');
    expect(section.toLowerCase()).toMatch(/crate|package name|library name|lib name/);
  });

  it('lists "transitive" as a forbidden distribution-mechanics term', () => {
    const skill = loadSkill();
    const section = extractSection(skill, 'User-facing copy vs Under the hood');
    expect(section).toMatch(/transitive/i);
  });
});

describe('release SKILL.md — required bullet shape', () => {
  it('describes what a good user-facing bullet looks like (user-observable outcome)', () => {
    const skill = loadSkill();
    const section = extractSection(skill, 'User-facing copy vs Under the hood');
    // Must guide writers toward user-observable language
    expect(section.toLowerCase()).toMatch(
      /lead with|what the user|user can|user will|non-technical|observable/,
    );
  });
});

describe('release SKILL.md — before/after examples', () => {
  it('includes at least one "Before:" example and one "After:" example', () => {
    const skill = loadSkill();
    const section = extractSection(skill, 'User-facing copy vs Under the hood');
    expect(section).toMatch(/\bBefore\b/i);
    expect(section).toMatch(/\bAfter\b/i);
  });

  it('includes a before/after example covering a security-fix bullet', () => {
    const skill = loadSkill();
    const section = extractSection(skill, 'User-facing copy vs Under the hood');
    // Must demonstrate a security / vulnerability context example
    expect(section.toLowerCase()).toMatch(/security|vulnerabil|inject|fix|patch/);
  });

  it('includes a before/after example covering a dependency-bump bullet', () => {
    const skill = loadSkill();
    const section = extractSection(skill, 'User-facing copy vs Under the hood');
    // Must demonstrate a dependency bump / version upgrade context example
    expect(section.toLowerCase()).toMatch(/depend|bump|upgrade|version update|updated.*version/);
  });

  it('"After" example bullets do NOT contain version number triples', () => {
    const skill = loadSkill();
    const section = extractSection(skill, 'User-facing copy vs Under the hood');
    // Find lines explicitly marked as "After:" examples (✅ After: or plain After:)
    // These are the model bullets that non-technical users would see.
    const afterLines = section
      .split('\n')
      .filter((l) => /✅\s*After:|^-\s*After:/i.test(l) || /After:\s*`/.test(l));
    // There must be at least one After example
    expect(afterLines.length).toBeGreaterThan(0);
    for (const line of afterLines) {
      // After bullets should NOT contain raw version triples like "11.14.0"
      expect(line).not.toMatch(/\b\d+\.\d+\.\d+\b/);
    }
  });
});

// ── generate-changelog.ts — warn-only linter ─────────────────────────────────

describe('generate-changelog.ts — linter function presence', () => {
  it('defines a linter function for user-facing bullets', () => {
    const script = loadScript();
    // Must have a named function that lints user-facing bullets
    expect(script).toMatch(
      /function lint[A-Z]|const lint[A-Z]|function warnForbidden|function checkBullet/i,
    );
  });
});

describe('generate-changelog.ts — forbidden-pattern regexes', () => {
  it('includes a regex for version-triple patterns (\\d+\\.\\d+\\.\\d+)', () => {
    const script = loadScript();
    // The source will contain the regex literal characters \d+\.\d+
    // When stored in a file, \d is the two-char sequence backslash + d
    expect(script).toMatch(/\\d\+/); // matches \d+ appearing in source code
  });

  it('includes "Dependabot" in its forbidden-pattern list', () => {
    const script = loadScript();
    expect(script).toMatch(/Dependabot/);
  });

  it('includes "transitive" in its forbidden-pattern list', () => {
    const script = loadScript();
    expect(script).toMatch(/transitive/);
  });
});

describe('generate-changelog.ts — bullet-linter warn-only behaviour', () => {
  it('uses console.warn to report offending bullets', () => {
    const script = loadScript();
    expect(script).toMatch(/console\.warn/);
  });

  it('does NOT call process.exit(1) inside the bullet-linter (warn-only by design)', () => {
    const script = loadScript();
    // Match the `lintUserFacingBullets` function body specifically — the new
    // `lintLatestPlaceholder` function below it DOES return false to trigger
    // exit, and that's correct.
    const bulletLinterMatch = script.match(
      /function lintUserFacingBullets[\s\S]*?(?=\nfunction )/,
    );
    const body = bulletLinterMatch ? bulletLinterMatch[0] : '';
    expect(body).not.toMatch(/process\.exit\(1\)/);
  });
});

describe('generate-changelog.ts — blocking placeholder linter', () => {
  it('defines the literal PLACEHOLDER_CHANGES_STRING constant', () => {
    const script = loadScript();
    expect(script).toMatch(/PLACEHOLDER_CHANGES_STRING\s*=\s*['"]_No user-visible changes\._['"]/);
  });

  it('defines INFRA_ONLY_OPTOUT_PATTERNS for the explicit opt-out', () => {
    const script = loadScript();
    expect(script).toMatch(/INFRA_ONLY_OPTOUT_PATTERNS/);
    expect(script).toMatch(/Infrastructure-only release/);
    expect(script).toMatch(/No user-visible changes vs/);
  });

  it('exports / defines a lintLatestPlaceholder function', () => {
    const script = loadScript();
    expect(script).toMatch(/function lintLatestPlaceholder/);
  });

  it('main() exits 1 when lintLatestPlaceholder returns false', () => {
    const script = loadScript();
    // The call site in main() must guard with `if (!lintLatestPlaceholder(...))`
    // and call process.exit(1) on failure. Match the pattern loosely.
    expect(script).toMatch(/if\s*\(\s*!lintLatestPlaceholder\([^)]*\)\s*\)\s*\{[\s\S]*?process\.exit\(1\)/);
  });

  it('checks the LATEST entry only (older entries grandfathered)', () => {
    const script = loadScript();
    // The function header comment / body should mention "latest" / "newest"
    // semantics so the grandfathering intent is documented at the source.
    expect(script).toMatch(/lintLatestPlaceholder[\s\S]{0,500}(latest|newest)/i);
  });

  it('accepts an opt-out by checking the raw file body for opt-out patterns', () => {
    const script = loadScript();
    // The function must read the raw file (not rely on the parsed `sections`)
    // because the parser drops placeholder-only releases. Look for readFileSync
    // inside the function body.
    const fnMatch = script.match(/function lintLatestPlaceholder[\s\S]*?(?=\nfunction )/);
    expect(fnMatch).toBeTruthy();
    if (fnMatch) {
      expect(fnMatch[0]).toMatch(/readFileSync/);
    }
  });
});

describe('aw-release-notes skill — file shape', () => {
  it('exists at .claude/skills/aw-release-notes/SKILL.md', () => {
    const skillPath = resolve(ROOT, '.claude/skills/aw-release-notes/SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toMatch(/^---\nname: aw-release-notes/);
  });

  it('declares MODE input with alpha and stable values', () => {
    const skillPath = resolve(ROOT, '.claude/skills/aw-release-notes/SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toMatch(/MODE/);
    expect(content).toMatch(/alpha/);
    expect(content).toMatch(/stable/);
  });

  it('documents the stable-mode alpha-noise filter (drops alpha-introduced-then-alpha-fixed bugs)', () => {
    const skillPath = resolve(ROOT, '.claude/skills/aw-release-notes/SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toMatch(/alpha[\s-]?introduced/i);
  });

  it('documents the infra-only opt-out phrase the linter recognises', () => {
    const skillPath = resolve(ROOT, '.claude/skills/aw-release-notes/SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toMatch(/Infrastructure-only release/);
  });
});
