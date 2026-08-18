import { useSyncExternalStore } from "react";
import { getLocale, getFormatLocale, subscribeLocale, type Locale } from "@/lib/i18n";

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
 * The locale to pass `Intl` / `toLocaleDateString`, re-rendering the component
 * when the user changes language (#705).
 *
 * `undefined` means "follow the OS", which is what every call site did
 * implicitly before this existed — so adopting the hook is behaviour-preserving
 * until someone actually picks a language in Settings.
 */
export function useFormatLocale(): string | undefined {
  return useSyncExternalStore(subscribeLocale, getFormatLocale, getFormatLocale);
}
