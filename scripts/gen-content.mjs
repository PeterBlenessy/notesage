#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Single-source content generator (spike).
//
// Reads per-feature "content atoms" (frontmatter facts + audience-marked
// sections) and emits content for the three-tier web journey + the non-web
// channels, with `{{shortcut:id}}` tokens resolved from the facts.
//
// Usage:
//   node scripts/gen-content.mjs content/features/voice.md --target=web
//   node scripts/gen-content.mjs content/features/editor.md --target=deep
//   node scripts/gen-content.mjs content/features/voice.md --target=in-app
//   node scripts/gen-content.mjs content/features/voice.md --target=social
//   node scripts/gen-content.mjs --category=write        # assemble a category page
//
// Tiers: [web] = tier-2 (feature, high-level) · [deep] = tier-3 (deep-dive).
// The web tiers will most likely be consumed by the site framework's content
// layer once the stack is chosen; this script proves the shape + serves the
// non-web targets (in-app, social).
//
// Note: [developer] is intentionally NOT a target. Developer-facing docs live
// in docs/features/*.md and change on the code's cadence — link, don't merge.
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export const TARGETS = ['web', 'deep', 'in-app', 'social'];

/** Split an atom into { front, sections } where sections is keyed by target. */
export function parseAtom(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('atom is missing YAML frontmatter');
  const front = parse(m[1]) ?? {};
  const body = m[2];

  const marks = [];
  const re = /^##\s*\[([a-z-]+)\]\s*$/gim;
  let match;
  while ((match = re.exec(body))) {
    marks.push({ name: match[1], contentStart: re.lastIndex, headStart: match.index });
  }
  const sections = {};
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].headStart : body.length;
    sections[marks[i].name] = body.slice(marks[i].contentStart, end).trim();
  }
  return { front, sections };
}

/** Replace {{shortcut:id}} with the shortcut's keys from the facts block. */
export function resolveTokens(text, front) {
  return text.replace(/\{\{shortcut:([a-z0-9-]+)\}\}/gi, (_, id) => {
    const s = (front.shortcuts ?? []).find((x) => x.id === id);
    if (!s) throw new Error(`unknown shortcut token in body: {{shortcut:${id}}}`);
    return s.keys;
  });
}

/** Render one channel of an atom to a string. */
export function render(raw, target) {
  if (!TARGETS.includes(target)) throw new Error(`unknown target: ${target}`);
  const { front, sections } = parseAtom(raw);
  const section = sections[target];
  if (section == null) throw new Error(`atom has no [${target}] section`);
  return resolveTokens(section, front);
}

/** Assemble a category page: tier-1 intro + tier-2 feature summaries. */
export function renderCategory(slug, { categoriesDir, featuresDir }) {
  const { front: catFront, sections: catSections } = parseAtom(
    readFileSync(path.join(categoriesDir, `${slug}.md`), 'utf8'),
  );
  const intro = catSections['web'] ? resolveTokens(catSections['web'], catFront) : '';

  const feats = readdirSync(featuresDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseAtom(readFileSync(path.join(featuresDir, f), 'utf8')).front)
    .filter((front) => front.category === slug)
    .map((front) => ({
      title: front.title ?? front.feature,
      summary: front.summary ?? '',
      order: front.order ?? 100,
    }))
    .sort((a, b) => a.order - b.order || String(a.title).localeCompare(String(b.title)));

  const list = feats.map((f) => `- **${f.title}** — ${f.summary}`).join('\n');
  return `# ${catFront.title ?? slug}\n\n${intro}\n\n${list}\n`;
}

// CLI entry (only when run directly, not when imported by the test).
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const catArg = args.find((a) => a.startsWith('--category='));

  try {
    if (catArg) {
      const slug = catArg.split('=')[1];
      const content = path.resolve('content');
      process.stdout.write(
        renderCategory(slug, {
          categoriesDir: path.join(content, 'categories'),
          featuresDir: path.join(content, 'features'),
        }),
      );
    } else {
      const file = args.find((a) => !a.startsWith('--'));
      const target = (args.find((a) => a.startsWith('--target=')) ?? '--target=web').split('=')[1];
      if (!file) {
        console.error('usage: gen-content.mjs <atom.md> --target=web|deep|in-app|social  |  --category=<slug>');
        process.exit(1);
      }
      process.stdout.write(render(readFileSync(file, 'utf8'), target) + '\n');
    }
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
