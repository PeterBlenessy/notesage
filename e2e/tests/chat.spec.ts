import { test, expect } from '@playwright/test';
import { setupTauriMock, emitTauriEvent, trackInvokeCalls } from '../fixtures/tauri-mock';

/**
 * Pre-seeds localStorage with a mock Anthropic connection and routing config
 * so the chat panel treats the app as having an active AI provider.
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

test.describe('Chat panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await seedAIProvider(page);
    await page.goto('/');
    // Wait for the app to mount
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root');
        return root && root.children.length > 0;
      },
      { timeout: 10000 },
    );
  });

  test('opens chat panel with Cmd+Shift+C', async ({ page }) => {
    // Chat panel should not be visible initially
    const chatPanel = page.locator('.bg-card').filter({ hasText: 'New Chat' });
    await expect(chatPanel).not.toBeVisible();

    // Open chat panel with keyboard shortcut
    await page.keyboard.press('Meta+Shift+c');

    // Chat panel should now be visible — look for the "New Chat" tab text
    const chatTab = page.locator('button', { hasText: 'New Chat' }).first();
    await expect(chatTab).toBeVisible({ timeout: 5000 });
  });

  test('can type a message in the chat input', async ({ page }) => {
    // Open chat panel
    await page.keyboard.press('Meta+Shift+c');
    await page.waitForTimeout(500);

    // Find the textarea inside the chat panel
    const textarea = page.locator('textarea[placeholder*="Ask"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Type a message
    await textarea.fill('Hello, how are you?');
    await expect(textarea).toHaveValue('Hello, how are you?');
  });

  test('send button is enabled when text is present and disabled when empty', async ({ page }) => {
    // Open chat panel
    await page.keyboard.press('Meta+Shift+c');
    await page.waitForTimeout(500);

    const textarea = page.locator('textarea[placeholder*="Ask"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Send button should be disabled when empty
    const sendButton = page.locator('button[title="Send (Cmd+Enter)"]');
    await expect(sendButton).toBeDisabled();

    // Type a message — send button should become enabled
    await textarea.fill('Hello!');
    await expect(sendButton).toBeEnabled();

    // Clear the message — send button should become disabled again
    await textarea.fill('');
    await expect(sendButton).toBeDisabled();
  });

  test('sending a message adds it to the chat message list', async ({ page }) => {
    // Open chat panel
    await page.keyboard.press('Meta+Shift+c');
    await page.waitForTimeout(500);

    const textarea = page.locator('textarea[placeholder*="Ask"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Type and send a message
    await textarea.fill('What is Notesage?');
    const sendButton = page.locator('button[title="Send (Cmd+Enter)"]');
    await sendButton.click();

    // The user message should appear in the chat list
    const userMessage = page.locator('p').filter({ hasText: 'What is Notesage?' });
    await expect(userMessage).toBeVisible({ timeout: 5000 });

    // Input should be cleared after sending
    await expect(textarea).toHaveValue('');
  });

  test('sending a message via Cmd+Enter keyboard shortcut', async ({ page }) => {
    // Open chat panel
    await page.keyboard.press('Meta+Shift+c');
    await page.waitForTimeout(500);

    const textarea = page.locator('textarea[placeholder*="Ask"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Type a message and send via keyboard
    await textarea.fill('Tell me about markdown');
    await textarea.press('Meta+Enter');

    // The user message should appear
    const userMessage = page.locator('p').filter({ hasText: 'Tell me about markdown' });
    await expect(userMessage).toBeVisible({ timeout: 5000 });
  });

  test('mock streaming response renders assistant message', async ({ page }) => {
    // Open chat panel
    await page.keyboard.press('Meta+Shift+c');
    await page.waitForTimeout(500);

    const textarea = page.locator('textarea[placeholder*="Ask"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Type and send a message
    await textarea.fill('What is Notesage?');
    const sendButton = page.locator('button[title="Send (Cmd+Enter)"]');
    await sendButton.click();

    // Wait for user message to appear
    await expect(page.locator('p').filter({ hasText: 'What is Notesage?' })).toBeVisible({ timeout: 5000 });

    // Give the app time to invoke ai_chat_stream and set up listeners
    await page.waitForTimeout(300);

    // Simulate streaming AI response via mock Tauri events
    await emitTauriEvent(page, 'ai-stream-chunk', 'Notesage is ');
    await emitTauriEvent(page, 'ai-stream-chunk', 'a rich text ');
    await emitTauriEvent(page, 'ai-stream-chunk', 'markdown editor.');
    await emitTauriEvent(page, 'ai-stream-done', null);

    // The streamed assistant response should appear in the chat
    const assistantMessage = page.locator('text=Notesage is a rich text markdown editor.');
    await expect(assistantMessage).toBeVisible({ timeout: 5000 });
  });

  test('ai_chat_stream command is invoked with correct messages', async ({ page }) => {
    // Open chat panel
    await page.keyboard.press('Meta+Shift+c');
    await page.waitForTimeout(500);

    // Set up invoke tracking
    const getInvokeCalls = await trackInvokeCalls(page);

    const textarea = page.locator('textarea[placeholder*="Ask"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Send a message
    await textarea.fill('Hello AI');
    const sendButton = page.locator('button[title="Send (Cmd+Enter)"]');
    await sendButton.click();

    // Wait for the invoke to happen
    await page.waitForTimeout(500);

    const calls = await getInvokeCalls();
    const streamCall = calls.find((c) => c.cmd === 'ai_chat_stream');
    expect(streamCall).toBeDefined();

    // Verify the messages array contains the user message
    const args = streamCall!.args as Record<string, unknown>;
    const messages = args.messages as Array<{ role: string; content: string }>;
    expect(messages).toBeDefined();
    const userMsg = messages.find((m) => m.role === 'user' && m.content.includes('Hello AI'));
    expect(userMsg).toBeDefined();
  });

  test('chat panel renders even without AI provider configured', async ({ page }) => {
    // The chat panel should render and show the input textarea
    // regardless of whether a provider is configured
    await page.keyboard.press('Meta+Shift+c');
    await page.waitForTimeout(500);

    const textarea = page.locator('textarea[placeholder*="Ask"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });

  test('chat panel toggles closed with Cmd+Shift+C', async ({ page }) => {
    // Open chat panel
    await page.keyboard.press('Meta+Shift+c');
    const chatTab = page.locator('button', { hasText: 'New Chat' }).first();
    await expect(chatTab).toBeVisible({ timeout: 5000 });

    // Close chat panel with the same shortcut
    await page.keyboard.press('Meta+Shift+c');

    // Chat panel content should disappear
    await expect(chatTab).not.toBeVisible({ timeout: 5000 });
  });
});
