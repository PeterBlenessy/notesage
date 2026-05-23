// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/component-harness';
import { ChatInput } from '../ChatInput';
import type { EditContext } from '../ChatInput';

// Mock hooks used by ChatInput
vi.mock('@/hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    startDictation: vi.fn(),
    stopDictation: vi.fn(),
    isDictating: false,
    interimText: '',
    finalText: '',
  }),
}));

vi.mock('@/stores/skill-store', () => ({
  useSkillStore: vi.fn((selector) =>
    selector({ skills: [], agents: [], agentEnabledOverrides: {} })
  ),
}));

describe('ChatInput — edit context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows editing banner when editContext is provided', () => {
    const editContext: EditContext = { parentId: 'msg-1', originalContent: 'Hello' };
    render(
      <ChatInput
        onSend={vi.fn()}
        editContext={editContext}
        onCancelEdit={vi.fn()}
      />
    );

    expect(screen.getByText('Editing message')).toBeDefined();
  });

  it('does not show editing banner when editContext is null', () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        editContext={null}
        onCancelEdit={vi.fn()}
      />
    );

    expect(screen.queryByText('Editing message')).toBeNull();
  });

  it('pre-fills input with original content when entering edit mode', async () => {
    const editContext: EditContext = { parentId: 'msg-1', originalContent: 'Original text' };
    render(
      <ChatInput
        onSend={vi.fn()}
        editContext={editContext}
        onCancelEdit={vi.fn()}
      />
    );

    await waitFor(() => {
      const textarea = document.querySelector('.chat-input-textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Original text');
    });
  });

  it('clears input and edit context on cancel button click', () => {
    const onCancelEdit = vi.fn();
    const editContext: EditContext = { parentId: 'msg-1', originalContent: 'Hello' };
    render(
      <ChatInput
        onSend={vi.fn()}
        editContext={editContext}
        onCancelEdit={onCancelEdit}
      />
    );

    fireEvent.click(screen.getByTitle('Cancel editing'));
    expect(onCancelEdit).toHaveBeenCalledOnce();
  });

  it('clears edit context on Escape key', async () => {
    const onCancelEdit = vi.fn();
    const editContext: EditContext = { parentId: 'msg-1', originalContent: 'Hello' };
    render(
      <ChatInput
        onSend={vi.fn()}
        editContext={editContext}
        onCancelEdit={onCancelEdit}
      />
    );

    await waitFor(() => {
      const textarea = document.querySelector('.chat-input-textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Hello');
    });

    const textarea = document.querySelector('.chat-input-textarea') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onCancelEdit).toHaveBeenCalledOnce();
  });

  it('editing a different message replaces the current edit context', async () => {
    const editContext1: EditContext = { parentId: 'msg-1', originalContent: 'First' };
    const editContext2: EditContext = { parentId: 'msg-2', originalContent: 'Second' };

    const { rerender } = render(
      <ChatInput
        onSend={vi.fn()}
        editContext={editContext1}
        onCancelEdit={vi.fn()}
      />
    );

    await waitFor(() => {
      const textarea = document.querySelector('.chat-input-textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('First');
    });

    rerender(
      <ChatInput
        onSend={vi.fn()}
        editContext={editContext2}
        onCancelEdit={vi.fn()}
      />
    );

    await waitFor(() => {
      const textarea = document.querySelector('.chat-input-textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Second');
    });
  });
});
