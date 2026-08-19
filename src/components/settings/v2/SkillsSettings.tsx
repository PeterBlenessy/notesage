import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings-store';
import { PromptsSettings as LegacyPromptsSettings } from '../PromptsSettings';
import { SkillsSettings as LegacySkillsSettings } from '../SkillsSettings';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';

/**
 * Skills settings panel (v2).
 *
 * Consolidation 2026-04-26: the "Skill & Agent Management" toggle moved
 * here from Advanced > Experimental — it gates delete/move actions on the
 * Skills & Agents list below, so the toggle and the list belong together.
 *
 * The "Custom Prompts" and "Skills & Agents" groups use the `bare` opt-out
 * because they wrap heavy legacy components that own their own internal
 * section headers, cards, and chrome — putting them inside the tinted
 * island would double up surfaces. A proper refactor splits the legacy
 * `SkillsSettings` into separate Skills / Agents / Instructions panels
 * (tracked separately).
 */
export function SkillsSettings() {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const skillManagement = useSettingsStore((s) => s.skillManagement);
  const setSkillManagement = useSettingsStore((s) => s.setSkillManagement);

  return (
    <>
      <SettingsGroup label={t("settings.management")}>
        <SettingsRow
          label={t("settings.skillAgentManagement")}
          description={t("settings.skillAgentManagementDesc")}
          htmlFor="skill-management"
          control={
            <Switch
              id="skill-management"
              checked={skillManagement}
              onCheckedChange={setSkillManagement}
            />
          }
        />
      </SettingsGroup>

      {/* Library — the legacy `<SkillsSettings>` component renders its
          own "Skills" + "Agents" sub-headers, so the outer group label
          would just duplicate the panel title. Group is `bare` and
          unlabeled, acting purely as a sealed mount point. */}
      <SettingsGroup bare>
        <div className="py-2">
          <LegacySkillsSettings />
        </div>
      </SettingsGroup>

      <SettingsGroup label={t("settings.customPrompts")} bare>
        <div className="py-2">
          <LegacyPromptsSettings />
        </div>
      </SettingsGroup>
    </>
  );
}
