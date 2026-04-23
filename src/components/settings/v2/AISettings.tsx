import * as React from 'react';
import { ConnectionsSettings } from '@/components/settings/ConnectionsSettings';
import { UseCaseRoutingSettings } from '@/components/settings/UseCaseRoutingSettings';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useSettingsStore } from '@/stores/settings-store';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';

/**
 * AI & Agents settings panel (v2).
 *
 * Chrome migration for Batch G10 / task #67 of the UI refresh. Behaviour is
 * identical to the legacy "AI Providers" tab in `SettingsDialog.tsx` — this
 * component only swaps the outer layout for the new v2 primitives
 * (`SettingsGroup` / `SettingsRow`). The underlying `ConnectionsSettings`
 * and `UseCaseRoutingSettings` components are mounted as sealed blocks so
 * their rich internal layouts (connection cards, add-connection popover,
 * per-use-case routing dropdowns) render unchanged.
 *
 * Persisted approvals live in the Privacy panel (#66); the group below
 * is navigational only, dispatching a `notesage:open-settings-panel`
 * CustomEvent that the legacy shell / future v2 dialog will listen for.
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
  const searchProvider = useSettingsStore((s) => s.searchProvider);

  const openPrivacyPanel = React.useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('notesage:open-settings-panel', {
        detail: { panel: 'privacy' },
      }),
    );
  }, []);

  return (
    <div data-slot="ai-settings">
      {/* Connections — rich content is owned by ConnectionsSettings; mount
          directly (no SettingsGroup wrapper) so we don't double-border the
          connection cards. */}
      <section className="mb-10" aria-labelledby="ai-connections-label">
        <h3
          id="ai-connections-label"
          className="text-[10.5px] font-medium tracking-wider uppercase text-muted-foreground mb-3"
        >
          Connections
        </h3>
        <p className="text-[12px] text-muted-foreground mb-3 max-w-[460px] leading-relaxed">
          Where Notesage talks to. Keys, agents, local models.
        </p>
        <ConnectionsSettings />
      </section>

      {/* Routing — same rationale as Connections: UseCaseRoutingSettings
          draws its own collapsible / per-slot layout. */}
      <section className="mb-10" aria-labelledby="ai-routing-label">
        <h3
          id="ai-routing-label"
          className="text-[10.5px] font-medium tracking-wider uppercase text-muted-foreground mb-3"
        >
          Routing
        </h3>
        <p className="text-[12px] text-muted-foreground mb-3 max-w-[460px] leading-relaxed">
          Pick which provider handles each use case — interactive chat, agent
          tasks, inline completions.
        </p>
        <UseCaseRoutingSettings />
      </section>

      <SettingsGroup
        label="Tool calling"
        description="How Notesage invokes tools on your behalf during AI chat."
      >
        <SettingsRow
          label="Enable tool calling"
          description="Allow models to autonomously call built-in tools (read/write files, web search, execute skill scripts)."
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
        <SettingsRow
          label="Web search provider"
          description="Backend used by the built-in web_search tool."
          control={
            <span
              className="text-[13px] text-muted-foreground capitalize"
              data-testid="ai-search-provider"
            >
              {searchProvider === 'duckduckgo' ? 'DuckDuckGo' : searchProvider}
            </span>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label="Network sandbox"
        description="Per-connection settings live in each connection's config dialog. These are the app-level defaults."
      >
        <SettingsRow
          label="Sandbox is configured per connection"
          description="Open a connection above to set its filesystem sandbox, network restriction, kernel enforcement, and domain allowlist. New agent connections start with kernel enforcement on."
        />
      </SettingsGroup>

      <SettingsGroup
        label="Persisted approvals"
        description="Tool-call and domain approvals you've remembered via 'Allow always'. Managed from the Privacy panel."
      >
        <SettingsRow
          label="Manage persisted approvals"
          description="Review and revoke remembered approvals for tool calls and domains."
          control={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openPrivacyPanel}
              aria-label="Open Privacy settings"
            >
              Open Privacy settings
            </Button>
          }
        />
      </SettingsGroup>
    </div>
  );
}
