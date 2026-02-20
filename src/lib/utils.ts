import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a filesystem path for user-facing display.
 * - Replaces ~/Library/Mobile Documents/com~apple~CloudDocs with "iCloud Drive"
 * - Replaces home directory with "~"
 */
export function formatDisplayPath(path: string, homeDir?: string): string {
  // iCloud Drive path on macOS
  const icloudMarker = "Library/Mobile Documents/com~apple~CloudDocs";
  const icloudIdx = path.indexOf(icloudMarker);
  if (icloudIdx !== -1) {
    const rest = path.slice(icloudIdx + icloudMarker.length);
    return "iCloud Drive" + rest;
  }

  // Shorten home directory to ~
  if (homeDir && path.startsWith(homeDir)) {
    return "~" + path.slice(homeDir.length);
  }

  return path;
}
