/**
 * Local Agent setup — happy path (Playwright, mocked Tauri IPC).
 *
 * Covers the end-to-end wiring of the "Local AI" agentic-chat preset that the
 * real WKWebView E2E harness can't drive (heavy install + multi-GB model +
 * Seatbelt are validated separately by the live WebDriver run). Here every
 * backend command is mocked to success and we assert the staged setup dialog
 * walks idle → verifying → ready and fires the right IPC sequence.
 *
 * Flow under test (src/hooks/useLocalAgentSetup.ts):
 *   Settings → AI Providers → Add → "Local Agent" → "Set up"
 *   → detect (list_local_models, get_system_memory)
   *   → install: agent_resolve_binary check → SKIPPED (binary already resolves; model already downloaded → no download stage)
 *   → configure (start_local_server, local_agent_write_config, agent_resolve_binary)
 *   → verify (acp_agent_smoke_test ok)   → ready ("Done").
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setupTauriMock, trackInvokeCalls } from '../../fixtures/tauri-mock';

// A tool-calling-capable model that is ALREADY downloaded and fits in RAM, so
// recommendToolCallingModel picks it and the download stage is skipped (keeps
// the happy path deterministic — no model-download progress events to drive).
const TOOL_MODEL = {
  id: 'qwen-tool-7b',
  name: 'Qwen Tool 7B',
  filename: 'qwen-tool-7b.gguf',
  size_bytes: 4_000_000_000,
  ram_required_bytes: 6_000_000_000,
  downloaded: true,
  description: 'Tool-calling capable',
  huggingface_url: '',
  is_custom: false,
  source: 'catalog',
  supports_fim: false,
  supports_tool_calling: true,
};

// Mocked backend for the whole setup sequence. Values are returned verbatim by
// the mock invoke handler (see e2e/fixtures/tauri-mock.ts).
const SETUP_OVERRIDES: Record<string, unknown> = {
  list_local_models: [TOOL_MODEL],
  get_system_memory: { total_bytes: 16_000_000_000, available_bytes: 12_000_000_000 },
  agent_install: 'qwen', // resolves; return value unused
  start_local_server: 8137,
  local_agent_write_config: {
    configPath: '/Users/test/.notesage/agents/opencode/opencode.json',
    env: { OPENCODE_CONFIG: '/Users/test/.notesage/agents/opencode/opencode.json' },
    configKey: '8137:qwen-tool-7b',
    port: 8137,
    modelId: 'qwen-tool-7b',
  },
  agent_resolve_binary: { path: '/Users/test/.notesage/agents/bin/opencode' },
  acp_agent_smoke_test: { ok: true, stage: 'done' },
  // Defensive: connection persistence may resolve a keychain entry.
  store_credential: null,
};

async function openLocalAgentDialog(page: Page) {
  // Settings dialog
  await page.keyboard.press('Meta+,');
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });

  // AI Providers panel
  await page.getByRole('button', { name: 'AI Providers' }).click();

  // Add → Local Agent
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByText('Local Agent', { exact: true }).click();

  // The setup dialog is mounted at the app root and appears on top.
  const dialog = page
    .getByRole('dialog')
    .filter({ hasText: 'Set up a private, on-device agent' });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  return dialog;
}

test.describe('Local Agent setup — happy path', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page, { overrides: SETUP_OVERRIDES });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Add → Local Agent → Set up walks to a ready state', async ({ page }) => {
    const getCalls = await trackInvokeCalls(page);
    const dialog = await openLocalAgentDialog(page);

    // Kick the staged flow.
    await dialog.getByRole('button', { name: 'Set up' }).click();

    // Terminal success: the "Done" button only renders in the ready stage.
    await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible({
      timeout: 15000,
    });

    // The setup drove the real IPC sequence. In the mock both the agent binary
    // already resolves (pre-installed) and the model is pre-downloaded, so the
    // resume/skip guards fire: the install is skipped (installAgentIfMissing
    // sees a resolved binary) and the download is skipped — only the resolve
    // check, server start, config write, and smoke test run.
    const calls = await getCalls();
    const cmds = calls.map((c) => c.cmd);
    expect(cmds).toContain('agent_resolve_binary');
    expect(cmds).toContain('start_local_server');
    expect(cmds).toContain('local_agent_write_config');
    expect(cmds).toContain('acp_agent_smoke_test');
    // Binary already resolves → install skipped; model already downloaded →
    // download skipped (the setup-flow resume guards).
    expect(cmds).not.toContain('agent_install');
    expect(cmds).not.toContain('download_local_model');
  });
});
