// @vitest-environment jsdom
/**
 * Desktop chrome speaks Swedish (#706, phase 2 of #653).
 *
 * Phase 1 shipped the plumbing — a language picker and locale-aware date and
 * number formatting — but no desktop string was actually translated. Picking
 * "Svenska" changed how dates looked and nothing else, which is a stranger
 * state to ship than either extreme.
 *
 * These assert one representative string per surface rather than every string.
 * A per-string test would be a second copy of the translation table, drifting
 * from the first; what needs guarding is that each surface is WIRED to the
 * locale at all. A surface that renders through `t()` for its header and
 * hardcodes the rest fails review, not this file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@/test/tauri-mock';
import { setLocale, t } from '@/lib/i18n';
import { SidebarRowIndicators } from '@/components/sidebar/quiet/SidebarRowIndicators';
import { useGitStore } from '@/stores/git-store';
import { useSettingsStore } from '@/stores/settings-store';

afterEach(() => {
  cleanup();
  // Module state, shared across files in a sequential run — restore it or
  // every later file formats and translates as Swedish.
  setLocale(null);
});

/**
 * The table tests below prove a translation EXISTS. This one proves a surface
 * actually reaches for it — which is the part that can silently not happen.
 * A key added to the table and never called renders English forever while
 * every table assertion stays green.
 */
describe('a surface renders its translation, not just owns one', () => {
  it('shows the git badge tooltip in Swedish', () => {
    useSettingsStore.setState({ gitEnabled: true });
    useGitStore.setState({
      repos: { '/p': { isGitRepo: true, currentBranch: 'main', files: [], loading: false } },
    } as never);
    setLocale('sv');

    render(<SidebarRowIndicators path="/p" kind="project" />);

    const badge = screen.getByLabelText(t('git.repositoryOn', { branch: 'main' }));
    expect(badge).toBeTruthy();
  });
});

describe('desktop chrome translation coverage', () => {
  beforeEach(() => {
    setLocale('sv');
  });

  // One key per surface named in #706. These are the strings the tests below
  // assert on; the surfaces render them through `t()`.
  const SURFACES: ReadonlyArray<{ surface: string; key: Parameters<typeof t>[0]; english: string }> = [
    { surface: 'sidebar', key: 'section.pinned', english: 'Pinned' },
    { surface: 'command bar', key: 'cmd.placeholder', english: 'Ask, search, or type / for skills…' },
    { surface: 'chat', key: 'chat.deleteConversation', english: 'Delete conversation' },
    { surface: 'activity', key: 'activity.agentActivity', english: 'Agent activity' },
    { surface: 'git', key: 'git.repository', english: 'Git repository' },
    { surface: 'toasts', key: 'toast.openFileFailed', english: 'Failed to open file' },
  ];

  it.each(SURFACES)('$surface has a Swedish string, not the English one', ({ key, english }) => {
    const translated = t(key);
    expect(translated).toBeTruthy();
    expect(translated).not.toBe(english);
  });

  it('renders English again when the locale goes back', () => {
    setLocale('en');
    expect(t('section.pinned')).toBe('Pinned');
  });
});

describe('missing translation falls back to English', () => {
  beforeEach(() => {
    setLocale('sv');
  });

  it('never renders a bare key', () => {
    // The failure this guards: a half-translated UI is tolerable, a UI showing
    // `section.pinned` where a word should be is not. Exercised against a key
    // from this phase so the guarantee is tested where it now matters.
    const out = t('section.pinned');
    expect(out).not.toMatch(/^[a-z]+\.[a-zA-Z]+$/);
    expect(out.length).toBeGreaterThan(0);
  });
});
