import { useSyncExternalStore } from "react";
import { getLocale, subscribeLocale, type Locale } from "@/lib/i18n";

/**
 * Subscribe a component to locale changes (#653). `t()` reads module state,
 * so a component that calls it must also re-render when the language
 * changes — this hook is that subscription. `useSyncExternalStore` keeps it
 * correct under concurrent rendering without a provider to mount.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
