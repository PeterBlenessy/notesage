import { create } from "zustand";

interface TagStore {
  /** All known tags (without # prefix), sorted */
  tags: string[];
  /** Map of tag name → file paths containing that tag */
  filesByTag: Record<string, string[]>;
  /** Replace both tags and file mapping from a scan result */
  setScanResult: (filesByTag: Record<string, string[]>) => void;
}

export const useTagStore = create<TagStore>((set) => ({
  tags: [],
  filesByTag: {},
  setScanResult: (filesByTag) =>
    set({ tags: Object.keys(filesByTag).sort(), filesByTag }),
}));
