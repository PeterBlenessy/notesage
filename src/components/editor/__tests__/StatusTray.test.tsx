// @vitest-environment jsdom

import '@/test/tauri-mock';
import React, { useRef } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  renderWithProviders,
  registerDefaultHandlers,
  fireEvent,
  act,
} from '@/test/component-harness';
import { StatusTray } from '@/components/editor/StatusTray';
import type { Comment } from '@/stores/comment-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useRecordingStore } from '@/stores/recording-store';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Store reset helpers
// ---------------------------------------------------------------------------

function resetStores() {
  useSettingsStore.setState({
    inlineCompletionsDisabled: false,
    toolCallingEnabled: true,
  });
  useRoutingStore.setState({
    routing: {
      interactive: { connectionId: null },
      agent_tasks: { connectionId: null },
      inline_completion: { connectionId: null },
    },
  });
  useConnectionsStore.setState({ connections: [] });
  useLocalAIStore.setState({
    serverStatus: 'stopped',
    activeModelId: null,
    models: [],
  });
  useRecordingStore.setState({
    isRecording: false,
    isDictating: false,
  });
}

function addConnection(partial: Partial<Connection> & Pick<Connection, 'id' | 'provider' | 'authMethod' | 'label'>) {
  const conn: Connection = {
    status: 'connected',
    credentials: { type: 'local_bundled' } as Connection['credentials'],
    capabilities: ['inline_completion'],
    createdAt: Date.now(),
    ...partial,
  } as Connection;
  useConnectionsStore.setState((s) => ({ connections: [...s.connections, conn] }));
  return conn;
}

/**
 * Host component — renders a real anchor element so Radix Popover can position
 * the popover content relative to it. The popover is controlled by `open`.
 */
function TrayHost(props: Omit<React.ComponentProps<typeof StatusTray>, 'anchor'>) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div>
      <div ref={ref} data-testid="anchor" />
      <StatusTray {...props} anchor={ref} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StatusTray — task #53', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetStores();
  });

  it('does not render popover content when open=false', () => {
    renderWithProviders(
      <TrayHost open={false} onOpenChange={() => {}} />,
    );
    expect(document.body.textContent ?? '').not.toContain('Completions');
    expect(document.body.textContent ?? '').not.toContain('Session');
  });

  it('renders the four group headings when open=true', () => {
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Completions');
    expect(text).toContain('Comments');
    expect(text).toContain('Session');
    expect(text).toContain('Help');
  });

  it('renders the completion picker with all four options', () => {
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const group = document.querySelector('[role="radiogroup"]');
    expect(group).toBeTruthy();
    const options = group?.querySelectorAll('[role="radio"]');
    expect(options?.length).toBe(4);
    const labels = Array.from(options ?? []).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Off', 'Copilot', 'Local AI', 'Ollama']);
  });

  it('disables options whose connections are not configured', () => {
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const radios = document.querySelectorAll('[role="radio"]');
    const byLabel: Record<string, HTMLElement> = {};
    radios.forEach((r) => {
      byLabel[r.getAttribute('aria-label') ?? ''] = r as HTMLElement;
    });
    // With no connections, Off is enabled, others are disabled.
    expect((byLabel['Off'] as HTMLButtonElement).disabled).toBe(false);
    expect((byLabel['Copilot'] as HTMLButtonElement).disabled).toBe(true);
    expect((byLabel['Local AI'] as HTMLButtonElement).disabled).toBe(true);
    expect((byLabel['Ollama'] as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks "Off" as active when completions are disabled globally', () => {
    useSettingsStore.setState({ inlineCompletionsDisabled: true });
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const offButton = Array.from(document.querySelectorAll('[role="radio"]')).find(
      (b) => b.getAttribute('aria-label') === 'Off',
    );
    expect(offButton?.getAttribute('aria-checked')).toBe('true');
  });

  it('clicking "Off" flips inlineCompletionsDisabled to true', () => {
    // Start with completions on + Ollama routed, to ensure Off actually changes state.
    const ollama = addConnection({
      id: 'c-ollama',
      provider: 'ollama',
      authMethod: 'local',
      label: 'Ollama',
    });
    useRoutingStore.setState({
      routing: {
        interactive: { connectionId: null },
        agent_tasks: { connectionId: null },
        inline_completion: { connectionId: ollama.id },
      },
    });

    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const offButton = Array.from(document.querySelectorAll('[role="radio"]')).find(
      (b) => b.getAttribute('aria-label') === 'Off',
    ) as HTMLButtonElement;

    expect(useSettingsStore.getState().inlineCompletionsDisabled).toBe(false);
    fireEvent.click(offButton);
    expect(useSettingsStore.getState().inlineCompletionsDisabled).toBe(true);
  });

  it('clicking an available provider routes it and clears the disabled flag', () => {
    const ollama = addConnection({
      id: 'c-ollama',
      provider: 'ollama',
      authMethod: 'local',
      label: 'Ollama',
    });
    useSettingsStore.setState({ inlineCompletionsDisabled: true });

    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const ollamaButton = Array.from(document.querySelectorAll('[role="radio"]')).find(
      (b) => b.getAttribute('aria-label') === 'Ollama',
    ) as HTMLButtonElement;
    expect(ollamaButton.disabled).toBe(false);

    fireEvent.click(ollamaButton);
    expect(useSettingsStore.getState().inlineCompletionsDisabled).toBe(false);
    expect(useRoutingStore.getState().routing.inline_completion.connectionId).toBe(
      ollama.id,
    );
  });

  it('tool calling Switch reflects and toggles settings-store.toolCallingEnabled', () => {
    useSettingsStore.setState({ toolCallingEnabled: true });
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const sw = document.querySelector('#status-tray-tool-calling') as HTMLElement;
    expect(sw).toBeTruthy();
    expect(sw.getAttribute('data-state')).toBe('checked');

    fireEvent.click(sw);
    expect(useSettingsStore.getState().toolCallingEnabled).toBe(false);
  });

  it('shows "Recording…" dot when recording-store.isRecording is true', () => {
    useRecordingStore.setState({ isRecording: true });
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    expect(document.body.textContent ?? '').toContain('Recording\u2026');
  });

  it('shows "Idle" when recording is off', () => {
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    expect(document.body.textContent ?? '').toContain('Idle');
  });

  it('Help → Keyboard shortcuts calls onShortcutsOpen and closes the tray', () => {
    const onShortcutsOpen = vi.fn();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <TrayHost
        open={true}
        onOpenChange={onOpenChange}
        onShortcutsOpen={onShortcutsOpen}
      />,
    );
    const button = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Keyboard shortcuts'),
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(onShortcutsOpen).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('hides the word-count breakdown when wordCount is undefined', () => {
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    expect(document.body.textContent ?? '').not.toContain('min read');
  });

  it('shows "N words · M min read" when wordCount is provided', () => {
    renderWithProviders(
      <TrayHost open={true} onOpenChange={() => {}} wordCount={450} />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('450 words');
    expect(text).toMatch(/min read/);
  });

  it('uses singular "word" for wordCount=1', () => {
    renderWithProviders(
      <TrayHost open={true} onOpenChange={() => {}} wordCount={1} />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/1 word\b/);
  });

  it('Comments group shows open count when there are open comments', () => {
    const comments: Comment[] = [
      {
        id: 'c1',
        documentId: 'd',
        authorId: 'u',
        body: 'open one',
        status: 'open',
        anchor: { from: 0, to: 0, anchorText: '' },
        createdAt: 0,
        updatedAt: 0,
      } as unknown as Comment,
      {
        id: 'c2',
        documentId: 'd',
        authorId: 'u',
        body: 'done one',
        status: 'done',
        anchor: { from: 0, to: 0, anchorText: '' },
        createdAt: 0,
        updatedAt: 0,
      } as unknown as Comment,
    ];
    renderWithProviders(
      <TrayHost open={true} onOpenChange={() => {}} comments={comments} />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('1 open');
    expect(text).toContain('View open comments');
  });

  it('"View open comments" closes the tray and fires a custom event', () => {
    const comments: Comment[] = [
      {
        id: 'c1',
        documentId: 'd',
        authorId: 'u',
        body: 'open',
        status: 'open',
        anchor: { from: 0, to: 0, anchorText: '' },
        createdAt: 0,
        updatedAt: 0,
      } as unknown as Comment,
    ];
    const onOpenChange = vi.fn();
    const listener = vi.fn();
    window.addEventListener('notesage:open-comment-list', listener);

    renderWithProviders(
      <TrayHost
        open={true}
        onOpenChange={onOpenChange}
        comments={comments}
      />,
    );

    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('View open comments'),
    ) as HTMLButtonElement;
    act(() => {
      fireEvent.click(btn);
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener('notesage:open-comment-list', listener);
  });

  it('shows a "Running" indicator for Local AI when a local_bundled connection exists and status=running', () => {
    addConnection({
      id: 'c-local',
      provider: 'local_ai',
      authMethod: 'local_bundled',
      label: 'Local AI',
    });
    useLocalAIStore.setState({
      serverStatus: 'running',
      activeModelId: 'm-1',
      models: [
        {
          id: 'm-1',
          name: 'Qwen 7B',
          size_bytes: 0,
          downloaded: true,
        } as unknown as import('@/lib/tauri').LocalModelInfo,
      ],
    });
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Local AI');
    expect(text).toContain('Running');
  });

  it('omits the Local AI row when there is no local_bundled connection', () => {
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    // "Local AI" appears as a picker label but NOT as a session row label.
    // The picker is in the radiogroup; the session row label includes the
    // word "Running" or "Stopped" after the provider name. With no
    // connection, nothing like "Local AI · Stopped" should render.
    expect(document.body.textContent ?? '').not.toMatch(/Local AI\s*·/);
  });
});
