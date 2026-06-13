// Pure, dependency-injected driver for the Local Agent setup flow (task #16).
//
// Kept free of React/stores/Tauri so the staged state machine — including
// parallel install+download, per-stage failure attribution, and the
// smoke-test gate → Path-4 fallback — is unit-testable with fakes. The hook
// `useLocalAgentSetup` supplies the real dependencies.

import type { LocalAgentActiveStage, LocalAgentSetupStage } from '@/stores/local-ai-store';
import type { SmokeTestReport } from '@/lib/tauri';

export interface LocalAgentSetupDeps {
  /** Hardware-tier detection (populates the store's hardware profile). */
  detect: () => Promise<void>;
  /** Pick a `supports_tool_calling` model id appropriate for this machine. */
  recommendModel: () => Promise<string>;
  /** True when the model file is already on disk (skip the download). */
  isModelDownloaded: (modelId: string) => boolean;
  /** Install the Goose agent binary (#7); resolves when the install finishes. */
  installAgent: () => Promise<void>;
  /** Download the chosen model; resolves when complete. */
  downloadModel: (modelId: string) => Promise<void>;
  /** Ensure the bundled llama-server is running with the chosen model. */
  ensureServerRunning: (modelId: string) => Promise<void>;
  /** Generate the Goose env against the live server (#8). */
  writeConfig: () => Promise<void>;
  /** Create (or reuse) the custom_acp preset connection; returns its id (#2). */
  createPresetConnection: (modelId: string) => Promise<string>;
  /** Point the interactive routing slot at the preset connection (#13). */
  routeInteractive: (connectionId: string) => void;
  /** Run the bounded smoke test (#12). */
  smokeTest: (connectionId: string) => Promise<SmokeTestReport>;
  /** Advance the persisted setup state machine (#15). */
  setStage: (next: {
    stage: LocalAgentSetupStage;
    failedStage?: LocalAgentActiveStage;
    error?: string;
    modelId?: string;
  }) => void;
  /** Clear the degraded flag once setup verifies healthy (#13). */
  clearDegraded: () => void;
  /** Optional progress breadcrumb (orb / activity entry). */
  onProgress?: (stage: LocalAgentActiveStage, message: string) => void;
}

export interface LocalAgentSetupResult {
  ok: boolean;
  /** On failure, the stage that failed. */
  failedStage?: LocalAgentActiveStage;
  error?: string;
}

function errMessage(err: unknown): string {
  return String((err as { message?: unknown })?.message ?? err ?? 'Unknown error');
}

/**
 * Drive the staged Local Agent setup. Each stage is attributed on failure so
 * the dialog (#17) and the cmd-bar notice (#20) can point the user at the right
 * place. Verification failure does NOT throw — it lands as a `failed` state at
 * the `verifying` stage so routing falls back to Path 4 (#13) and the user can
 * retry from the dialog.
 */
export async function runLocalAgentSetup(
  deps: LocalAgentSetupDeps,
): Promise<LocalAgentSetupResult> {
  let modelId = '';

  // detecting → recommend
  try {
    deps.setStage({ stage: 'detecting' });
    deps.onProgress?.('detecting', 'Checking hardware…');
    await deps.detect();
    modelId = await deps.recommendModel();
  } catch (err) {
    return fail(deps, 'detecting', err, modelId);
  }

  // downloading: install agent + download model in parallel
  try {
    deps.setStage({ stage: 'downloading', modelId });
    deps.onProgress?.('downloading', 'Installing agent and model…');
    await Promise.all([
      deps.installAgent(),
      deps.isModelDownloaded(modelId) ? Promise.resolve() : deps.downloadModel(modelId),
    ]);
  } catch (err) {
    return fail(deps, 'downloading', err, modelId);
  }

  // configuring: start server, write config, create connection, route
  let connectionId = '';
  try {
    deps.setStage({ stage: 'configuring', modelId });
    deps.onProgress?.('configuring', 'Configuring the local agent…');
    await deps.ensureServerRunning(modelId);
    await deps.writeConfig();
    connectionId = await deps.createPresetConnection(modelId);
    deps.routeInteractive(connectionId);
  } catch (err) {
    return fail(deps, 'configuring', err, modelId);
  }

  // verifying: smoke test (gate). A failed report is terminal-failed, not a throw.
  try {
    deps.setStage({ stage: 'verifying', modelId });
    deps.onProgress?.('verifying', 'Verifying the agent responds…');
    const report = await deps.smokeTest(connectionId);
    if (!report.ok) {
      const reason = report.error ?? `Verification failed at the ${report.stage} stage`;
      deps.setStage({ stage: 'failed', failedStage: 'verifying', error: reason, modelId });
      return { ok: false, failedStage: 'verifying', error: reason };
    }
  } catch (err) {
    return fail(deps, 'verifying', err, modelId);
  }

  deps.clearDegraded();
  deps.setStage({ stage: 'ready', modelId });
  return { ok: true };
}

function fail(
  deps: LocalAgentSetupDeps,
  stage: LocalAgentActiveStage,
  err: unknown,
  modelId: string,
): LocalAgentSetupResult {
  const error = errMessage(err);
  deps.setStage({ stage: 'failed', failedStage: stage, error, modelId });
  return { ok: false, failedStage: stage, error };
}
