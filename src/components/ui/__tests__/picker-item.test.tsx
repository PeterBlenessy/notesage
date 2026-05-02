// @vitest-environment jsdom

/**
 * Locks in the visual contract of the canonical `<PickerItem>` /
 * `<PickerCheckboxItem>` primitive. Every picker in the app composes one
 * of these — so this single file is the source-of-truth check that the
 * selection indicator stays the right size, weight, and colour. Replaces
 * the per-consumer source-scan tests (`ChatFooter.checkmark.test.ts`,
 * `ModelSelectionForm.check.test.ts`) that existed when each picker
 * rolled its own inline `<Check>`.
 */

import '@/test/tauri-mock';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/component-harness';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
} from '@/components/ui/dropdown-menu';
import { PickerCheckboxItem, PickerItem } from '@/components/ui/picker-item';

describe('PickerItem — visual contract', () => {
  it('selected row renders a Check with size-3.5 (h-3.5 w-3.5) and strokeWidth=2.5', () => {
    renderWithProviders(
      <DropdownMenu open={true}>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="claude">
            <PickerItem value="claude" label="Claude Sonnet" />
            <PickerItem value="other" label="Other" />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const check = document.querySelector('[data-picker-check]') as SVGElement | null;
    expect(check, 'selection-indicator Check not found on selected row').not.toBeNull();
    expect(check!.classList.contains('h-3.5')).toBe(true);
    expect(check!.classList.contains('w-3.5')).toBe(true);
    expect(check!.getAttribute('stroke-width')).toBe('2.5');
  });

  it('selected row uses --color-accent-primary on the Check icon (not muted-foreground or any chromatic fill)', () => {
    renderWithProviders(
      <DropdownMenu open={true}>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="claude">
            <PickerItem value="claude" label="Claude Sonnet" />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const check = document.querySelector('[data-picker-check]') as SVGElement | null;
    expect(check).not.toBeNull();
    // Tailwind compiles `text-[var(--color-accent-primary)]` literally on the element
    expect(check!.classList.contains('text-[var(--color-accent-primary)]')).toBe(true);
  });

  it('selected row has NO chromatic background fill (selection shows ONLY via Check icon)', () => {
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
    expect(row!.className).not.toContain('bg-[var(--color-accent-primary)]');
    expect(row!.className).not.toContain('text-accent-foreground');
  });

  it('unselected row does NOT render a Check', () => {
    renderWithProviders(
      <DropdownMenu open={true}>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="other">
            <PickerItem value="claude" label="Claude Sonnet" />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(document.querySelector('[data-picker-check]')).toBeNull();
  });
});

describe('PickerCheckboxItem — visual contract', () => {
  it('checked row renders the same selection Check as PickerItem', () => {
    renderWithProviders(
      <DropdownMenu open={true}>
        <DropdownMenuContent>
          <PickerCheckboxItem label="Project A" checked={true} />
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const check = document.querySelector('[data-picker-check]') as SVGElement | null;
    expect(check).not.toBeNull();
    expect(check!.classList.contains('h-3.5')).toBe(true);
    expect(check!.classList.contains('w-3.5')).toBe(true);
    expect(check!.getAttribute('stroke-width')).toBe('2.5');
    expect(check!.classList.contains('text-[var(--color-accent-primary)]')).toBe(true);
  });

  it('unchecked row does NOT render the Check', () => {
    renderWithProviders(
      <DropdownMenu open={true}>
        <DropdownMenuContent>
          <PickerCheckboxItem label="Project A" checked={false} />
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(document.querySelector('[data-picker-check]')).toBeNull();
  });
});
