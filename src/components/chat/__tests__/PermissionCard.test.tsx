// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/component-harness';
import { PermissionCard } from '../PermissionCard';
import type { PermissionRequest } from '@/stores/permission-store';

// Silence store side effects — the card calls invoke() and writes to the
// chat store on Allow/Deny. We don't exercise those paths in these a11y
// tests, but we do want any accidental invocation to noop cleanly.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/stores/chat-store', () => ({
  useChatStore: Object.assign(
    vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
      const state = { addMessage: vi.fn() };
      return selector ? selector(state) : state;
    }),
    {
      getState: () => ({
        addMessage: vi.fn(),
      }),
    },
  ),
}));

// The permission store is used both via `useStore(selector)` (for the
// reactive `removeRequest`) and via `getState()` (inside handlers). Mock
// both entry points with a minimal in-memory shape.
const permStoreState = {
  requests: [] as PermissionRequest[],
  removeRequest: vi.fn(),
  allowSession: vi.fn(),
  allowAlways: vi.fn(),
};
vi.mock('@/stores/permission-store', async () => {
  const actual = await vi.importActual<object>('@/stores/permission-store');
  return {
    ...actual,
    usePermissionStore: Object.assign(
      vi.fn((selector?: (s: typeof permStoreState) => unknown) =>
        selector ? selector(permStoreState) : permStoreState,
      ),
      { getState: () => permStoreState },
    ),
  };
});

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: 'req-1',
    instanceId: 'inst-1',
    sessionId: 'sess-1',
    requestId: 'req-1',
    toolKind: 'write_file',
    toolTitle: '',
    toolInput: '/path/to/file.md',
    options: [
      { optionId: 'allow', kind: 'allow', name: 'Allow' },
      { optionId: 'deny', kind: 'reject', name: 'Deny' },
    ],
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('PermissionCard — accessibility (#83)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the outer wrapper with role=alert and aria-live=assertive', () => {
    render(<PermissionCard request={makeRequest()} />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    // Must be labelled by an element so screen readers announce on appearance
    expect(alert.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('aria-labelledby points to an element containing the tool label', () => {
    render(<PermissionCard request={makeRequest({ toolKind: 'write_file' })} />);
    const alert = screen.getByRole('alert');
    const labelId = alert.getAttribute('aria-labelledby')!;
    const labelEl = document.getElementById(labelId);
    expect(labelEl).not.toBeNull();
    // "Editing file" is what formatAcpToolName returns for write_file
    expect(labelEl!.textContent).toContain('Editing file');
  });

  it('moves focus to the Allow button when the card mounts', () => {
    render(<PermissionCard request={makeRequest()} />);
    const allow = screen.getByRole('button', {
      name: /^Allow write_file to /i,
    });
    expect(document.activeElement).toBe(allow);
  });

  it('Allow button has aria-label containing tool kind and tool input', () => {
    render(
      <PermissionCard
        request={makeRequest({ toolKind: 'write_file', toolInput: '/path/to/file.md' })}
      />,
    );
    const allow = screen.getByRole('button', {
      name: 'Allow write_file to /path/to/file.md',
    });
    expect(allow).toBeDefined();
  });

  it('Deny button has aria-label containing tool kind and tool input', () => {
    render(
      <PermissionCard
        request={makeRequest({ toolKind: 'write_file', toolInput: '/path/to/file.md' })}
      />,
    );
    const deny = screen.getByRole('button', {
      name: 'Deny write_file to /path/to/file.md',
    });
    expect(deny).toBeDefined();
  });

  it('bash tool uses the "command" verb in aria-labels', () => {
    render(
      <PermissionCard
        request={makeRequest({ toolKind: 'bash', toolInput: 'git push origin main' })}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Allow bash command git push origin main' }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Deny bash command git push origin main' }),
    ).toBeDefined();
  });

  it('read_file tool uses the "of" preposition in aria-labels', () => {
    render(
      <PermissionCard
        request={makeRequest({ toolKind: 'read_file', toolInput: '/etc/passwd' })}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Allow read_file of /etc/passwd' }),
    ).toBeDefined();
  });

  it('falls back to the formatted label when toolInput is empty', () => {
    render(
      <PermissionCard
        request={makeRequest({ toolKind: 'write_file', toolInput: '' })}
      />,
    );
    // Falls back to `<verb> <formatAcpToolName(kind)>`
    expect(screen.getByRole('button', { name: 'Allow Editing file' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Deny Editing file' })).toBeDefined();
  });

  it('truncates long tool input in aria-label', () => {
    const longPath = '/very/long/path/' + 'x'.repeat(200) + '/file.md';
    render(
      <PermissionCard
        request={makeRequest({ toolKind: 'write_file', toolInput: longPath })}
      />,
    );
    const allow = screen.getByRole('alert').querySelector('button[aria-label^="Allow"]')!;
    const ariaLabel = allow.getAttribute('aria-label')!;
    // 80-char cap + the "Allow write_file to " prefix — total label should be
    // well under the full untruncated length. Ellipsis marks truncation.
    expect(ariaLabel.length).toBeLessThan(longPath.length);
    expect(ariaLabel).toContain('…');
  });

  it('renders a polite live region ready for future countdown announcements', () => {
    const { container } = render(<PermissionCard request={makeRequest()} />);
    const countdown = container.querySelector('[data-permission-countdown]');
    expect(countdown).not.toBeNull();
    expect(countdown!.getAttribute('aria-live')).toBe('polite');
    expect(countdown!.getAttribute('role')).toBe('status');
  });
});
