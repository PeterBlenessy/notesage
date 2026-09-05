import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { onAction } from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { tauriApi } from "@/lib/tauri";
import { notify } from "@/lib/notifications";
import { useInboxStore, type InboxItem } from "@/stores/inbox-store";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * useInboxArrivals — the Mac's side of Inbox notifications (PRD
 * 2026-09-05-ios-notifications, "The Mac's side"; task #14).
 *
 * Mounted once in `App.tsx`. Three jobs:
 *
 * 1. Watch the `Inbox/` folder and reload the listing on any change under
 *    it — moved here from `InboxSection`, which unmounts with the sidebar on
 *    ⌘⇧L (the surface-scoped-listener class of bug,
 *    `project_always_mounted_listeners`).
 * 2. Diff the listing across loads and announce arrivals: the first
 *    completed load for a root is the baseline (startup must not announce a
 *    backlog); every later load that adds names produces ONE notification —
 *    "New in Inbox" with the item's title for one, "N new in Inbox" for
 *    several. Gated on `settings.notifyInboxCaptures` and suppressed while
 *    the window is focused AND the Inbox view is open (the user is looking
 *    at the list already).
 * 3. Clicking the notification opens the Inbox and focuses the window.
 *
 * The Mac's own Share Extension captures are indistinguishable from the
 * phone's on disk and are announced too — deliberately: the desktop sheet
 * closes at once, and "it landed" is worth one banner.
 */

/** Payload key on the notification so the click handler knows it is ours. */
export const INBOX_NOTIFICATION_EXTRA = { inbox: true } as const;

/** Reload debounce after a change under the folder — a share writes the
 *  file and its sidecar in quick succession; one listing covers both. */
const RELOAD_DEBOUNCE_MS = 300;

/** How many names the multi-item body lists before "and N more". */
const LISTED_TITLES = 2;

function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The item's title: the cached article header when already read, else the filename stem. */
function titleOf(item: InboxItem, meta: ReturnType<typeof useInboxStore.getState>["meta"]): string {
  const cached = meta[item.path]?.title?.trim();
  return cached || stem(item.name);
}

/**
 * The one notification for a batch of arrivals. Exported for the test and
 * kept pure: `{ title, body }` from the added items.
 */
export function arrivalNotification(
  added: InboxItem[],
  meta: ReturnType<typeof useInboxStore.getState>["meta"],
): { title: string; body: string } {
  if (added.length === 1) {
    return { title: "New in Inbox", body: titleOf(added[0], meta) };
  }
  const titles = added.map((item) => titleOf(item, meta));
  const listed = titles.slice(0, LISTED_TITLES);
  const rest = titles.length - listed.length;
  const body = rest > 0 ? `${listed.join(", ")} and ${rest} more` : titles.join(" and ");
  return { title: `${added.length} new in Inbox`, body };
}

/** True when the user already has the list in front of them. */
function inboxIsInView(): boolean {
  return document.hasFocus() && useInboxStore.getState().open;
}

export function useInboxArrivals(): void {
  const dir = useInboxStore((s) => s.dir);
  const hasItems = useInboxStore((s) => s.items.length > 0);

  // 1a. Watch the folder once its path is known. The sidecar's own writes
  //     are self-marked and filtered out by the watcher.
  const watchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!dir || watchedRef.current === dir) return;
    watchedRef.current = dir;
    void tauriApi.watchDirectory(dir).catch(() => {
      // No folder yet. The effect re-runs when the first listing finds
      // something (`hasItems` flips), which is when the folder exists.
      watchedRef.current = null;
    });
  }, [dir, hasItems]);

  // 1b. Reload on any change under the folder (not its `.notesage/` sidecar).
  useEffect(() => {
    let timer: number | null = null;
    const unlisten = listen<Array<{ path: string; kind: string }>>("file-changed-batch", (event) => {
      const root = useInboxStore.getState().dir;
      if (!root) return;
      const prefix = `${root}/`;
      const touched = event.payload.some((c) => c.path.startsWith(prefix) && !c.path.startsWith(`${prefix}.notesage/`));
      if (!touched) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void useInboxStore.getState().load();
      }, RELOAD_DEBOUNCE_MS);
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      void unlisten.then((fn) => fn());
    };
  }, []);

  // 2. Baseline-then-diff of the listing's names, keyed on the root. A load
  //    "completes" when `loading` flips false with no error; the store sets
  //    `items` and `loading` in the same update, so a completed load is one
  //    state change. Keyed on the root because startup resolves it in two
  //    steps (local, then iCloud) and each root's first listing is its own
  //    baseline, never an "arrival". Only completed loads move the baseline:
  //    a removal outside a load (file / trash) leaves the name in it, so a
  //    listing that still shows the file for a moment cannot re-announce it.
  useEffect(() => {
    let baselineRoot: string | null = null;
    let baseline: Set<string> | null = null;
    return useInboxStore.subscribe((state, previous) => {
      if (state.dir !== baselineRoot) {
        baselineRoot = state.dir;
        baseline = null;
      }
      if (!state.dir) return;
      if (!(previous.loading && !state.loading && !state.error)) return;
      const names = new Set(state.items.map((item) => item.name));
      if (!baseline) {
        baseline = names;
        return;
      }
      // The store reads a failed listing as "no Inbox yet" (empty). An
      // empty listing after a non-empty one is therefore ambiguous — the
      // user trashed everything, or the disk blinked — and moving the
      // baseline to {} would re-announce the whole backlog when it comes
      // back. Nothing was added either way; keep the names.
      if (names.size === 0) return;
      const prev = baseline;
      baseline = names;
      const added = state.items.filter((item) => !prev.has(item.name));
      if (added.length === 0) return;
      if (!useSettingsStore.getState().notifyInboxCaptures) return;
      if (inboxIsInView()) return;
      const { title, body } = arrivalNotification(added, state.meta);
      void notify("inbox_capture", title, body, { ...INBOX_NOTIFICATION_EXTRA });
    });
  }, []);

  // 3. Clicking the notification opens the Inbox and focuses the window
  //    (the `useSessionManager` pattern). Defensive — the plugin / window
  //    API may be unavailable (headless / tests); failures are swallowed.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    onAction((notification) => {
      if (notification.extra?.inbox !== true) return;
      useInboxStore.getState().openInbox();
      getCurrentWindow().setFocus().catch(() => {});
    })
      .then((handle) => {
        cleanup = () => handle.unregister();
      })
      .catch(() => {
        // Plugin unavailable — no click-to-open, notifications still fire.
      });
    return () => cleanup?.();
  }, []);
}
