// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { clearMockInvokeHandlers, registerDefaultHandlers } from '@/test/tauri-mock';
import { AddEditServerDialog, type CatalogPrefill } from '@/components/settings/McpServersSettings';

const UNTRUSTED_PREFILL: CatalogPrefill = {
  name: 'Filesystem',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  env: [],
  transport: 'stdio',
  url: null,
  untrusted: true,
};

const TRUSTED_PREFILL: CatalogPrefill = {
  ...UNTRUSTED_PREFILL,
  untrusted: false,
};

beforeEach(() => {
  clearMockInvokeHandlers();
  registerDefaultHandlers();
});

describe('AddEditServerDialog deep-link consent gate', () => {
  it('shows a warning and disables Test/Add until the source is acknowledged', () => {
    renderWithProviders(
      <AddEditServerDialog open onOpenChange={() => {}} prefill={UNTRUSTED_PREFILL} />
    );

    expect(screen.getByText('Requested by an external link')).toBeTruthy();

    const testBtn = screen.getByRole('button', { name: /test/i }) as HTMLButtonElement;
    const addBtn = screen.getByRole('button', { name: /add server/i }) as HTMLButtonElement;
    expect(testBtn.disabled).toBe(true);
    expect(addBtn.disabled).toBe(true);

    // Tick the acknowledgement checkbox.
    fireEvent.click(screen.getByRole('checkbox'));

    expect((screen.getByRole('button', { name: /test/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /add server/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not gate a trusted (catalog/manual) prefill', () => {
    renderWithProviders(
      <AddEditServerDialog open onOpenChange={() => {}} prefill={TRUSTED_PREFILL} />
    );

    expect(screen.queryByText('Requested by an external link')).toBeNull();
    expect((screen.getByRole('button', { name: /test/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /add server/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
