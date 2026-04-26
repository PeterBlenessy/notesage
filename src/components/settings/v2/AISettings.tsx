import { ConnectionsSettings } from '@/components/settings/ConnectionsSettings';
import { UseCaseRoutingSettings } from '@/components/settings/UseCaseRoutingSettings';
import { ApprovalsSettings as LegacyApprovalsSettings } from '@/components/settings/ApprovalsSettings';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings-store';
import { SettingsGroup } from './SettingsGroup';
import { SettingsHint } from './SettingsHint';
import { SettingsRow } from './SettingsRow';

/**
 * AI & Agents settings panel (v2).
 *
 * Consolidation 2026-04-26: this panel absorbs the standalone Privacy
 * panel (approvals are inlined at the bottom) and the AI-relevant scope
 * toggles previously in Advanced (Cross-Project Mode, Show Agent Mode
 * Picker). The Privacy panel is removed from the nav. Tool Calling and
 * Web Search live here only — duplicates were dropped from Advanced.
 */
export function AISettings() {
  const toolCallingEnabled = useSettingsStore((s) => s.toolCallingEnabled);
  const setToolCallingEnabled = useSettingsStore((s) => s.setToolCallingEnabled);
  const requireAllToolConfirmations = useSettingsStore(
    (s) => s.requireAllToolConfirmations,
  );
  const setRequireAllToolConfirmations = useSettingsStore(
    (s) => s.setRequireAllToolConfirmations,
  );
  const crossProjectMode = useSettingsStore((s) => s.crossProjectMode);
  const setCrossProjectMode = useSettingsStore((s) => s.setCrossProjectMode);
  const showAgentModePicker = useSettingsStore((s) => s.showAgentModePicker);
  const setShowAgentModePicker = useSettingsStore((s) => s.setShowAgentModePicker);

  return (
    <div data-slot="ai-settings">
      {/* Connections — `bare` so the bordered connection cards inside
          ConnectionsSettings don't double up with the tinted-island
          surface that non-bare groups paint. */}
      <SettingsGroup
        label="Connections"
        description="Connect to AI providers Notesage can talk to. Add subscription-based agents (Claude Code, Codex, Copilot, Gemini), API-key providers (Anthropic, OpenAI, OpenAI-compatible), or an Ollama server, and check for managed-agent updates from here."
        bare
      >
        <div className="py-2">
          <ConnectionsSettings />
        </div>
      </SettingsGroup>

      {/* Use Case Mapping — non-bare so the flat divide-y rows from
          UseCaseRoutingSettings sit on the standard tinted island,
          matching Tool Calling / Project Scope below. */}
      <SettingsGroup
        label="Use Case Mapping"
        description="Pick which provider handles each use case — interactive chat, agent tasks, inline completions. New connections are auto-assigned to any slot they're compatible with."
      >
        <UseCaseRoutingSettings />
      </SettingsGroup>

      <SettingsGroup
        label="Tool Calling"
        description="How Notesage invokes tools on your behalf during AI chat."
      >
        <SettingsRow
          label="Enable tool calling"
          description="Allow models to autonomously call built-in tools — read/write files, execute skill scripts, and web search. Web search uses each provider's native backend where available (Anthropic, OpenAI); for local AI and Ollama, queries are sent to DuckDuckGo."
          htmlFor="ai-tool-calling-enabled"
          control={
            <Switch
              id="ai-tool-calling-enabled"
              checked={toolCallingEnabled}
              onCheckedChange={setToolCallingEnabled}
              aria-label="Enable tool calling"
            />
          }
        />
        <SettingsRow
          label="Require confirmation for every tool call"
          description="Prompt for approval on every tool call, even read-only ones."
          htmlFor="ai-require-all-confirmations"
          control={
            <Switch
              id="ai-require-all-confirmations"
              checked={requireAllToolConfirmations}
              onCheckedChange={setRequireAllToolConfirmations}
              aria-label="Require confirmation for every tool call"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label="Project Scope"
        description="How AI features see your projects."
      >
        <SettingsRow
          label="Cross-project mode"
          description={
            <>
              Exposes{' '}
              <span className="font-medium text-foreground">
                all workspace folders
              </span>{' '}
              to the AI agent — disables project isolation. Only enable for
              power-user workflows that explicitly need multi-project
              visibility. A persistent banner appears in the chat panel while
              this is on.
            </>
          }
          htmlFor="cross-project-mode"
          control={
            <Switch
              id="cross-project-mode"
              checked={crossProjectMode}
              onCheckedChange={setCrossProjectMode}
            />
          }
        />
        <SettingsRow
          label="Show agent mode picker"
          description="Show a mode picker in the chat footer for agents that support permission modes — Read Only, Agent, Full Access, Plan. When off, the agent's default mode is used."
          htmlFor="show-agent-mode-picker"
          control={
            <Switch
              id="show-agent-mode-picker"
              checked={showAgentModePicker}
              onCheckedChange={setShowAgentModePicker}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup label="Network Sandbox" bare>
        <SettingsHint title="Sandbox is configured per connection">
          <p>
            Open a connection above to set its filesystem sandbox, network
            restriction, kernel enforcement, and domain allowlist. New agent
            connections start with kernel enforcement on.
          </p>
        </SettingsHint>
      </SettingsGroup>

      <SettingsGroup
        label="Persisted Approvals"
        description="Tool-call and domain approvals you've remembered via 'Allow always'. Revoke individually or in bulk."
        bare
      >
        {/* `bare` opts out of the tinted-island styling so the legacy
            approvals table doesn't double up with another surface. */}
        <div className="py-2">
          <LegacyApprovalsSettings />
        </div>
      </SettingsGroup>
    </div>
  );
}
