// @vitest-environment jsdom
//
// Task #23 — scope-aware active-tab auto-attach. Red-team TDD: the pre-fix
// behaviour was to auto-attach the active editor tab's file path as a chat
// context item regardless of scope, silently leaking Project B paths into a
// Project A-scoped chat. These tests codify the invariant: out-of-scope tabs
// are NOT auto-attached; instead an `explicitAttachOffer` surfaces so the
// user can opt in.

import { describe, it, expect, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';

import { useChatContext } from '@/hooks/useChatContext';
import { useChatStore } from '@/stores/chat-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';

function seedActiveConversation(projectPaths: string[]) {
  const conv = {
    id: 'conv-test',
    title: 'Test',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPaths,
    segments: [],
    activeSegmentIndex: 0,
    pendingProjectSwitch: null,
    activeLeafId: null,
  };
  useChatStore.setState({
    conversations: [conv],
    activeConversationId: 'conv-test',
  });
}

function seedActiveTab(filePath: string, fileName: string) {
  useEditorStore.setState({
    tabs: [
      {
        id: 'tab-1',
        filePath,
        fileName,
        content: '',
        originalContent: '',
        dirty: false,
      // The EditorTab shape has more fields than we use here; casting keeps
      // this test helper narrow while the store happily accepts the extras.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
    activeTabId: 'tab-1',
  });
}

function resetAll() {
  useChatStore.setState({ conversations: [], activeConversationId: null });
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useSettingsStore.setState({ notesRootPath: '', homeDir: null });
}

describe('useChatContext — scope-aware auto-attach (Task #23)', () => {
  beforeEach(() => {
    resetAll();
  });

  it('does NOT auto-attach an active tab that lives outside selected projects', () => {
    // Red-team seed: the attack scenario from the task file.
    // Active tab is in Project B, but the chat is scoped to Project A.
    seedActiveTab('/workspace/project-B/secrets.md', 'secrets.md');
    seedActiveConversation(['/workspace/project-A']);

    const { result } = renderHook(() => useChatContext());

    // Attack invariant: the leaking path MUST NOT appear as an attached
    // context item. Pre-fix, items included this path unconditionally.
    expect(result.current.contextItems).toHaveLength(0);
    expect(result.current.attachedFilePaths).not.toContain('/workspace/project-B/secrets.md');

    // Positive side of the contract: the offer surface exposes the path
    // so the user can consciously opt in. UI renders "Add this file to chat".
    expect(result.current.explicitAttachOffer).toEqual({
      path: '/workspace/project-B/secrets.md',
      label: 'secrets.md',
    });
  });

  it('auto-attaches an active tab that lives inside a selected project', () => {
    seedActiveTab('/workspace/project-A/notes.md', 'notes.md');
    seedActiveConversation(['/workspace/project-A']);

    const { result } = renderHook(() => useChatContext());

    expect(result.current.contextItems).toHaveLength(1);
    expect(result.current.contextItems[0].path).toBe('/workspace/project-A/notes.md');
    expect(result.current.attachedFilePaths).toContain('/workspace/project-A/notes.md');
    expect(result.current.explicitAttachOffer).toBeNull();
  });

  it('treats the notes root as in-scope (matches #16/#17 policy)', () => {
    useSettingsStore.setState({ notesRootPath: '/Users/me/Notesage', homeDir: '/Users/me' });
    seedActiveTab('/Users/me/Notesage/quick.md', 'quick.md');
    seedActiveConversation([]); // no projects selected — only notes root contributes

    const { result } = renderHook(() => useChatContext());

    expect(result.current.contextItems).toHaveLength(1);
    expect(result.current.attachedFilePaths).toContain('/Users/me/Notesage/quick.md');
  });

  it('resolves a `~/Notesage` notes root against homeDir', () => {
    useSettingsStore.setState({ notesRootPath: '~/Notesage', homeDir: '/Users/me' });
    seedActiveTab('/Users/me/Notesage/ideas.md', 'ideas.md');
    seedActiveConversation([]);

    const { result } = renderHook(() => useChatContext());

    expect(result.current.attachedFilePaths).toContain('/Users/me/Notesage/ideas.md');
  });

  it('empty scope with no notes root does NOT auto-attach', () => {
    // Matches the #8/#16/#17 policy: empty selectedProjectPaths does not
    // silently allow everything.
    seedActiveTab('/tmp/random-note.md', 'random-note.md');
    seedActiveConversation([]);

    const { result } = renderHook(() => useChatContext());

    expect(result.current.contextItems).toHaveLength(0);
    expect(result.current.explicitAttachOffer?.path).toBe('/tmp/random-note.md');
  });

  it('honours explicit attach for out-of-scope files (user opted in)', () => {
    seedActiveTab('/workspace/project-B/secrets.md', 'secrets.md');
    seedActiveConversation(['/workspace/project-A']);

    const { result } = renderHook(() => useChatContext());

    expect(result.current.contextItems).toHaveLength(0);
    expect(result.current.explicitAttachOffer).not.toBeNull();

    act(() => {
      result.current.attachExplicit('/workspace/project-B/secrets.md', 'secrets.md');
    });

    expect(result.current.contextItems).toHaveLength(1);
    expect(result.current.attachedFilePaths).toContain('/workspace/project-B/secrets.md');
    // Offer retracts once the file is attached.
    expect(result.current.explicitAttachOffer).toBeNull();
  });

  it('dismissing an auto-attached in-scope tab removes it and surfaces no offer', () => {
    seedActiveTab('/workspace/project-A/notes.md', 'notes.md');
    seedActiveConversation(['/workspace/project-A']);

    const { result } = renderHook(() => useChatContext());
    expect(result.current.contextItems).toHaveLength(1);

    act(() => {
      result.current.dismissItem('/workspace/project-A/notes.md');
    });

    expect(result.current.contextItems).toHaveLength(0);
    // In-scope tab doesn't produce an offer — dismissal is the user's call.
    expect(result.current.explicitAttachOffer).toBeNull();
  });

  it('no active tab → no items and no offer', () => {
    seedActiveConversation(['/workspace/project-A']);

    const { result } = renderHook(() => useChatContext());

    expect(result.current.contextItems).toHaveLength(0);
    expect(result.current.explicitAttachOffer).toBeNull();
  });
});
