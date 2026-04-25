// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '@/test/component-harness';
import { SettingsGroup } from '@/components/settings/v2/SettingsGroup';
import { SettingsRow } from '@/components/settings/v2/SettingsRow';

describe('SettingsGroup', () => {
  it('renders the label in uppercase small-caps style', () => {
    renderWithProviders(
      <SettingsGroup label="Theme">
        <SettingsRow label="Color mode" />
      </SettingsGroup>,
    );
    const heading = screen.getByText('Theme');
    expect(heading).toBeTruthy();
    // Uppercase styling applied via Tailwind class
    expect(heading.className).toMatch(/uppercase/);
    expect(heading.tagName).toBe('H3');
  });

  it('renders description below label when provided', () => {
    renderWithProviders(
      <SettingsGroup label="Theme" description="How Notesage looks.">
        <SettingsRow label="Color mode" />
      </SettingsGroup>,
    );
    expect(screen.getByText('How Notesage looks.')).toBeTruthy();
  });

  it('renders children inside a bordered, hairline-divided container', () => {
    renderWithProviders(
      <SettingsGroup label="Theme">
        <SettingsRow label="Row A" />
        <SettingsRow label="Row B" />
        <SettingsRow label="Row C" />
      </SettingsGroup>,
    );

    expect(screen.getByText('Row A')).toBeTruthy();
    expect(screen.getByText('Row B')).toBeTruthy();
    expect(screen.getByText('Row C')).toBeTruthy();

    // The container wrapping rows must carry divide-y so CSS draws hairlines
    // between siblings.
    const container = screen.getByText('Row A').closest(
      '[class*="divide-y"]',
    ) as HTMLElement | null;
    expect(container).not.toBeNull();
    expect(container!.className).toMatch(/divide-y/);
    expect(container!.className).toMatch(/border/);
  });

  it('works without a label', () => {
    renderWithProviders(
      <SettingsGroup>
        <SettingsRow label="Loose row" />
      </SettingsGroup>,
    );
    expect(screen.getByText('Loose row')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Live-test 2026-04-25 #147 — when every row in a group has filtered
  // out under the search query, the empty bordered container should
  // disappear instead of leaving a hollow box on the panel. The
  // group-level filter sits next to the row-level filter on
  // `SettingsRow` so panels migrate without code changes.
  // ------------------------------------------------------------------
  describe('search-driven group hiding', () => {
    it('hides itself when all SettingsRow children filter out', async () => {
      const { SettingsSearchContext } = await import(
        '@/components/settings/v2/SettingsSearch'
      );
      renderWithProviders(
        <SettingsSearchContext.Provider value={{ query: 'xyzzy' }}>
          <SettingsGroup label="Theme">
            <SettingsRow label="Color mode" />
            <SettingsRow label="Accent" />
          </SettingsGroup>
        </SettingsSearchContext.Provider>,
      );
      expect(screen.queryByText('Theme')).toBeNull();
      expect(screen.queryByText('Color mode')).toBeNull();
      expect(screen.queryByText('Accent')).toBeNull();
    });

    it('renders when at least one SettingsRow matches', async () => {
      const { SettingsSearchContext } = await import(
        '@/components/settings/v2/SettingsSearch'
      );
      renderWithProviders(
        <SettingsSearchContext.Provider value={{ query: 'color' }}>
          <SettingsGroup label="Theme">
            <SettingsRow label="Color mode" />
            <SettingsRow label="Accent" />
          </SettingsGroup>
        </SettingsSearchContext.Provider>,
      );
      expect(screen.getByText('Theme')).toBeTruthy();
      expect(screen.getByText('Color mode')).toBeTruthy();
      // The non-matching row is hidden.
      expect(screen.queryByText('Accent')).toBeNull();
    });

    it('does not hide a group with no SettingsRow children at all', async () => {
      // Custom panels may stuff arbitrary JSX inside a group. We don't try
      // to walk that — render so the panel author keeps control.
      const { SettingsSearchContext } = await import(
        '@/components/settings/v2/SettingsSearch'
      );
      renderWithProviders(
        <SettingsSearchContext.Provider value={{ query: 'xyzzy' }}>
          <SettingsGroup label="Custom">
            <div>raw jsx with no SettingsRow</div>
          </SettingsGroup>
        </SettingsSearchContext.Provider>,
      );
      expect(screen.getByText('Custom')).toBeTruthy();
    });
  });
});
