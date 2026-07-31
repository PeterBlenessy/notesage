// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSkillStore } from '@/stores/skill-store';
import { setAvailableCommands, clearSessionInfo } from '@/lib/ai/acp-agent-state';
import SkillMode from '../SkillMode';

// The gap this closes: agent commands were captured from
// `available_commands_update` and stored, but nothing read them — so no command
// the agent offered was reachable, including `/compact`, which is the only
// compaction control an ACP agent has (it owns its own context window).

function seedSkills(names: string[]): void {
  useSkillStore.setState({
    skills: names.map((name) => ({
      name,
      path: `/skills/${name}`,
      description: `${name} skill`,
      source: 'notesage-global',
    })) as never,
    enabledOverrides: {},
  });
}

describe('SkillMode — agent commands', () => {
  beforeEach(() => {
    seedSkills([]);
    clearSessionInfo();
  });

  afterEach(() => {
    clearSessionInfo();
  });

  it('lists commands the connected agent advertises', () => {
    setAvailableCommands([
      { name: 'compact', description: 'Summarize the conversation so far' },
      { name: 'clear', description: 'Clear the session' },
    ]);
    render(<SkillMode filter="" onPick={vi.fn()} />);

    expect(screen.getByText('compact')).toBeTruthy();
    expect(screen.getByText('Summarize the conversation so far')).toBeTruthy();
    expect(screen.getByText('clear')).toBeTruthy();
  });

  it('picking one inserts it, which is what reaches the agent', async () => {
    // `expandSkillPrefix` leaves an unmatched /name untouched, so the command
    // text passes through to the agent verbatim on send.
    const onPick = vi.fn();
    setAvailableCommands([{ name: 'compact', description: 'Compact' }]);
    render(<SkillMode filter="" onPick={onPick} />);

    await userEvent.click(screen.getByText('compact'));
    expect(onPick).toHaveBeenCalledWith('compact');
  });

  it('marks agent commands distinctly from skills', () => {
    // The two execute in different processes — the agent's vs Notesage's — so
    // which one will act must be visible before pressing Enter.
    seedSkills(['summarize']);
    setAvailableCommands([{ name: 'compact', description: 'Compact' }]);
    render(<SkillMode filter="" onPick={vi.fn()} />);

    const options = screen.getAllByRole('option');
    const kinds = options.map((o) => o.getAttribute('data-kind'));
    expect(kinds).toContain('skill');
    expect(kinds).toContain('agent');
  });

  it('filters agent commands by the typed prefix', () => {
    setAvailableCommands([
      { name: 'compact', description: 'Compact' },
      { name: 'clear', description: 'Clear' },
    ]);
    render(<SkillMode filter="comp" onPick={vi.fn()} />);

    expect(screen.getByText('compact')).toBeTruthy();
    expect(screen.queryByText('clear')).toBeNull();
  });

  it('keeps skills first so an agent command cannot steal the Enter target', () => {
    // With both matching, the first row — what Enter fires — must stay the
    // skill the user was reaching for.
    seedSkills(['collect']);
    setAvailableCommands([{ name: 'compact', description: 'Compact' }]);
    render(<SkillMode filter="c" onPick={vi.fn()} />);

    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('data-kind')).toBe('skill');
  });

  it('renders exactly as before when no agent is connected', () => {
    // Regression guard: the overwhelmingly common case must be untouched.
    seedSkills(['summarize', 'translate']);
    render(<SkillMode filter="" onPick={vi.fn()} />);

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options.every((o) => o.getAttribute('data-kind') === 'skill')).toBe(true);
  });

  it('says so when neither a skill nor a command matches', () => {
    setAvailableCommands([{ name: 'compact', description: 'Compact' }]);
    render(<SkillMode filter="zzz" onPick={vi.fn()} />);
    expect(screen.getByText(/no skills or agent commands match/i)).toBeTruthy();
  });

  it('drops the agent list when the session is cleared', () => {
    // Session info is cleared on connection switch / agent stop; a stale
    // command would offer an action the current agent cannot perform.
    setAvailableCommands([{ name: 'compact', description: 'Compact' }]);
    clearSessionInfo();
    render(<SkillMode filter="" onPick={vi.fn()} />);
    expect(screen.queryByText('compact')).toBeNull();
  });
});
