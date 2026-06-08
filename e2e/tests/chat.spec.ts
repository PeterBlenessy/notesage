import { test, expect } from '@playwright/test';
import { setupTauriMock, emitTauriEvent, trackInvokeCalls } from '../fixtures/tauri-mock';

/**
 * Pre-seeds localStorage with a mock Anthropic connection and routing config
 * so the cmd-bar treats the app as having an active AI provider.
 */
async function seedAIProvider(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const connectionId = 'conn-e2e-test';

    // connections-store — one Anthropic API-key connection
    const connectionsState = {
      state: {
        connections: [
          {
            id: connectionId,
            provider: 'anthropic',
            authMethod: 'api_key',
            status: 'connected',
            label: 'Anthropic (Test)',
            credentials: { type: 'api_key', credentialStored: true },
            capabilities: ['interactive', 'agent_tasks'],
            createdAt: Date.now(),
          },
        ],
      },
      version: 0,
    };
    localStorage.setItem('notesage-connections', JSON.stringify(connectionsState));

    // routing-store — route interactive use-case to the test connection
    const routingState = {
      state: {
        routing: {
          interactive: { connectionId },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      },
      version: 0,
    };
    localStorage.setItem('notesage-routing', JSON.stringify(routingState));

    // chat-store — start with one empty conversation
    const convId = 'conv-e2e-test';
    const chatState = {
      state: {
        conversations: [
          {
            id: convId,
            title: 'New Chat',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            projectPaths: [],
            segments: [{ projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
            activeSegmentIndex: 0,
            pendingProjectSwitch: null,
            pendingAgentSwitch: null,
          },
        ],
        activeConversationId: convId,
        isLoading: false,
        error: null,
        activeTool: null,
        webSearchEnabled: false,
      },
      version: 0,
    };
    localStorage.setItem('notesage-chat', JSON.stringify(chatState));
  });
}

/**
 * Post-Classic-removal (#325) the chat surface is QuietLayout's
 * FloatingCommandBar — a single composer that doubles as the cmd palette.
 * These tests open it via the documented chord (`Cmd+K` is the canonical
 * focus chord; `Cmd+Shift+C` also works when collapsed) and assert against
 * the bar's selectors: `[data-cmd-bar]` wraps the bar, the input is
 * `textarea[role="combobox"]`, the send button has
 * `aria-label="Send message"`.
 */
test.describe('Chat (FloatingCommandBar)', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await seedAIProvider(page);
    await page.goto('/');
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root');
        return root && root.children.length > 0;
      },
      { timeout: 10000 },
    );
  });

  test('Cmd+K expands the command bar', async ({ page }) => {
    const bar = page.locator('[data-cmd-bar]');
    // The bar mounts collapsed (data-expanded="false"); the input only
    // becomes visible once the user expands.
    await expect(bar).toBeVisible({ timeout: 5000 });
    await expect(bar).toHaveAttribute('data-expanded', 'false');

    await page.keyboard.press('Meta+k');

    await expect(bar).toHaveAttribute('data-expanded', 'true', { timeout: 5000 });
    const input = bar.locator('textarea[role="combobox"]');
    await expect(input).toBeVisible();
  });

  test('Cmd+Shift+C expands the command bar when collapsed', async ({ page }) => {
    const bar = page.locator('[data-cmd-bar]');
    await expect(bar).toHaveAttribute('data-expanded', 'false');

    await page.keyboard.press('Meta+Shift+c');

    await expect(bar).toHaveAttribute('data-expanded', 'true', { timeout: 5000 });
  });

  test('can type a message in the command bar input', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    const input = page.locator('[data-cmd-bar] textarea[role="combobox"]');
    await expect(input).toBeVisible({ timeout: 5000 });

    await input.fill('Hello, how are you?');
    await expect(input).toHaveValue('Hello, how are you?');
  });

  test('send button is disabled when input is empty and enabled with text', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    const input = page.locator('[data-cmd-bar] textarea[role="combobox"]');
    await expect(input).toBeVisible({ timeout: 5000 });

    const sendButton = page.locator('[data-cmd-bar] button[aria-label="Send message"]');
    await expect(sendButton).toBeDisabled();

    await input.fill('Hello!');
    await expect(sendButton).toBeEnabled();

    await input.fill('');
    await expect(sendButton).toBeDisabled();
  });

  test('sending a message renders the user message in the stream', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    const input = page.locator('[data-cmd-bar] textarea[role="combobox"]');
    await expect(input).toBeVisible({ timeout: 5000 });

    await input.fill('What is Notesage?');
    const sendButton = page.locator('[data-cmd-bar] button[aria-label="Send message"]');
    await sendButton.click();

    // The user message should appear in the bar's conversation stream.
    const userMessage = page.locator('[data-cmd-bar]').getByText('What is Notesage?').first();
    await expect(userMessage).toBeVisible({ timeout: 5000 });

    // Input is cleared after sending.
    await expect(input).toHaveValue('');
  });

  test('Cmd+Enter sends the message from the input', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    const input = page.locator('[data-cmd-bar] textarea[role="combobox"]');
    await expect(input).toBeVisible({ timeout: 5000 });

    await input.fill('Tell me about markdown');
    await input.press('Meta+Enter');

    const userMessage = page.locator('[data-cmd-bar]').getByText('Tell me about markdown').first();
    await expect(userMessage).toBeVisible({ timeout: 5000 });
  });

  test('streaming response renders the assistant text', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    const input = page.locator('[data-cmd-bar] textarea[role="combobox"]');
    await expect(input).toBeVisible({ timeout: 5000 });

    // Capture invoke args so we can read the per-request streamId the hook
    // generates (events are emitted/listened on `<event>:<streamId>`).
    const getInvokeCalls = await trackInvokeCalls(page);

    await input.fill('What is Notesage?');
    await page.locator('[data-cmd-bar] button[aria-label="Send message"]').click();

    await expect(
      page.locator('[data-cmd-bar]').getByText('What is Notesage?').first(),
    ).toBeVisible({ timeout: 5000 });

    // Give the app a beat to invoke ai_chat_stream and wire up listeners.
    await page.waitForTimeout(300);

    const calls = await getInvokeCalls();
    const streamCall = calls.find((c) => c.cmd === 'ai_chat_stream');
    const streamId = (streamCall?.args as { streamId?: string } | undefined)?.streamId ?? '';
    const ev = (base: string) => (streamId ? `${base}:${streamId}` : base);

    await emitTauriEvent(page, ev('ai-stream-chunk'), 'Notesage is ');
    await emitTauriEvent(page, ev('ai-stream-chunk'), 'a rich text ');
    await emitTauriEvent(page, ev('ai-stream-chunk'), 'markdown editor.');
    await emitTauriEvent(page, ev('ai-stream-done'), null);

    await expect(
      page.locator('[data-cmd-bar]').getByText('Notesage is a rich text markdown editor.'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('ai_chat_stream is invoked with the user message', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    const getInvokeCalls = await trackInvokeCalls(page);

    const input = page.locator('[data-cmd-bar] textarea[role="combobox"]');
    await expect(input).toBeVisible({ timeout: 5000 });

    await input.fill('Hello AI');
    await page.locator('[data-cmd-bar] button[aria-label="Send message"]').click();

    await page.waitForTimeout(500);

    const calls = await getInvokeCalls();
    const streamCall = calls.find((c) => c.cmd === 'ai_chat_stream');
    expect(streamCall).toBeDefined();

    const args = streamCall!.args as Record<string, unknown>;
    const messages = args.messages as Array<{ role: string; content: string }>;
    expect(messages).toBeDefined();
    const userMsg = messages.find((m) => m.role === 'user' && m.content.includes('Hello AI'));
    expect(userMsg).toBeDefined();
  });

  test('Escape collapses the expanded floating command bar', async ({ page }) => {
    const bar = page.locator('[data-cmd-bar]');

    await page.keyboard.press('Meta+k');
    await expect(bar).toHaveAttribute('data-expanded', 'true', { timeout: 5000 });

    // Esc is the documented dismiss path in float mode (the bar's keymap
    // owns Esc; ⌘⇧C re-press is a no-op in expanded+float).
    await page.keyboard.press('Escape');

    await expect(bar).toHaveAttribute('data-expanded', 'false', { timeout: 5000 });
  });
});
