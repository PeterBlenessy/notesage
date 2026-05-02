import { useState, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';

// --- Connection timeout helper ---

export const CONNECTION_TIMEOUT_MS = 120_000;

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

// --- Setup guide types and data ---

export interface GuideStep {
  label?: string;
  command?: string;
  note?: string;
  url?: string;
}

export interface SetupGuide {
  title: string;
  steps: GuideStep[];
}

export function getInstallGuide(binary: string): SetupGuide {
  switch (binary) {
    case 'claude-agent-acp':
      return {
        title: 'Install Claude Code',
        steps: [
          { label: 'Install Node.js if you don\'t have it', url: 'https://nodejs.org' },
          { label: 'Run in your terminal:', command: 'npm install -g @agentclientprotocol/claude-agent-acp' },
          { label: 'Requires a Claude Pro or Max subscription', url: 'https://anthropic.com/claude' },
        ],
      };
    case 'codex-acp':
    case 'codex':
      return {
        title: 'Install OpenAI Codex',
        steps: [
          { label: 'Install Node.js if you don\'t have it', url: 'https://nodejs.org' },
          { label: 'Run in your terminal:', command: 'npm install -g @agentclientprotocol/codex-acp' },
          { label: 'Requires a ChatGPT Plus or Pro subscription' },
        ],
      };
    case 'copilot':
      return {
        title: 'Install GitHub Copilot CLI',
        steps: [
          { label: 'Install Node.js if you don\'t have it', url: 'https://nodejs.org' },
          { label: 'Run in your terminal:', command: 'npm install -g @github/copilot' },
          { label: 'Requires a GitHub Copilot subscription', url: 'https://github.com/features/copilot' },
        ],
      };
    case 'gemini':
      return {
        title: 'Install Google Gemini CLI',
        steps: [
          { label: 'Install Node.js if you don\'t have it', url: 'https://nodejs.org' },
          { label: 'Run in your terminal:', command: 'npm install -g @google/gemini-cli' },
          { label: 'Free with a Google account', url: 'https://github.com/google-gemini/gemini-cli' },
        ],
      };
    case 'copilot-language-server':
      return {
        title: 'Install Copilot Language Server',
        steps: [
          { label: 'Install Node.js if you don\'t have it', url: 'https://nodejs.org' },
          { label: 'Run in your terminal:', command: 'npm install -g @github/copilot-language-server' },
          { label: 'Requires a GitHub Copilot subscription', url: 'https://github.com/features/copilot' },
        ],
      };
    default:
      return {
        title: `Install ${binary}`,
        steps: [
          { label: `Install "${binary}" to continue` },
        ],
      };
  }
}

export function getAuthGuide(binary: string): SetupGuide {
  switch (binary) {
    case 'claude-agent-acp':
      return {
        title: 'Sign in to Claude',
        steps: [
          { label: 'Run in your terminal:', command: 'claude auth login' },
          { label: 'A browser window will open for sign-in', note: 'Requires Claude Pro or Max subscription' },
        ],
      };
    case 'codex-acp':
    case 'codex':
      return {
        title: 'Sign in to OpenAI',
        steps: [
          { label: 'Run in your terminal:', command: 'codex login --device-auth' },
          { note: 'Requires ChatGPT Plus or Pro subscription' },
        ],
      };
    case 'copilot':
      return {
        title: 'Sign in to GitHub',
        steps: [
          { label: 'Run in your terminal:', command: 'copilot auth login' },
          { note: 'Requires a GitHub Copilot subscription' },
        ],
      };
    case 'gemini':
      return {
        title: 'Sign in to Google',
        steps: [
          { label: 'Option 1 — Run Gemini CLI to sign in via browser:', command: 'cd /tmp && gemini' },
          { note: 'Choose "Sign in with Google" when prompted, complete sign-in in browser, then close the terminal session' },
          { label: 'Option 2 — Use an API key:', command: 'export GEMINI_API_KEY=your-key-here' },
          { note: 'Get a free API key from', url: 'https://aistudio.google.com/apikey' },
        ],
      };
    default:
      return {
        title: `Sign in to ${binary}`,
        steps: [
          { label: `Sign in to "${binary}" before connecting` },
        ],
      };
  }
}

// --- Setup guide UI components ---

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [command]);

  return (
    <div className="flex items-center gap-1.5 mt-1 rounded-md bg-muted/50 border border-border px-2.5 py-1.5 font-mono text-xs">
      <span className="flex-1 overflow-x-auto whitespace-nowrap select-all">{command}</span>
      <button
        onClick={handleCopy}
        className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
        title="Copy to clipboard"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" strokeWidth={1.5} />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
        )}
      </button>
    </div>
  );
}

function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [url]);

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <span className="text-xs text-muted-foreground select-all truncate">{url}</span>
      <button
        onClick={handleCopy}
        className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
        title="Copy URL"
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-500" strokeWidth={1.5} />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
        )}
      </button>
    </div>
  );
}

export function SetupGuideView({ guide }: { guide: SetupGuide }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <ol className="space-y-2.5">
        {guide.steps.map((step, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-xs text-muted-foreground font-medium mt-0.5 shrink-0 w-4 text-right">
              {step.label || step.note ? `${i + 1}.` : ''}
            </span>
            <div className="flex-1 min-w-0">
              {step.label && (
                <p className="text-sm text-foreground">{step.label}</p>
              )}
              {step.command && <CopyableCommand command={step.command} />}
              {step.url && <CopyableUrl url={step.url} />}
              {step.note && (
                <p className="text-xs text-muted-foreground mt-0.5 italic">{step.note}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// (Removed unused `ProviderPickerRow` — superseded by the canonical
// `<PickerItem>` / `<PickerCheckboxItem>` in `src/components/ui/picker-item.tsx`.
// Picker rows everywhere now compose `DropdownMenuPrimitive.RadioItem` /
// `CheckboxItem` from Radix, getting free keyboard navigation, ARIA roles,
// and focus management — which the plain-`<button>` ProviderPickerRow
// reinvented poorly.)
