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

describe('generate-changelog.ts — warn-only behaviour', () => {
  it('uses console.warn to report offending bullets', () => {
    const script = loadScript();
    expect(script).toMatch(/console\.warn/);
  });

  it('does NOT call process.exit(1) inside the linter (exit code stays 0)', () => {
    const script = loadScript();
    // Find the linter function body
    const linterMatch = script.match(
      /function lint[\s\S]*?(?=\nfunction |\nexport |\nconst [A-Z_]|$)/i,
    );
    const linterBody = linterMatch ? linterMatch[0] : '';
    // The linter section itself must not exit with code 1
    expect(linterBody).not.toMatch(/process\.exit\(1\)/);
  });
});
