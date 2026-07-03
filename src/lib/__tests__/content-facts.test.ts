import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { parse } from 'yaml';

// Content-atom facts check. Validates every single-source feature atom
// (content/features/*.md) against the app's own authoritative sources, so the
// marketing/in-app/social copy can't silently drift from the code — the failure
// mode that put "live dictation" and the wrong comment shortcut in the draft.
//
// The atom format is shared with the CLI generator (scripts/gen-content.mjs);
// this parser mirrors it. In a real build we'd extract one typed module and run
// the CLI through it — kept inline here to keep the check self-contained.

// Tier-2 = [web], tier-3 = [deep]. [developer] is never allowed (dev docs live
// in docs/features/*.md).
const KNOWN_SECTIONS = ['web', 'deep', 'in-app', 'social'] as const;
const REQUIRED_SECTIONS = ['web', 'in-app'] as const; // deep + social are optional
const KNOWN_CATEGORIES = ['write', 'ai', 'organize', 'documents', 'voice', 'automate'] as const;

interface Shortcut {
  id: string;
  keys: string;
  label?: string;
}
interface AtomFront {
  feature?: string;
  title?: string;
  category?: string;
  summary?: string;
  shortcuts?: Shortcut[];
  forbidden?: string[];
  screenshots?: string[];
}

function parseAtom(rawText: string): { front: AtomFront; sections: Record<string, string> } {
  const m = rawText.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('atom is missing YAML frontmatter');
  const front = (parse(m[1]) ?? {}) as AtomFront;
  const body = m[2];

  const marks: { name: string; contentStart: number; headStart: number }[] = [];
  const re = /^##\s*\[([a-z-]+)\]\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    marks.push({ name: match[1], contentStart: re.lastIndex, headStart: match.index });
  }
  const sections: Record<string, string> = {};
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].headStart : body.length;
    sections[marks[i].name] = body.slice(marks[i].contentStart, end).trim();
  }
  return { front, sections };
}

const repoRoot = path.resolve(__dirname, '../../..');
const featuresDir = path.join(repoRoot, 'content', 'features');
const manifestPath = path.join(repoRoot, 'src', 'shared', 'appCommandManifest.json');
const shortcutsDocPath = path.join(repoRoot, 'docs', 'keyboard-shortcuts.md');
const screenshotsDir = path.join(repoRoot, 'content', 'screenshots');

/** Every place the app authoritatively states a shortcut: the command manifest's
 *  `display` strings plus the keyboard-shortcuts reference. A declared shortcut
 *  must match one of these — it can't invent a chord. */
function shortcutAuthority(): string {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    commands?: { display?: string }[];
  };
  const displays = (manifest.commands ?? []).map((c) => c.display ?? '').join('\n');
  const doc = readFileSync(shortcutsDocPath, 'utf8');
  return `${displays}\n${doc}`;
}

const atomFiles = readdirSync(featuresDir).filter((f) => f.endsWith('.md'));
const authority = shortcutAuthority();

describe('content atoms — facts validated against the app', () => {
  it('discovers at least the seeded atoms', () => {
    expect(atomFiles.length).toBeGreaterThanOrEqual(1);
  });

  for (const file of atomFiles) {
    describe(file, () => {
      const { front, sections } = parseAtom(readFileSync(path.join(featuresDir, file), 'utf8'));
      const allBody = Object.values(sections).join('\n');

      it('belongs to a known category and has a summary', () => {
        expect(KNOWN_CATEGORIES as readonly string[], `${file}: category "${front.category}" unknown`).toContain(
          front.category,
        );
        expect((front.summary ?? '').trim().length, `${file}: missing summary`).toBeGreaterThan(0);
        expect((front.summary ?? '').length, `${file}: summary too long for a card/meta`).toBeLessThanOrEqual(200);
      });

      it('has the required audience sections and only known sections', () => {
        for (const s of REQUIRED_SECTIONS) {
          expect(sections[s], `${file}: missing [${s}] section`).toBeTruthy();
        }
        expect(sections['developer'], `${file}: atoms must not carry a [developer] section`).toBeUndefined();
        for (const name of Object.keys(sections)) {
          expect(KNOWN_SECTIONS as readonly string[], `${file}: unknown section [${name}]`).toContain(name);
        }
      });

      it('every declared shortcut matches an authoritative app source', () => {
        for (const s of front.shortcuts ?? []) {
          expect(
            authority,
            `${file}: shortcut "${s.keys}" (${s.id}) not found in the command manifest or keyboard-shortcuts.md`,
          ).toContain(s.keys);
        }
      });

      it('no forbidden phrase appears in any section (drift guard)', () => {
        const lower = allBody.toLowerCase();
        for (const phrase of front.forbidden ?? []) {
          expect(lower, `${file}: forbidden phrase "${phrase}" leaked into the content`).not.toContain(
            phrase.toLowerCase(),
          );
        }
      });

      it('every referenced screenshot exists', () => {
        for (const shot of front.screenshots ?? []) {
          expect(existsSync(path.join(screenshotsDir, shot)), `${file}: missing screenshot ${shot}`).toBe(true);
        }
      });

      it('every {{shortcut:id}} token resolves to a declared shortcut', () => {
        const ids = new Set((front.shortcuts ?? []).map((s) => s.id));
        for (const m of allBody.matchAll(/\{\{shortcut:([a-z0-9-]+)\}\}/gi)) {
          expect(ids.has(m[1]), `${file}: unresolved token {{shortcut:${m[1]}}}`).toBe(true);
        }
      });
    });
  }
});
