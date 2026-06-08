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

  it('default variant focus ring + border resolve through --color-accent-primary', () => {
    const { container } = renderWithProviders(<Button>Save</Button>);
    const btn = container.querySelector('button[data-slot="button"]')!;
    // Focus ring + border use the same fallback chain so accent extends to keyboard focus.
    expect(btn.className).toContain('focus-visible:ring-[var(--color-accent-primary)]/50');
    expect(btn.className).toContain('focus-visible:border-[var(--color-accent-primary)]');
  });

  it('default variant label uses --color-on-accent (white on accent, macOS-style)', () => {
    const { container } = renderWithProviders(<Button>Save</Button>);
    const btn = container.querySelector('button[data-slot="button"]')!;
    // Label/icon colour must go through --color-on-accent — white on a chromatic
    // accent in BOTH themes (matching the white glyph), NOT
    // --color-primary-foreground, which is dark in dark mode → black-on-accent.
    expect(btn.className).toContain('text-[var(--color-on-accent)]');
    expect(btn.className).not.toContain('text-primary-foreground');
  });

  it('disabled default variant keeps on-accent text (dimmed via opacity, not greyed)', () => {
    const { container } = renderWithProviders(<Button disabled>Next</Button>);
    const btn = container.querySelector('button[data-slot="button"]')!;
    // The shared base sets `disabled:text-muted-foreground` (grey-on-accent =
    // unreadable). The default variant overrides it back to --color-on-accent;
    // tailwind-merge must drop the muted one so the label stays white, dimmed
    // only by `disabled:opacity-70` (macOS-style).
    expect(btn.className).toContain('disabled:text-[var(--color-on-accent)]');
    expect(btn.className).not.toContain('disabled:text-muted-foreground');
    expect(btn.className).toContain('disabled:opacity-70');
  });

  it('disabled destructive variant keeps white text (dimmed via opacity, not greyed)', () => {
    const { container } = renderWithProviders(
      <Button variant="destructive" disabled>Delete</Button>,
    );
    const btn = container.querySelector('button[data-slot="button"]')!;
    // Same grey-on-fill problem as the default variant — keep white, dim via opacity.
    expect(btn.className).toContain('disabled:text-white');
    expect(btn.className).not.toContain('disabled:text-muted-foreground');
    expect(btn.className).toContain('disabled:opacity-70');
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
