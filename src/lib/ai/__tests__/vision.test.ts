/**
 * Unit tests for vision.ts — provider vision capability detection and
 * image-to-chat event bus.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  supportsVision,
  registerSendImageHandler,
  unregisterSendImageHandler,
  sendImageToChat,
} from '../vision';
import type { ImageAttachment } from '../types';

// ---------------------------------------------------------------------------
// supportsVision
// ---------------------------------------------------------------------------

describe('supportsVision', () => {
  it('returns true for Anthropic', () => {
    expect(supportsVision({ provider: 'anthropic' })).toBe(true);
  });

  it('returns true for OpenAI', () => {
    expect(supportsVision({ provider: 'openai' })).toBe(true);
  });

  it('returns true for Google', () => {
    expect(supportsVision({ provider: 'google' })).toBe(true);
  });

  it('returns true for OpenAI-compatible', () => {
    expect(supportsVision({ provider: 'openai_compatible' })).toBe(true);
  });

  it('returns false for Ollama without vision flag', () => {
    expect(supportsVision({ provider: 'ollama' })).toBe(false);
  });

  it('returns true for Ollama with vision flag', () => {
    expect(supportsVision({ provider: 'ollama', ollamaSupportsVision: true })).toBe(true);
  });

  it('returns false for Ollama with explicit false vision flag', () => {
    expect(supportsVision({ provider: 'ollama', ollamaSupportsVision: false })).toBe(false);
  });

  it('returns false for local_bundled without vision flag', () => {
    expect(supportsVision({ provider: 'local_bundled' })).toBe(false);
  });

  it('returns true for local_bundled with vision flag', () => {
    expect(supportsVision({ provider: 'local_bundled', localModelSupportsVision: true })).toBe(true);
  });

  it('returns false for agent_managed without flag', () => {
    expect(supportsVision({ provider: 'agent_managed' })).toBe(false);
  });

  it('returns true for agent_managed with flag', () => {
    expect(supportsVision({ provider: 'agent_managed', acpSupportsImages: true })).toBe(true);
  });

  it('returns false for unknown provider', () => {
    expect(supportsVision({ provider: 'unknown' as never })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sendImageToChat event bus
// ---------------------------------------------------------------------------

describe('sendImageToChat event bus', () => {
  const mockAttachment: ImageAttachment = {
    id: 'img-test-1',
    data: 'base64data',
    mimeType: 'image/jpeg',
    width: 800,
    height: 600,
    size: 1234,
  };

  it('delivers attachment to registered handler', () => {
    const handler = vi.fn();
    registerSendImageHandler(handler);

    sendImageToChat(mockAttachment);
    expect(handler).toHaveBeenCalledWith(mockAttachment);

    unregisterSendImageHandler();
  });

  it('does nothing when no handler is registered', () => {
    unregisterSendImageHandler();
    // Should not throw
    expect(() => sendImageToChat(mockAttachment)).not.toThrow();
  });

  it('stops delivering after unregister', () => {
    const handler = vi.fn();
    registerSendImageHandler(handler);
    unregisterSendImageHandler();

    sendImageToChat(mockAttachment);
    expect(handler).not.toHaveBeenCalled();
  });
});
