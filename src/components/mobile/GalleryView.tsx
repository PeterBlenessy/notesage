import type { FileEntry } from "@/lib/tauri";
import { GalleryCard } from "./GalleryCard";

interface GalleryViewProps {
  entries: FileEntry[];
  currentFolderName: string;
  theme: "light" | "dark";
  onActivate: (entry: FileEntry) => void;
}

/**
 * Notes-style gallery grid (#633) — the alternative to `LibraryBrowser`'s
 * single-column list. Fixed at 3 columns across, per the source screenshot;
 * responsive/landscape reflow is left to a future pass.
 */
export function GalleryView({ entries, currentFolderName, theme, onActivate }: GalleryViewProps) {
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-5 px-3 pb-4" role="list" aria-label="Notes gallery">
      {entries.map((entry) => (
        <GalleryCard
          key={entry.path}
          entry={entry}
          currentFolderName={currentFolderName}
          theme={theme}
          onActivate={onActivate}
        />
      ))}
    </div>
  );
}
