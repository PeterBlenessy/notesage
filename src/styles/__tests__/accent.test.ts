// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    const themeBlock = globals.match(/@theme\s*\{([\s\S]*?)\n\}/);
    expect(themeBlock).toBeTruthy();
    expect(themeBlock![1]).not.toContain('--color-accent-primary');
  });

  it('editor.css link colour resolves through --color-accent-primary', () => {
    // .ProseMirror a colour must reach the accent token; hover border too.
    const linkBlock = editor.match(/\.ProseMirror a\s*\{([^}]*)\}/);
    expect(linkBlock).toBeTruthy();
    expect(linkBlock![1]).toContain('var(--color-accent-primary)');
  });
});
