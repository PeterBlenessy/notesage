import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConnectAgent } from './ConnectAgent';
import { ConnectCopilotLsp } from './ConnectCopilotLsp';
import { PROVIDER_OPTIONS } from '@/lib/ai/connections';
import type { Connection, ProviderOption } from '@/lib/ai/connections';
import { useConnectionsStore } from '@/stores/connections-store';
import { toast } from 'sonner';

/**
 * Resolve the `ProviderOption` that drives the install/auth flow for an existing
 * subscription connection, matched by its agent binary. LSP connections match on
 * `lspBinary`; ACP agents on `agentBinary`. Returns `null` for connections with
 * no matching built-in option (e.g. custom_acp / the Local Agent preset, which
 * are not re-auth-capable).
 */
export function findProviderOption(connection: Connection): ProviderOption | null {
  const creds = connection.credentials;
  if (creds.type !== 'agent_managed') return null;
  const bin = creds.agentBinary;
  if (bin === 'copilot-language-server') {
    return PROVIDER_OPTIONS.find((o) => o.lspBinary === 'copilot-language-server') ?? null;
  }
  return PROVIDER_OPTIONS.find((o) => o.agentBinary === bin) ?? null;
}

/**
 * In-app re-authentication for a subscription connection. Instead of opening a
 * terminal with a CLI login command, this reuses the SAME components that the
 * "Add Connection" flow uses — so re-auth is identical to initial sign-in:
 * a browser OAuth window (Claude Code / Codex), the GitHub device-code flow
 * (Copilot LSP), or the in-app credential form (Gemini EnvVar). Each of those
 * components keeps a terminal sign-in as its own last-resort fallback, so the
 * terminal is never the *primary* path.
 *
 * On success we don't create a new connection — the OAuth token was refreshed on
 * disk (or fresh env vars were entered); we just mark the existing connection
 * `connected` (and persist any new env vars through the keychain via
 * `updateConnection`).
 */
export function ReauthDialog({
  connection,
  open,
  onOpenChange,
}: {
  connection: Connection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateConnection = useConnectionsStore((s) => s.updateConnection);
  const option = useMemo(() => findProviderOption(connection), [connection]);

  if (!option) return null;
  const isLsp = !!option.lspBinary;

  const handleConnected = (_option: ProviderOption, envVars?: Record<string, string>) => {
    const creds = connection.credentials;
    if (
      !isLsp &&
      creds.type === 'agent_managed' &&
      envVars &&
      Object.keys(envVars).length > 0
    ) {
      // Gemini EnvVar re-auth: persist the freshly-entered values. updateConnection
      // routes them through the keychain exactly like addConnection does.
      updateConnection(connection.id, {
        status: 'connected',
        credentials: {
          type: 'agent_managed',
          agentBinary: creds.agentBinary,
          ...(creds.agentArgs ? { agentArgs: creds.agentArgs } : {}),
          envVars,
        },
      });
    } else {
      // Browser/device OAuth: the token was refreshed on disk; just clear the
      // error state on the existing connection.
      updateConnection(connection.id, { status: 'connected' });
    }
    toast.success(`${connection.label} re-authenticated`);
    setTimeout(() => onOpenChange(false), 600);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="text-sm">Re-authenticate {connection.label}</DialogTitle>
        </DialogHeader>
        {isLsp ? (
          <ConnectCopilotLsp
            option={option}
            onBack={() => onOpenChange(false)}
            onConnected={handleConnected}
          />
        ) : (
          <ConnectAgent
            option={option}
            onBack={() => onOpenChange(false)}
            onConnected={handleConnected}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
