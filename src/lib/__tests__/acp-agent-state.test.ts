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

describe('getModeLabel — permission-level common mode mapping', () => {
  it('maps default/read-only to Read Only', () => {
    expect(getModeLabel(undefined, 'default', 'Default').name).toBe('Read Only');
    expect(getModeLabel(undefined, 'read-only', 'Read Only').name).toBe('Read Only');
  });

  it('maps acceptEdits/auto/autoEdit to Agent', () => {
    expect(getModeLabel(undefined, 'acceptEdits', 'Accept Edits').name).toBe('Agent');
    expect(getModeLabel(undefined, 'auto', 'Default').name).toBe('Agent');
    expect(getModeLabel(undefined, 'autoEdit', 'Auto Edit').name).toBe('Agent');
  });

  it('maps bypassPermissions/full-access/yolo to Full Access', () => {
    expect(getModeLabel(undefined, 'bypassPermissions', 'Bypass').name).toBe('Full Access');
    expect(getModeLabel(undefined, 'full-access', 'Full Access').name).toBe('Full Access');
    expect(getModeLabel(undefined, 'yolo', 'YOLO').name).toBe('Full Access');
  });

  it('maps plan/architect to Plan', () => {
    expect(getModeLabel(undefined, 'plan', 'Plan').name).toBe('Plan');
    expect(getModeLabel(undefined, 'architect', 'Architect').name).toBe('Plan');
  });

  it('returns native name for unmapped modes', () => {
    expect(getModeLabel(undefined, 'dontAsk', "Don't Ask").name).toBe("Don't Ask");
    expect(getModeLabel(undefined, 'custom', 'Custom').name).toBe('Custom');
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
  it('maps Claude Code modes to permission levels', () => {
    const modes = getCommonModes([
      { id: 'default', name: 'Default' },
      { id: 'acceptEdits', name: 'Accept Edits' },
      { id: 'plan', name: 'Plan Mode' },
      { id: 'dontAsk', name: "Don't Ask" },
      { id: 'bypassPermissions', name: 'Bypass Permissions' },
    ]);
    expect(modes.map(m => m.name)).toEqual(['Read Only', 'Agent', 'Plan', 'Full Access']);
  });

  it('maps Codex modes to permission levels', () => {
    const modes = getCommonModes([
      { id: 'read-only', name: 'Read Only' },
      { id: 'auto', name: 'Default' },
      { id: 'full-access', name: 'Full Access' },
    ]);
    expect(modes.map(m => m.name)).toEqual(['Read Only', 'Agent', 'Full Access']);
  });

  it('maps Gemini modes to permission levels', () => {
    const modes = getCommonModes([
      { id: 'default', name: 'Default' },
      { id: 'autoEdit', name: 'Auto Edit' },
      { id: 'yolo', name: 'YOLO' },
      { id: 'plan', name: 'Plan' },
    ]);
    expect(modes.map(m => m.name)).toEqual(['Read Only', 'Agent', 'Full Access', 'Plan']);
  });

  it('maps Copilot CLI URL-based modes', () => {
    const modes = getCommonModes([
      { id: 'https://agentclientprotocol.com/protocol/session-modes#agent', name: 'Agent' },
      { id: 'https://agentclientprotocol.com/protocol/session-modes#plan', name: 'Plan' },
      { id: 'https://agentclientprotocol.com/protocol/session-modes#autopilot', name: 'Autopilot' },
    ]);
    expect(modes.map(m => m.name)).toEqual(['Agent', 'Plan', 'Full Access']);
  });

  it('deduplicates — first matching mode ID wins per common key', () => {
    const modes = getCommonModes([
      { id: 'default', name: 'Default' },
      { id: 'read-only', name: 'Read Only' }, // also maps to read_only, but already added
    ]);
    expect(modes).toHaveLength(1);
    expect(modes[0].name).toBe('Read Only');
    expect(modes[0].agentModeId).toBe('default'); // first one wins
  });

  it('returns empty for agents with no common modes', () => {
    const modes = getCommonModes([
      { id: 'custom-only', name: 'Custom' },
    ]);
    expect(modes).toHaveLength(0);
  });

  it('getCommonMode returns null for unmapped IDs', () => {
    expect(getCommonMode('dontAsk')).toBeNull();
    expect(getCommonMode('custom-mode')).toBeNull();
  });

  it('getCommonMode returns correct common mode', () => {
    expect(getCommonMode('default')?.key).toBe('read_only');
    expect(getCommonMode('auto')?.key).toBe('agent');
    expect(getCommonMode('full-access')?.key).toBe('full_access');
    expect(getCommonMode('plan')?.key).toBe('plan');
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
