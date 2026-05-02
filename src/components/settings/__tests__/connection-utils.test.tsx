// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/component-harness';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
} from '@/components/ui/dropdown-menu';
import { PickerItem } from '@/components/ui/picker-item';

/**
 * The previous `ProviderPickerRow` component (added by PR #91) was
 * replaced by the canonical `<PickerItem>` / `<PickerCheckboxItem>`
 * primitives in `src/components/ui/picker-item.tsx`, which compose
 * Radix `DropdownMenuPrimitive.RadioItem` / `CheckboxItem` to get
 * free keyboard nav, ARIA roles, and focus management. This file's
 * tests now exercise the canonical primitive — the visual contract
 * (right-aligned accent-coloured Check icon, no row fill) is the
 * same.
 */

describe('PickerItem — selection indicator prominence', () => {
  it('renders a Check with h-3.5 class and strokeWidth=2.5 when selected', () => {
    renderWithProviders(
      <DropdownMenu open={true}>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="claude">
            <PickerItem value="claude" label="Claude Sonnet" />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const svg = document.querySelector('[data-picker-check]') as SVGElement | null;
    expect(svg, 'Check icon not found').not.toBeNull();
    expect(svg!.classList.contains('h-3.5'), 'Check icon should have h-3.5 class').toBe(true);
    expect(svg!.getAttribute('stroke-width'), 'Check icon should have stroke-width 2.5').toBe('2.5');
  });

  it('does not render the Check when not selected', () => {
    renderWithProviders(
      <DropdownMenu open={true}>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="other">
            <PickerItem value="claude" label="Claude Sonnet" />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const svg = document.querySelector('[data-picker-check]') as SVGElement | null;
    expect(svg, 'Check icon should not render on unselected row').toBeNull();
  });

  it('selected row does NOT apply bg-[var(--color-accent-primary)] fill', () => {
    renderWithProviders(
      <DropdownMenu open={true}>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="claude">
            <PickerItem value="claude" label="Claude Sonnet" />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const row = document.querySelector('[data-slot="picker-item"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    // No chromatic row fill — selection shows ONLY via the Check icon
    expect(row!.className).not.toContain('bg-[var(--color-accent-primary)]');
  });
});
