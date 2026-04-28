// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, afterEach } from 'vitest';
import { renderWithProviders } from '@/test/component-harness';
import { Button } from '@/components/ui/button';

const ACCENT_TOKEN = 'var(--color-accent-primary)';

describe('Button — accent wiring (UI Refresh #6)', () => {
  afterEach(() => {
    document.documentElement.className = '';
  });

  it('default variant resolves background through --color-accent-primary', () => {
    const { container } = renderWithProviders(<Button>Save</Button>);
    const btn = container.querySelector('button[data-slot="button"]')!;
    expect(btn).toBeTruthy();
    // The default variant must reach the named accent token (not bg-primary directly),
    // so flipping --accent flips the whole primary-affordance pathway in one place.
    expect(btn.className).toContain(`bg-[${ACCENT_TOKEN}]`);
    // Hover uses color-mix to mimic the previous bg-primary/90 darkening.
    expect(btn.className).toContain('hover:bg-[color-mix(in_oklab,var(--color-accent-primary),black_10%)]');
  });

  it('default variant focus indicator is a 1px accent outline (live-test 2026-04-28 iter-5)', () => {
    const { container } = renderWithProviders(<Button>Save</Button>);
    const btn = container.querySelector('button[data-slot="button"]')!;
    // 1px solid outline through `--color-accent-primary`. Per user
    // direction: always accent (no foreground fallback), 1px
    // (2px read as too thick), full outline shorthand because
    // Tailwind v4's `outline-N` only sets width, not style.
    // When no accent class is set, `--color-accent-primary`
    // resolves to `--color-primary` per the design-system
    // fallback chain.
    expect(btn.className).toContain('focus-visible:[outline:1px_solid_var(--color-accent-primary)]');
    expect(btn.className).toContain('focus-visible:[outline-offset:2px]');
  });

  it('link variant text resolves through --color-accent-primary', () => {
    const { container } = renderWithProviders(<Button variant="link">Open</Button>);
    const btn = container.querySelector('button[data-slot="button"]')!;
    expect(btn.className).toContain(`text-[${ACCENT_TOKEN}]`);
  });

  it('does not throw when accent class is set on <html>', () => {
    document.documentElement.classList.add('accent-orange');
    const { container } = renderWithProviders(<Button>Save</Button>);
    const btn = container.querySelector('button[data-slot="button"]')!;
    expect(btn).toBeTruthy();
    // The class string is unchanged — the accent fallback is purely a CSS resolution concern.
    expect(btn.className).toContain(`bg-[${ACCENT_TOKEN}]`);
  });

  it('non-accent variants are NOT touched (destructive, secondary, outline, ghost)', () => {
    const cases: Array<'destructive' | 'secondary' | 'outline' | 'ghost'> = [
      'destructive',
      'secondary',
      'outline',
      'ghost',
    ];
    for (const variant of cases) {
      const { container } = renderWithProviders(<Button variant={variant}>X</Button>);
      const btn = container.querySelector('button[data-slot="button"]')!;
      // Non-default, non-link variants must not inherit the accent token.
      expect(btn.className).not.toContain(`bg-[${ACCENT_TOKEN}]`);
      expect(btn.className).not.toContain(`text-[${ACCENT_TOKEN}]`);
    }
  });
});
