/**
 * Unit tests for the pure model-fit helpers (no Tauri / no store).
 * Covers params parsing, quant extraction, input building, slot-capability
 * gating, verdict sorting, and the summary string.
 */

import { describe, it, expect } from 'vitest';
import {
  parseParamsB,
  extractQuantFromFilename,
  toModelFitInput,
  hasSlotCapability,
  isRecommendedForSlot,
  fitSummary,
  compareByVerdict,
} from '../model-fit';
import type { ModelFitResult, GgufCapabilities } from '@/lib/tauri';

function fit(partial: Partial<ModelFitResult>): ModelFitResult {
  return {
    id: 'm',
    est_ram_bytes: 5_000_000_000,
    fit: 'fits',
    est_tok_per_sec: 20,
    speed: 'fast',
    runnable: true,
    reasons: [],
    ...partial,
  };
}

function caps(partial: Partial<GgufCapabilities>): GgufCapabilities {
  return {
    architecture: 'qwen2',
    context_length: 32768,
    has_fim_tokens: false,
    has_tool_template: false,
    has_thinking: false,
    gguf_version: 3,
    truncated: false,
    ...partial,
  };
}

describe('parseParamsB', () => {
  it('parses B and decimal labels', () => {
    expect(parseParamsB('7B')).toBe(7);
    expect(parseParamsB('1.5B')).toBe(1.5);
    expect(parseParamsB('0.6B')).toBe(0.6);
    expect(parseParamsB('70 B')).toBe(70);
    expect(parseParamsB('qwen2.5-coder-7b')).toBe(7);
  });
  it('converts millions to billions', () => {
    expect(parseParamsB('500M')).toBe(0.5);
  });
  it('returns null on unknown', () => {
    expect(parseParamsB(undefined)).toBeNull();
    expect(parseParamsB('')).toBeNull();
    expect(parseParamsB('large')).toBeNull();
  });
});

describe('extractQuantFromFilename', () => {
  it('pulls quant labels from filenames', () => {
    expect(extractQuantFromFilename('Qwen3-8B-Q4_K_M.gguf')).toBe('Q4_K_M');
    expect(extractQuantFromFilename('model-Q8_0.gguf')).toBe('Q8_0');
    expect(extractQuantFromFilename('x-F16.gguf')).toBe('F16');
  });
  it('returns null when absent', () => {
    expect(extractQuantFromFilename('model.gguf')).toBeNull();
    expect(extractQuantFromFilename(null)).toBeNull();
  });
});

describe('toModelFitInput', () => {
  it('builds an input from full metadata', () => {
    const input = toModelFitInput({
      id: 'qwen3-8b',
      size_bytes: 5_000_000_000,
      parameters: '8B',
      quantization: 'Q4_K_M',
      filename: 'Qwen3-8B-Q4_K_M.gguf',
    });
    expect(input).toEqual({
      id: 'qwen3-8b',
      file_size_bytes: 5_000_000_000,
      params_b: 8,
      active_params_b: null,
      quant: 'Q4_K_M',
    });
  });
  it('falls back to filename quant then default', () => {
    expect(
      toModelFitInput({ id: 'x', size_bytes: 1e9, parameters: '3B', filename: 'x-Q5_K_M.gguf' })?.quant,
    ).toBe('Q5_K_M');
    expect(
      toModelFitInput({ id: 'x', size_bytes: 1e9, parameters: '3B', filename: 'x.gguf' })?.quant,
    ).toBe('Q4_K_M');
  });
  it('returns null when size or params unknown', () => {
    expect(toModelFitInput({ id: 'x', size_bytes: 0, parameters: '7B' })).toBeNull();
    expect(toModelFitInput({ id: 'x', size_bytes: 1e9, parameters: 'unknown' })).toBeNull();
  });
});

describe('hasSlotCapability', () => {
  it('chat needs nothing', () => {
    expect(hasSlotCapability(undefined, 'chat')).toBe(true);
  });
  it('completion needs verified FIM', () => {
    expect(hasSlotCapability(caps({ has_fim_tokens: true }), 'completion')).toBe(true);
    expect(hasSlotCapability(caps({ has_fim_tokens: false }), 'completion')).toBe(false);
    expect(hasSlotCapability(undefined, 'completion')).toBe(false); // unverified → no
  });
  it('agent needs verified tool template', () => {
    expect(hasSlotCapability(caps({ has_tool_template: true }), 'agent')).toBe(true);
    expect(hasSlotCapability(caps({ has_tool_template: false }), 'agent')).toBe(false);
  });
});

describe('isRecommendedForSlot', () => {
  it('requires runnable AND capability', () => {
    expect(isRecommendedForSlot(fit({ runnable: true }), caps({ has_fim_tokens: true }), 'completion')).toBe(true);
    expect(isRecommendedForSlot(fit({ runnable: false }), caps({ has_fim_tokens: true }), 'completion')).toBe(false);
    expect(isRecommendedForSlot(fit({ runnable: true }), caps({ has_fim_tokens: false }), 'completion')).toBe(false);
    expect(isRecommendedForSlot(undefined, caps({ has_fim_tokens: true }), 'completion')).toBe(false);
  });
});

describe('fitSummary', () => {
  it('formats fits / tight with tok/s', () => {
    expect(fitSummary(fit({ fit: 'fits', est_tok_per_sec: 24 }))).toBe('✓ Fits · ~24 tok/s');
    expect(fitSummary(fit({ fit: 'tight', est_tok_per_sec: 5 }))).toBe('~ Tight · ~5 tok/s');
  });
  it('uses the reason for wont-fit', () => {
    expect(fitSummary(fit({ fit: 'wont-fit', runnable: false, reasons: ['Won’t fit — needs ~42 GB, you have 16 GB'] })))
      .toContain('Won');
  });
  it('null when no fit', () => {
    expect(fitSummary(undefined)).toBeNull();
  });
});

describe('compareByVerdict', () => {
  it('runnable first, then tok/s desc', () => {
    const a = { fit: fit({ runnable: true, est_tok_per_sec: 10 }) };
    const b = { fit: fit({ runnable: true, est_tok_per_sec: 30 }) };
    const c = { fit: fit({ runnable: false, est_tok_per_sec: 99 }) };
    const sorted = [c, a, b].sort(compareByVerdict);
    expect(sorted).toEqual([b, a, c]);
  });
  it('treats missing fit as not-runnable', () => {
    const known = { fit: fit({ runnable: true, est_tok_per_sec: 5 }) };
    const unknown = {};
    expect([unknown, known].sort(compareByVerdict)[0]).toBe(known);
  });
});
