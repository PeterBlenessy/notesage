// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/component-harness';
import { AgentSwitchCard } from '../AgentSwitchCard';

// Stub the chat store — we only care about the component's render +
// focus contract here, not the resolveAgentSwitch side effect.
const resolveAgentSwitchMock = vi.fn();
vi.mock('@/stores/chat-store', () => ({
  useChatStore: Object.assign(
    vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
      const state = { resolveAgentSwitch: resolveAgentSwitchMock };
      return selector ? selector(state) : state;
    }),
    {
      getState: () => ({ resolveAgentSwitch: resolveAgentSwitchMock }),
    },
  ),
}));

describe('AgentSwitchCard — accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression for keyboard-only walkthrough finding #2 (2026-04-28).
  // Without autofocus, the user is stuck — the chat textarea above
  // the card is `disabled={switchPending}` (so they can't type) AND
  // Tab forward from the textarea bypasses the card (the card is
  // upstream in the chat-stream DOM). Mirror of the PermissionCard
  // pattern that already does this for the Allow button.
  it('moves focus to the "Include history" button on mount', () => {
    render(
      <AgentSwitchCard newAgent="Codex" previousAgent="Claude Code" />,
    );
    const include = screen.getByRole('button', { name: /Include history/i });
    expect(document.activeElement).toBe(include);
  });

  it('renders the unresolved card with role=alert + aria-live=assertive', () => {
    render(
      <AgentSwitchCard newAgent="Codex" previousAgent="Claude Code" />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('renders BOTH buttons reachable via the focus order (Tab walks Include → Start fresh)', () => {
    render(
      <AgentSwitchCard newAgent="Codex" previousAgent="Claude Code" />,
    );
    expect(
      screen.getByRole('button', { name: /Include history/i }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: /Start fresh/i }),
    ).toBeDefined();
  });

  it('does NOT auto-focus when rendered in the resolved (read-only) state', () => {
    // Resolved cards render no buttons — they're a chrome label
    // ("Switched to X"). Autofocus on a state with no focusable
    // target would silently no-op, but verify we don't accidentally
    // pull focus to some other element either.
    const previousFocus = document.body;
    render(
      <AgentSwitchCard
        newAgent="Codex"
        previousAgent="Claude Code"
        resolved={{ historyIncluded: true }}
      />,
    );
    expect(document.activeElement).toBe(previousFocus);
    // No buttons in the resolved state.
    expect(screen.queryByRole('button')).toBeNull();
    // No alert role either — the resolved state is silent chrome.
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
