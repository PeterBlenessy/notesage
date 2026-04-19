// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@/test/component-harness';
import { AcpSessionControls } from '../AcpSessionControls';
import {
  clearSessionInfo,
  setSessionModes,
} from '@/lib/ai/acp-agent-state';
import type { Connection } from '@/lib/ai/connections';

// The component reads the current connection ID from the connections store only
// when handling mode-conflict dialog actions (not during render). Stub it with
// an empty-connections snapshot so `useConnectionsStore.getState()` calls inside
// conflict handlers don't blow up if accidentally invoked from a test.
vi.mock('@/stores/connections-store', () => ({
  useConnectionsStore: Object.assign(
    vi.fn((selector: (s: { connections: Connection[] }) => unknown) =>
      selector({ connections: [] }),
    ),
    { getState: () => ({ connections: [], updateConnection: vi.fn() }) },
  ),
}));

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-test',
    provider: 'anthropic',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'Test',
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
    capabilities: ['interactive'],
    createdAt: Date.now(),
    ...overrides,
  };
}

// Capability fixtures — modeled on the real probe output per agent
const CLAUDE_CAPS = {
  availableModes: [
    { id: 'default', name: 'Default' },
    { id: 'acceptEdits', name: 'Accept Edits' },
    { id: 'plan', name: 'Plan' },
    { id: 'bypassPermissions', name: 'Bypass Permissions' },
  ],
  configOptions: [],
};

const CODEX_CAPS = {
  availableModes: [
    { id: 'read-only', name: 'Read Only' },
    { id: 'auto', name: 'Auto' },
    { id: 'full-access', name: 'Full Access' },
  ],
  configOptions: [
    {
      id: 'reasoning_effort',
      name: 'Reasoning Effort',
      category: 'thought_level',
      currentValue: 'medium',
      options: [
        { value: 'minimal', name: 'minimal' },
        { value: 'low', name: 'low' },
        { value: 'medium', name: 'medium' },
        { value: 'high', name: 'high' },
      ],
    },
  ],
};

const COPILOT_CAPS = {
  availableModes: [
    { id: 'https://agentclientprotocol.com/protocol/session-modes#agent', name: 'Agent' },
    { id: 'https://agentclientprotocol.com/protocol/session-modes#plan', name: 'Plan' },
    { id: 'https://agentclientprotocol.com/protocol/session-modes#autopilot', name: 'Autopilot' },
  ],
  configOptions: [],
};

describe('AcpSessionControls — capability source of truth', () => {
  beforeEach(() => {
    clearSessionInfo();
  });

  it('returns null when no connection is supplied', () => {
    const { container } = render(
      <AcpSessionControls showModePicker={true} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the mode picker from connection capabilities (no live session needed)', () => {
    // No session exists yet — the mode picker must still populate from
    // connection.acpCapabilities, otherwise the footer would be empty until the
    // user sends a first message.
    const conn = makeConnection({ acpCapabilities: CLAUDE_CAPS });
    render(<AcpSessionControls showModePicker={true} connection={conn} />);

    // Claude's 4 modes map to all 4 common modes (Read Only, Agent, Plan, Full Access).
    // The picker trigger shows the currently-selected label — defaults to the
    // first common mode since no acpDefaults / live sessionInfo are set.
    expect(screen.getByRole('button', { name: /read only/i })).toBeDefined();
  });

  it('updates picker contents instantly when the connection prop changes', () => {
    // This is the core UX fix: switching agents populates the picker from
    // connection.acpCapabilities immediately, with no wait for session/new.
    const claude = makeConnection({ id: 'claude', acpCapabilities: CLAUDE_CAPS });
    const codex = makeConnection({ id: 'codex', acpCapabilities: CODEX_CAPS });

    const { rerender } = render(
      <AcpSessionControls showModePicker={true} connection={claude} />,
    );

    // Switch to Codex — the reasoning-effort picker only exists on Codex,
    // so finding it post-rerender proves the connection capabilities flowed
    // through without a session round-trip.
    rerender(<AcpSessionControls showModePicker={true} connection={codex} />);

    // Codex's thinking-effort picker uses a 1-char abbreviation (M for medium);
    // its aria-label comes from the button's text content. We assert the
    // Reasoning Effort picker's current value is visible.
    expect(screen.getByRole('button', { name: /^m/i })).toBeDefined();
  });

  it('hides the mode picker when fewer than 2 common modes are available', () => {
    // A connection with only one mapped common mode (just "default" → read_only)
    // — not enough variety to warrant a picker. But the config picker for
    // reasoning effort should still render.
    const conn = makeConnection({
      acpCapabilities: {
        availableModes: [{ id: 'default', name: 'Default' }],
        configOptions: CODEX_CAPS.configOptions,
      },
    });
    render(<AcpSessionControls showModePicker={true} connection={conn} />);

    // No "Read Only" / "Agent" / "Plan" / "Full Access" mode buttons at top
    // level — but the reasoning effort picker is present.
    expect(screen.queryByRole('button', { name: /read only/i })).toBeNull();
    // The M (medium) picker should be there.
    expect(screen.getByRole('button', { name: /^m/i })).toBeDefined();
  });

  it('filters config options with category=mode or category=model', () => {
    // Agents sometimes report modes/models via configOptions — the dedicated
    // mode/model pickers handle those, so the ConfigOptionPicker list must
    // exclude them to prevent duplicate UI.
    const conn = makeConnection({
      acpCapabilities: {
        availableModes: CODEX_CAPS.availableModes,
        configOptions: [
          ...CODEX_CAPS.configOptions,
          { id: 'model', name: 'Model', category: 'model', currentValue: 'gpt-5' },
          { id: 'session_mode', name: 'Mode', category: 'mode', currentValue: 'auto' },
        ],
      },
    });
    render(<AcpSessionControls showModePicker={true} connection={conn} />);

    // Only the reasoning effort picker should appear (M trigger). The model/mode
    // duplicate config options are filtered out — the mode picker above renders
    // those separately.
    expect(screen.queryByRole('button', { name: /gpt-5/i })).toBeNull();
  });

  it('respects showModePicker=false even when modes are available', () => {
    const conn = makeConnection({
      acpCapabilities: {
        availableModes: CLAUDE_CAPS.availableModes,
        configOptions: CODEX_CAPS.configOptions,
      },
    });
    render(<AcpSessionControls showModePicker={false} connection={conn} />);

    // Mode picker (Shield icon + common-mode label) must not be rendered
    // when the user has opted out via Settings > Advanced.
    expect(screen.queryByRole('button', { name: /read only/i })).toBeNull();
    // But config pickers are still visible.
    expect(screen.getByRole('button', { name: /^m/i })).toBeDefined();
  });

  it('returns null when no controls to show (no modes, no config, no usage)', () => {
    const conn = makeConnection({
      acpCapabilities: { availableModes: [], configOptions: [] },
    });
    const { container } = render(
      <AcpSessionControls showModePicker={true} connection={conn} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('prefers live sessionInfo.modes for current-mode highlight over acpDefaults', () => {
    // If a session is live, its currentModeId wins — `acpDefaults` is a
    // fallback for use between connection-add and first-session. This lock
    // ensures the live-session case is wired up correctly.
    const conn = makeConnection({
      acpCapabilities: CLAUDE_CAPS,
      acpDefaults: { modeId: 'default' }, // Read Only
    });

    setSessionModes({
      currentModeId: 'acceptEdits', // Agent
      availableModes: CLAUDE_CAPS.availableModes,
    });

    render(<AcpSessionControls showModePicker={true} connection={conn} />);

    // Live session's "acceptEdits" → "Agent" wins over acpDefaults' "default".
    expect(screen.getByRole('button', { name: /^agent/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^read only$/i })).toBeNull();
  });

  it('falls back to acpDefaults.modeId when no live session is set', () => {
    const conn = makeConnection({
      acpCapabilities: CLAUDE_CAPS,
      acpDefaults: { modeId: 'plan' },
    });
    // Note: we intentionally do NOT call setSessionModes here — this simulates
    // the post-switch, pre-first-send state that used to leave the picker
    // showing stale values from the previous agent.
    render(<AcpSessionControls showModePicker={true} connection={conn} />);

    // acpDefaults.modeId = "plan" → common key "plan" → display "Plan"
    expect(screen.getByRole('button', { name: /^plan/i })).toBeDefined();
  });

  it('renders Copilot’s 3 URL-style modes (no stale count from prior agent)', () => {
    // Regression lock for 2026-04-19 report: switching Claude (4 modes) →
    // Copilot (3 modes) used to show 4 stale options until send. Now the
    // picker trigger shows the right common-mode label immediately.
    const copilot = makeConnection({ id: 'copilot', acpCapabilities: COPILOT_CAPS });

    render(<AcpSessionControls showModePicker={true} connection={copilot} />);

    // Copilot's "agent" URL maps to common mode "Agent" (its working default).
    // The picker defaults to the first common mode.
    expect(screen.getByRole('button', { name: /^agent/i })).toBeDefined();
  });
});
