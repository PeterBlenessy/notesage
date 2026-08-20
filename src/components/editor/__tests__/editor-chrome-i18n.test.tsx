// @vitest-environment jsdom
/**
 * Editor chrome speaks Swedish (#708, final phase of #653).
 *
 * Scope note: this covers CHROME — toolbar, bubble menu, find bar. Document
 * content is never translated, which is the whole point of the distinction.
 *
 * Two things specific to this surface:
 *
 * **Keyboard hints must NOT be translated.** `Cmd+B` is the key you press, not
 * prose. A tooltip reading "Fet (Cmd+B)" is right; "Fet (Kommando+B)" would
 * describe a key that does not exist on the keyboard.
 *
 * **aria-labels count.** A Swedish screen-reader user should hear Swedish, not
 * just see it — so the labels are asserted, not only the visible text.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { setLocale, t } from '@/lib/i18n';

afterEach(() => {
  setLocale(null);
});

describe('editor chrome translation', () => {
  it('translates toolbar, bubble menu and find bar', () => {
    setLocale('sv');
    // One representative per surface named in the issue.
    expect(t('editor.bold')).not.toBe('Bold');
    expect(t('editor.improveWithAi')).not.toBe('Improve with AI');
    expect(t('editor.findInDocument')).not.toBe('Find in document');
  });

  it('translates aria-labels, not only visible text', () => {
    setLocale('sv');
    // `editor.findInDocument` and `editor.closeFindBar` are aria-labels — the
    // screen-reader surface, which is easy to leave behind because nobody
    // sees it in a screenshot.
    expect(t('editor.closeFindBar')).not.toBe('Close find bar');
    expect(t('editor.previousMatch')).not.toBe('Previous match');
  });

  it('leaves keyboard hints alone', () => {
    setLocale('sv');
    // The hints live outside the translated string by construction — the
    // component composes `t("editor.bold") + " (Cmd+B)"`. This asserts the
    // translation itself never swallowed one.
    for (const key of ['editor.bold', 'editor.undo', 'editor.replaceAll'] as const) {
      expect(t(key)).not.toMatch(/Cmd|Ctrl|Shift|Enter|Tab/);
    }
  });

  it('falls back to English rather than rendering a bare key', () => {
    setLocale('sv');
    const out = t('editor.blockquote');
    expect(out).not.toMatch(/^editor\./);
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns to English when the language does', () => {
    setLocale('en');
    expect(t('editor.bold')).toBe('Bold');
  });
});
