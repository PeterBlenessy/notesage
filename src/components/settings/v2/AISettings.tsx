import { ConnectionsSettings } from '@/components/settings/ConnectionsSettings';
import { UseCaseRoutingSettings } from '@/components/settings/UseCaseRoutingSettings';
import { ApprovalsSettings as LegacyApprovalsSettings } from '@/components/settings/ApprovalsSettings';
import { SandboxActivitySettings } from '@/components/settings/SandboxActivitySettings';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { useSettingsStore } from '@/stores/settings-store';
import { trackSettingToggle } from '@/lib/telemetry';
import { SettingsGroup } from './SettingsGroup';
import { SettingsHint } from './SettingsHint';
import { SettingsRow } from './SettingsRow';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';

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
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
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
  const maxConcurrentSessions = useSettingsStore((s) => s.maxConcurrentSessions);
  const setMaxConcurrentSessions = useSettingsStore((s) => s.setMaxConcurrentSessions);
  const notifyPermissionRequest = useSettingsStore((s) => s.notifyPermissionRequest);
  const setNotifyPermissionRequest = useSettingsStore((s) => s.setNotifyPermissionRequest);

  return (
    <div data-slot="ai-settings">
      {/* Connections — `bare` so the bordered connection cards inside
          ConnectionsSettings don't double up with the tinted-island
          surface that non-bare groups paint. */}
      <SettingsGroup
        label={t("settings.connections")}
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
        label={t("settings.useCaseMapping")}
        description="Pick which provider handles each use case — interactive chat, agent tasks, inline completions. New connections are auto-assigned to any slot they're compatible with."
      >
        <UseCaseRoutingSettings />
      </SettingsGroup>

      {/* ----------------------------------------------------------------
          Permission scopes — a section heading that collects the four
          access/isolation groups (Tool Calling, Project Scope, Network
          Sandbox, Persisted Approvals) under a label matching the
          codebase vocabulary (*Scope types, getChatSandboxScope, etc.).
          "privacy" is kept as a search synonym so users who remember the
          old label can still find these controls.
          ---------------------------------------------------------------- */}
      <div data-section="permission-scopes">
        <h3 className="text-[11px] font-semibold tracking-wider uppercase text-foreground mb-1">
          Permission scopes
        </h3>
        <p className="text-[12px] text-muted-foreground mb-4 leading-relaxed">
          What AI agents may access and do — tool-calling permissions, project
          isolation, network reach, and persisted approvals. Maps to the
          <code className="mx-1 text-[11px] font-mono">*Scope</code>types used
          throughout the codebase.
        </p>
      </div>

      <SettingsGroup
        label={t("settings.toolCalling")}
        description={t("settings.toolCallingDesc")}
        searchKeywords={['privacy']}
      >
        <SettingsRow
          label={t("settings.enableToolCalling")}
          description="Allow models to autonomously call built-in tools — read/write files, execute skill scripts, and web search. Web search uses each provider's native backend where available (Anthropic, OpenAI); for local AI and Ollama, queries are sent to DuckDuckGo."
          htmlFor="ai-tool-calling-enabled"
          control={
            <Switch
              id="ai-tool-calling-enabled"
              checked={toolCallingEnabled}
              onCheckedChange={(v) => { setToolCallingEnabled(v); trackSettingToggle("tool_calling", v); }}
              aria-label={t("settings.enableToolCalling")}
            />
          }
        />
        <SettingsRow
          label={t("settings.requireConfirmation")}
          description={t("settings.requireConfirmationDesc")}
          htmlFor="ai-require-all-confirmations"
          control={
            <Switch
              id="ai-require-all-confirmations"
              checked={requireAllToolConfirmations}
              onCheckedChange={(v) => { setRequireAllToolConfirmations(v); trackSettingToggle("require_all_tool_confirmations", v); }}
              aria-label={t("settings.requireConfirmation")}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label={t("settings.projectScope")}
        description={t("settings.projectScopeDesc")}
        searchKeywords={['privacy']}
      >
        <SettingsRow
          label={t("settings.crossProjectMode")}
          description={
            <>
              Exposes{' '}
              <span className="font-medium text-foreground">
                all workspace folders
              </span>{' '}
              to the AI agent — disables project isolation. Only enable for
              power-user workflows that explicitly need multi-project
              visibility. A persistent banner appears in the command bar
              while this is on.
            </>
          }
          htmlFor="cross-project-mode"
          control={
            <Switch
              id="cross-project-mode"
              checked={crossProjectMode}
              onCheckedChange={(v) => { setCrossProjectMode(v); trackSettingToggle("cross_project", v); }}
            />
          }
        />
        <SettingsRow
          label={t("settings.showAgentModePicker")}
          description={t("settings.showAgentModePickerDesc")}
          htmlFor="show-agent-mode-picker"
          control={
            <Switch
              id="show-agent-mode-picker"
              checked={showAgentModePicker}
              onCheckedChange={(v) => { setShowAgentModePicker(v); trackSettingToggle("agent_mode_picker", v); }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label={t("settings.sessions")}
        description={t("settings.sessionsDesc")}
        searchKeywords={['concurrent', 'queue', 'multitask', 'parallel']}
      >
        <SettingsRow
          label={t("settings.maxConcurrentSessions")}
          description="How many AI conversations can run at the same time. Further sends wait in a queue and start automatically as sessions finish. Lower this if your machine struggles with several agents at once."
          control={
            <div className="w-[180px]">
              <Slider
                value={[maxConcurrentSessions]}
                onValueChange={([v]) => setMaxConcurrentSessions(v)}
                min={3}
                max={5}
                step={1}
                aria-label={t("settings.maxConcurrentSessions")}
              />
            </div>
          }
          controlSublabel={String(maxConcurrentSessions)}
        />
        <SettingsRow
          label={t("settings.notifyBackgroundPermission")}
          description={t("settings.notifyBackgroundPermissionDesc")}
          htmlFor="notify-permission-request"
          control={
            <Switch
              id="notify-permission-request"
              checked={notifyPermissionRequest}
              onCheckedChange={setNotifyPermissionRequest}
              aria-label={t("settings.notifyBackgroundPermission")}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup label={t("settings.networkSandbox")} bare>
        <SettingsHint title={t("settings.sandboxPerConnection")}>
          <p>
            Open a connection above to set its filesystem sandbox, network
            restriction, kernel enforcement, and domain allowlist. New agent
            connections start with kernel enforcement on.
          </p>
        </SettingsHint>
      </SettingsGroup>

      <SettingsGroup
        label={t("settings.sandboxActivity")}
        description={t("settings.sandboxActivityDesc")}
        searchKeywords={['privacy', 'proxy', 'observability']}
        bare
      >
        <SandboxActivitySettings />
      </SettingsGroup>

      <SettingsGroup
        label={t("settings.persistedApprovals")}
        description={t("settings.persistedApprovalsDesc")}
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
