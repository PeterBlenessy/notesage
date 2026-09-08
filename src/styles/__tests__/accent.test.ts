// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../..');

/** Every hand-written source file under `src/`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'generated') continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Every custom property the app defines anywhere — in CSS, in a React inline
 * style object (`'--x': value`), or via `setProperty('--x', …)`. A fallback is
 * only safe if its token appears in here.
 */
function definedCustomProperties(): Set<string> {
  const defined = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(--[a-zA-Z0-9-]+)['"`]?\s*:/g)) defined.add(m[1]);
    for (const m of src.matchAll(/setProperty\(\s*['"`](--[a-zA-Z0-9-]+)/g)) defined.add(m[1]);
  }
  return defined;
}

const globals = readFileSync(resolve(__dirname, '../globals.css'), 'utf8');
const editor = readFileSync(resolve(__dirname, '../editor.css'), 'utf8');

describe('CSS accent wiring (UI Refresh #6)', () => {
  it('globals.css defines --color-accent-primary with the --accent fallback chain', () => {
    // The named token is the single source of truth — `var(--accent, var(--color-primary))`
    // is repeated nowhere else in the codebase, so future audits know where to look.
    expect(globals).toMatch(/--color-accent-primary:\s*var\(--accent,\s*var\(--color-primary\)\)/);
  });

  it('--color-accent-primary is defined OUTSIDE @theme to avoid auto-registration', () => {
    // Tailwind v4 auto-creates a `bg-X` utility for every `--color-X` inside @theme.
    // We deliberately put accent-primary outside @theme so it stays an arbitrary-value
    // token (no `bg-accent-primary` collision with the existing neutral --color-accent).
    // `@theme` carries the `static` modifier (`@theme static { … }`) so editor-only
    // tokens aren't tree-shaken from production builds — match either form.
    const themeBlock = globals.match(/@theme(?:\s+static)?\s*\{([\s\S]*?)\n\}/);
    expect(themeBlock).toBeTruthy();
    expect(themeBlock![1]).not.toContain('--color-accent-primary');
  });

  it('never falls back to a custom property that nothing defines', () => {
    // Not style policing — correctness. There is no `--primary` token, yet
    // twelve components spelled `var(--accent, var(--primary))` inline. With no
    // accent class — the DEFAULT — that resolves to an undefined custom
    // property, and a var() that resolves to nothing makes the whole
    // declaration invalid at computed-value time. Verified in Chromium:
    //
    //   box-shadow: 0 0 0 3px var(--accent, var(--primary))   -> computed `none`
    //   background:            var(--accent, var(--primary))  -> transparent
    //   ...same with var(--color-primary)                     -> the grey, as intended
    //
    // So those focus rings, the title bar's dirty dot and the sidebar's drop
    // indicators drew NOTHING on the default accent, rather than the neutral
    // grey the design system promises (#39). Consume `--color-accent-primary`.
    const defined = definedCustomProperties();
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file.includes('__tests__')) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\*|\/\/)/.test(line)) return; // a comment may name the trap
          for (const m of line.matchAll(/var\(\s*--[a-zA-Z0-9-]+\s*,\s*var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g)) {
            if (!defined.has(m[1])) {
              offenders.push(`${file.replace(/.*\/src\//, 'src/')}:${i + 1} falls back to ${m[1]}`);
            }
          }
        });
    }
    expect(offenders, 'A var() fallback naming an undefined token renders nothing at all.').toEqual([]);
  });

  it('editor.css link colour resolves through --color-accent-primary', () => {
    // .ProseMirror a colour must reach the accent token; hover border too.
    const linkBlock = editor.match(/\.ProseMirror a\s*\{([^}]*)\}/);
    expect(linkBlock).toBeTruthy();
    expect(linkBlock![1]).toContain('var(--color-accent-primary)');
  });
});
