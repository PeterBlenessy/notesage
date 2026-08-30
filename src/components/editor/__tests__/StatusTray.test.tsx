// @vitest-environment jsdom

// Radix Tooltip uses ResizeObserver (via @radix-ui/react-use-size) for
// trigger sizing. jsdom doesn't ship one — polyfill before any imports
// pull Radix in, otherwise every render that mounts a <Tooltip> throws.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Radix Select uses Pointer Events APIs (hasPointerCapture / setPointerCapture
// / releasePointerCapture / scrollIntoView) that jsdom does not implement.
// Polyfill them as no-ops so opening the dropdown in tests does not throw.
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (typeof proto.hasPointerCapture !== 'function') {
    proto.hasPointerCapture = () => false;
  }
  if (typeof proto.setPointerCapture !== 'function') {
    proto.setPointerCapture = () => {};
  }
  if (typeof proto.releasePointerCapture !== 'function') {
    proto.releasePointerCapture = () => {};
  }
  if (typeof proto.scrollIntoView !== 'function') {
    proto.scrollIntoView = () => {};
  }
}

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
import { useActionStore } from '@/stores/action-store';
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
  });
  // ActionsGroup reads `getOpenCount()` from action-store, which this reset
  // never touched — so an action left behind by another test file made the
  // "no open actions" assertion fail under a shuffled order (#736). The store
  // is persisted, so it genuinely survives across files.
  useActionStore.setState({ actions: [], actionCache: {} });
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
    expect(document.body.textContent ?? '').not.toContain('Comments');
  });

  it('renders the always-visible group headings when open=true (Completions, Comments, Help)', () => {
    // Live-test 2026-04-25 — the "Session" group was renamed to
    // "Local AI" and now only renders when a `local_bundled`
    // connection exists. With no connection (default test setup), the
    // section is omitted entirely.
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Completions');
    expect(text).toContain('Comments');
    expect(text).toContain('Help');
    // Session header is gone — replaced by conditional Local AI header.
    expect(text).not.toContain('Session');
  });

  // Picker UI changed from a segmented radio group to a Select dropdown
  // (issue #181). Tests now query the SelectTrigger (role="combobox") and
  // assert on its displayed text instead of aria-checked on radio buttons.
  it('renders the completion picker as a dropdown showing "Off" when no inline_completion connections exist', () => {
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const trigger = document.querySelector(
      '[role="combobox"][aria-label="Completion provider"]',
    );
    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain('Off');
  });

  it('marks "Off" as active when completions are disabled globally', () => {
    useSettingsStore.setState({ inlineCompletionsDisabled: true });
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const trigger = document.querySelector(
      '[role="combobox"][aria-label="Completion provider"]',
    );
    expect(trigger?.textContent).toContain('Off');
  });

  it('selecting "Off" flips inlineCompletionsDisabled to true', async () => {
    // The Radix Select dropdown is portal-rendered; we drive the ValueChange
    // path through pointerdown on the trigger + click on the option, which
    // is the canonical jsdom-friendly interaction.
    const ollama = addConnection({
      id: 'c-ollama',
      provider: 'ollama',
      authMethod: 'local',
      label: 'Ollama',
      capabilities: ['inline_completion'],
    });
    useRoutingStore.setState({
      routing: {
        interactive: { connectionId: null },
        agent_tasks: { connectionId: null },
        inline_completion: { connectionId: ollama.id },
      },
    });

    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const trigger = document.querySelector(
      '[role="combobox"][aria-label="Completion provider"]',
    ) as HTMLElement;
    expect(useSettingsStore.getState().inlineCompletionsDisabled).toBe(false);
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    // Wait for portal content to mount.
    await Promise.resolve();
    const offOption = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((el) => el.textContent?.trim() === 'Off') as HTMLElement | undefined;
    expect(offOption).toBeTruthy();
    if (offOption) fireEvent.click(offOption);
    expect(useSettingsStore.getState().inlineCompletionsDisabled).toBe(true);
  });

  it('selecting an available provider routes it and clears the disabled flag', async () => {
    const ollama = addConnection({
      id: 'c-ollama',
      provider: 'ollama',
      authMethod: 'local',
      label: 'Ollama',
      capabilities: ['inline_completion'],
    });
    useSettingsStore.setState({ inlineCompletionsDisabled: true });

    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const trigger = document.querySelector(
      '[role="combobox"][aria-label="Completion provider"]',
    ) as HTMLElement;
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await Promise.resolve();
    const ollamaOption = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((el) => el.textContent?.includes('Ollama')) as HTMLElement | undefined;
    expect(ollamaOption).toBeTruthy();
    if (ollamaOption) fireEvent.click(ollamaOption);

    expect(useSettingsStore.getState().inlineCompletionsDisabled).toBe(false);
    expect(useRoutingStore.getState().routing.inline_completion.connectionId).toBe(
      ollama.id,
    );
  });

  /**
   * Live-test 2026-04-25 — the tool-calling row was removed from the
   * StatusTray. The toggle still exists in Settings > Advanced, but
   * surfacing it from the status bar wasn't useful and added chrome
   * the user explicitly asked us to drop. Negative regression: the
   * switch must NOT reach the DOM.
   */
  it('does NOT render a tool-calling switch (removed from the popover)', () => {
    useSettingsStore.setState({ toolCallingEnabled: true });
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    expect(document.querySelector('#status-tray-tool-calling')).toBeNull();
    expect(document.body.textContent ?? '').not.toContain('Tool calling');
  });

  it('does NOT render a "Recording…" row inside the Session group', () => {
    // Live-test 2026-04-25 — the dedicated row was removed. The
    // top-row MicButton conveys recording state with a pulsing,
    // accent-coloured icon; a duplicate text row was redundant.
    useRecordingStore.setState({ isRecording: true });
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    expect(document.body.textContent ?? '').not.toContain('Recording\u2026');
  });

  /**
   * Live-test 2026-04-25 — the dedicated `Recording — Idle / Recording…`
   * row was removed. The popover's top-row `MicButton` already conveys
   * recording state visually, so a separate text row was redundant.
   */
  it('does NOT render an "Idle" row inside the Session group', () => {
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    expect(document.body.textContent ?? '').not.toContain('Idle');
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

  it('does not render the legacy "N words · M min read" strip', () => {
    // Live-test 2026-04-26 — the word-count + reading-time strip was
    // dropped from the popover (the word count is already shown in the
    // status-bar row itself; duplicating it here was visual noise).
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    expect(document.body.textContent ?? '').not.toContain('min read');
    expect(document.body.textContent ?? '').not.toMatch(/\d+ words?\b/);
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

  it('Comments group counts comments without a status field as open', () => {
    // Regression: `addComment` does not set `status` on freshly created
    // comments — they live with `status === undefined`. The CommentsGroup
    // used to strict-match `=== "open"` and miss every freshly authored
    // comment, surfacing "0 / none open" for documents that obviously
    // had comments. Now the count matches CommentListPopover semantics
    // (anything not resolved/done is "open").
    const comments: Comment[] = [
      {
        id: 'c1',
        documentId: 'd',
        authorId: 'u',
        body: 'fresh, no status field',
        anchor: { from: 0, to: 0, anchorText: '' },
        createdAt: 0,
        updatedAt: 0,
      } as unknown as Comment,
      {
        id: 'c2',
        documentId: 'd',
        authorId: 'u',
        body: 'also fresh',
        anchor: { from: 0, to: 0, anchorText: '' },
        createdAt: 0,
        updatedAt: 0,
      } as unknown as Comment,
    ];
    renderWithProviders(
      <TrayHost open={true} onOpenChange={() => {}} comments={comments} />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('2 open');
    expect(text).toContain('View open comments');
  });

  it('Comments group hides resolved comments from the count', () => {
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
      {
        id: 'c2',
        documentId: 'd',
        authorId: 'u',
        body: 'gone',
        status: 'resolved',
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
  });

  it('"View open comments" opens an inline comment list and fires the legacy event', () => {
    // Live-test 2026-04-26 — clicking "View open comments" used to fire
    // a CustomEvent and close the tray, expecting an external host to
    // mount the legacy `CommentListPopover`. No host listened, so the
    // click was a no-op. Behaviour now: the row is itself a
    // PopoverTrigger and the comment list mounts inside a nested
    // popover. The legacy CustomEvent is still dispatched on open so
    // existing listeners and the perf regression test keep working.
    const comments: Comment[] = [
      {
        id: 'c1',
        documentId: 'd',
        authorId: 'u',
        body: 'first comment body',
        status: 'open',
        from: 0,
        to: 0,
        anchorText: 'anchor snippet',
        createdAt: 0,
        updatedAt: 0,
      } as unknown as Comment,
    ];
    const onOpenChange = vi.fn();
    const onSelectComment = vi.fn();
    const listener = vi.fn();
    window.addEventListener('notesage:open-comment-list', listener);

    renderWithProviders(
      <TrayHost
        open={true}
        onOpenChange={onOpenChange}
        comments={comments}
        onSelectComment={onSelectComment}
      />,
    );

    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('View open comments'),
    ) as HTMLButtonElement;
    act(() => {
      fireEvent.click(btn);
    });

    // Legacy event fires once on open (regression-locked by perf test).
    expect(listener).toHaveBeenCalledTimes(1);
    // The inner comment list renders the comment header + body.
    expect(document.body.textContent ?? '').toContain('Comments (1)');
    expect(document.body.textContent ?? '').toContain('first comment body');
    // Clicking a row dismisses the tray (so the editor regains focus on
    // the jumped-to anchor) and forwards to onSelectComment.
    const rowBtns = Array.from(document.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('first comment body'),
    );
    expect(rowBtns.length).toBeGreaterThan(0);
    act(() => {
      fireEvent.click(rowBtns[rowBtns.length - 1] as HTMLButtonElement);
    });
    expect(onSelectComment).toHaveBeenCalledTimes(1);
    expect(onSelectComment.mock.calls[0][0].id).toBe('c1');
    expect(onOpenChange).toHaveBeenCalledWith(false);

    window.removeEventListener('notesage:open-comment-list', listener);
  });

  /**
   * Live-test 2026-04-25 — the "Session" group was renamed to "Local AI"
   * and now uses a 2-row layout:
   *   row 1: "Local AI" header + status dot (right-aligned)
   *   row 2: "Model" label + Select with downloaded models
   *
   * The status text ("Running" / "Stopped" / etc.) was dropped from the
   * visible body — it lives on the dot's `aria-label` / `title` for
   * screen readers + tooltip. These tests pin the new layout.
   */
  it('renders the "Local AI" section header when a local_bundled connection exists', () => {
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
    // Section <section aria-label="Local AI"> is mounted.
    expect(document.querySelector('section[aria-label="Local AI"]')).toBeTruthy();
    // The status dot exists with the correct server-status attribute.
    const dot = document.querySelector('[data-testid="local-ai-status-dot"]');
    expect(dot?.getAttribute('data-server-status')).toBe('running');
    // Status label lives on aria-label, not visible body text.
    expect(dot?.getAttribute('aria-label')).toContain('Running');
  });

  it('omits the Local AI section entirely when there is no local_bundled connection', () => {
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    expect(document.querySelector('section[aria-label="Local AI"]')).toBeNull();
    // No status dot rendered either.
    expect(document.querySelector('[data-testid="local-ai-status-dot"]')).toBeNull();
  });

  it('renders a Model picker populated with downloaded models', () => {
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
          downloaded: true,
        } as unknown as import('@/lib/tauri').LocalModelInfo,
        {
          id: 'm-2',
          name: 'Llama 3 8B',
          downloaded: true,
        } as unknown as import('@/lib/tauri').LocalModelInfo,
        {
          id: 'm-3',
          name: 'Not Yet Downloaded',
          downloaded: false,
        } as unknown as import('@/lib/tauri').LocalModelInfo,
      ],
    });
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const trigger = document.querySelector(
      '#status-tray-local-ai-model',
    ) as HTMLElement;
    expect(trigger).toBeTruthy();
    // Trigger displays the active model's name.
    expect(trigger.textContent ?? '').toContain('Qwen 7B');
    // Trigger is enabled because at least one downloaded model exists.
    expect(trigger.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('disables the Model picker when no downloaded models exist', () => {
    addConnection({
      id: 'c-local',
      provider: 'local_ai',
      authMethod: 'local_bundled',
      label: 'Local AI',
    });
    useLocalAIStore.setState({
      serverStatus: 'stopped',
      activeModelId: null,
      models: [
        {
          id: 'm-1',
          name: 'Not Yet Downloaded',
          downloaded: false,
        } as unknown as import('@/lib/tauri').LocalModelInfo,
      ],
    });
    renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
    const trigger = document.querySelector(
      '#status-tray-local-ai-model',
    ) as HTMLElement;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('data-disabled')).not.toBeNull();
    expect(trigger.textContent ?? '').toContain('No models downloaded');
  });

  // -------------------------------------------------------------------------
  // Local AI status dot — colour reflects server state
  // -------------------------------------------------------------------------
  //
  // Chromatic status palette (#415): these are semantic status indicators (a
  // traffic-light for the local inference server), so they use status colours —
  // green=running, amber=starting (pulse), red=error, muted=stopped. The dot
  // here MUST match the always-visible quiet status strip dot byte-for-byte;
  // both render from the shared `local-ai-dot` helper. We assert via the
  // `data-server-status` data attribute AND the class-list so the test survives
  // Tailwind class ordering tweaks while still pinning the semantic mapping. The
  // transitional (starting) pulse is gated on reduced motion — jsdom's
  // matchMedia mock returns false (motion allowed), so the class is present.

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

  it('Local AI dot is faint muted (idle) when the server is stopped', () => {
    const dot = renderTrayWithStatus('stopped');
    expect(dot).toBeTruthy();
    expect(dot?.getAttribute('data-server-status')).toBe('stopped');
    expect(dot?.className).toContain('bg-muted-foreground/30');
    expect(dot?.className).not.toContain('bg-green');
    expect(dot?.className).not.toContain('bg-amber');
    expect(dot?.className).not.toContain('bg-red');
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

  it('does not autofocus a control on open (mic tooltip would auto-show) (#bug)', async () => {
    const editor = createMockEditor() as unknown as Editor;
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button data-testid="opener" onClick={() => setOpen(true)}>
            open
          </button>
          <TrayHost open={open} onOpenChange={setOpen} editor={editor} />
        </div>
      );
    }

    renderWithProviders(<Harness />);
    const opener = document.querySelector('[data-testid="opener"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(opener);
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    // Radix's default autofocus is prevented, so focus must NOT land on the
    // recording MicButton (whose focus-triggered tooltip would otherwise stick
    // open on every popover open).
    const micButton = document
      .querySelector('[aria-label="Editor tools"]')
      ?.querySelector('button');
    expect(micButton).toBeTruthy();
    expect(document.activeElement).not.toBe(micButton);
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

  // -------------------------------------------------------------------------
  // ActionsGroup (bugs #3-#5) — open-actions count + click to open dialog
  // -------------------------------------------------------------------------
  describe('ActionsGroup (bugs #3-#5)', () => {
    it('renders the Actions section heading when popover is open', () => {
      renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
      const text = document.body.textContent ?? '';
      expect(text).toContain('Actions');
    });

    it('shows muted "No open actions" when openCount === 0', () => {
      // useActionStore.getOpenCount() defaults to 0 with no items seeded.
      renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
      const text = document.body.textContent ?? '';
      expect(text).toContain('No open actions');
    });

    it('shows the open count when openCount > 0', async () => {
      const { useActionStore } = await import('@/stores/action-store');
      // Seed a single open task. The store's `getOpenCount` filters
      // by `status === 'open'`.
      useActionStore.setState({
        actions: [
          {
            id: 't1',
            source_type: 'task',
            status: 'open',
            text: 'Buy milk',
            line: 1,
            file: '/p/x.md',
            project_root: '/p',
            project_name: 'p',
            updated_at: Date.now(),
          },
        ],
      } as unknown as Parameters<typeof useActionStore.setState>[0]);

      renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
      const text = document.body.textContent ?? '';
      expect(text).toContain('1 open action');
      expect(text).not.toContain('No open actions');
    });

    it('clicking the row fires onOpenActions AND closes the popover', async () => {
      // Reset action-store explicitly — the previous test seeds an
      // action and the parent `beforeEach` doesn't touch this store.
      const { useActionStore } = await import('@/stores/action-store');
      useActionStore.setState({ actions: [] } as unknown as Parameters<typeof useActionStore.setState>[0]);

      const onOpenActions = vi.fn();
      const onOpenChange = vi.fn();
      renderWithProviders(
        <TrayHost
          open={true}
          onOpenChange={onOpenChange}
          onOpenActions={onOpenActions}
        />,
      );
      const button = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('No open actions'),
      ) as HTMLButtonElement | undefined;
      expect(button).toBeTruthy();
      fireEvent.click(button!);
      expect(onOpenActions).toHaveBeenCalledTimes(1);
      // Tray closed as part of the click handler.
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('button is disabled when onOpenActions is not provided', async () => {
      const { useActionStore } = await import('@/stores/action-store');
      useActionStore.setState({ actions: [] } as unknown as Parameters<typeof useActionStore.setState>[0]);

      renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
      const button = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('No open actions'),
      ) as HTMLButtonElement | undefined;
      expect(button).toBeTruthy();
      // Without `onOpenActions` threaded in, the button shouldn't fire.
      expect(button!.hasAttribute('disabled')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // CompletionsGroup — issue #179: dynamic picker from connections-store
  // -------------------------------------------------------------------------

  describe('CompletionsGroup — dynamic connections (issue #179)', () => {
    it('shows only inline_completion-capable connections, not hardcoded options', async () => {
      addConnection({
        id: 'c-anthropic',
        provider: 'anthropic',
        authMethod: 'api_key',
        label: 'My Claude',
        capabilities: ['interactive', 'inline_completion'],
      });
      renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
      const trigger = document.querySelector(
        '[role="combobox"][aria-label="Completion provider"]',
      ) as HTMLElement;
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await Promise.resolve();
      const labels = Array.from(document.querySelectorAll('[role="option"]'))
        .map((el) => el.textContent?.trim() ?? '');
      expect(labels.some((l) => l.includes('Off'))).toBe(true);
      expect(labels.some((l) => l.includes('My Claude'))).toBe(true);
      expect(labels.some((l) => l.includes('Copilot'))).toBe(false);
      expect(labels.some((l) => l.includes('Local AI'))).toBe(false);
    });

    it('omits connections that lack inline_completion capability', async () => {
      addConnection({
        id: 'c-interactive-only',
        provider: 'anthropic',
        authMethod: 'api_key',
        label: 'Chat Only',
        capabilities: ['interactive'],
      });
      renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
      const trigger = document.querySelector(
        '[role="combobox"][aria-label="Completion provider"]',
      ) as HTMLElement;
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await Promise.resolve();
      const labels = Array.from(document.querySelectorAll('[role="option"]'))
        .map((el) => el.textContent?.trim() ?? '');
      // Connection without inline_completion must not appear.
      expect(labels.some((l) => l.includes('Chat Only'))).toBe(false);
      // Only the "Off" option should be present.
      expect(labels.length).toBe(1);
      expect(labels[0]).toContain('Off');
    });

    it('shows "Configure in Settings" empty-state when no inline_completion connections exist', () => {
      // No connections added — default from resetStores().
      renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
      const text = document.body.textContent ?? '';
      expect(text).toContain('Configure in Settings');
    });

    it('does not show hardcoded Copilot/Local AI/Ollama when no matching connections', () => {
      // With no connections the old code showed three disabled hardcoded buttons.
      renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
      const text = document.body.textContent ?? '';
      expect(text).not.toContain('Copilot');
      expect(text).not.toContain('Local AI');
      expect(text).not.toContain('Ollama');
    });

    it('picking a connection writes its ID to routing-store inline_completion', async () => {
      addConnection({
        id: 'c-custom-123',
        provider: 'ollama',
        authMethod: 'local',
        label: 'My Ollama',
        capabilities: ['inline_completion'],
      });
      renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
      const trigger = document.querySelector(
        '[role="combobox"][aria-label="Completion provider"]',
      ) as HTMLElement;
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await Promise.resolve();
      const option = Array.from(document.querySelectorAll('[role="option"]')).find(
        (el) => el.textContent?.includes('My Ollama'),
      ) as HTMLElement | undefined;
      expect(option).toBeTruthy();
      if (option) fireEvent.click(option);
      expect(useRoutingStore.getState().routing.inline_completion.connectionId).toBe('c-custom-123');
      expect(useSettingsStore.getState().inlineCompletionsDisabled).toBe(false);
    });

    it('active state reflects the routing-store inline_completion connection ID', () => {
      addConnection({
        id: 'c-1',
        provider: 'ollama',
        authMethod: 'local',
        label: 'Ollama',
        capabilities: ['inline_completion'],
      });
      addConnection({
        id: 'c-2',
        provider: 'anthropic',
        authMethod: 'api_key',
        label: 'Claude',
        capabilities: ['inline_completion'],
      });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: null },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: 'c-2' },
        },
      });
      renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
      const trigger = document.querySelector(
        '[role="combobox"][aria-label="Completion provider"]',
      );
      // The trigger displays the currently-selected option's text.
      expect(trigger?.textContent).toContain('Claude');
      expect(trigger?.textContent).not.toContain('Ollama');
    });

    it('Off is active when inlineCompletionsDisabled=true regardless of routing', () => {
      addConnection({
        id: 'c-oll',
        provider: 'ollama',
        authMethod: 'local',
        label: 'Ollama',
        capabilities: ['inline_completion'],
      });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: null },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: 'c-oll' },
        },
      });
      useSettingsStore.setState({ inlineCompletionsDisabled: true });
      renderWithProviders(<TrayHost open={true} onOpenChange={() => {}} />);
      const trigger = document.querySelector(
        '[role="combobox"][aria-label="Completion provider"]',
      );
      expect(trigger?.textContent).toContain('Off');
      expect(trigger?.textContent).not.toContain('Ollama');
    });
  });
});
