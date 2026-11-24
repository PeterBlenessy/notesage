/**
 * Rehydration error handling for zustand `persist` stores.
 *
 * When a store's saved value cannot be rehydrated (the JSON is damaged, or
 * `migrate` / `merge` throws on its shape), zustand swallows the error and
 * the store simply starts on its defaults — with nothing logged, nothing
 * shown, and the next state change saving those defaults over the value that
 * failed to load. A workspace store that did this came up with no projects.
 *
 * So every persisted store routes its rehydration error here: it is logged,
 * the raw saved string is copied aside before anything can overwrite it, and
 * the user is told once.
 */
import { toast } from "sonner";
import { t } from "@/lib/i18n";

// The logger is loaded on demand, not imported: this module is pulled in by
// every persisted store, and the logger touches `window` when it loads —
// which the stores themselves never needed (several are used from tests and
// tooling with no DOM). It is only wanted on the error path anyway.
function logStore(level: "warn" | "error", message: string, detail: unknown): void {
  void import("@/lib/logger")
    .then(({ log }) => log[level]("store", message, detail))
    .catch(() => console.error(`[store] ${message}`, detail));
}

/** localStorage key the unusable raw value of `storeName` is kept under. */
export function corruptBackupKey(storeName: string): string {
  return `${storeName}.corrupt`;
}

/**
 * Stores hydrate while the app is still booting, and sonner drops toasts
 * raised before its `<Toaster>` has mounted — so the toast waits a moment.
 */
const REHYDRATE_TOAST_DELAY_MS = 1500;
let toastShown = false;

/**
 * Copy a localStorage-backed store's raw value aside. A no-op for stores
 * that are not in localStorage (the file-backed ones keep their own copy,
 * see `tauri-storage.ts`).
 */
function preserveRawValue(storeName: string): boolean {
  try {
    const raw = localStorage.getItem(storeName);
    if (raw === null) return false;
    localStorage.setItem(corruptBackupKey(storeName), raw);
    return true;
  } catch (err) {
    // No localStorage, or the quota is full. Nothing more can be done here.
    logStore("warn", `Could not keep a copy of the unusable '${storeName}' value`, err);
    return false;
  }
}

/** Log a store's rehydration failure, keep its raw value, tell the user once. */
export function reportRehydrateError(storeName: string, error: unknown): void {
  const kept = preserveRawValue(storeName);
  logStore(
    "error",
    `Could not restore '${storeName}' — starting it on defaults` +
      (kept ? `; the saved value was kept as '${corruptBackupKey(storeName)}'` : ""),
    error,
  );
  if (toastShown) return;
  toastShown = true;
  setTimeout(() => {
    toast.error(t("toast.settingsRestoreFailed"), {
      description: t("toast.settingsRestoreFailedDescription"),
      duration: Infinity,
    });
  }, REHYDRATE_TOAST_DELAY_MS);
}

/**
 * The post-rehydration callback of a store with nothing else to do there.
 * Written inline at each store so `persist` still infers the state type:
 *
 *   onRehydrateStorage: () => (_state, error) =>
 *     handleRehydrateResult("notesage-workspace", error),
 */
export function handleRehydrateResult(storeName: string, error: unknown): void {
  if (error) reportRehydrateError(storeName, error);
}
