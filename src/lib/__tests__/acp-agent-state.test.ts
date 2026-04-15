import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSessionInfo,
  setSessionModes,
  setSessionConfigOptions,
  updateCurrentMode,
  updateConfigOptionValue,
  clearSessionInfo,
  subscribeSessionInfo,
  getModeLabel,
} from '../ai/acp-agent-state';

beforeEach(() => {
  clearSessionInfo();
});

describe('getModeLabel', () => {
  it('returns Claude Code labels for known mode IDs', () => {
    const label = getModeLabel('claude-agent-acp', 'code', 'Code');
    expect(label.name).toBe('Edit');
    expect(label.tooltip).toContain('read and modify');
  });

  it('returns native name for non-Claude agents', () => {
    const label = getModeLabel('codex-acp', 'read-only', 'Read Only');
    expect(label.name).toBe('Read Only');
    expect(label.tooltip).toBe('');
  });

  it('returns native name for unknown Claude mode IDs', () => {
    const label = getModeLabel('claude-agent-acp', 'custom-mode', 'Custom Mode');
    expect(label.name).toBe('Custom Mode');
  });

  it('returns native name when agentBinary is undefined', () => {
    const label = getModeLabel(undefined, 'code', 'Code');
    expect(label.name).toBe('Code');
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
      { id: 'thinkingEffort', name: 'Thinking Effort', category: 'thinkingEffort', currentValue: 'default', options: [{ id: 'low', name: 'Low' }, { id: 'default', name: 'Default' }, { id: 'high', name: 'High' }] },
    ]);
    const info = getSessionInfo();
    expect(info.configOptions).toHaveLength(1);
    expect(info.configOptions![0].id).toBe('thinkingEffort');
    expect(info.configOptions![0].currentValue).toBe('default');
  });

  it('updates config option value', () => {
    setSessionConfigOptions([
      { id: 'thinkingEffort', name: 'Thinking Effort', currentValue: 'default', options: [{ id: 'low', name: 'Low' }, { id: 'default', name: 'Default' }] },
      { id: 'other', name: 'Other', currentValue: 'a', options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
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
      { id: 'test', name: 'Test', currentValue: 'a', options: [{ id: 'a', name: 'A' }] },
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
    setSessionConfigOptions([{ id: 'a', name: 'A', currentValue: '1', options: [{ id: '1', name: '1' }] }]);
    expect(callCount).toBe(1);
    updateConfigOptionValue('a', '2');
    expect(callCount).toBe(2);
    unsub();
  });
});
