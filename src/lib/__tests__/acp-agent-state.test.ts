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

describe('getModeLabel — Claude Code mapping', () => {
  it('maps code → Edit for Claude Code agent', () => {
    expect(getModeLabel('claude-agent-acp', 'code', 'Code').name).toBe('Edit');
  });

  it('maps architect → Plan for Claude Code agent', () => {
    expect(getModeLabel('claude-agent-acp', 'architect', 'Architect').name).toBe('Plan');
  });

  it('maps ask → Chat for Claude Code agent', () => {
    expect(getModeLabel('claude-agent-acp', 'ask', 'Ask').name).toBe('Chat');
  });

  it('passes through unknown modes for Claude Code', () => {
    expect(getModeLabel('claude-agent-acp', 'bypassPermissions', 'Bypass Permissions').name).toBe('Bypass Permissions');
  });

  it('passes through all modes for non-Claude agents', () => {
    expect(getModeLabel('codex-acp', 'read-only', 'Read Only').name).toBe('Read Only');
    expect(getModeLabel('gemini', 'yolo', 'YOLO').name).toBe('YOLO');
    expect(getModeLabel('copilot', 'agent', 'Agent').name).toBe('Agent');
  });

  it('handles agent binary with "claude" substring', () => {
    expect(getModeLabel('my-claude-fork', 'code', 'Code').name).toBe('Edit');
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
