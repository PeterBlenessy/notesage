import { useSettingsStore } from '@/stores/settings-store';

export function debugLog(...args: unknown[]): void {
  if (useSettingsStore.getState().debugLogging) {
    console.log(...args);
  }
}
