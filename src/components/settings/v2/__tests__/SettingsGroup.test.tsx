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
});
