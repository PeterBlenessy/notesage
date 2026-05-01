// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/component-harness';
// ProviderPickerRow does not exist yet — this import will fail (RED).
import { ProviderPickerRow } from '@/components/settings/connection-utils';

describe('ProviderPickerRow — selection indicator prominence', () => {
  it('renders a Check with h-3.5 class and strokeWidth=2.5 when selected', () => {
    renderWithProviders(
      <ProviderPickerRow label="Claude Sonnet" isSelected={true} onClick={() => {}} />,
    );

    // The Check icon (lucide) renders as an <svg class="lucide lucide-check ...">
    const svg = document.querySelector('.lucide-check') as SVGElement | null;
    expect(svg, 'Check icon not found').not.toBeNull();
    expect(svg!.classList.contains('h-3.5'), 'Check icon should have h-3.5 class').toBe(true);
    expect(svg!.getAttribute('stroke-width'), 'Check icon should have stroke-width 2.5').toBe('2.5');
  });

  it('renders nothing or no Check when not selected', () => {
    renderWithProviders(
      <ProviderPickerRow label="Claude Sonnet" isSelected={false} onClick={() => {}} />,
    );

    const svg = document.querySelector('.lucide-check') as SVGElement | null;
    // Either no check rendered, or check is hidden (e.g. invisible class)
    if (svg) {
      // If it renders but is hidden, verify it doesn't carry the selected-fill class
      const parent = svg.closest('button');
      expect(parent?.classList.contains('bg-[var(--color-accent-primary)]')).toBe(false);
    }
    // else: no check rendered at all — also valid
  });

  it('selected row does NOT apply bg-[var(--color-accent-primary)] fill', () => {
    renderWithProviders(
      <ProviderPickerRow label="Claude Sonnet" isSelected={true} onClick={() => {}} />,
    );

    const btn = document.querySelector('button') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    // The selected row must not use the chromatic accent fill
    expect(btn!.className).not.toContain('bg-[var(--color-accent-primary)]');
  });
});
