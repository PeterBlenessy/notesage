// @vitest-environment jsdom

import '@/test/tauri-mock';
import React, { useRef } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockEditor } from '@/test/mock-editor';
import type { Editor } from '@tiptap/react';
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
    // jsdom doesn't implement scrollIntoView — stub so the task #54
    // deep-link effect doesn't throw under test.
    Element.prototype.scrollIntoView = vi.fn();
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

  // -------------------------------------------------------------------------
  // Local AI status dot — colour reflects server state
  // -------------------------------------------------------------------------
  //
  // User feedback: "local ai dot should be green when running, orange when
  // starting up". The dot lives in the Session group's `LocalAIStatusRow`.
  // We assert via the `data-server-status` data attribute AND the class-list
  // so the test survives Tailwind class ordering tweaks while still
  // pinning the semantic colour mapping.

  function renderTrayWithStatus(status: 'stopped' | 'starting' | 'running' | 'error') {
    addConnection({
      id: 'c-local',
      provider: 'local_ai',
      authMethod: 'local_bundled',
      label: 'Local AI',
    });
    useLocalAIStore.setState({ serverStatus: status });
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    return document.querySelector(
      '[data-testid="local-ai-status-dot"]',
    ) as HTMLElement | null;
  }

  it('Local AI dot is neutral (idle) when the server is stopped', () => {
    const dot = renderTrayWithStatus('stopped');
    expect(dot).toBeTruthy();
    expect(dot?.getAttribute('data-server-status')).toBe('stopped');
    expect(dot?.className).toContain('bg-muted-foreground/30');
    expect(dot?.className).not.toContain('bg-green');
    expect(dot?.className).not.toContain('bg-amber');
    expect(dot?.className).not.toContain('animate-pulse');
  });

  it('Local AI dot is amber and pulsing when the server is starting', () => {
    const dot = renderTrayWithStatus('starting');
    expect(dot).toBeTruthy();
    expect(dot?.getAttribute('data-server-status')).toBe('starting');
    expect(dot?.className).toContain('bg-amber-500');
    expect(dot?.className).toContain('animate-pulse');
    expect(dot?.className).not.toContain('bg-green');
  });

  it('Local AI dot is green when the server is running', () => {
    const dot = renderTrayWithStatus('running');
    expect(dot).toBeTruthy();
    expect(dot?.getAttribute('data-server-status')).toBe('running');
    expect(dot?.className).toContain('bg-green-500');
    expect(dot?.className).not.toContain('bg-amber');
    expect(dot?.className).not.toContain('animate-pulse');
  });

  it('Local AI dot is red when the server reports an error', () => {
    const dot = renderTrayWithStatus('error');
    expect(dot).toBeTruthy();
    expect(dot?.getAttribute('data-server-status')).toBe('error');
    expect(dot?.className).toContain('bg-red-500');
    expect(dot?.className).not.toContain('bg-green');
  });

  // -------------------------------------------------------------------------
  // initialExpandedGroup (task #54)
  // -------------------------------------------------------------------------

  it('focuses the requested group root when opened with initialExpandedGroup="completions"', async () => {
    // Open host starting closed, then flip to open with the prop set. The
    // tray only reacts on the false → true transition, so this mirrors how
    // the dots in `QuietStatusBar` will drive it.
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button data-testid="opener" onClick={() => setOpen(true)}>
            open
          </button>
          <TrayHost
            open={open}
            onOpenChange={setOpen}
            initialExpandedGroup="completions"
          />
        </div>
      );
    }

    renderWithProviders(<Harness />);
    const opener = document.querySelector('[data-testid="opener"]') as HTMLElement;

    // The effect schedules focus/scroll via setTimeout(0) so Radix can
    // mount the popover first. We wait for both the open transition AND
    // the timer to flush.
    await act(async () => {
      fireEvent.click(opener);
      // Flush the microtask queue + setTimeout(0).
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    // The "Completions" label lives inside the targeted group root, so the
    // currently focused element's subtree should contain that text.
    const focused = document.activeElement as HTMLElement | null;
    expect(focused).toBeTruthy();
    expect(focused?.textContent ?? '').toContain('Completions');
  });

  it('calls scrollIntoView on the requested group when opened with initialExpandedGroup', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;

    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button data-testid="opener" onClick={() => setOpen(true)}>
            open
          </button>
          <TrayHost
            open={open}
            onOpenChange={setOpen}
            initialExpandedGroup="session"
          />
        </div>
      );
    }

    renderWithProviders(<Harness />);
    const opener = document.querySelector('[data-testid="opener"]') as HTMLElement;

    await act(async () => {
      fireEvent.click(opener);
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    // The effect calls scrollIntoView on the resolved group ref.
    expect(spy).toHaveBeenCalled();
  });

  it('does not scroll when opened without initialExpandedGroup', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;

    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button data-testid="opener" onClick={() => setOpen(true)}>
            open
          </button>
          <TrayHost open={open} onOpenChange={setOpen} />
        </div>
      );
    }

    renderWithProviders(<Harness />);
    const opener = document.querySelector('[data-testid="opener"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(opener);
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(spy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Editor tools (#110) — MicButton + source-mode toggle
  // -------------------------------------------------------------------------

  it('renders MicButton when editor is provided (#110)', () => {
    const editor = createMockEditor() as unknown as Editor;
    renderWithProviders(
      <TrayHost open={true} onOpenChange={() => {}} editor={editor} />,
    );
    // The Editor tools section is labelled "Editor tools" via aria-label.
    const section = document.querySelector('[aria-label="Editor tools"]');
    expect(section).toBeTruthy();
    // MicButton — the icon-only Mic button is the first <button> in the
    // section.
    const buttons = section?.querySelectorAll('button');
    expect((buttons?.length ?? 0)).toBeGreaterThan(0);
  });

  it('renders the source-mode toggle when onToggleViewMode is provided (#110)', () => {
    const onToggleViewMode = vi.fn();
    renderWithProviders(
      <TrayHost
        open={true}
        onOpenChange={() => {}}
        viewMode="wysiwyg"
        onToggleViewMode={onToggleViewMode}
      />,
    );
    const toggle = document.querySelector('[aria-label="Switch to Markdown source"]') as HTMLElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('source-mode toggle reflects current viewMode and calls callback on click (#110)', () => {
    const onToggleViewMode = vi.fn();
    renderWithProviders(
      <TrayHost
        open={true}
        onOpenChange={() => {}}
        viewMode="source"
        onToggleViewMode={onToggleViewMode}
      />,
    );
    const toggle = document.querySelector('[aria-label="Switch to Rich text"]') as HTMLElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(onToggleViewMode).toHaveBeenCalledTimes(1);
  });

  it('omits the Editor tools section when neither editor nor onToggleViewMode is provided (#110)', () => {
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    expect(document.querySelector('[aria-label="Editor tools"]')).toBeNull();
  });

  it('source-mode toggle is hidden when onToggleViewMode is omitted (#110)', () => {
    const editor = createMockEditor() as unknown as Editor;
    renderWithProviders(
      <TrayHost
        open={true}
        onOpenChange={() => {}}
        editor={editor}
        viewMode="wysiwyg"
      />,
    );
    // Editor tools section should still render (MicButton present), but
    // no source-mode toggle without the callback.
    expect(document.querySelector('[aria-label="Editor tools"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Switch to Markdown source"]')).toBeNull();
    expect(document.querySelector('[aria-label="Switch to Rich text"]')).toBeNull();
  });
});
