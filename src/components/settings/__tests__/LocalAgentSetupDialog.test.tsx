// @vitest-environment jsdom
//
// Component tests for the Local Agent setup dialog (task #17/#21). Covers the
// rendered states — idle (model picker + Set up), running (Continue in
// background), failed (error + Retry), ready (Done) — by seeding the store-backed
// state machine rather than driving the IPC flow.

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderWithProviders, screen } from '@/test/component-harness';
import { LocalAgentSetupDialog } from '@/components/settings/LocalAgentSetupDialog';
import { useLocalAIStore } from '@/stores/local-ai-store';
import type { LocalModelInfo } from '@/lib/tauri';

const GB = 1024 ** 3;

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
  });

  it('idle: shows the model picker, the stage checklist, and a Set up button', () => {
    open();
    renderWithProviders(<LocalAgentSetupDialog />);
    expect(screen.getByText('Set up private, offline AI')).toBeTruthy();
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

  it('ready: shows a Done button', () => {
    open();
    useLocalAIStore.getState().setLocalAgentSetup({ stage: 'ready', modelId: 'qwen2.5-coder-7b' });
    renderWithProviders(<LocalAgentSetupDialog />);
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
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
