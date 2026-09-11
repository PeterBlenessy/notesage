import { useState, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';
import { t } from '@/lib/i18n';

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
        title: t("install.claudeCode"),
        steps: [
          { label: t("install.nodejs"), url: 'https://nodejs.org' },
          { label: t("install.runInTerminal"), command: 'npm install -g @agentclientprotocol/claude-agent-acp' },
          { label: t("install.needsClaudeSub"), url: 'https://anthropic.com/claude' },
        ],
      };
    case 'codex-acp':
    case 'codex':
      return {
        title: t("install.codex"),
        steps: [
          { label: t("install.nodejs"), url: 'https://nodejs.org' },
          { label: t("install.runInTerminal"), command: 'npm install -g @agentclientprotocol/codex-acp' },
          { label: t("install.needsChatgptSub") },
        ],
      };
    case 'copilot':
      return {
        title: t("install.copilotCli"),
        steps: [
          { label: t("install.nodejs"), url: 'https://nodejs.org' },
          { label: t("install.runInTerminal"), command: 'npm install -g @github/copilot' },
          { label: t("install.needsCopilotSub"), url: 'https://github.com/features/copilot' },
        ],
      };
    case 'gemini':
      return {
        title: t("install.geminiCli"),
        steps: [
          { label: t("install.nodejs"), url: 'https://nodejs.org' },
          { label: t("install.runInTerminal"), command: 'npm install -g @google/gemini-cli' },
          { label: t("install.geminiFree"), url: 'https://github.com/google-gemini/gemini-cli' },
        ],
      };
    case 'copilot-language-server':
      return {
        title: t("install.copilotLsp"),
        steps: [
          { label: t("install.nodejs"), url: 'https://nodejs.org' },
          { label: t("install.runInTerminal"), command: 'npm install -g @github/copilot-language-server' },
          { label: t("install.needsCopilotSub"), url: 'https://github.com/features/copilot' },
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
        title: t("signin.claude"),
        steps: [
          { label: t("install.runInTerminal"), command: 'claude auth login' },
          { label: t("signin.browserOpens"), note: t("signin.needsClaudeSub") },
        ],
      };
    case 'codex-acp':
    case 'codex':
      return {
        title: t("signin.openai"),
        steps: [
          { label: t("install.runInTerminal"), command: 'codex login --device-auth' },
          { note: t("signin.needsChatgptSub") },
        ],
      };
    case 'copilot':
      return {
        title: t("signin.github"),
        steps: [
          { label: t("install.runInTerminal"), command: 'copilot auth login' },
          { note: t("install.needsCopilotSub") },
        ],
      };
    case 'gemini':
      return {
        title: t("signin.google"),
        steps: [
          { label: t("signin.geminiOption1"), command: 'cd /tmp && gemini' },
          { note: t("signin.geminiBrowserNote") },
          { label: t("signin.geminiOption2"), command: 'export GEMINI_API_KEY=your-key-here' },
          { note: t("signin.geminiKeyFrom"), url: 'https://aistudio.google.com/apikey' },
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
        title={t("common.copyToClipboard")}
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
        title={t("common.copyUrl")}
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
