// @vitest-environment node

/**
 * Stylesheets must arrive through the bundler, not through runtime injection.
 *
 * The shipped CSP refuses inline <style> elements: Tauri appends a nonce to
 * `style-src`, and per the CSP spec a nonce makes the `'unsafe-inline'` in
 * tauri.conf.json inert. Anything injected at runtime is therefore dropped in
 * production while working perfectly in development, where `tauri dev` serves
 * over Vite with no CSP at all — the same blind spot that hid #444.
 *
 * That divergence shipped for three releases: sonner's 24 base rules and
 * Tiptap's ProseMirror base were both being refused, so toasts rendered
 * without their stylesheet and the gap cursor never drew. Nothing failed, no
 * test noticed, and the console message names neither the stylesheet nor its
 * injector.
 *
 * These assertions are cheap and the failure they guard against is silent.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

describe('styles reach production without relying on inline injection', () => {
  it('imports sonner base CSS rather than leaving it to sonner\'s injection', () => {
    expect(read('src/main.tsx')).toContain('sonner/dist/styles.css');
  });

  it('imports sonner CSS before globals.css, which overrides it', () => {
    const main = read('src/main.tsx');
    const sonner = main.indexOf('sonner/dist/styles.css');
    const globals = main.indexOf('@/styles/globals.css');
    expect(sonner).toBeGreaterThan(-1);
    expect(globals).toBeGreaterThan(-1);
    // Both are un-layered, so the later import wins ties. globals.css carries
    // `[data-sonner-toast]` overrides written against sonner's base.
    expect(sonner).toBeLessThan(globals);
  });

  it('turns off Tiptap CSS injection', () => {
    expect(read('src/hooks/useEditor.ts')).toContain('injectCSS: false');
  });

  it('carries the ProseMirror base rules Tiptap would have injected', () => {
    const editor = read('src/styles/editor.css');
    // The ones production was missing: without these the gap cursor never
    // draws and the separator image is not collapsed.
    expect(editor).toContain('.ProseMirror-gapcursor');
    expect(editor).toContain('img.ProseMirror-separator');
    expect(editor).toContain('.ProseMirror-focused .ProseMirror-gapcursor');
    expect(editor).toContain('ProseMirror-cursor-blink');
    expect(editor).toContain('.ProseMirror-hideselection');
  });
});
