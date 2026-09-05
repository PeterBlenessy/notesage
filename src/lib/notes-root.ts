import { INBOX_FOLDER_NAME } from "@/lib/inbox";

/**
 * The library root as an absolute path.
 *
 * `settings.notesRootPath` is stored as typed — `~/Notesage` by default — and
 * the tilde had been expanded inline at three call sites, each slightly
 * differently. One helper, one rule: a leading `~` is the home directory,
 * nothing else is touched, and `null` means the home directory is not known
 * yet (it is resolved once at startup and never persisted).
 */
export function resolveNotesRoot(notesRootPath: string, homeDir: string | null): string | null {
  const trimmed = notesRootPath.trim().replace(/\/+$/, "");
  if (trimmed === "") return null;
  if (trimmed === "~") return homeDir;
  if (trimmed.startsWith("~/")) {
    return homeDir ? `${homeDir.replace(/\/+$/, "")}${trimmed.slice(1)}` : null;
  }
  return trimmed;
}

/**
 * Where the share extensions land captures: `<library root>/Inbox`.
 *
 * The folder name is a literal by contract (see `inbox.ts`): the phone, the
 * Mac share menu and the desktop all agree on it, and it is what the user
 * sees in Finder and Files.
 */
export function inboxDir(notesRoot: string): string {
  return `${notesRoot.replace(/\/+$/, "")}/${INBOX_FOLDER_NAME}`;
}

/** The Inbox's own metadata folder, the way a project keeps `.notesage/`. */
export function inboxMetaDir(notesRoot: string): string {
  return `${inboxDir(notesRoot)}/.notesage`;
}

/**
 * The folder whose name the desktop recorder and the phone agree on — a
 * literal for the same reason the Inbox is one.
 */
export const RECORDINGS_FOLDER_NAME = "Recordings";

/**
 * Where recording bundles live: `<library root>/Recordings`. Follows the
 * Inbox's root rule (`settings.icloudNotesagePath` when sync is on, else
 * `resolveNotesRoot`), so on the phone `Recordings/` sits beside `Inbox/` and
 * a bundle the phone finalizes there is what the Mac's scanner lists.
 */
export function recordingsDir(notesRoot: string): string {
  return `${notesRoot.replace(/\/+$/, "")}/${RECORDINGS_FOLDER_NAME}`;
}
