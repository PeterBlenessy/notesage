/**
 * Tell the user how an action ended — on whichever surface they are actually
 * looking at.
 *
 * `toast.error` is not enough on iOS any more. Since the browsing surface
 * went native (#1000) the folder screens are `UIViewController`s and the web
 * view is not on screen behind them, so a sonner toast raised from a menu
 * action renders into a view nobody can see. The user confirms a destructive
 * action, nothing happens, and nothing says why — which is exactly how folder
 * delete read as "the app ignores me" rather than "this failed".
 *
 * So: ask the native layer first, fall back to the toast. The native call
 * rejects off-iOS (desktop dev, tests, a build without the plugin), which is
 * the same signal as "there is no native screen covering anything".
 *
 * The sheet is `iosContextMenu` with no items — the presenter the delete
 * confirmation already uses — rather than a new plugin command. A message
 * with one dismiss row IS an action sheet with no actions, and reusing it
 * keeps this to one file instead of seven.
 */

import { toast } from "sonner";

import { setChromeStatus } from "@/components/mobile/chrome-status";
import { t } from "@/lib/i18n";
import { iosContextMenu } from "@/lib/ios-api";

/**
 * Show `message` as a native sheet, or as a toast where there is no native
 * layer. Never throws: a failure to report a failure must not replace the
 * original error with a second one.
 */
export async function reportActionError(message: string): Promise<void> {
  try {
    await iosContextMenu({ title: message, items: [], cancelLabel: t("common.ok") });
  } catch {
    // Nested, not a sibling: a `<Toaster>` that is not mounted throws too,
    // and an exception raised while reporting a failure would surface as a
    // different failure than the one that happened.
    try {
      toast.error(message);
    } catch {
      /* nothing left to tell them with */
    }
  }
}

/** How long a confirmation sits in the status line before clearing itself. */
const CONFIRMATION_MS = 2600;

let clearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Say an action SUCCEEDED, without making the user dismiss anything.
 *
 * The native status line (`chrome-status.ts`), not the error sheet: a modal
 * that has to be tapped away is the right weight for "this failed and nothing
 * happened" and the wrong weight for "done". It is the same bottom-centre slot
 * the background sweep uses, it is drawn natively so it is visible over a
 * native folder screen, and it is passive — `busy: false`, no spinner.
 *
 * Self-clearing, because nothing else would clear it: the sweep owns its own
 * lifecycle and a confirmation has none. A sweep running at the same moment
 * wins the slot back on its next document, which is the right precedence —
 * work in progress outranks an acknowledgement of work already done.
 */
export function reportActionDone(message: string): void {
  if (clearTimer !== null) clearTimeout(clearTimer);
  setChromeStatus({ label: message, busy: false });
  clearTimer = setTimeout(() => {
    clearTimer = null;
    setChromeStatus(null);
  }, CONFIRMATION_MS);
}

/** Test seam: drop a pending clear so one test cannot bleed into the next. */
export function resetActionReporting(): void {
  if (clearTimer !== null) clearTimeout(clearTimer);
  clearTimer = null;
}
