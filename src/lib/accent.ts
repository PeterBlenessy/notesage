/**
 * Accent color scaffolding for the UI refresh.
 *
 * Three named accents: "orange", "blue", "system" (macOS NSColor.controlAccentColor).
 * "default" means no accent applied — `--accent` is unset and consumers fall back
 * to the neutral `--primary` via `var(--accent, var(--primary))`.
 *
 * The accent class is applied to `<html>` (`document.documentElement`); the per-theme
 * oklch values come from the corresponding `.accent-*` rules in `globals.css`.
 *
 * For the `"system"` accent, the macOS-side oklch string is fetched at runtime via
 * the `get_system_accent_color` Tauri command and pushed onto `--accent-system-value`
 * via `setSystemAccentValue`.
 *
 * No UI yet — task #6 will swap `var(--primary)` → `var(--accent, var(--primary))`
 * at the primary-affordance sites.
 */

export type AccentName = 'default' | 'orange' | 'blue' | 'system';

const ACCENT_CLASSES: ReadonlyArray<string> = ['accent-orange', 'accent-blue', 'accent-system'];

/**
 * Toggle the accent class on `document.documentElement`.
 * Always removes any previously-set accent class before applying the new one.
 * "default" removes all accent classes (consumers fall back to `--primary`).
 */
export function setAccent(name: AccentName): void {
  const root = document.documentElement;
  for (const cls of ACCENT_CLASSES) {
    root.classList.remove(cls);
  }
  if (name === 'orange') {
    root.classList.add('accent-orange');
  } else if (name === 'blue') {
    root.classList.add('accent-blue');
  } else if (name === 'system') {
    root.classList.add('accent-system');
  }
  // 'default' — no class added.
}

/**
 * Set the `--accent-system-value` CSS custom property on `document.documentElement`.
 * Pass `null` to remove the property (the `.accent-system` class falls back to its
 * default oklch value when the property is unset).
 *
 * Used by `useAccent` to push the macOS NSColor.controlAccentColor result into CSS.
 */
export function setSystemAccentValue(oklchString: string | null): void {
  const root = document.documentElement;
  if (oklchString === null) {
    root.style.removeProperty('--accent-system-value');
  } else {
    root.style.setProperty('--accent-system-value', oklchString);
  }
}
