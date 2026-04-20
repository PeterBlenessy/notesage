import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { getAuthGuide } from '@/components/settings/connection-utils';

// Agents whose sign-in flow can be triggered from the Re-authenticate path.
// Keyed by the raw agent_binary command name. Entries must have a terminal
// command in `getAuthGuide` (no-command entries would open Terminal to nothing).
const REAUTH_CAPABLE: ReadonlySet<string> = new Set([
  'claude-agent-acp',
  'codex-acp',
  'copilot',
  'copilot-language-server',
  'gemini',
]);

export function canReauthenticate(agentBinary: string): boolean {
  return REAUTH_CAPABLE.has(agentBinary);
}

/**
 * Trigger the agent's sign-in flow in a native Terminal window, reusing the
 * same command `getAuthGuide` drives the initial registration with.
 *
 * Falls back to clipboard copy when Terminal cannot be opened (non-macOS, or
 * the `run_in_terminal` command errors) so the user at least has the command
 * ready to paste.
 */
export async function reauthenticateAgent(
  agentBinary: string,
  label: string,
): Promise<void> {
  const guide = getAuthGuide(agentBinary);
  const cmd = guide.steps.find((s) => s.command)?.command;
  if (!cmd) {
    toast.error(`No known sign-in command for ${label}`);
    return;
  }

  try {
    await invoke('run_in_terminal', { command: cmd });
    toast.info(
      `Terminal opened — finish sign-in for ${label}, then retry your message.`,
      { duration: 8000 },
    );
  } catch (err) {
    try {
      await navigator.clipboard.writeText(cmd);
      toast.info(`Copied sign-in command to clipboard: ${cmd}`, { duration: 8000 });
    } catch {
      toast.error(
        `Could not open terminal. Run this yourself: ${cmd}. (${String(err)})`,
      );
    }
  }
}

/** Regexes matching ACP auth-failure errors we want to react to. */
const AUTH_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  /\b401\b/i,
  /\bunauthorized\b/i,
  /authentication\s+(required|failed)/i,
  /invalid\s+authentication/i,
  /invalid\s+api\s+key/i,
];

export function isAuthError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return AUTH_ERROR_PATTERNS.some((re) => re.test(raw));
}
