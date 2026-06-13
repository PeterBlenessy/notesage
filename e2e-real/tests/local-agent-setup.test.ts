/**
 * Local Agent setup — REAL macOS run (WebDriverIO + tauri-webdriver).
 *
 * Unlike the mocked Playwright happy-path (e2e/tests/settings/local-agent-setup.spec.ts),
 * this drives the ACTUAL backend: real OpenCode install (npm `opencode-ai` via the
 * portable Node runtime), real bundled llama-server start against a downloaded
 * tool-calling model, real config generation, and a real `acp_agent_smoke_test`
 * (health → spawn → session → prompt → done) under the Seatbelt + network sandbox.
 *
 * This is the live confirmation that the npm-installed
 * `~/.notesage/agents/bin/opencode` spawns, isolates (empty network allowlist +
 * llama port only), and completes an agentic turn — the part that can't run in
 * the Linux CI container.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm wdio run wdio.conf.ts --spec ./e2e-real/tests/local-agent-setup.test.ts
 *
 * Prereqs on the host (this is a MANUAL validation tool, not a CI gate):
 *   - Network access (npm install of opencode-ai; Node runtime if no system Node).
 *   - At least one downloaded `supports_tool_calling` catalog model
 *     (e.g. qwen3-1.7b, gemma-4-e4b) — else the flow triggers a multi-GB download.
 *   - A CLEAN single instance: no other Notesage (esp. the installed
 *     /Applications build) running. A concurrent instance shares ~/.notesage,
 *     spawns competing llama-servers, and produces port cross-talk that makes
 *     the smoke test connect to the wrong server.
 *
 * Harness caveats (observed 2026-06-13): the WKWebView WebDriver bridge can be
 * finicky here — repeated runs can crash the webview, and if a half-configured
 * Local Agent connection persists, the app may eagerly spawn the agent at
 * startup and wedge `new_session`. If you hit that, fully quit the app, clear
 * stray `llama-server`/`opencode` processes, and relaunch. The deterministic
 * regression lock for the context-window bug this test first surfaced lives in
 * the unit test `resolveLocalAgentContext` (src/lib/ai/__tests__/
 * local-agent-model.test.ts); this spec is the end-to-end companion.
 */

// The setup is genuinely long: Node-runtime download + `npm install opencode-ai`
// + model load + agentic smoke prompt. Give it generous headroom.
const SETUP_TIMEOUT_MS = 600_000; // 10 min

type SetupSnapshot = {
  stage: string;
  failedStage: string | null;
  error: string | null;
  degraded: unknown;
};

async function readSetup(): Promise<SetupSnapshot> {
  return browser.execute(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const s = w.__E2E_LOCAL_AI_STORE__?.getState?.();
    return {
      stage: s?.localAgentSetup?.stage ?? 'unknown',
      failedStage: s?.localAgentSetup?.failedStage ?? null,
      error: s?.localAgentSetup?.error ?? null,
      degraded: s?.localAgentDegraded ?? null,
    };
  });
}

async function hasPresetConnection(): Promise<boolean> {
  return browser.execute(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const conns = w.__E2E_CONNECTIONS_STORE__?.getState?.()?.connections ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return conns.some((c: any) => c.provider === 'custom_acp' && c.config?.localAgentPreset === 'opencode');
  });
}

describe('Local Agent setup — real install + agentic smoke', () => {
  before(async () => {
    const root = await browser.$('#root');
    await root.waitForExist({ timeout: 10_000, timeoutMsg: 'App root not found within 10s' });
  });

  // Regular function (not arrow) so Mocha honours this.timeout() — the real
  // install + server + agentic smoke can take minutes, well past the 30s default.
  it('installs OpenCode (npm), starts the bundled server, and passes the agentic smoke test', async function () {
    this.timeout(SETUP_TIMEOUT_MS + 60_000);

    // Reset any prior setup state so the run starts clean and idempotent, then
    // open the staged setup dialog via the store (reliable in WKWebView vs.
    // clicking through Settings → AI Providers → Add → Local Agent).
    await browser.execute(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const s = w.__E2E_LOCAL_AI_STORE__?.getState?.();
      s?.resetLocalAgentSetup?.();
      s?.setLocalAgentSetupDialogOpen?.(true);
    });

    // The dialog mounts at the app root; its primary action is "Set up".
    const setupBtn = await browser.$('button=Set up');
    await setupBtn.waitForClickable({ timeout: 10_000, timeoutMsg: 'Set up button not clickable' });
    await setupBtn.click();

    // Poll the real setup stage until terminal (ready | failed). The backend is
    // doing a real Node-runtime download, npm install, model load, and smoke
    // prompt here — hence the long timeout.
    let last: SetupSnapshot = { stage: 'idle', failedStage: null, degraded: null };
    await browser.waitUntil(
      async () => {
        last = await readSetup();
        return last.stage === 'ready' || last.stage === 'failed';
      },
      {
        timeout: SETUP_TIMEOUT_MS,
        interval: 2_000,
        timeoutMsg: `Setup did not reach a terminal stage in ${SETUP_TIMEOUT_MS}ms (last: ${JSON.stringify(last)})`,
      },
    );

    if (last.stage !== 'ready') {
      throw new Error(
        `Local Agent setup failed at stage "${last.failedStage}": ${last.error ?? '(no error captured)'}. Degraded: ${JSON.stringify(last.degraded)}`,
      );
    }

    // Ready ⇒ the smoke test passed (spawn + session + agentic prompt under
    // Seatbelt) and the preset connection was registered.
    expect(last.stage).toBe('ready');
    expect(await hasPresetConnection()).toBe(true);
  });
});
