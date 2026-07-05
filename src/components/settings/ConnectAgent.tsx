import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Check, Loader2, AlertCircle, RefreshCw, Download, ExternalLink } from 'lucide-react';
import { ProviderLogo } from '@/components/ProviderLogo';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ProviderOption } from '@/lib/ai/connections';
import type { AcpSpawnResult, AuthEnvVar, AuthMethodInfo } from '@/lib/ai/acp-utils';
import type { AgentAvailability, BinaryResolution } from '@/lib/tauri';
import { CONNECTION_TIMEOUT_MS, withTimeout, getInstallGuide, getAuthGuide, SetupGuideView } from './connection-utils';

type AgentPhase = 'checking' | 'not_installed' | 'installing' | 'not_authenticated' | 'env_var_auth' | 'connecting' | 'authenticating' | 'connected' | 'error';

/** Extract the first `env_var` auth method from a spawn result, if any. */
function findEnvVarAuthMethod(methods: AuthMethodInfo[]): (AuthMethodInfo & { type: 'env_var' }) | null {
  for (const m of methods) {
    if (m.type === 'env_var') return m;
  }
  return null;
}

export function ConnectAgent({
  option,
  onBack,
  onConnected,
}: {
  option: ProviderOption;
  onBack: () => void;
  onConnected: (option: ProviderOption, envVars?: Record<string, string>) => void;
}) {
  const [phase, setPhase] = useState<AgentPhase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [installProgress, setInstallProgress] = useState<{ phase: string; progress: number; total: number; message: string } | null>(null);
  const [showManualGuide, setShowManualGuide] = useState(false);
  const [binarySource, setBinarySource] = useState<'managed' | 'system' | null>(null);
  /** Agent-advertised EnvVar auth method used when `phase === 'env_var_auth'`. */
  const [envVarMethod, setEnvVarMethod] = useState<(AuthMethodInfo & { type: 'env_var' }) | null>(null);
  /** User-entered values keyed by env var name. */
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const isRetryRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    let active = true;
    const binary = option.agentBinary!;
    const isRetry = isRetryRef.current;
    isRetryRef.current = false;
    const retryStart = isRetry ? Date.now() : 0;
    const endRetry = async () => {
      if (!isRetry) return;
      const elapsed = Date.now() - retryStart;
      if (elapsed < 600) await new Promise((r) => setTimeout(r, 600 - elapsed));
      setRetrying(false);
    };

    (async () => {
      // On retry, keep showing current guide — only reset on first load
      if (!isRetry) {
        setPhase('checking');
      }
      setError(null);

      try {
        const avail = await withTimeout(
          invoke<AgentAvailability>('acp_agent_check_availability', {
            agentId: binary,
          }),
          CONNECTION_TIMEOUT_MS,
          'Availability check',
        );
        if (!active) return;
        await endRetry();

        // Also check binary source via new resolver
        try {
          const resolution = await invoke<BinaryResolution | null>('agent_resolve_binary', { agentId: binary });
          if (resolution) {
            setBinarySource(resolution.source);
          }
        } catch {
          // Non-critical — source tracking is informational
        }

        if (!avail.installed) {
          setPhase('not_installed');
          return;
        }
      } catch (err) {
        if (!active) return;
        await endRetry();
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('timed out')) {
          setError(msg);
          setPhase('error');
        } else {
          setPhase('not_installed');
        }
        return;
      }

      // Phase 2: Spawn agent, read auth methods, and authenticate.
      //
      // Auth state now comes from the ACP `initialize` response — no CLI probes.
      // If the agent advertises `AuthMethod::EnvVar`, collect values via a generic
      // form and stop the probe agent; the caller will re-spawn with env vars.
      //
      // Stored-artifact fast path (PRD #10): for fresh "Add Connection" flows
      // there are no stored credentials yet, so the short-circuit wouldn't fire
      // anyway. Existing connections reconnect via `useAcpLifecycle` which can
      // short-circuit on `credentials.envVars` presence. We accept the one-time
      // probe spawn here (30s timeout; typical ~1–3s) in exchange for removing
      // the hardcoded CLI probes. If this becomes friction, a future pass can
      // short-circuit on `option.provider === 'google'` to skip the probe.
      await endRetry();
      setPhase('connecting');
      let instanceId: string | null = null;

      try {
        const result = await withTimeout(
          invoke<AcpSpawnResult>('acp_agent_spawn', {
            agentBinary: binary,
            agentArgs: option.agentArgs ?? null,
            role: 'interactive',
            workingDirectory: '/tmp',
          }),
          CONNECTION_TIMEOUT_MS,
          'Connection',
        );
        if (!active) {
          invoke('acp_agent_stop', { instanceId: result.instance_id }).catch(() => {});
          return;
        }
        instanceId = result.instance_id;

        // Pick the auth method. Agents can advertise BOTH an interactive OAuth
        // ("agent") method AND an API-key ("env_var") method — Codex offers
        // ChatGPT login *and* OPENAI_API_KEY. Prefer the OAuth method: only fall
        // back to the env_var credential form when env_var is the ONLY option
        // (e.g. Gemini, which can't open a browser from a subprocess). Without
        // this, Codex wrongly led with an API-key dialog.
        const agentMethod = result.auth_methods.find((m) => m.type === 'agent');
        const envVar = findEnvVarAuthMethod(result.auth_methods);
        if (envVar && !agentMethod) {
          invoke('acp_agent_stop', { instanceId }).catch(() => {});
          if (!active) return;
          setEnvVarMethod(envVar);
          const initial: Record<string, string> = {};
          for (const v of envVar.vars) initial[v.name] = '';
          setEnvValues(initial);
          setPhase('env_var_auth');
          return;
        }

        // Switch to authenticating phase — the agent may open a browser
        setPhase('authenticating');

        // Try to authenticate — some agents handle auth internally.
        // Pass the OAuth method id explicitly so a multi-method agent (e.g. Codex)
        // uses ChatGPT login rather than whichever method it lists first.
        // Use a shorter timeout (30s) since if the agent can't open a browser,
        // waiting longer won't help.
        try {
          await withTimeout(
            invoke('acp_agent_authenticate', { instanceId, methodId: agentMethod?.id ?? null }),
            30_000,
            'Authentication',
          );
        } catch (authErr) {
          const msg = String(authErr);
          if (!msg.toLowerCase().includes('not implemented')) {
            throw authErr;
          }
        }
        if (!active) {
          invoke('acp_agent_stop', { instanceId }).catch(() => {});
          return;
        }

        invoke('acp_agent_stop', { instanceId }).catch(() => {});

        setPhase('connected');
        onConnectedRef.current(option);
      } catch (err) {
        if (instanceId) {
          invoke('acp_agent_stop', { instanceId }).catch(() => {});
        }
        if (!active) return;
        // If spawn/auth failed, show the manual auth guide instead of a generic error
        // so users know exactly what to run
        setError(err instanceof Error ? err.message : String(err));
        setPhase('not_authenticated');
      }
    })();

    return () => { active = false; };
  }, [option, retryCount]);

  const binary = option.agentBinary!;
  const canManagedInstall = !!option.installMeta;

  const handleRetry = useCallback(() => {
    isRetryRef.current = true;
    setRetrying(true);
    setRetryCount((c) => c + 1);
  }, []);

  const handleManagedInstall = useCallback(async () => {
    setPhase('installing');
    setInstallProgress(null);
    setError(null);

    const unlisten = await listen<{ agent_id: string; phase: string; progress: number; total: number; message: string }>(
      'agent-install-progress',
      (event) => {
        if (event.payload.agent_id === binary) {
          setInstallProgress(event.payload);
        }
      },
    );

    try {
      await invoke('agent_install', { agentId: binary });
      setBinarySource('managed');
      // Trigger retry to proceed through the connection flow
      isRetryRef.current = true;
      setRetryCount((c) => c + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      unlisten();
    }
  }, [binary]);

  const retryButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRetry}
      disabled={retrying}
      className="flex-1"
    >
      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${retrying ? 'animate-spin' : ''}`} strokeWidth={1.5} />
      Retry
    </Button>
  );

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ProviderLogo provider={option.provider} className="w-5 h-5 shrink-0" />
        <span className="text-sm font-medium">{option.label}</span>
        {binarySource && phase === 'connected' && (
          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded border border-border">
            {binarySource === 'managed' ? 'Managed' : 'System'}
          </span>
        )}
      </div>

      {phase === 'checking' && (
        <div className="flex items-center gap-2.5 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
          <span className="text-sm text-muted-foreground">
            Checking for {binary}...
          </span>
        </div>
      )}

      {phase === 'not_installed' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {option.label} wasn't found on your system.
          </p>

          {canManagedInstall && !showManualGuide && (
            <>
              <Button
                size="sm"
                onClick={handleManagedInstall}
                className="w-full"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                Install {option.label}
              </Button>
              <button
                onClick={() => setShowManualGuide(true)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full text-center"
              >
                or install manually
              </button>
            </>
          )}

          {(!canManagedInstall || showManualGuide) && (
            <>
              <SetupGuideView guide={getInstallGuide(binary)} />
              {canManagedInstall && showManualGuide && (
                <button
                  onClick={() => setShowManualGuide(false)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full text-center"
                >
                  or install automatically
                </button>
              )}
            </>
          )}

          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
            {retryButton}
          </div>
        </div>
      )}

      {phase === 'installing' && (
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
            <span className="text-sm text-muted-foreground">
              {installProgress?.message || 'Preparing install...'}
            </span>
          </div>
          {installProgress && installProgress.total > 0 && (
            <Progress
              value={installProgress.total > 0 ? (installProgress.progress / installProgress.total) * 100 : 0}
              className="h-1.5"
            />
          )}
          <p className="text-[10px] text-muted-foreground capitalize">
            {installProgress?.phase || 'initializing'}
          </p>
        </div>
      )}

      {phase === 'env_var_auth' && envVarMethod && (
        <EnvVarAuthForm
          method={envVarMethod}
          values={envValues}
          onChange={setEnvValues}
          error={error}
          onSubmit={() => {
            const filled: Record<string, string> = {};
            for (const v of envVarMethod.vars) {
              const val = (envValues[v.name] ?? '').trim();
              if (val) filled[v.name] = val;
            }
            onConnectedRef.current(option, filled);
          }}
          onBack={onBack}
          onSignInWithTerminal={async () => {
            // Terminal fallback for OAuth-based methods that complement EnvVar auth.
            const guide = getAuthGuide(binary);
            const cmd = guide.steps.find((s) => s.command)?.command;
            if (cmd) {
              try {
                await invoke('run_in_terminal', { command: cmd });
              } catch {
                navigator.clipboard.writeText(cmd).catch(() => {});
              }
            }
          }}
        />
      )}

      {phase === 'not_authenticated' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {option.label} is installed but needs sign-in.
          </p>
          {error && (
            <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive/80 break-words">{error}</p>
            </div>
          )}

          <Button
            size="sm"
            className="w-full"
            onClick={async () => {
              const guide = getAuthGuide(binary);
              const cmd = guide.steps.find((s) => s.command)?.command;
              if (cmd) {
                try {
                  await invoke('run_in_terminal', { command: cmd });
                } catch {
                  if (cmd) navigator.clipboard.writeText(cmd).catch(() => {});
                }
              }
            }}
          >
            Sign in to {option.label}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Opens a terminal window to complete sign-in. Click Retry when done.
          </p>

          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
            {retryButton}
          </div>
        </div>
      )}

      {phase === 'connecting' && (
        <div className="space-y-2 py-2">
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
            <span className="text-sm text-muted-foreground">Starting agent...</span>
          </div>
        </div>
      )}

      {phase === 'authenticating' && (
        <div className="space-y-2 py-2">
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
            <span className="text-sm text-muted-foreground">Waiting for sign-in...</span>
          </div>
          <p className="text-xs text-muted-foreground pl-6.5">
            A browser window should open. Complete sign-in there, then return here.
          </p>
        </div>
      )}

      {phase === 'connected' && (
        <div className="flex items-center gap-2.5 py-3">
          <Check className="h-4 w-4 text-green-500" strokeWidth={2} />
          <span className="text-sm font-medium">Connected!</span>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium text-destructive">
                  {phase === 'error' && installProgress ? 'Install failed' : 'Connection failed'}
                </p>
                {error && (
                  <p className="text-xs text-destructive/80 mt-1 break-words">
                    {error}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
            {retryButton}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Generic form driven by the agent-advertised `AuthMethod::EnvVar` payload.
 * Renders one input per `vars[]` entry (password-style by default), shows the
 * optional `link` as a "Get yours at" helper, and offers a terminal sign-in
 * fallback for agents that support both OAuth and env-var auth.
 */
function EnvVarAuthForm({
  method,
  values,
  onChange,
  error,
  onSubmit,
  onBack,
  onSignInWithTerminal,
}: {
  method: AuthMethodInfo & { type: 'env_var' };
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  error: string | null;
  onSubmit: () => void;
  onBack: () => void;
  onSignInWithTerminal: () => Promise<void> | void;
}) {
  const requiredVars = method.vars.filter((v) => !v.optional);
  const allRequiredFilled = requiredVars.every((v) => (values[v.name] ?? '').trim().length > 0);

  const displayLabel = (v: AuthEnvVar) => (v.label && v.label.trim() ? v.label.trim() : v.name);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {method.description ?? `${method.name} — enter the required credentials to sign in.`}
      </p>

      {error && (
        <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20">
          <p className="text-xs text-destructive/80 break-words">{error}</p>
        </div>
      )}

      <div className="space-y-2.5">
        {method.vars.map((v) => (
          <div key={v.name} className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {displayLabel(v)}
              {v.optional && <span className="ml-1 text-[10px]">(optional)</span>}
            </Label>
            <Input
              type={v.secret ? 'password' : 'text'}
              placeholder={v.name}
              value={values[v.name] ?? ''}
              onChange={(e) => onChange({ ...values, [v.name]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && allRequiredFilled) onSubmit();
              }}
              className="text-sm h-8"
            />
          </div>
        ))}
      </div>

      <Button
        size="sm"
        className="w-full"
        disabled={!allRequiredFilled}
        onClick={onSubmit}
      >
        Connect
      </Button>

      {method.link && (
        <p className="text-[11px] text-muted-foreground text-center">
          Get yours at{' '}
          <button
            className="inline-flex items-center gap-0.5 underline hover:text-foreground transition-colors cursor-pointer"
            onClick={() => window.open(method.link!, '_blank')}
          >
            {(() => {
              try {
                return new URL(method.link).hostname.replace(/^www\./, '');
              } catch {
                return method.link;
              }
            })()}
            <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </p>
      )}

      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-[10px]">
          <span className="bg-background px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={onSignInWithTerminal}
      >
        Sign in via Terminal
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">
        Opens a terminal window to complete sign-in. Click Retry when done.
      </p>

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
          Back
        </Button>
      </div>
    </div>
  );
}
