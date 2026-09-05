import { useEffect } from "react";
import { iosConsumeLaunchRoute, onIosNotificationRoute } from "@/lib/ios-api";
import { INBOX_FOLDER_NAME } from "@/lib/inbox";
import { useMobileStore, type GrantState } from "@/stores/mobile-store";

function landOnInbox(route: string | null) {
  if (route === "inbox") useMobileStore.getState().jumpToFolder({ relPath: INBOX_FOLDER_NAME, name: INBOX_FOLDER_NAME });
}

/**
 * A notification tap lands on the Inbox. Warm taps arrive as the
 * `notesage:notification` event from the native delegate; a cold launch
 * keeps the route natively until the frontend asks for it, which it does
 * once the grant is in — before that there is no library to land in.
 * Mounted at the app root, like every listener that must outlive a screen.
 */
export function useNotificationRoute(grantState: GrantState): void {
  useEffect(() => onIosNotificationRoute(landOnInbox), []);
  useEffect(() => {
    if (grantState !== "granted") return;
    void iosConsumeLaunchRoute().then(landOnInbox).catch(() => {});
  }, [grantState]);
}
