import { useSyncExternalStore } from "react";

/**
 * Whether the native navigation stack is actually on screen.
 *
 * NOT the same question as "is the flag on", and the difference is a trap:
 * the top row of chrome (back, breadcrumb, "…") is suppressed because the
 * navigation bar provides it, so keying that on the flag alone would strip the
 * back button on any build where the stack failed to present — desktop dev,
 * the vitest suite, a build without the plugin, or an iOS version where
 * `present` threw. A screen with no way back is a worse failure than no native
 * navigation at all.
 *
 * A module-level store rather than React state because the two readers sit in
 * different trees: the hook that presents the stack lives at the app root, and
 * the chrome hook runs inside whichever screen is mounted.
 */
let presented = false;
const listeners = new Set<() => void>();

export function setNavShellPresented(value: boolean): void {
  if (presented === value) return;
  presented = value;
  for (const listener of listeners) listener();
}

export function isNavShellPresented(): boolean {
  return presented;
}

export function useNavShellPresented(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => presented,
    () => false,
  );
}
