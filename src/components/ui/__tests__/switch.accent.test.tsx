// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/component-harness';
import { Switch } from '@/components/ui/switch';

describe('Switch — accent wiring (UI Refresh #6)', () => {
  it('ON state inline backgroundColor falls back through --accent', () => {
    const { container } = renderWithProviders(<Switch checked />);
    const root = container.querySelector('[data-slot="switch"]') as HTMLElement;
    expect(root).toBeTruthy();
    // jsdom doesn't resolve CSS vars; we assert the literal fallback string is present
    // so that wiring --accent flips the Switch without touching this component.
    expect(root.style.backgroundColor).toBe('var(--accent, var(--color-foreground))');
  });

  it('OFF state inline backgroundColor stays neutral border (no accent)', () => {
    const { container } = renderWithProviders(<Switch checked={false} />);
    const root = container.querySelector('[data-slot="switch"]') as HTMLElement;
    expect(root).toBeTruthy();
    // OFF must NOT carry the accent — accent is for affordance, the OFF track is chrome.
    expect(root.style.backgroundColor).toBe('var(--color-border)');
  });
});
