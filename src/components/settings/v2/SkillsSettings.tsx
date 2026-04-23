import { PromptsSettings as LegacyPromptsSettings } from '../PromptsSettings';
import { SkillsSettings as LegacySkillsSettings } from '../SkillsSettings';
import { SettingsGroup } from './SettingsGroup';

/**
 * Skills settings panel (v2) — hosts the existing dense Skills & Prompts UI
 * inside v2 shell wrappers. The legacy inner components own their own layout;
 * we treat them as sealed boxes mounted inside labelless `SettingsGroup`
 * containers so the panel blends with the rest of the v2 shell.
 */
export function SkillsSettings() {
  return (
    <>
      <SettingsGroup label="Custom Prompts">
        <div className="px-4 py-4">
          <LegacyPromptsSettings />
        </div>
      </SettingsGroup>

      <SettingsGroup label="Skills & Agents">
        <div className="px-4 py-4">
          <LegacySkillsSettings />
        </div>
      </SettingsGroup>
    </>
  );
}
