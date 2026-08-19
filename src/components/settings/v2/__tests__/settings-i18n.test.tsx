// @vitest-environment jsdom
/**
 * Settings speaks Swedish (#707, phase 3 of #653).
 *
 * Two failure modes specific to this surface, neither of which a plain
 * "is the string translated" test would catch:
 *
 * **The nav is a module-level constant.** `NAV` in SettingsDialogV2 is built
 * once at import. A `t()` call placed inside it evaluates then and never
 * again, so the sidebar keeps whichever language happened to be active when
 * the module first loaded — and switching language appears to do nothing,
 * sending you hunting in the translation table rather than at the call site.
 *
 * **Search matches the label text.** `matchesSettingsQuery(item.label, query)`
 * compares against the rendered label, so translating the labels should make
 * search work in Swedish for free — but only if the labels are actually
 * re-evaluated. A frozen nav makes Swedish search silently return nothing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { setLocale, t } from '@/lib/i18n';
import { buildSettingsNav } from '@/components/settings/v2/SettingsDialogV2';
import { matchesSettingsQuery } from '@/components/settings/v2/SettingsSearch';

afterEach(() => {
  setLocale(null);
});

describe('settings navigation', () => {
  it('is translated', () => {
    setLocale('sv');
    const labels = buildSettingsNav().flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain(t('settings.appearance'));
    expect(labels).not.toContain('Appearance');
  });

  it('re-reads the language rather than freezing at import', () => {
    // The guard for the module-level-const trap. If `buildSettingsNav` were a
    // `const NAV = [...]` evaluated once, the second call would still return
    // the first call's language and this fails.
    setLocale('en');
    const english = buildSettingsNav()[0].items[0].label;
    setLocale('sv');
    const swedish = buildSettingsNav()[0].items[0].label;

    expect(english).not.toBe(swedish);
  });
});

describe('settings search', () => {
  it('finds a panel by its Swedish name', () => {
    setLocale('sv');
    const labels = buildSettingsNav().flatMap((g) => g.items.map((i) => i.label));
    const appearance = t('settings.appearance');

    // Search the way the dialog does — against the rendered label.
    const hit = labels.filter((l: string) => matchesSettingsQuery(l, appearance.slice(0, 4)));
    expect(hit).toContain(appearance);
  });

  it('does not match the English name once Swedish is chosen', () => {
    // Not pedantry: if this passed, it would mean the search index is built
    // from hardcoded English strings while the UI renders Swedish — a surface
    // where what you see and what you can search have drifted apart.
    setLocale('sv');
    const labels = buildSettingsNav().flatMap((g) => g.items.map((i) => i.label));
    expect(labels.some((l: string) => matchesSettingsQuery(l, 'Appearance'))).toBe(false);
  });
});
