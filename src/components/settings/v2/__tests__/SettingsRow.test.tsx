// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '@/test/component-harness';
import { SettingsRow } from '@/components/settings/v2/SettingsRow';

describe('SettingsRow', () => {
  it('renders label alone', () => {
    renderWithProviders(<SettingsRow label="Color mode" />);
    expect(screen.getByText('Color mode')).toBeTruthy();
  });

  it('renders description when provided', () => {
    renderWithProviders(
      <SettingsRow
        label="Color mode"
        description="Choose light, dark, or match the operating system."
      />,
    );
    expect(
      screen.getByText('Choose light, dark, or match the operating system.'),
    ).toBeTruthy();
  });

  it('renders the control slot in the right-aligned column', () => {
    renderWithProviders(
      <SettingsRow
        label="Reduce motion"
        control={<input type="checkbox" data-testid="rm-toggle" />}
      />,
    );
    expect(screen.getByTestId('rm-toggle')).toBeTruthy();
  });

  it('renders controlSublabel under the control', () => {
    renderWithProviders(
      <SettingsRow
        label="Font size"
        control={<input type="range" data-testid="size-slider" />}
        controlSublabel="17 px"
      />,
    );
    expect(screen.getByTestId('size-slider')).toBeTruthy();
    expect(screen.getByText('17 px')).toBeTruthy();
  });

  it('ties label to control via htmlFor when provided', () => {
    renderWithProviders(
      <SettingsRow
        label="Reduce motion"
        htmlFor="reduce-motion"
        control={<input id="reduce-motion" type="checkbox" />}
      />,
    );
    const label = screen.getByText('Reduce motion').closest('label');
    expect(label).toBeTruthy();
    expect(label!.getAttribute('for')).toBe('reduce-motion');
  });

  it('renders label as a non-label span when htmlFor is omitted', () => {
    renderWithProviders(<SettingsRow label="Reduce motion" />);
    const textNode = screen.getByText('Reduce motion');
    // No wrapping <label> means the text sits inside a <span>.
    expect(textNode.closest('label')).toBeNull();
    expect(textNode.tagName).toBe('SPAN');
  });

  it('wires control to description via aria-describedby when both are provided', () => {
    renderWithProviders(
      <SettingsRow
        label="Reduce motion"
        description="Turn off non-essential animations across the app."
        control={<input type="checkbox" data-testid="rm-toggle" />}
      />,
    );
    const control = screen.getByTestId('rm-toggle');
    const describedBy = control.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    // The description paragraph should carry that exact id.
    const desc = document.getElementById(describedBy!);
    expect(desc).not.toBeNull();
    expect(desc!.textContent).toBe(
      'Turn off non-essential animations across the app.',
    );
  });

  it('does not inject aria-describedby when there is no description', () => {
    renderWithProviders(
      <SettingsRow
        label="Reduce motion"
        control={<input type="checkbox" data-testid="rm-toggle" />}
      />,
    );
    const control = screen.getByTestId('rm-toggle');
    expect(control.getAttribute('aria-describedby')).toBeNull();
  });

  it('preserves existing aria-describedby on the control and appends the description id', () => {
    renderWithProviders(
      <SettingsRow
        label="Reduce motion"
        description="Turn off non-essential animations across the app."
        control={
          <input
            type="checkbox"
            data-testid="rm-toggle"
            aria-describedby="external-help"
          />
        }
      />,
    );
    const control = screen.getByTestId('rm-toggle');
    const describedBy = control.getAttribute('aria-describedby') ?? '';
    // Existing id preserved + description id appended.
    expect(describedBy.split(/\s+/)).toContain('external-help');
    const ids = describedBy.split(/\s+/);
    // Locate the description id (the one that actually resolves to a node).
    const descId = ids.find((id) => document.getElementById(id) !== null && id !== 'external-help');
    expect(descId).toBeTruthy();
  });
});
