// @vitest-environment jsdom
//
// Component tests for the Custom Agent add-connection form (task #5 of the
// local-ai-agents PRD). Covers the five form states: empty, filled, probing,
// success (capabilities preview), and error (inline stderr tail) — plus the
// args/env-var input plumbing into `registerCustomAcpConnection`.

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test/component-harness';
import { ConnectCustomAgent } from '@/components/settings/ConnectCustomAgent';
import { registerCustomAcpConnection } from '@/lib/ai/acp-agent-state';
import { tauriApi } from '@/lib/tauri';

vi.mock('@/lib/ai/acp-agent-state', () => ({
  registerCustomAcpConnection: vi.fn(),
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    openFileDialog: vi.fn(),
  },
}));

const mockRegister = vi.mocked(registerCustomAcpConnection);
const mockOpenFileDialog = vi.mocked(tauriApi.openFileDialog);

const SUCCESS_RESULT = {
  connectionId: 'conn-custom-1',
  capabilities: {
    availableModes: [
      { id: 'default', name: 'Default' },
      { id: 'plan', name: 'Plan' },
    ],
    configOptions: [{ id: 'effort', name: 'Effort' }],
    supportsLoadSession: true,
    supportsImages: false,
    agentVersion: '0.3.1',
    lastProbed: Date.now(),
  },
};

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Agent' } });
  fireEvent.change(screen.getByLabelText('Binary path'), {
    target: { value: '/opt/agents/my-acp-agent' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConnectCustomAgent — empty state', () => {
  it('disables Connect until name and binary path are filled', () => {
    renderWithProviders(<ConnectCustomAgent onBack={() => {}} onConnected={() => {}} />);

    const connect = screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Agent' } });
    expect(connect.disabled).toBe(true); // path still missing

    fireEvent.change(screen.getByLabelText('Binary path'), {
      target: { value: '/opt/agents/my-acp-agent' },
    });
    expect(connect.disabled).toBe(false);
  });

  it('never calls registerCustomAcpConnection while invalid', () => {
    renderWithProviders(<ConnectCustomAgent onBack={() => {}} onConnected={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(mockRegister).not.toHaveBeenCalled();
  });
});

describe('ConnectCustomAgent — filled state and submit plumbing', () => {
  it('submits trimmed label/path, space-split args, and only filled env rows', async () => {
    mockRegister.mockResolvedValue(SUCCESS_RESULT);
    renderWithProviders(<ConnectCustomAgent onBack={() => {}} onConnected={() => {}} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  My Agent  ' } });
    fireEvent.change(screen.getByLabelText('Binary path'), {
      target: { value: ' /opt/agents/my-acp-agent ' },
    });
    fireEvent.change(screen.getByLabelText(/Arguments/), { target: { value: '  acp --verbose ' } });

    // Two env rows: one filled, one left empty (must be omitted)
    fireEvent.click(screen.getByRole('button', { name: /add variable/i }));
    fireEvent.click(screen.getByRole('button', { name: /add variable/i }));
    const names = screen.getAllByLabelText('Variable name');
    const values = screen.getAllByLabelText('Variable value');
    fireEvent.change(names[0], { target: { value: 'MY_AGENT_KEY' } });
    fireEvent.change(values[0], { target: { value: 'secret-123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    expect(mockRegister).toHaveBeenCalledWith({
      label: 'My Agent',
      binaryPath: '/opt/agents/my-acp-agent',
      binaryArgs: ['acp', '--verbose'],
      envVars: { MY_AGENT_KEY: 'secret-123' },
    });
  });

  it('omits binaryArgs and envVars entirely when left empty', async () => {
    mockRegister.mockResolvedValue(SUCCESS_RESULT);
    renderWithProviders(<ConnectCustomAgent onBack={() => {}} onConnected={() => {}} />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    expect(mockRegister).toHaveBeenCalledWith({
      label: 'My Agent',
      binaryPath: '/opt/agents/my-acp-agent',
      binaryArgs: undefined,
      envVars: undefined,
    });
  });

  it('Browse fills the binary path from the native file dialog', async () => {
    mockOpenFileDialog.mockResolvedValue('/picked/agent-bin');
    renderWithProviders(<ConnectCustomAgent onBack={() => {}} onConnected={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /browse for agent binary/i }));

    await waitFor(() => {
      expect((screen.getByLabelText('Binary path') as HTMLInputElement).value).toBe(
        '/picked/agent-bin',
      );
    });
  });

  it('env value inputs are masked by default with a show/hide toggle', () => {
    renderWithProviders(<ConnectCustomAgent onBack={() => {}} onConnected={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /add variable/i }));
    const value = screen.getByLabelText('Variable value') as HTMLInputElement;
    expect(value.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Show value' }));
    expect(value.type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide value' }));
    expect(value.type).toBe('password');
  });

  it('env rows can be removed', () => {
    renderWithProviders(<ConnectCustomAgent onBack={() => {}} onConnected={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /add variable/i }));
    expect(screen.getAllByLabelText('Variable name')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Remove variable' }));
    expect(screen.queryByLabelText('Variable name')).toBeNull();
  });
});

describe('ConnectCustomAgent — probing state', () => {
  it('shows the probing indicator and disables inputs while the probe runs', async () => {
    let resolveProbe: (v: typeof SUCCESS_RESULT) => void = () => {};
    mockRegister.mockImplementation(
      () => new Promise((resolve) => { resolveProbe = resolve; }),
    );
    renderWithProviders(<ConnectCustomAgent onBack={() => {}} onConnected={() => {}} />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText('Probing agent…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Binary path') as HTMLInputElement).disabled).toBe(true);

    resolveProbe(SUCCESS_RESULT);
    await waitFor(() => expect(screen.queryByText('Probing agent…')).toBeNull());
  });
});

describe('ConnectCustomAgent — success state', () => {
  it('shows discovered capabilities and Done reports the connection id', async () => {
    mockRegister.mockResolvedValue(SUCCESS_RESULT);
    const onConnected = vi.fn();
    renderWithProviders(<ConnectCustomAgent onBack={() => {}} onConnected={onConnected} />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText('Connected')).toBeTruthy();
    expect(screen.getByText('v0.3.1')).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getByText('1 config option')).toBeTruthy();
    expect(screen.getByText('Session restore')).toBeTruthy();
    expect(screen.getByText('No image input')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onConnected).toHaveBeenCalledWith('conn-custom-1');
  });
});

describe('ConnectCustomAgent — error state', () => {
  const PROBE_ERROR =
    'ACP initialize failed: connection closed\nAgent stderr (last 2 lines):\npanic: MY_AGENT_KEY not set\nexiting';

  it('shows the error headline inline and the stderr tail behind Show details', async () => {
    mockRegister.mockRejectedValue(new Error(PROBE_ERROR));
    const onConnected = vi.fn();
    renderWithProviders(<ConnectCustomAgent onBack={() => {}} onConnected={onConnected} />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText('ACP initialize failed: connection closed')).toBeTruthy();
    expect(onConnected).not.toHaveBeenCalled();

    // stderr tail is collapsed behind "Show details"
    fireEvent.click(screen.getByText('Show details'));
    expect(screen.getByText(/panic: MY_AGENT_KEY not set/)).toBeTruthy();
  });

  it('returns to an editable form preserving the entered values for retry', async () => {
    mockRegister.mockRejectedValueOnce(new Error(PROBE_ERROR)).mockResolvedValue(SUCCESS_RESULT);
    renderWithProviders(<ConnectCustomAgent onBack={() => {}} onConnected={() => {}} />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByText('ACP initialize failed: connection closed');

    const path = screen.getByLabelText('Binary path') as HTMLInputElement;
    expect(path.disabled).toBe(false);
    expect(path.value).toBe('/opt/agents/my-acp-agent');

    // Retry succeeds and clears the error
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Connected')).toBeTruthy();
    expect(screen.queryByText('ACP initialize failed: connection closed')).toBeNull();
  });
});
