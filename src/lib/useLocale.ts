import { useSyncExternalStore } from "react";
import { getLocale, subscribeLocale, getFormattingLocale, type Locale } from "@/lib/i18n";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * Subscribe a component to locale changes (#653). `t()` reads module state,
 * so a component that calls it must also re-render when the language
 * changes — this hook is that subscription. `useSyncExternalStore` keeps it
 * correct under concurrent rendering without a provider to mount.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/**
 * Locale to pass to `toLocaleDateString()` / `Intl.*` constructors (#705).
 * Reads the Settings language override directly (not the resolved `t()`
 * locale) so that "no override" keeps following the OS locale verbatim —
 * even for an OS locale Notesage doesn't have UI strings for, where
 * `useLocale()` would resolve to the English UI fallback but date/number
 * formatting has no such fallback need.
 */
export function useFormattingLocale(): string | undefined {
  const override = useSettingsStore((s) => s.locale);
  return getFormattingLocale(override);
}
