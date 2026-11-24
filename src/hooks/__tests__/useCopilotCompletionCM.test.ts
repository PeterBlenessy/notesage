// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { useCopilotCompletionCM } from '@/hooks/useCopilotCompletionCM';
import { useRoutingStore } from '@/stores/routing-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Connection } from '@/lib/ai/connections';

vi.mock('@/components/editor/codemirror-ghost-text', () => ({
  setGhostTextCM: vi.fn(),
  clearGhostTextCM: vi.fn(),
  hasActiveGhostTextCM: vi.fn(() => false),
  ghostTextAcceptCallbackCM: { current: null },
}));

vi.mock('@/lib/copilot-shared', () => ({
  requestCopilotCompletion: vi.fn(),
  notifyCompletionAccepted: vi.fn(),
}));

import {
  setGhostTextCM,
  clearGhostTextCM,
  hasActiveGhostTextCM,
} from '@/components/editor/codemirror-ghost-text';
import { requestCopilotCompletion } from '@/lib/copilot-shared';

const mockSetGhostText = vi.mocked(setGhostTextCM);
const mockClearGhostText = vi.mocked(clearGhostTextCM);
const mockHasActiveGhostText = vi.mocked(hasActiveGhostTextCM);
const mockRequest = vi.mocked(requestCopilotCompletion);

type CompletionResult = Awaited<ReturnType<typeof requestCopilotCompletion>>;

const TAB_ID = 'tab-1';
const FILE = '/project/test.md';

/** A single-line CodeMirror stand-in: the hook only reads doc, selection and focus. */
function makeView(text: string, head: number) {
  const view = {
    hasFocus: true,
    state: {
      doc: {
        toString: () => text,
        lineAt: () => ({ number: 1, from: 0 }),
      },
      selection: { main: { empty: true, head } },
    },
  };
  return view;
}

function asView(view: ReturnType<typeof makeView>): EditorView {
  return view as unknown as EditorView;
}

function setContent(content: string) {
  useEditorStore.setState((s) => ({
    openDocuments: s.openDocuments.map((d) => (d.id === TAB_ID ? { ...d, content } : d)),
  }));
}

/** Change the tab content and let the 150 ms completion timer fire. */
async function typeAndWait(view: ReturnType<typeof makeView>, content: string, head: number) {
  view.state.selection.main.head = head;
  await act(async () => {
    setContent(content);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
}

describe('useCopilotCompletionCM', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const connection: Connection = {
      id: 'conn-copilot-lsp',
      provider: 'github',
      authMethod: 'agent_managed',
      status: 'connected',
      label: 'Copilot LSP',
      credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
      capabilities: ['inline_completion'],
      createdAt: Date.now(),
    };
    useConnectionsStore.setState({ connections: [connection] });
    useRoutingStore.setState({
      routing: {
        interactive: { connectionId: null },
        agent_tasks: { connectionId: null },
        inline_completion: { connectionId: connection.id },
      },
    });
    useEditorStore.setState({
      openDocuments: [
        {
          id: TAB_ID,
          filePath: FILE,
          fileName: 'test.md',
          isDirty: false,
          content: 'Hello',
          frontmatter: null,
          fileType: 'markdown' as const,
          contentLoaded: true,
          viewMode: 'source' as const,
        },
      ],
      activeTabId: TAB_ID,
    });
    useSettingsStore.setState({ inlineCompletionsDisabled: false });
    mockSetGhostText.mockClear();
    mockClearGhostText.mockClear();
    mockHasActiveGhostText.mockReset().mockReturnValue(false);
    mockRequest.mockReset();
    setMockInvokeHandler('copilot_lsp_did_open', () => undefined);
    setMockInvokeHandler('copilot_lsp_did_close', () => undefined);
    setMockInvokeHandler('copilot_lsp_did_focus', () => undefined);
    setMockInvokeHandler('copilot_lsp_did_change', () => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('paints the completion at the caret it was requested for', async () => {
    mockRequest.mockResolvedValue({ text: ' world' });
    const view = makeView('Hello', 5);
    renderHook(() => useCopilotCompletionCM(asView(view)));

    await typeAndWait(view, 'Hello!', 6);

    expect(mockRequest).toHaveBeenCalledWith(FILE, 0, 6, 1);
    expect(mockSetGhostText).toHaveBeenCalledTimes(1);
    expect(mockSetGhostText.mock.calls[0][1]).toMatchObject({ text: ' world', pos: 6 });
  });

  it('discards a slow completion superseded by a newer request', async () => {
    let resolveFirst: (r: CompletionResult) => void = () => {};
    let resolveSecond: (r: CompletionResult) => void = () => {};
    mockRequest
      .mockImplementationOnce(() => new Promise<CompletionResult>((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => new Promise<CompletionResult>((r) => { resolveSecond = r; }));

    const view = makeView('Hello', 5);
    renderHook(() => useCopilotCompletionCM(asView(view)));

    await typeAndWait(view, 'Hello a', 7);
    await typeAndWait(view, 'Hello ab', 8);
    expect(mockRequest).toHaveBeenCalledTimes(2);

    // The newer request answers first, then the stale one lands.
    await act(async () => { resolveSecond({ text: ' fresh' }); });
    await act(async () => { resolveFirst({ text: ' stale' }); });

    expect(mockSetGhostText).toHaveBeenCalledTimes(1);
    expect(mockSetGhostText.mock.calls[0][1]).toMatchObject({ text: ' fresh', pos: 8 });
  });

  it('discards a completion when the caret moved off the request anchor', async () => {
    let resolveFirst: (r: CompletionResult) => void = () => {};
    mockRequest.mockImplementationOnce(
      () => new Promise<CompletionResult>((r) => { resolveFirst = r; }),
    );

    const view = makeView('Hello', 5);
    renderHook(() => useCopilotCompletionCM(asView(view)));

    await typeAndWait(view, 'Hello a', 7);
    // Arrow key: the caret moves, no content change, so no superseding request.
    view.state.selection.main.head = 2;
    await act(async () => { resolveFirst({ text: ' stale' }); });

    expect(mockSetGhostText).not.toHaveBeenCalled();
  });

  it('reacts to the completions setting being toggled', async () => {
    mockRequest.mockResolvedValue({ text: ' world' });
    mockHasActiveGhostText.mockReturnValue(true);
    const view = makeView('Hello', 5);
    renderHook(() => useCopilotCompletionCM(asView(view)));
    mockClearGhostText.mockClear();

    // Turning completions off clears the ghost text that is showing...
    await act(async () => {
      useSettingsStore.setState({ inlineCompletionsDisabled: true });
    });
    expect(mockClearGhostText).toHaveBeenCalledTimes(1);

    // ...and stops new requests.
    await typeAndWait(view, 'Hello a', 7);
    expect(mockRequest).not.toHaveBeenCalled();

    // Turning them back on re-arms the request path.
    await act(async () => {
      useSettingsStore.setState({ inlineCompletionsDisabled: false });
    });
    await typeAndWait(view, 'Hello ab', 8);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
