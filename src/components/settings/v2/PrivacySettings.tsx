import { ApprovalsSettings as LegacyApprovalsSettings } from '../ApprovalsSettings';
import { SettingsGroup } from './SettingsGroup';

/**
 * Privacy settings panel (v2) — mounts the existing approvals UI.
 *
 * The legacy `ApprovalsSettings` owns a complex table of scoped approvals
 * (tool calls, skill scripts, ACP tools, domains) with per-row revoke and
 * bulk-revoke affordances. We treat it as a sealed box inside a v2 group
 * wrapper to avoid regressions in its internal layout.
 */
export function PrivacySettings() {
  return (
    <SettingsGroup
      label="Approvals"
      description="Manage persisted tool-call and domain approvals across connections and projects."
    >
      <div className="px-4 py-4">
        <LegacyApprovalsSettings />
      </div>
    </SettingsGroup>
  );
}
