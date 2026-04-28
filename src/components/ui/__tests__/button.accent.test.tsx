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

  it('default variant focus indicator uses accent + foreground fallback (live-test 2026-04-28)', () => {
    const { container } = renderWithProviders(<Button>Save</Button>);
    const btn = container.querySelector('button[data-slot="button"]')!;
    // Focus indicator is a 2px solid outline OUTSIDE the button (offset
    // 2px) using the full outline shorthand. The shorthand is critical:
    // Tailwind v4's `outline-2` only sets width, not style — and the
    // base `outline-none` sets style to `none`, so width-only
    // overrides leave outline-style:none and the indicator is invisible.
    // The arbitrary-value shorthand sets style + width + color together.
    // Color resolves through `--accent` (chromatic when set) with a
    // `--color-foreground` fallback so the indicator stays high-
    // contrast even when no accent class is active.
    expect(btn.className).toContain('focus-visible:[outline:2px_solid_var(--accent,var(--color-foreground))]');
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
