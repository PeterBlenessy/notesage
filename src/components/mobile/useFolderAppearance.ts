import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { resolveFolderIcon, type FolderAppearance } from "@/lib/folder-icon";
import { folderAppearanceFor } from "@/lib/folder-appearance-cache";
import type { FileEntry } from "@/lib/tauri";

/**
 * The folder's icon and colour as chosen on the Mac (#140), resolved with
 * the desktop's own `resolveFolderIcon` so both apps agree on what "Star,
 * teal" looks like. Defaults to the plain folder until the read lands.
 */
export function useFolderAppearance(entry: FileEntry): { Icon: LucideIcon; color: string | undefined } {
  const [appearance, setAppearance] = useState<FolderAppearance | null>(null);
  useEffect(() => {
    if (!entry.is_directory) return;
    // A re-listing that bumped this folder's mtime is a fresh read: show the
    // plain folder while it lands rather than the appearance it used to have.
    setAppearance((prev) => (prev === null ? prev : null));
    let cancelled = false;
    void folderAppearanceFor(entry.path, entry.modified).then((a) => {
      if (!cancelled) setAppearance(a);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.is_directory, entry.path, entry.modified]);
  const resolved = resolveFolderIcon({ type: "standard", name: entry.name, appearance: appearance ?? undefined });
  return { Icon: resolved.icon, color: resolved.color };
}
