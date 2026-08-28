/**
 * In-memory `localStorage`, installed as a side effect of importing this.
 *
 *     import "@/test/local-storage";   // FIRST import, before any store
 *
 * # Why this is needed at all
 *
 * Node has shipped its own `localStorage` global since v22. It is inert
 * unless the process was started with `--localstorage-file`, and vitest does
 * not pass that flag — so `globalThis.localStorage` exists as an own property
 * whose value is `undefined`. Because it is an own property, jsdom's real
 * implementation never lands in the global slot, and `window === globalThis`
 * under vitest's jsdom environment, so there is no second copy to fall back
 * to.
 *
 * Anything reading `localStorage` at module-init time then gets `undefined`.
 * For zustand's `persist` middleware that surfaces as
 * `Cannot read properties of undefined (reading 'setItem')` inside the
 * library, several frames from the test that triggered it — which is why the
 * symptom reads as a store bug rather than an environment one.
 *
 * # Why a side-effect import rather than a setupFile
 *
 * `vitest.config.ts` deliberately omits `setupFiles` so that a test can
 * install its own storage without fighting a global one. That reasoning still
 * holds, so this follows the same convention as `@/test/tauri-mock`: opt in
 * by importing it.
 *
 * # Why it must be the FIRST import
 *
 * ES module imports are evaluated in source order, and a zustand store reads
 * its storage while the module is being initialised — not on first use. An
 * import placed after the store under test runs too late to help.
 *
 * # Why not just pin Node to 22
 *
 * `.nvmrc` does pin 22, and CI honours it, which is why this was invisible in
 * CI while failing locally on Node 26. But a test suite that only passes on
 * one Node version is a trap for the next person, and the failure it produces
 * points at the wrong place. Node's own `localStorage` is not going away.
 */

const backing = new Map<string, string>();

const storage: Storage = {
  getItem: (key: string) => backing.get(key) ?? null,
  setItem: (key: string, value: string) => {
    backing.set(key, String(value));
  },
  removeItem: (key: string) => {
    backing.delete(key);
  },
  clear: () => {
    backing.clear();
  },
  get length() {
    return backing.size;
  },
  key: (index: number) => [...backing.keys()][index] ?? null,
};

// `configurable: true` so a test that wants its own mock can still replace
// this — installing storage must not take the option away from anyone.
Object.defineProperty(globalThis, "localStorage", {
  value: storage,
  writable: true,
  configurable: true,
});

// zustand's persist default reaches for `window.localStorage`, not the bare
// global. Under jsdom `window` already exists and is `globalThis`; this covers
// a node-environment test that imports a persisted store anyway.
if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}

/** Empty the backing store. For a test that wants a clean slate between cases. */
export function resetTestLocalStorage(): void {
  backing.clear();
}
