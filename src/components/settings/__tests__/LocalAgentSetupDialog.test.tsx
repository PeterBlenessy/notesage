// @vitest-environment jsdom
//
// Component tests for the Local Agent setup dialog (task #17/#21). Covers the
// rendered states — idle (model picker + Set up), running (Continue in
// background), failed (error + Retry), ready (Done) — by seeding the store-backed
// state machine rather than driving the IPC flow.

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor, act } from '@/test/component-harness';
import { emitMockEvent } from '@/test/tauri-mock';
import { LocalAgentSetupDialog } from '@/components/settings/LocalAgentSetupDialog';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useConnectionsStore } from '@/stores/connections-store';
import type { Connection } from '@/lib/ai/connections';
import type { LocalModelInfo } from '@/lib/tauri';

const GB = 1024 ** 3;

/** Minimal Local Agent (Goose) preset connection — `isLocalAgentPreset` only
 *  checks provider + config.localAgentPreset. */
function presetConnection(): Connection {
  return {
    id: 'goose-conn',
    provider: 'custom_acp',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'Local Agent',
    credentials: { type: 'agent_managed', agentBinary: 'goose' },
    capabilities: ['interactive'],
    createdAt: Date.now(),
    config: { localAgentPreset: 'goose' },
  } as Connection;
}

function toolModel(id: string): LocalModelInfo {
  return {
    id, name: id, filename: `${id}.gguf`, size_bytes: 4 * GB, ram_required_bytes: 5 * GB,
    downloaded: false, description: '', huggingface_url: '', is_custom: false, source: 'catalog',
    supports_fim: false, supports_tool_calling: true, supports_thinking: false, supports_vision: false,
  } as LocalModelInfo;
}

function open() {
  useLocalAIStore.setState({
    localAgentSetupDialogOpen: true,
    models: [toolModel('qwen2.5-coder-7b')],
    systemMemory: { total_bytes: 16 * GB, available_bytes: 10 * GB },
  });
}

describe('LocalAgentSetupDialog', () => {
  beforeEach(() => {
    useLocalAIStore.getState().resetLocalAgentSetup();
    useLocalAIStore.setState({ localAgentSetupDialogOpen: false, models: [], systemMemory: null });
    useConnectionsStore.setState({ connections: [] });
  });

  it('idle: shows the model picker, the stage checklist, and a Set up button', () => {
    open();
    renderWithProviders(<LocalAgentSetupDialog />);
    expect(screen.getByText('Set up a private, on-device agent')).toBeTruthy();
    expect(screen.getByText('Check hardware')).toBeTruthy();
    expect(screen.getByText('Verify it responds')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set up' })).toBeTruthy();
  });

  it('running: shows Continue in background, not Set up', () => {
    open();
    useLocalAIStore.getState().setLocalAgentSetup({ stage: 'downloading', modelId: 'qwen2.5-coder-7b' });
    renderWithProviders(<LocalAgentSetupDialog />);
    expect(screen.getByRole('button', { name: /continue in background/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set up' })).toBeNull();
  });

  it('failed: shows the error message and a Retry button', () => {
    open();
    useLocalAIStore.getState().setLocalAgentSetup({
      stage: 'failed', failedStage: 'verifying', error: 'smoke test timed out',
    });
    renderWithProviders(<LocalAgentSetupDialog />);
    expect(screen.getByText('smoke test timed out')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });

  it('ready: shows a Done button (when the preset connection exists)', () => {
    open();
    useConnectionsStore.setState({ connections: [presetConnection()] });
    useLocalAIStore.getState().setLocalAgentSetup({ stage: 'ready', modelId: 'qwen2.5-coder-7b' });
    renderWithProviders(<LocalAgentSetupDialog />);
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('stale ready (connection removed) falls back to idle so the agent can be re-added', () => {
    // Regression lock: after removing the Local Agent, the persisted
    // `stage: 'ready'` would otherwise render a dead "Done" (which only closes,
    // never re-running setup). With no preset connection present, the dialog
    // must reset to idle and offer "Set up" again.
    open();
    useConnectionsStore.setState({ connections: [] });
    useLocalAIStore.getState().setLocalAgentSetup({ stage: 'ready', modelId: 'qwen2.5-coder-7b' });
    renderWithProviders(<LocalAgentSetupDialog />);
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Set up' })).toBeTruthy();
  });

  it('shows a progress bar for the Goose binary download during the downloading stage', async () => {
    open();
    useLocalAIStore.getState().setLocalAgentSetup({ stage: 'downloading', modelId: 'qwen2.5-coder-7b' });
    renderWithProviders(<LocalAgentSetupDialog />);
    // No model download is registered, so the bar only appears once the agent
    // download progress arrives over `agent-install-progress`.
    expect(screen.queryByRole('progressbar')).toBeNull();
    act(() => {
      emitMockEvent('agent-install-progress', {
        agent_id: 'goose', phase: 'downloading', progress: 40, total: 100, message: '',
      });
    });
    await waitFor(() => expect(screen.getByRole('progressbar')).toBeTruthy());
  });

  it('ignores agent-install-progress for other agents', async () => {
    open();
    useLocalAIStore.getState().setLocalAgentSetup({ stage: 'downloading', modelId: 'qwen2.5-coder-7b' });
    renderWithProviders(<LocalAgentSetupDialog />);
    act(() => {
      emitMockEvent('agent-install-progress', {
        agent_id: 'gemini', phase: 'downloading', progress: 40, total: 100, message: '',
      });
    });
    // A non-goose agent must not drive the bar.
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  });

  it('warns when the machine has under 8GB of memory', () => {
    useLocalAIStore.setState({
      localAgentSetupDialogOpen: true,
      models: [toolModel('qwen3-1.7b')],
      systemMemory: { total_bytes: 6 * GB, available_bytes: 3 * GB },
    });
    renderWithProviders(<LocalAgentSetupDialog />);
    expect(screen.getByText(/under\s*8\s*GB/i)).toBeTruthy();
  });
});
