import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSessionInfo,
  setSessionModes,
  setSessionConfigOptions,
  updateCurrentMode,
  updateConfigOptionValue,
  updateUsage,
  setAvailableCommands,
  clearSessionInfo,
  subscribeSessionInfo,
  getModeLabel,
  getCommonModes,
  getCommonMode,
} from '../ai/acp-agent-state';

beforeEach(() => {
  clearSessionInfo();
});

describe('getModeLabel — universal common mode mapping', () => {
  it('maps known mode IDs to common names regardless of agent', () => {
    expect(getModeLabel('claude-agent-acp', 'default', 'Default').name).toBe('Agent');
    expect(getModeLabel('codex-acp', 'auto', 'Default').name).toBe('Agent');
    expect(getModeLabel('gemini', 'default', 'Default').name).toBe('Agent');
  });

  it('maps plan modes to Plan', () => {
    expect(getModeLabel('claude-agent-acp', 'architect', 'Architect').name).toBe('Plan');
    expect(getModeLabel('claude-agent-acp', 'plan', 'Plan Mode').name).toBe('Plan');
  });

  it('maps ask/chat modes to Chat', () => {
    expect(getModeLabel('claude-agent-acp', 'ask', 'Ask').name).toBe('Chat');
  });

  it('returns native name for unmapped modes', () => {
    expect(getModeLabel('claude-agent-acp', 'bypassPermissions', 'Bypass Permissions').name).toBe('Bypass Permissions');
    expect(getModeLabel('gemini', 'yolo', 'YOLO').name).toBe('YOLO');
  });
});

describe('session modes state', () => {
  it('starts with null modes', () => {
    expect(getSessionInfo().modes).toBeNull();
  });

  it('sets modes from session response', () => {
    setSessionModes({
      currentModeId: 'code',
      availableModes: [
        { id: 'code', name: 'Code' },
        { id: 'architect', name: 'Architect' },
        { id: 'ask', name: 'Ask' },
      ],
    });
    const info = getSessionInfo();
    expect(info.modes?.currentModeId).toBe('code');
    expect(info.modes?.availableModes).toHaveLength(3);
  });

  it('updates current mode', () => {
    setSessionModes({
      currentModeId: 'code',
      availableModes: [
        { id: 'code', name: 'Code' },
        { id: 'architect', name: 'Architect' },
      ],
    });
    updateCurrentMode('architect');
    expect(getSessionInfo().modes?.currentModeId).toBe('architect');
  });

  it('ignores updateCurrentMode when no modes set', () => {
    updateCurrentMode('architect');
    expect(getSessionInfo().modes).toBeNull();
  });

  it('clears modes on clearSessionInfo', () => {
    setSessionModes({
      currentModeId: 'code',
      availableModes: [{ id: 'code', name: 'Code' }],
    });
    clearSessionInfo();
    expect(getSessionInfo().modes).toBeNull();
  });
});

describe('session config options state', () => {
  it('starts with null config options', () => {
    expect(getSessionInfo().configOptions).toBeNull();
  });

  it('sets config options from session response', () => {
    setSessionConfigOptions([
      { id: 'thinkingEffort', name: 'Thinking Effort', category: 'thinkingEffort', currentValue: 'default', options: [{ value: 'low', name: 'Low' }, { value: 'default', name: 'Default' }, { value: 'high', name: 'High' }] },
    ]);
    const info = getSessionInfo();
    expect(info.configOptions).toHaveLength(1);
    expect(info.configOptions![0].id).toBe('thinkingEffort');
    expect(info.configOptions![0].currentValue).toBe('default');
  });

  it('updates config option value', () => {
    setSessionConfigOptions([
      { id: 'thinkingEffort', name: 'Thinking Effort', currentValue: 'default', options: [{ value: 'low', name: 'Low' }, { value: 'default', name: 'Default' }] },
      { id: 'other', name: 'Other', currentValue: 'a', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] },
    ]);
    updateConfigOptionValue('thinkingEffort', 'low');
    const info = getSessionInfo();
    expect(info.configOptions![0].currentValue).toBe('low');
    expect(info.configOptions![1].currentValue).toBe('a'); // unchanged
  });

  it('ignores updateConfigOptionValue when no options set', () => {
    updateConfigOptionValue('thinkingEffort', 'low');
    expect(getSessionInfo().configOptions).toBeNull();
  });

  it('clears config options on clearSessionInfo', () => {
    setSessionConfigOptions([
      { id: 'test', name: 'Test', currentValue: 'a', options: [{ value: 'a', name: 'A' }] },
    ]);
    clearSessionInfo();
    expect(getSessionInfo().configOptions).toBeNull();
  });
});

describe('subscription notifications', () => {
  it('notifies listeners on mode change', () => {
    let callCount = 0;
    const unsub = subscribeSessionInfo(() => { callCount++; });
    setSessionModes({ currentModeId: 'code', availableModes: [] });
    expect(callCount).toBe(1);
    updateCurrentMode('ask');
    expect(callCount).toBe(2);
    unsub();
    setSessionModes(null);
    expect(callCount).toBe(2); // no longer subscribed
  });

  it('notifies listeners on config change', () => {
    let callCount = 0;
    const unsub = subscribeSessionInfo(() => { callCount++; });
    setSessionConfigOptions([{ id: 'a', name: 'A', currentValue: '1', options: [{ value: '1', name: '1' }] }]);
    expect(callCount).toBe(1);
    updateConfigOptionValue('a', '2');
    expect(callCount).toBe(2);
    unsub();
  });
});

// ---------------------------------------------------------------------------
// Phase 2B tests
// ---------------------------------------------------------------------------

describe('getCommonModes — filters to Agent/Plan/Chat', () => {
  it('maps Claude Code modes to common modes (actual ACP IDs)', () => {
    const modes = getCommonModes([
      { id: 'default', name: 'Default' },
      { id: 'acceptEdits', name: 'Accept Edits' },
      { id: 'plan', name: 'Plan Mode' },
      { id: 'dontAsk', name: "Don't Ask" },
      { id: 'bypassPermissions', name: 'Bypass Permissions' },
    ]);
    // default → Agent, acceptEdits → Agent (dedup), plan → Plan, others hidden
    expect(modes.map(m => m.name)).toEqual(['Agent', 'Plan']);
  });

  it('maps Gemini modes to common modes', () => {
    const modes = getCommonModes([
      { id: 'default', name: 'Default' },
      { id: 'autoEdit', name: 'Auto Edit' },
      { id: 'yolo', name: 'YOLO' },
      { id: 'plan', name: 'Plan' },
    ]);
    // default → Agent, autoEdit → Agent (dedup), yolo → hidden, plan → Plan
    expect(modes.map(m => m.name)).toEqual(['Agent', 'Plan']);
  });

  it('Codex has only Agent mode (no plan/chat)', () => {
    const modes = getCommonModes([
      { id: 'read-only', name: 'Read Only' },
      { id: 'auto', name: 'Default' },
      { id: 'full-access', name: 'Full Access' },
    ]);
    // read-only → Agent, auto → Agent (dedup), full-access → hidden
    expect(modes.map(m => m.name)).toEqual(['Agent']);
  });

  it('maps Copilot CLI URL-based modes', () => {
    const modes = getCommonModes([
      { id: 'https://agentclientprotocol.com/protocol/session-modes#agent', name: 'Agent' },
      { id: 'https://agentclientprotocol.com/protocol/session-modes#plan', name: 'Plan' },
      { id: 'https://agentclientprotocol.com/protocol/session-modes#autopilot', name: 'Autopilot' },
    ]);
    expect(modes.map(m => m.name)).toEqual(['Agent', 'Plan']);
  });

  it('deduplicates — first matching mode ID wins', () => {
    const modes = getCommonModes([
      { id: 'default', name: 'Default' },
      { id: 'code', name: 'Code' }, // also maps to Agent, but Agent already added
    ]);
    expect(modes).toHaveLength(1);
    expect(modes[0].name).toBe('Agent');
    expect(modes[0].agentModeId).toBe('default'); // first one wins
  });

  it('returns empty for agents with no common modes', () => {
    const modes = getCommonModes([
      { id: 'custom-only', name: 'Custom' },
    ]);
    expect(modes).toHaveLength(0);
  });

  it('getCommonMode returns null for unmapped IDs', () => {
    expect(getCommonMode('yolo')).toBeNull();
    expect(getCommonMode('bypassPermissions')).toBeNull();
    expect(getCommonMode('custom-mode')).toBeNull();
  });

  it('getCommonMode returns common mode for mapped IDs', () => {
    expect(getCommonMode('default')?.key).toBe('agent');
    expect(getCommonMode('plan')?.key).toBe('plan');
    expect(getCommonMode('ask')?.key).toBe('chat');
  });
});

describe('config option value field handling', () => {
  it('uses value field for matching (not id)', () => {
    setSessionConfigOptions([
      {
        id: 'reasoning_effort',
        name: 'Reasoning Effort',
        category: 'thought_level',
        currentValue: 'medium',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
        ],
      },
    ]);
    const info = getSessionInfo();
    expect(info.configOptions![0].currentValue).toBe('medium');

    updateConfigOptionValue('reasoning_effort', 'high');
    expect(getSessionInfo().configOptions![0].currentValue).toBe('high');
  });

  it('filters mode category from config options (avoids duplicate)', () => {
    setSessionConfigOptions([
      { id: 'mode', name: 'Mode', category: 'mode', currentValue: 'default', options: [{ value: 'default', name: 'Default' }] },
      { id: 'model', name: 'Model', category: 'model', currentValue: 'gpt-4', options: [{ value: 'gpt-4', name: 'GPT-4' }] },
      { id: 'effort', name: 'Effort', category: 'thought_level', currentValue: 'medium', options: [{ value: 'medium', name: 'Medium' }] },
    ]);
    const all = getSessionInfo().configOptions!;
    // The component filters mode+model, leaving only thought_level
    const visible = all.filter(opt => opt.category !== 'model' && opt.category !== 'mode');
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('effort');
  });
});

describe('session info lifecycle', () => {
  it('clearSessionInfo resets both modes and configOptions', () => {
    setSessionModes({
      currentModeId: 'code',
      availableModes: [{ id: 'code', name: 'Code' }],
    });
    setSessionConfigOptions([
      { id: 'test', name: 'Test', currentValue: 'a', options: [{ value: 'a', name: 'A' }] },
    ]);

    expect(getSessionInfo().modes).not.toBeNull();
    expect(getSessionInfo().configOptions).not.toBeNull();

    clearSessionInfo();

    expect(getSessionInfo().modes).toBeNull();
    expect(getSessionInfo().configOptions).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 3 tests
// ---------------------------------------------------------------------------

describe('usage tracking', () => {
  it('stores usage data', () => {
    updateUsage({ contextUsed: 4200, contextSize: 200000 });
    const info = getSessionInfo();
    expect(info.usage?.contextUsed).toBe(4200);
    expect(info.usage?.contextSize).toBe(200000);
  });

  it('stores usage with cost', () => {
    updateUsage({ contextUsed: 1000, contextSize: 100000, cost: { amount: 0.03, currency: 'USD' } });
    expect(getSessionInfo().usage?.cost?.amount).toBe(0.03);
  });

  it('clears usage on clearSessionInfo', () => {
    updateUsage({ contextUsed: 500, contextSize: 50000 });
    clearSessionInfo();
    expect(getSessionInfo().usage).toBeNull();
  });
});

describe('agent commands', () => {
  it('stores commands from available_commands_update', () => {
    setAvailableCommands([
      { name: 'compact', description: 'Compact the conversation' },
      { name: 'clear', description: 'Clear conversation history' },
    ]);
    expect(getSessionInfo().commands).toHaveLength(2);
    expect(getSessionInfo().commands[0].name).toBe('compact');
  });

  it('replaces commands on subsequent update', () => {
    setAvailableCommands([{ name: 'old', description: 'Old command' }]);
    setAvailableCommands([{ name: 'new', description: 'New command' }]);
    expect(getSessionInfo().commands).toHaveLength(1);
    expect(getSessionInfo().commands[0].name).toBe('new');
  });

  it('clears commands on clearSessionInfo', () => {
    setAvailableCommands([{ name: 'test', description: 'Test' }]);
    clearSessionInfo();
    expect(getSessionInfo().commands).toHaveLength(0);
  });
});
