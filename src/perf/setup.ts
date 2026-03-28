/**
 * Setup file for performance benchmark tests.
 *
 * Polyfills localStorage for Zustand persist middleware in jsdom.
 * jsdom may provide a Storage object but some versions return a
 * non-functional stub.
 */

const existing = typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
if (!existing || typeof existing.setItem !== 'function') {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true, configurable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: storage, writable: true, configurable: true });
  }
}
