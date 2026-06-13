import { describe, it, expect } from 'vitest';
import {
  recommendToolCallingModel,
  resolveLocalAgentContext,
  LOCAL_AGENT_MIN_CONTEXT,
} from '../local-agent-model';
import type { LocalModelInfo } from '@/lib/tauri';

const GB = 1024 ** 3;

function model(overrides: Partial<LocalModelInfo>): LocalModelInfo {
  return {
    id: 'm', name: 'M', filename: 'm.gguf', size_bytes: GB, ram_required_bytes: GB,
    downloaded: false, description: '', huggingface_url: '', is_custom: false, source: 'catalog',
    supports_fim: false, supports_tool_calling: true, supports_thinking: false, supports_vision: false,
    ...overrides,
  } as LocalModelInfo;
}

describe('recommendToolCallingModel', () => {
  it('returns null when no model supports tool calling', () => {
    expect(recommendToolCallingModel([model({ id: 'a', supports_tool_calling: false })], 16 * GB)).toBeNull();
    expect(recommendToolCallingModel([], 16 * GB)).toBeNull();
  });

  it('never recommends a non-tool-calling model', () => {
    const models = [
      model({ id: 'no-tools', supports_tool_calling: false, downloaded: true, ram_required_bytes: 2 * GB }),
      model({ id: 'tools', supports_tool_calling: true, ram_required_bytes: 6 * GB }),
    ];
    expect(recommendToolCallingModel(models, 16 * GB)).toBe('tools');
  });

  it('prefers a downloaded model that fits over a larger non-downloaded one', () => {
    const models = [
      model({ id: 'big', ram_required_bytes: 12 * GB }),
      model({ id: 'small-downloaded', ram_required_bytes: 5 * GB, downloaded: true }),
    ];
    // 16GB * 0.7 = 11.2GB budget → big (12GB) does not fit; downloaded one wins anyway.
    expect(recommendToolCallingModel(models, 16 * GB)).toBe('small-downloaded');
  });

  it('picks the largest model that fits the RAM budget when none are downloaded', () => {
    const models = [
      model({ id: 'tiny', ram_required_bytes: 3 * GB }),
      model({ id: 'mid', ram_required_bytes: 6 * GB }),
      model({ id: 'huge', ram_required_bytes: 20 * GB }),
    ];
    // 16GB * 0.7 = 11.2GB → mid (6GB) is the largest that fits.
    expect(recommendToolCallingModel(models, 16 * GB)).toBe('mid');
  });

  it('falls back to the smallest model when nothing fits the budget', () => {
    const models = [
      model({ id: 'a', ram_required_bytes: 20 * GB }),
      model({ id: 'b', ram_required_bytes: 32 * GB }),
    ];
    expect(recommendToolCallingModel(models, 8 * GB)).toBe('a');
  });

  it('ignores the RAM budget when total memory is unknown (largest wins)', () => {
    const models = [
      model({ id: 'a', ram_required_bytes: 6 * GB }),
      model({ id: 'b', ram_required_bytes: 12 * GB }),
    ];
    expect(recommendToolCallingModel(models, null)).toBe('b');
  });
});

describe('resolveLocalAgentContext', () => {
  it('floors the chat default (4096) at the agent minimum', () => {
    // 4096 is the store chat default — far too small for OpenCode's ~7.3K-token
    // system prompt. The agent must run with at least the minimum.
    expect(resolveLocalAgentContext(4096)).toBe(LOCAL_AGENT_MIN_CONTEXT);
  });

  it('floors any sub-minimum value at the agent minimum', () => {
    expect(resolveLocalAgentContext(2048)).toBe(LOCAL_AGENT_MIN_CONTEXT);
    expect(resolveLocalAgentContext(0)).toBe(LOCAL_AGENT_MIN_CONTEXT);
    expect(resolveLocalAgentContext(LOCAL_AGENT_MIN_CONTEXT - 1)).toBe(LOCAL_AGENT_MIN_CONTEXT);
  });

  it('honours a larger user-configured context', () => {
    expect(resolveLocalAgentContext(32768)).toBe(32768);
    expect(resolveLocalAgentContext(LOCAL_AGENT_MIN_CONTEXT + 1)).toBe(LOCAL_AGENT_MIN_CONTEXT + 1);
  });

  it('the minimum clears OpenCode\'s agentic system prompt with headroom', () => {
    // The empirical failure was a 7319-token request against a 4096 window.
    // The floor must comfortably exceed that (it does, with ~2x headroom).
    expect(LOCAL_AGENT_MIN_CONTEXT).toBeGreaterThan(7319 * 2);
  });
});
