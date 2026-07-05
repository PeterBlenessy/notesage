import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Loader2, AlertCircle, RefreshCw, Copy } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { log } from '@/lib/logger';
import type { ProviderOption } from '@/lib/ai/connections';
import type { CopilotSignInResponse, CopilotStatus } from '@/lib/tauri';
import { CONNECTION_TIMEOUT_MS, withTimeout, getInstallGuide, SetupGuideView } from './connection-utils';

const COPILOT_PATH = "M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z";
const COPILOT_EYES = "M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z";

function CopilotIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d={COPILOT_PATH} />
      <path d={COPILOT_EYES} />
    </svg>
  );
}

type CopilotLspPhase = 'checking' | 'not_installed' | 'signing_in' | 'device_code' | 'connected' | 'error';

export function ConnectCopilotLsp({
  option,
  onBack,
  onConnected,
}: {
  option: ProviderOption;
  onBack: () => void;
  onConnected: (option: ProviderOption) => void;
}) {
  const [phase, setPhase] = useState<CopilotLspPhase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const isRetryRef = useRef(false);
  const deviceCodeReceivedRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  // Listen for auth completion via didChangeStatus — attach BEFORE starting LSP
  // so we don't miss early "Normal" events from cached credentials.
  // Guard: onConnected must only be called ONCE per attempt.
  const authCompleted = useRef(false);

  const completeAuth = useCallback(() => {
    if (authCompleted.current) return; // already fired
    authCompleted.current = true;
    log.debug('settings', 'Auth succeeded, completing connection (once)');
    setPhase('connected');
    // Don't stop the LSP here — useCopilotCompletion will restart it with
    // the correct working directory. Stopping here races with the hook's start.
    onConnectedRef.current(option);
  }, [option]);

  useEffect(() => {
    authCompleted.current = false;

    const unlistenStatus = listen<{ message: string; kind: string }>(
      'copilot-status-changed',
      (event) => {
        const { message, kind } = event.payload;
        log.debug('settings', 'Copilot status changed', { kind, message });
        if (kind === 'Normal') {
          completeAuth();
        }
      }
    );

    // Listen for device code from server→client signIn request (fallback path).
    // When the direct signIn RPC returns an empty code, the LSP sends the
    // device code asynchronously via a server→client request handled in Rust.
    deviceCodeReceivedRef.current = false;
    const unlistenDeviceCode = listen<{ userCode: string; verificationUri: string }>(
      'copilot-auth-device-code',
      (event) => {
        const { userCode, verificationUri } = event.payload;
        log.debug('settings', 'Device code received via event', { userCode, verificationUri });
        if (userCode && !authCompleted.current) {
          deviceCodeReceivedRef.current = true;
          setDeviceCode(userCode);
          setPhase('device_code');
          // Auto-copy code to clipboard so it's ready when user opens GitHub
          navigator.clipboard.writeText(userCode).catch(() => {});
        }
      }
    );

    // Log ALL LSP messages during auth for debugging
    const unlistenLspMsg = listen<Record<string, unknown>>(
      'copilot-lsp-message',
      (event) => {
        log.debug('copilot-lsp', 'LSP message', event.payload);
        console.log('[Copilot LSP]', event.payload);
      }
    );

    return () => {
      unlistenStatus.then((fn) => fn());
      unlistenDeviceCode.then((fn) => fn());
      unlistenLspMsg.then((fn) => fn());
    };
  }, [completeAuth, retryCount]);

  // Check binary availability, start LSP, and sign in
  useEffect(() => {
    let active = true;
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
        log.debug('settings', 'Checking binary availability');
        const available = await withTimeout(
          invoke<boolean>('copilot_lsp_check_availability'),
          CONNECTION_TIMEOUT_MS,
          'Availability check',
        );
        log.debug('settings', 'Binary availability result', { available });
        if (!active) return;

        await endRetry();
        if (!available) {
          setPhase('not_installed');
          return;
        }

        // Binary found — start LSP and sign in
        setPhase('signing_in');

        log.debug('settings', 'Starting Copilot LSP');
        await withTimeout(
          invoke('copilot_lsp_start', { workingDirectory: '/tmp' }),
          CONNECTION_TIMEOUT_MS,
          'Starting Copilot',
        );
        log.debug('settings', 'Copilot LSP started');
        if (!active) return;

        // Check if already authenticated (status event arrived during init)
        if (authCompleted.current) {
          log.debug('settings', 'Already authenticated during LSP init, skipping signIn');
          return;
        }

        // Check status before attempting sign-in
        log.debug('settings', 'Checking Copilot LSP status');
        try {
          const status = await invoke<CopilotStatus>('copilot_lsp_status');
          log.debug('settings', 'Copilot LSP status', status);
          if (!active) return;

          if (status.authenticated) {
            completeAuth();
            return;
          }
        } catch (statusErr) {
          log.debug('settings', 'Status check failed (non-fatal)', statusErr);
        }

        log.debug('settings', `Calling copilot_lsp_sign_in (timeout: ${CONNECTION_TIMEOUT_MS}ms)`);
        const signInStart = Date.now();
        const result = await withTimeout(
          invoke<CopilotSignInResponse>(
            'copilot_lsp_sign_in'
          ),
          CONNECTION_TIMEOUT_MS,
          'Sign-in',
        );
        log.debug('settings', `signIn returned after ${Date.now() - signInStart}ms`, result);
        if (!active) return;

        // Check if the device code was already received via event while signIn was running
        if (deviceCodeReceivedRef.current) {
          log.debug('settings', 'Device code already received via event during signIn call — skipping result processing');
          return;
        }

        if (!result.user_code) {
          // Neither Phase 1 (signIn) nor Phase 2 (signInInitiate) returned a
          // device code. Wait for the LSP to send it asynchronously via a
          // server→client signIn request → copilot-auth-device-code event.
          log.debug('settings', 'Empty user_code from signIn — waiting for device code event or auth completion');
          if (!authCompleted.current) {
            // Wait up to 10 seconds for either the device code event or auth completion
            for (let i = 0; i < 20; i++) {
              await new Promise((r) => setTimeout(r, 500));
              if (!active || authCompleted.current || deviceCodeReceivedRef.current) {
                log.debug('settings', 'Wait resolved', { authCompleted: authCompleted.current, deviceCodeReceived: deviceCodeReceivedRef.current });
                return;
              }
            }
            if (!active) return;
            // Still nothing — show error
            log.error('settings', 'Timed out waiting for device code after signIn returned empty');
            setError('Sign-in timed out waiting for device code. You may already be authenticated — try removing and re-adding the connection.');
            setPhase('error');
          }
          return;
        }

        log.debug('settings', 'Got device code from signIn result', { userCode: result.user_code });
        setDeviceCode(result.user_code);
        setPhase('device_code');
        // Auto-copy code to clipboard so it's ready when user opens GitHub
        navigator.clipboard.writeText(result.user_code).catch(() => {});
      } catch (err) {
        if (!active) return;
        await endRetry();
        const msg = err instanceof Error ? err.message : String(err);
        log.error('settings', 'Copilot connection error', { error: msg });
        setError(msg);
        setPhase('error');
      }
    })();

    return () => {
      active = false;
    };
  }, [retryCount, completeAuth]);

  // Note: no LSP cleanup on unmount — useCopilotCompletion manages the lifecycle.
  // Stopping here would race with the hook restarting the LSP.

  const handleRetry = useCallback(() => {
    isRetryRef.current = true;
    setRetrying(true);
    setRetryCount((c) => c + 1);
  }, []);

  const handleCopyCode = useCallback(() => {
    if (deviceCode) {
      navigator.clipboard.writeText(deviceCode).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        },
        () => {}
      );
    }
  }, [deviceCode]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CopilotIcon className="w-5 h-5 shrink-0" />
        <span className="text-sm font-medium">{option.label}</span>
      </div>

      {phase === 'checking' && (
        <div className="flex items-center gap-2.5 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
          <span className="text-sm text-muted-foreground">
            Checking for copilot-language-server...
          </span>
        </div>
      )}

      {phase === 'not_installed' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {option.label} wasn't found on your system. Follow the steps below to install it.
          </p>
          <SetupGuideView guide={getInstallGuide('copilot-language-server')} />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
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
          </div>
        </div>
      )}

      {phase === 'signing_in' && (
        <div className="flex items-center gap-2.5 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
          <span className="text-sm text-muted-foreground">Starting Copilot...</span>
        </div>
      )}

      {phase === 'device_code' && deviceCode && (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-muted/50 border border-border text-center">
            <p className="text-xs text-muted-foreground mb-2">
              Enter this code on GitHub:
            </p>
            <div className="flex items-center justify-center gap-2">
              <span className="text-2xl font-mono font-bold tracking-widest">
                {deviceCode}
              </span>
              <button
                onClick={handleCopyCode}
                className="p-1 rounded hover:bg-muted transition-colors"
                title="Copy code"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-foreground" strokeWidth={2} />
                ) : (
                  <Copy className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                )}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {copied ? 'Copied!' : 'Copied to clipboard — click icon to copy again'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                // Trigger finishDeviceFlow (starts OAuth polling + opens browser)
                invoke('copilot_lsp_finish_auth').catch(() => {});
                // Also open the page ourselves in case the LSP's open fails
                window.open('https://github.com/login/device', '_blank');
              }}
              className="flex-1"
            >
              <CopilotIcon className="h-3.5 w-3.5 mr-1.5" />
              Open GitHub
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Waiting for authentication...
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
                  Connection failed
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
          </div>
        </div>
      )}
    </div>
  );
}
